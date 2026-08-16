import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  getApiBase: vi.fn(async () => ''),
}))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: apiMocks.authFetch,
  getApiBase: apiMocks.getApiBase,
}))

describe('useUpdateCheck personal fork policy', () => {
  beforeEach(() => {
    apiMocks.authFetch.mockReset()
    apiMocks.getApiBase.mockClear()
  })

  it('keeps automatic and explicit checks disabled without network access', async () => {
    const { UPDATE_CHECKS_ENABLED, useUpdateCheck } = await import('../composables/useUpdateCheck')
    const update = useUpdateCheck()

    await update.start()
    await update.recheck()

    expect(UPDATE_CHECKS_ENABLED).toBe(false)
    expect(update.status.value).toBe('idle')
    expect(apiMocks.getApiBase).not.toHaveBeenCalled()
    expect(apiMocks.authFetch).not.toHaveBeenCalled()
  })

  it('never exposes an update prompt', async () => {
    const { useUpdateCheck } = await import('../composables/useUpdateCheck')
    const update = useUpdateCheck()

    await update.start()

    expect(update.takeAvailablePrompt()).toBeNull()
    expect(update.releaseUrl.value).toBe('')
  })
})
