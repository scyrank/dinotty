<template>
  <div class="embedded-error-screen">
    <section class="embedded-error-card" role="alert" aria-live="assertive">
      <img src="/logo.png" alt="Dinotty" class="embedded-error-logo" />
      <h1>{{ t('embeddedStartup.title') }}</h1>
      <p class="embedded-error-summary">{{ t('embeddedStartup.summary') }}</p>
      <pre class="embedded-error-detail">{{ error.message }}</pre>
      <p class="embedded-error-hint">{{ t('embeddedStartup.noTokenHint') }}</p>
      <button
        v-if="error.canRetryDynamic"
        type="button"
        class="embedded-error-button"
        :disabled="retrying"
        @click="$emit('retry')"
      >
        {{ retrying ? t('embeddedStartup.retrying') : t('embeddedStartup.retryDynamic') }}
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { EmbeddedServerStartupError } from '../composables/apiBase'
import { useI18n } from '../composables/useI18n'

defineProps<{
  error: EmbeddedServerStartupError
  retrying: boolean
}>()

defineEmits<{
  retry: []
}>()

const { t } = useI18n()
</script>

<style scoped>
.embedded-error-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  color: var(--text-primary, #e8e8e8);
  background: var(--bg-primary, #111);
}

.embedded-error-card {
  width: min(560px, 100%);
  padding: 32px;
  border: 1px solid var(--border-color, #3d3d3d);
  border-radius: 12px;
  background: var(--bg-secondary, #1d1d1d);
  box-shadow: 0 16px 48px rgb(0 0 0 / 35%);
}

.embedded-error-logo {
  width: 48px;
  height: 48px;
}

h1 {
  margin: 18px 0 10px;
  font-size: 22px;
}

.embedded-error-summary,
.embedded-error-hint {
  color: var(--text-secondary, #aaa);
  line-height: 1.6;
}

.embedded-error-detail {
  margin: 18px 0;
  padding: 12px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  border-radius: 6px;
  color: #ffb4ab;
  background: rgb(255 80 80 / 8%);
  font: 12px/1.6 var(--font-mono, monospace);
}

.embedded-error-button {
  margin-top: 8px;
  padding: 10px 18px;
  border: 0;
  border-radius: 6px;
  color: white;
  background: var(--accent-color, #3b82f6);
  cursor: pointer;
}

.embedded-error-button:disabled {
  cursor: wait;
  opacity: 0.65;
}
</style>
