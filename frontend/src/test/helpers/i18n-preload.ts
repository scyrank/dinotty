// Locale tables load lazily in the app; tests call t() synchronously, so both
// tables are preloaded before any test runs. Import from i18n/tables directly:
// importing useI18n here would pull useSettings into the module registry
// before the test files' vi.mock calls are registered.
import { loadLocale } from '../../composables/i18n/tables'

// Happy DOM 20 no longer provides the native dialog functions by default.
// Tests replace these with spies when the return value matters.
if (typeof window !== 'undefined' && typeof window.confirm !== 'function') {
  window.confirm = () => false
}

await loadLocale('en')
await loadLocale('zh')
