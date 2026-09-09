import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    vue({
      // Unit tests only inspect rendered attributes. Keeping asset URLs as
      // strings avoids resolving public-root paths such as /logo.png as local
      // filesystem modules under Vitest 4.
      template: { transformAssetUrls: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableIframePageLoading: true,
          disableJavaScriptFileLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
          navigation: {
            disableChildFrameNavigation: true,
            disableChildPageNavigation: true,
            disableMainFrameNavigation: true,
          },
        },
      },
    },
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: ['src/test/helpers/i18n-preload.ts'],
  },
})
