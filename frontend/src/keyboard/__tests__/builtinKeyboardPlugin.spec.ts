import { describe, expect, it, vi, beforeAll } from 'vitest'
import { mount } from '@vue/test-utils'
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { ref, type Component } from 'vue'
import * as hostVue from 'vue'
import { installHostBridge } from '../installHostBridge'
import { createKeyboardContext } from '../createKeyboardContext'

// Breaks the settings -> ... -> usePluginLoader -> useEventBridge ->
// useSyncWebSocket -> usePluginLoader cycle (known issue, same as
// createKeyboardContext.spec.ts).
vi.mock('../../composables/useEventBridge', () => ({
  subscribe: vi.fn(() => ({ dispose() {} })),
  emit: vi.fn(),
}))

// Phase 1b-iv contract: the builtin-keyboard plugin bundle (built in the
// dinotty-plugins repo from the moved MobileKeyboard source) must load under
// the host bridges and mount its keyboard component on the host Vue runtime
// with the KeyboardContext prop surface (no legacy visible/paneId/getSendFn).
//
// vite-node refuses to load files from the sibling dinotty-plugins checkout,
// so beforeAll copies the bundle bytes into __plugin_bundles__/ (gitignored)
// and the tests import the copy.

const BUNDLE_DIR = resolvePath(
  __dirname,
  '../../../../../dinotty-plugins/builtin-keyboard',
)
const FIXTURE = './__plugin_bundles__/builtin-keyboard/main.js'

type BundleModule = {
  activate: () => {
    keyboard: { id: string; component: Component; desiredHeight: unknown }
  }
}

beforeAll(() => {
  ;(window as unknown as Record<string, unknown>).__DINOTTY_VUE__ = hostVue
  installHostBridge()
  // happy-dom has no visualViewport; ctx.onViewportResize needs it.
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      height: 700,
      offsetTop: 0,
      addEventListener() {},
      removeEventListener() {},
    },
  })

  const dest = resolvePath(__dirname, '__plugin_bundles__/builtin-keyboard')
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  copyFileSync(resolvePath(BUNDLE_DIR, 'main.js'), resolvePath(dest, 'main.js'))
})

async function loadBundle(): Promise<BundleModule> {
  return (await import(FIXTURE)) as BundleModule
}

function makeCtx() {
  return createKeyboardContext({
    visible: ref(true),
    activePaneId: ref('p1'),
    sendActive: async () => {},
    sendBroadcast: async () => {},
    sendToPane: async () => {},
    nativeImeOpen: ref(false),
    setNativeImeOpen: () => {},
    onHostEvent: () => {},
  })
}

describe('builtin-keyboard plugin bundle', () => {
  it('contributes the keyboard provider with the expected id', async () => {
    const mod = await loadBundle()
    const { keyboard } = mod.activate()
    expect(keyboard.id).toBe('builtin-keyboard')
    expect(keyboard.component).toBeTruthy()
    expect(keyboard.desiredHeight).toBe('auto')
  })

  it('contains no bare module imports', () => {
    const src = readFileSync(
      resolvePath(__dirname, '__plugin_bundles__/builtin-keyboard/main.js'),
      'utf8',
    )
    const bare = [...src.matchAll(/from\s*["']([^"']+)["']/g)]
      .map((m) => m[1])
      .filter((s) => !s.startsWith('.') && !s.startsWith('/'))
    expect(bare).toEqual([])
  })

  it('mounts MobileKeyboard with a KeyboardContext prop', async () => {
    const mod = await loadBundle()
    const { keyboard } = mod.activate()
    const wrapper = mount(keyboard.component, {
      props: { ctx: makeCtx() },
    })
    // The keyboard band renders its bar; content renders key rows.
    expect(wrapper.element.children.length).toBeGreaterThan(0)
    wrapper.unmount()
  })
})
