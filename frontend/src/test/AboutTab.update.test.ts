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

describe('AboutTab personal fork update policy', () => {
  beforeEach(() => {
    aboutMocks.stopForeground.mockClear()
    aboutMocks.toastInfo.mockClear()
    apiMocks.authFetch.mockReset()
    apiMocks.authFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          version: '0.22.0',
          repo_url: 'https://github.com/scyrank/dinotty',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
  })

  it('shows version information without checks, controls, cards, or prompts', async () => {
    const { default: AboutTab } = await import('../components/settings/AboutTab.vue')
    const wrapper = mount(AboutTab)
    await flushPromises()

    expect(wrapper.text()).toContain('0.22.0')
    expect(wrapper.find('#auto-check-updates').exists()).toBe(false)
    expect(wrapper.find('.update-card').exists()).toBe(false)
    expect(apiMocks.authFetch).toHaveBeenCalledOnce()
    expect(apiMocks.authFetch).toHaveBeenCalledWith('/api/info')
    expect(aboutMocks.toastInfo).not.toHaveBeenCalled()

    wrapper.unmount()
    expect(aboutMocks.stopForeground).toHaveBeenCalledOnce()
  })
})
