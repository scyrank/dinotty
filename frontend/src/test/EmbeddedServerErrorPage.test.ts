import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import EmbeddedServerErrorPage from '../components/EmbeddedServerErrorPage.vue'

describe('EmbeddedServerErrorPage', () => {
  it('explains that the failure is local and offers a dynamic-port retry', async () => {
    const wrapper = mount(EmbeddedServerErrorPage, {
      props: {
        error: {
          code: 'embedded_port_access_denied',
          message: 'Windows denied access to fixed loopback port 8999.',
          canRetryDynamic: true,
        },
        retrying: false,
      },
    })

    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.text()).toMatch(/GitHub.*ChatGPT.*API/)
    expect(wrapper.text()).toContain('Windows denied access to fixed loopback port 8999.')

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('does not offer a retry when the backend marks the failure as strict', () => {
    const wrapper = mount(EmbeddedServerErrorPage, {
      props: {
        error: {
          code: 'embedded_server_already_started',
          message: 'The local service is already running.',
          canRetryDynamic: false,
        },
        retrying: false,
      },
    })

    expect(wrapper.find('button').exists()).toBe(false)
  })
})
