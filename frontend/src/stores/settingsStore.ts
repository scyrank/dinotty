import { defineStore } from 'pinia'
import {
  useSettings,
  applyCurrentTheme,
  getCurrentXtermTheme,
  onThemeChange,
  onTextChange,
  notifyTextChange,
} from '../composables/useSettings'
import type { SettingsData, TextConfig } from '../composables/useSettings'
import type { getXtermTheme } from '../themes'

/**
 * Settings store — wraps the existing useSettings composable singleton.
 *
 * The underlying settings state is a module-level reactive object in
 * useSettings.ts, so this store acts as a Pinia-compatible facade rather
 * than duplicating state. All consumers should import this store instead
 * of calling useSettings() directly.
 */
export const useSettingsStore = defineStore('settings', () => {
  // Call useSettings() to get the saveSettings/loadSettings functions
  // (they are not exported at module level, only via the composable return)
  const { settings, saveSettings, loadSettings } = useSettings()

  // ── Actions ────────────────────────────────────────────

  /** Load settings from the server */
  async function load() {
    await loadSettings()
  }

  /** Save current settings to the server */
  async function save() {
    await saveSettings()
  }

  /** Apply the current theme to the DOM */
  function applyTheme() {
    applyCurrentTheme()
  }

  /** Get the resolved xterm theme object */
  function getXtermThemeConfig(): ReturnType<typeof getCurrentXtermTheme> {
    return getCurrentXtermTheme()
  }

  /** Subscribe to theme changes. Returns an unsubscribe function. */
  function onTheme(fn: (xtermTheme: ReturnType<typeof getXtermTheme>) => void) {
    return onThemeChange(fn)
  }

  /** Subscribe to text config changes. Returns an unsubscribe function. */
  function onText(fn: (text: TextConfig) => void) {
    return onTextChange(fn)
  }

  /** Notify all text change listeners */
  function notifyText() {
    notifyTextChange()
  }

  return {
    // State (reactive reference from useSettings singleton)
    settings,

    // Actions
    load,
    save,
    applyTheme,
    getXtermThemeConfig,
    onTheme,
    onText,
    notifyText,
  }
})

// Re-export types for convenience
export type { SettingsData, TextConfig }
