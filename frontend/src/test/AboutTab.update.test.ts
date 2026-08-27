import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ authFetch: vi.fn() }))
const aboutMocks = vi.hoisted(() => ({
  stopForeground: vi.fn(),
  toastInfo: vi.fn(),
}))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  getApiBase: async () => '',
  authFetch: apiMocks.authFetch,
}))

vi.mock('../composables/useSettings', async () => {
  const { reactive, ref } = await vi.importActual<typeof import('vue')>('vue')
  const settings = reactive({ locale: 'zh', auto_check_updates: true })
  const settingsLoaded = ref(true)
  return {
    settings,
    settingsLoaded,
    useSettings: () => ({ settings, settingsLoaded, saveSettings: vi.fn() }),
  }
})

vi.mock('../composables/useAppForeground', () => ({
  getIsAppForeground: () => true,
  onAppForegroundGain: () => aboutMocks.stopForeground,
}))

vi.mock('vue-toastification', () => ({
  useToast: () => ({ info: aboutMocks.toastInfo }),
}))

describe('AboutTab personal fork update checks', () => {
  beforeEach(() => {
    aboutMocks.stopForeground.mockClear()
    aboutMocks.toastInfo.mockClear()
    apiMocks.authFetch.mockReset()
    apiMocks.authFetch.mockImplementation(async (input: string) => {
      const body =
        input === '/api/info'
          ? { version: '0.22.0', repo_url: 'https://github.com/scyrank/dinotty' }
          : { status: 'up_to_date', current_version: '0.22.1', latest_version: '0.22.1' }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  })

  it('shows version information and the fork update control', async () => {
    const { default: AboutTab } = await import('../components/settings/AboutTab.vue')
    const wrapper = mount(AboutTab)
    await flushPromises()

    expect(wrapper.text()).toContain('0.22.0')
    expect(wrapper.find('#auto-check-updates').exists()).toBe(true)
    expect(wrapper.find('.update-card').exists()).toBe(false)
    expect(apiMocks.authFetch).toHaveBeenCalledTimes(2)
    expect(apiMocks.authFetch).toHaveBeenCalledWith('/api/info')
    expect(aboutMocks.toastInfo).not.toHaveBeenCalled()

    wrapper.unmount()
    expect(aboutMocks.stopForeground).toHaveBeenCalledOnce()
  })
})
