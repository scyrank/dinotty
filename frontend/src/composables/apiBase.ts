import { isTauri, tauriInvoke } from './useTransport'

const LEGACY_STORAGE_KEY = 'dinotty_auth_token'

// Browser mode: cookie-based session (no token in localStorage).
// Tauri mode: keep the Bearer token in memory only. The Rust command reads it
// from the OS-protected settings location when the desktop app starts.
let loggedIn = false
let desktopAuthToken = ''
if (typeof localStorage !== 'undefined') {
  // One-time cleanup for versions that persisted the raw token in WebView
  // localStorage.
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}
// Session-authenticated with no bearer token: a desktop/web cookie session.
// setAuthToken() is never called on this path, so hasAuthToken() must not
// depend on a stored token alone.
let sessionAuthed = false

let cached = ''
let cachedBootstrap: EmbeddedServerBootstrap | null = null
let inflight: Promise<EmbeddedServerBootstrap> | null = null

export interface EmbeddedServerBootstrap {
  mode: 'embedded'
  host: string
  port: number
  baseUrl: string
  token: string
}

export interface EmbeddedServerStartupError {
  code: string
  message: string
  canRetryDynamic: boolean
}

export function normalizeEmbeddedServerStartupError(error: unknown): EmbeddedServerStartupError {
  if (error && typeof error === 'object') {
    const candidate = error as Partial<EmbeddedServerStartupError>
    if (typeof candidate.message === 'string') {
      return {
        code: typeof candidate.code === 'string' ? candidate.code : 'embedded_server_start_failed',
        message: candidate.message,
        canRetryDynamic: candidate.canRetryDynamic !== false,
      }
    }
  }
  return {
    code: 'embedded_server_start_failed',
    message: error instanceof Error ? error.message : String(error || 'Unknown startup error'),
    canRetryDynamic: true,
  }
}

function applyEmbeddedBootstrap(value: EmbeddedServerBootstrap): EmbeddedServerBootstrap {
  if (value.mode !== 'embedded' || !value.baseUrl || !value.port || !value.token) {
    throw new Error('Invalid embedded server bootstrap response')
  }
  cached = value.baseUrl.replace(/\/$/, '')
  desktopAuthToken = value.token
  cachedBootstrap = { ...value, baseUrl: cached }
  return cachedBootstrap
}

function embeddedConnectionError(error: unknown): EmbeddedServerStartupError {
  const detail = error instanceof Error ? error.message : String(error || 'connection failed')
  return {
    code: 'embedded_server_unreachable',
    message: `The local Dinotty service did not respond: ${detail}`,
    canRetryDynamic: false,
  }
}

export async function getEmbeddedServerBootstrap(): Promise<EmbeddedServerBootstrap> {
  if (!isTauri()) throw new Error('Embedded server bootstrap is only available in desktop mode')
  if (cachedBootstrap) return cachedBootstrap
  if (!inflight) {
    inflight = tauriInvoke('get_embedded_server_bootstrap')
      .then((value) => applyEmbeddedBootstrap(value as EmbeddedServerBootstrap))
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export async function retryEmbeddedServerDynamic(): Promise<EmbeddedServerBootstrap> {
  if (!isTauri()) throw new Error('Dynamic embedded server retry is only available in desktop mode')
  const value = (await tauriInvoke('retry_embedded_server_dynamic')) as EmbeddedServerBootstrap
  return applyEmbeddedBootstrap(value)
}

export function getAuthToken(): string {
  if (!isTauri()) return loggedIn ? 'cookie' : ''
  return desktopAuthToken
}

export function setAuthToken(token: string): void {
  if (!isTauri()) {
    loggedIn = true
    return
  }
  desktopAuthToken = token
}

export function markCookieAuthenticated(): void {
  sessionAuthed = true
  if (!isTauri()) loggedIn = true
}

export function clearAuthToken(): void {
  sessionAuthed = false
  if (!isTauri()) {
    loggedIn = false
    return
  }
  desktopAuthToken = ''
}

export function hasAuthToken(): boolean {
  if (sessionAuthed) return true
  if (!isTauri()) return loggedIn
  return !!desktopAuthToken
}

export type ValidateTokenResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'locked'; retryAfter?: number }

export async function validateToken(token: string): Promise<ValidateTokenResult> {
  try {
    await getApiBase()
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }
    if (!isTauri()) {
      ;(init as RequestInit).credentials = 'include'
    }
    const res = await fetch(apiUrl('/api/auth'), init)
    if (res.ok) {
      setAuthToken(token)
      return { ok: true }
    }
    if (res.status === 429) {
      return { ok: false, reason: 'locked', retryAfter: parseRetryAfter(res.headers.get('Retry-After')) }
    }
    return { ok: false, reason: 'invalid' }
  } catch (error) {
    if (isTauri()) throw embeddedConnectionError(error)
    return { ok: false, reason: 'invalid' }
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const n = parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export async function checkTokenConfigured(): Promise<{
  configured: boolean
  serverMode: boolean
  loginMethod?: 'token' | 'verification_code'
}> {
  try {
    await getApiBase()
    const res = await fetch(apiUrl('/api/token-configured'))
    if (!res.ok) return { configured: true, serverMode: true }
    const data = await res.json()
    return {
      configured: !!data.configured,
      serverMode: !!data.server_mode,
      loginMethod: data.login_method === 'verification_code' ? 'verification_code' : 'token',
    }
  } catch {
    if (isTauri()) throw embeddedConnectionError('token configuration request failed')
    return { configured: true, serverMode: true }
  }
}

export async function fetchAutoToken(): Promise<string> {
  try {
    if (isTauri()) {
      return (await getEmbeddedServerBootstrap()).token
    }
    await getApiBase()
    const res = await fetch(apiUrl('/api/auto-token'))
    if (!res.ok) return ''
    const data = await res.json()
    return data.token || ''
  } catch {
    return ''
  }
}

export async function authenticateEmbeddedDesktop(): Promise<boolean> {
  if (!isTauri()) return false
  const token = await fetchAutoToken()
  if (!token) {
    throw {
      code: 'embedded_token_unavailable',
      message: 'The internal desktop authentication token is unavailable.',
      canRetryDynamic: false,
    } satisfies EmbeddedServerStartupError
  }
  const result = await validateToken(token)
  if (!result.ok) {
    throw {
      code: 'embedded_authentication_failed',
      message: 'The local Dinotty service rejected its internal desktop token.',
      canRetryDynamic: false,
    } satisfies EmbeddedServerStartupError
  }
  return true
}

export async function fetchServerToken(): Promise<string> {
  try {
    await getApiBase()
    const res = await authFetch(apiUrl('/api/token'))
    if (!res.ok) return ''
    const data = await res.json()
    return data.token || ''
  } catch {
    return ''
  }
}

export async function getApiBase(): Promise<string> {
  if (!isTauri()) {
    cached = ''
    return ''
  }
  if (cached) return cached
  return (await getEmbeddedServerBootstrap()).baseUrl
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return cached ? `${cached}${p}` : p
}

export function authHeaders(): Record<string, string> {
  if (!isTauri()) return {}
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    if (init?.body != null && typeof init.body !== 'string') {
      return new Response('desktop bridge does not support binary/multipart body', { status: 400 })
    }
    const headers = Object.entries(authHeaders())
    if (init?.headers) {
      const h = new Headers(init.headers)
      h.forEach((v, k) => headers.push([k, v]))
    }
    const resp = (await tauriInvoke('tauri_fetch', {
      url,
      method: init?.method || 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : null,
    })) as { status: number; headers: [string, string][]; body: string }
    const bodyless =
      resp.status === 204 || resp.status === 304 || (resp.status >= 100 && resp.status < 200)
    return new Response(bodyless || !resp.body ? null : resp.body, {
      status: resp.status,
      headers: resp.headers,
    })
  }
  return fetch(url, { ...init, credentials: 'include' })
}

export function wsUrlWithToken(url: string): string {
  // Browser: same-origin WS sends cookies automatically.
  // Tauri: loopback bypass or Bearer in WS URL is not needed.
  return url
}

export type RequestCodeResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: 'rate_limited' | 'unknown'; retryAfter?: number }

export async function requestCode(): Promise<RequestCodeResult> {
  try {
    await getApiBase()
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }
    if (!isTauri()) {
      ;(init as RequestInit).credentials = 'include'
    }
    const res = await fetch(apiUrl('/api/auth/request-code'), init)
    if (res.ok) {
      const data = await res.json()
      return { ok: true, requestId: String(data.request_id ?? '') }
    }
    if (res.status === 429) {
      return { ok: false, reason: 'rate_limited', retryAfter: parseRetryAfter(res.headers.get('Retry-After')) }
    }
    return { ok: false, reason: 'unknown' }
  } catch {
    return { ok: false, reason: 'unknown' }
  }
}

export type ValidateCodeResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'invalid'
        | 'locked'
        | 'not_found'
        | 'expired'
        | 'consumed'
        | 'too_many_attempts'
        | 'method_mismatch'
      retryAfter?: number
    }

export async function validateCode(requestId: string, code: string): Promise<ValidateCodeResult> {
  try {
    await getApiBase()
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, code }),
    }
    if (!isTauri()) {
      ;(init as RequestInit).credentials = 'include'
    }
    const res = await fetch(apiUrl('/api/auth'), init)
    if (res.ok) {
      setAuthToken('cookie')
      return { ok: true }
    }
    if (res.status === 429) {
      return { ok: false, reason: 'locked', retryAfter: parseRetryAfter(res.headers.get('Retry-After')) }
    }
    const data = await res.json().catch(() => ({}))
    const errStr = typeof data.error === 'string' ? data.error : ''
    if (errStr === 'code not found') return { ok: false, reason: 'not_found' }
    if (errStr === 'code expired') return { ok: false, reason: 'expired' }
    if (errStr === 'code already used') return { ok: false, reason: 'consumed' }
    if (errStr === 'too many attempts') return { ok: false, reason: 'too_many_attempts' }
    if (errStr === 'login method mismatch') return { ok: false, reason: 'method_mismatch' }
    return { ok: false, reason: 'invalid' }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}
