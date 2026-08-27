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

vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
}))

const availableResponse = {
  status: 'update_available',
  current_version: '0.22.1',
  latest_version: '0.22.2',
  published_at: '2026-08-01T08:00:00Z',
  release_url: 'https://github.com/scyrank/dinotty/releases/tag/personal-v0.22.2-20260801',
}

async function freshUpdateCheck() {
  vi.resetModules()
  return import('../composables/useUpdateCheck')
}

describe('useUpdateCheck personal fork policy', () => {
  beforeEach(() => {
    apiMocks.authFetch.mockReset()
    apiMocks.getApiBase.mockClear()
  })

  it('checks the personal fork and maps an available release', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify(availableResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { UPDATE_CHECKS_ENABLED, useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()

    await update.start()

    expect(UPDATE_CHECKS_ENABLED).toBe(true)
    expect(apiMocks.authFetch).toHaveBeenCalledWith('/api/update-check', {
      signal: expect.any(AbortSignal),
    })
    expect(update.status.value).toBe('update_available')
    expect(update.latestVersion.value).toBe('0.22.2')
    expect(update.releaseUrl.value).toBe(availableResponse.release_url)
  })

  it('allows one explicit recheck without changing normal start deduplication', async () => {
    apiMocks.authFetch.mockImplementation(
      async () =>
        new Response(JSON.stringify(availableResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()

    await update.start()
    await update.recheck()
    await update.start()

    expect(apiMocks.authFetch).toHaveBeenCalledTimes(2)
    expect(update.status.value).toBe('update_available')
  })

  it('exposes an available update prompt only once', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify(availableResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()

    expect(update.takeAvailablePrompt()).toBeNull()
    await update.start()

    expect(update.takeAvailablePrompt()).toEqual({
      currentVersion: '0.22.1',
      latestVersion: '0.22.2',
    })
    expect(update.takeAvailablePrompt()).toBeNull()
  })

  it('rejects release URLs outside the personal fork', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          ...availableResponse,
          release_url: 'https://github.com/xichan96/dinotty/releases/tag/v0.22.2',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()

    await update.start()

    expect(update.status.value).toBe('unavailable')
    expect(update.releaseUrl.value).toBe('')
  })
})
