import type { Ref } from 'vue'
import { isTauri } from './useTransport'
import {
  resolveWindowCloseAction,
  useDesktopLifecycle,
} from './useDesktopLifecycle'
import type { useSettingsStore } from '../stores/settingsStore'
import type { useToast } from 'vue-toastification'

export interface AppTauriOptions {
  desktopLifecycle: ReturnType<typeof useDesktopLifecycle>
  settingsStore: ReturnType<typeof useSettingsStore>
  toast: ReturnType<typeof useToast>
  windowCloseConfirmVisible: Ref<boolean>
  trayVisibilityDialogVisible: Ref<boolean>
  lastTabCloseShortcutAt: Ref<number>
}

export function useAppTauri(options: AppTauriOptions) {
  const {
    desktopLifecycle,
    settingsStore,
    toast,
    windowCloseConfirmVisible,
    trayVisibilityDialogVisible,
    lastTabCloseShortcutAt,
  } = options

  let unlistenWindowClose: (() => void) | undefined
  let rememberHideAfterTrayConfirmation = false

  // Tauri window close confirmation
  // On macOS, Cmd+W is bound to the native "Close" menu item and fires CloseRequested
  // in addition to the JS keydown handler. Track when the tab-close shortcut fires so
  // the window-close-requested listener can suppress the app-exit path — Cmd+W should
  // close the tab, not quit the app.
  function setupTauriWindowClose() {
    if (!isTauri()) return
    const listen = (window as any).__TAURI__?.event?.listen
    if (!listen) return
    listen('window-close-requested', () => {
      if (Date.now() - lastTabCloseShortcutAt.value < 500) {
        return
      }
      const action = resolveWindowCloseAction(
        settingsStore.settings.close_window_behavior,
        desktopLifecycle.capabilities.value.canHideToTray
      )
      if (action === 'hide') {
        void onWindowCloseHide(false)
      } else if (action === 'quit') {
        void desktopLifecycle.requestQuit('window')
      } else {
        windowCloseConfirmVisible.value = true
      }
    }).then((fn: () => void) => {
      unlistenWindowClose = fn
    })
  }

  async function rememberCloseWindowBehavior(behavior: 'hide_to_tray' | 'quit') {
    settingsStore.settings.close_window_behavior = behavior
    await settingsStore.save()
  }

  async function onWindowCloseHide(remember: boolean) {
    windowCloseConfirmVisible.value = false
    if (desktopLifecycle.needsTrayVisibilityConfirmation()) {
      rememberHideAfterTrayConfirmation = remember
      trayVisibilityDialogVisible.value = true
      return
    }
    if ((await performHideToTray()) && remember) {
      await rememberCloseWindowBehavior('hide_to_tray')
    }
  }

  async function performHideToTray(): Promise<boolean> {
    try {
      await desktopLifecycle.hideToTray()
      return true
    } catch (error) {
      const message =
        typeof error === 'object' && error && 'message' in error
          ? String((error as { message: unknown }).message)
          : String(error)
      toast.error(message)
      return false
    }
  }

  async function onOpenSystemTraySettings() {
    try {
      await desktopLifecycle.openSystemTraySettings()
    } catch (error) {
      const message =
        typeof error === 'object' && error && 'message' in error
          ? String((error as { message: unknown }).message)
          : String(error)
      toast.error(message)
    }
  }

  async function onTrayVisibilityConfirmed() {
    desktopLifecycle.confirmTrayVisibility()
    trayVisibilityDialogVisible.value = false
    const remember = rememberHideAfterTrayConfirmation
    rememberHideAfterTrayConfirmation = false
    if ((await performHideToTray()) && remember) {
      await rememberCloseWindowBehavior('hide_to_tray')
    }
  }

  function onTrayVisibilityCancel() {
    rememberHideAfterTrayConfirmation = false
    trayVisibilityDialogVisible.value = false
  }

  function onWindowCloseQuit(remember: boolean) {
    windowCloseConfirmVisible.value = false
    if (remember) void rememberCloseWindowBehavior('quit')
    void desktopLifecycle.requestQuit('window')
  }

  function onWindowCloseCancel() {
    windowCloseConfirmVisible.value = false
  }

  function disposeTauriWindowClose() {
    unlistenWindowClose?.()
  }

  return {
    setupTauriWindowClose,
    onWindowCloseHide,
    onWindowCloseQuit,
    onWindowCloseCancel,
    onOpenSystemTraySettings,
    onTrayVisibilityConfirmed,
    onTrayVisibilityCancel,
    disposeTauriWindowClose,
  }
}
