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
    const invoke = vi.fn().mockResolvedValue('dpapi-backed-token')
    ;(window as any).__TAURI_INTERNALS__ = { invoke }
    vi.resetModules()
    const { fetchAutoToken } = await import('../composables/apiBase')

    await expect(fetchAutoToken()).resolves.toBe('dpapi-backed-token')
    expect(invoke).toHaveBeenCalledWith('embedded_auth_token', {})
  })

  it('initializes the Rust HTTP bridge bearer before desktop API calls', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'embedded_auth_token') return 'dpapi-backed-token'
      if (command === 'embedded_http_origin') return 'http://127.0.0.1:8999'
      throw new Error(`unexpected command: ${command}`)
    })
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    ;(window as any).__TAURI_INTERNALS__ = { invoke }
    vi.stubGlobal('fetch', fetch)
    vi.resetModules()
    const api = await import('../composables/apiBase')

    await expect(api.authenticateEmbeddedDesktop()).resolves.toBe(true)
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8999/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'dpapi-backed-token' }),
    })
    expect(api.authHeaders()).toEqual({ Authorization: 'Bearer dpapi-backed-token' })
  })
})
