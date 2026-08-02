import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasAuthToken, markCookieAuthenticated } from '../composables/apiBase'

afterEach(() => {
  delete (window as any).__TAURI_INTERNALS__
  localStorage.clear()
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
})
