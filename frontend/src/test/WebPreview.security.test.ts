import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebPreview from '../components/preview/WebPreview.vue'

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('WebPreview security boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps preview content in an opaque-origin sandbox', async () => {
    const wrapper = mount(WebPreview, {
      props: { visible: true, url: 'https://example.com' },
      global: {
        stubs: { DevToolsPanel: true, AddressDropdown: true },
      },
    })
    await flushPromises()

    const sandbox = wrapper.get('iframe').attributes('sandbox')
    expect(sandbox).toBe('allow-scripts allow-forms allow-popups')
    expect(sandbox).not.toContain('allow-same-origin')
    expect(sandbox).not.toContain('allow-top-navigation')

    wrapper.unmount()
  })

  it('opens an external preview without granting opener access', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const wrapper = mount(WebPreview, {
      props: { visible: true, url: 'https://example.com' },
      global: {
        stubs: { DevToolsPanel: true, AddressDropdown: true },
      },
    })
    await flushPromises()

    await wrapper.get('button[title="previewPanel.openInBrowser"]').trigger('click')
    expect(open).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer',
    )

    wrapper.unmount()
  })
})
