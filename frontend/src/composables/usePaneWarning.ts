import { ref } from 'vue'

const message = ref('')
let timer: ReturnType<typeof setTimeout> | null = null

export function usePaneWarning() {
  function show(msg: string, duration = 4000) {
    message.value = msg
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      message.value = ''
      timer = null
    }, duration)
  }

  return { message, show }
}
