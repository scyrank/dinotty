import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

export interface ConsoleEntry {
  id: number
  level: 'log' | 'warn' | 'info' | 'debug' | 'error' | 'clear'
  args: string[]
  ts: number
}

export interface NetworkEntry {
  id: number
  method: string
  url: string
  status: number
  duration: number
  error?: boolean
  ts: number
}

const MAX_ENTRIES = 500

function originOf(url: string): string | null {
  if (!url) return null
  try { return new URL(url).origin } catch { return null }
}

export function useDevTools() {
  const consoleEntries = ref<ConsoleEntry[]>([])
  const networkEntries = ref<NetworkEntry[]>([])
  let nextId = 1

  const allowedOrigins = new Set<string>([window.location.origin])

  function allowOrigin(url: string) {
    const o = originOf(url)
    if (o) allowedOrigins.add(o)
  }

  function isAllowedOrigin(origin: string): boolean {
    return allowedOrigins.has(origin)
  }

  const errorCount = computed(() =>
    consoleEntries.value.filter(e => e.level === 'error').length
  )

  function onMessage(e: MessageEvent) {
    if (!isAllowedOrigin(e.origin)) return
    const data = e.data
    if (!data) return

    if (data.type === 'preview-console') {
      if (data.level === 'clear') {
        consoleEntries.value = []
      } else {
        consoleEntries.value.push({
          id: nextId++,
          level: data.level,
          args: data.args || [],
          ts: data.ts || Date.now(),
        })
        if (consoleEntries.value.length > MAX_ENTRIES) {
          consoleEntries.value = consoleEntries.value.slice(-MAX_ENTRIES)
        }
      }
    } else if (data.type === 'preview-network') {
      networkEntries.value.push({
        id: nextId++,
        method: data.method || 'GET',
        url: data.url || '',
        status: data.status || 0,
        duration: data.duration || 0,
        error: data.error,
        ts: data.ts || Date.now(),
      })
      if (networkEntries.value.length > MAX_ENTRIES) {
        networkEntries.value = networkEntries.value.slice(-MAX_ENTRIES)
      }
    } else if (data.type === 'preview-error') {
      const parts: string[] = []
      if (data.message) parts.push(data.message)
      if (data.stack) parts.push(data.stack)
      if (data.source) {
        const loc = data.line ? `${data.source}:${data.line}` : data.source
        parts.unshift(`[${loc}]`)
      }
      consoleEntries.value.push({
        id: nextId++,
        level: 'error',
        args: parts.length ? parts : ['Unknown error'],
        ts: Date.now(),
      })
      if (consoleEntries.value.length > MAX_ENTRIES) {
        consoleEntries.value = consoleEntries.value.slice(-MAX_ENTRIES)
      }
    }
  }

  onMounted(() => window.addEventListener('message', onMessage))
  onBeforeUnmount(() => window.removeEventListener('message', onMessage))

  function clearConsole() {
    consoleEntries.value = []
  }

  function clearNetwork() {
    networkEntries.value = []
  }

  return { consoleEntries, networkEntries, errorCount, clearConsole, clearNetwork, allowOrigin, isAllowedOrigin }
}
