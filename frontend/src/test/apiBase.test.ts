import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasAuthToken, markCookieAuthenticated } from '../composables/apiBase'

afterEach(() => {
  delete (window as any).__TAURI_INTERNALS__
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('markCookieAuthenticated', () => {
  it('marks a non-Tauri session as authenticated', () => {
    markCookieAuthenticated()
    expect(hasAuthToken()).toBe(true)
  })
})

describe('Tauri token storage', () => {
  it('migrates away from localStorage and keeps the token in memory', async () => {
    localStorage.setItem('dinotty_auth_token', 'legacy-plaintext-token')
    ;(window as any).__TAURI_INTERNALS__ = { invoke: vi.fn() }
    vi.resetModules()
    const api = await import('../composables/apiBase')

    expect(localStorage.getItem('dinotty_auth_token')).toBeNull()
    api.setAuthToken('memory-only-token')
    expect(api.getAuthToken()).toBe('memory-only-token')
    expect(localStorage.getItem('dinotty_auth_token')).toBeNull()
  })

  it('loads the desktop token through the privileged Tauri command', async () => {
    const invoke = vi.fn().mockResolvedValue({
      mode: 'embedded',
      host: '127.0.0.1',
      port: 49152,
      baseUrl: 'http://127.0.0.1:49152',
      token: 'dpapi-backed-token',
    })
    ;(window as any).__TAURI_INTERNALS__ = { invoke }
    vi.resetModules()
    const { fetchAutoToken } = await import('../composables/apiBase')

    await expect(fetchAutoToken()).resolves.toBe('dpapi-backed-token')
    expect(invoke).toHaveBeenCalledWith('get_embedded_server_bootstrap', {})
    expect(localStorage.getItem('dinotty_auth_token')).toBeNull()
  })

  it('uses one dynamic bootstrap for the HTTP origin and in-memory bearer', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'get_embedded_server_bootstrap') {
        return {
          mode: 'embedded',
          host: '127.0.0.1',
          port: 49152,
          baseUrl: 'http://127.0.0.1:49152',
          token: 'dpapi-backed-token',
        }
      }
      throw new Error(`unexpected command: ${command}`)
    })
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    ;(window as any).__TAURI_INTERNALS__ = { invoke }
    vi.stubGlobal('fetch', fetch)
    vi.resetModules()
    const api = await import('../composables/apiBase')

    await expect(api.authenticateEmbeddedDesktop()).resolves.toBe(true)
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:49152/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'dpapi-backed-token' }),
    })
    expect(api.authHeaders()).toEqual({ Authorization: 'Bearer dpapi-backed-token' })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('retries a failed fixed port with a dynamic bootstrap', async () => {
    const bootstrap = {
      mode: 'embedded',
      host: '127.0.0.1',
      port: 53001,
      baseUrl: 'http://127.0.0.1:53001',
      token: 'dpapi-backed-token',
    }
    const invoke = vi.fn().mockResolvedValue(bootstrap)
    ;(window as any).__TAURI_INTERNALS__ = { invoke }
    vi.resetModules()
    const api = await import('../composables/apiBase')

    await expect(api.retryEmbeddedServerDynamic()).resolves.toEqual(bootstrap)
    expect(invoke).toHaveBeenCalledWith('retry_embedded_server_dynamic', {})
    expect(api.apiUrl('/api/settings')).toBe('http://127.0.0.1:53001/api/settings')
    expect(api.getAuthToken()).toBe('dpapi-backed-token')
  })

  it('surfaces an unreachable embedded service instead of falling back to remote login', async () => {
    const invoke = vi.fn().mockResolvedValue({
      mode: 'embedded',
      host: '127.0.0.1',
      port: 54001,
      baseUrl: 'http://127.0.0.1:54001',
      token: 'dpapi-backed-token',
    })
    ;(window as any).__TAURI_INTERNALS__ = { invoke }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))
    vi.resetModules()
    const api = await import('../composables/apiBase')

    await expect(api.checkTokenConfigured()).rejects.toMatchObject({
      code: 'embedded_server_unreachable',
      canRetryDynamic: false,
    })
  })
})
