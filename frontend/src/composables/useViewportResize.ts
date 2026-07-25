import { ref, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'
import type { Tab } from '../types/pane'
import { getAllLeaves } from '../types/pane'

export interface ViewportResizeOptions {
  kbVisible: Ref<boolean>
  activePaneId: Ref<string | null>
  tabs: Ref<Tab[]>
  termRefs: Record<string, { fit: () => void }>
}

export interface ViewportResizeState {
  isLandscape: Ref<boolean>
  imeOccluding: Ref<boolean>
  onViewportResize: () => void
  onOrientationChange: () => void
  reset: () => void
  revalidate: () => void
  dispose: () => void
}

export function useViewportResize(opts: ViewportResizeOptions): ViewportResizeState {
  const { kbVisible, activePaneId, tabs, termRefs } = opts

  const isLandscape = ref(window.innerWidth > window.innerHeight)
  const imeOccluding = ref(false)
  let viewportRefitTimer = 0
  let orientationRevalidateFrame = 0
  let naturalVH = 0
  let disposed = false

  function sampleViewport(allowBaselineReset = false) {
    const viewport = window.visualViewport
    if (!viewport) {
      imeOccluding.value = false
      return
    }

    const vh = viewport.height
    const off = Math.max(0, window.innerHeight - (viewport.offsetTop + vh))
    if (off === 0 && vh > 0) {
      naturalVH = allowBaselineReset ? vh : Math.max(naturalVH, vh)
    }
    const sysKbOpen = naturalVH > 0 && naturalVH - vh > 120
    imeOccluding.value = sysKbOpen && off > 0
    document.documentElement.style.setProperty('--sys-kb-height', `${off}px`)
    document.documentElement.style.setProperty(
      '--kb-open',
      sysKbOpen || kbVisible.value ? '1' : '0',
    )
  }

  function onViewportResize() {
    if (document.visibilityState === 'hidden') {
      reset()
      return
    }
    if (!window.visualViewport) return
    sampleViewport()

    clearTimeout(viewportRefitTimer)
    viewportRefitTimer = window.setTimeout(() => {
      if (!activePaneId.value) return
      const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
      if (!tab || tab.type !== 'terminal') return
      for (const leaf of getAllLeaves(tab.layout)) {
        termRefs[leaf.paneId]?.fit()
      }
    }, 100)
  }

  function onOrientationChange() {
    isLandscape.value = window.innerWidth > window.innerHeight
  }

  function reset() {
    clearTimeout(viewportRefitTimer)
    naturalVH = 0
    imeOccluding.value = false
    document.documentElement.style.setProperty('--sys-kb-height', '0px')
    document.documentElement.style.setProperty('--kb-open', kbVisible.value ? '1' : '0')
  }

  function revalidate() {
    const viewport = window.visualViewport
    if (!viewport) {
      reset()
      return
    }
    // Only re-establish the natural-height baseline from a confirmed-unoccluded
    // sample. If the IME is still occluding (off > 0), keep the existing baseline
    // so detection survives focus/pageshow/orientation revalidation instead of
    // getting stuck false until the keyboard fully closes and reopens.
    const off = Math.max(0, window.innerHeight - (viewport.offsetTop + viewport.height))
    if (off === 0) naturalVH = 0
    sampleViewport(off === 0)
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') reset()
  }

  function onOrientationLifecycle() {
    onOrientationChange()
    reset()
    cancelAnimationFrame(orientationRevalidateFrame)
    orientationRevalidateFrame = requestAnimationFrame(revalidate)
  }

  watch(kbVisible, (v) => {
    document.documentElement.style.setProperty('--kb-open', v ? '1' : '0')
  })

  onMounted(() => {
    window.addEventListener('resize', onOrientationChange)
    window.addEventListener('blur', reset)
    window.addEventListener('focus', revalidate)
    window.addEventListener('pagehide', reset)
    window.addEventListener('pageshow', revalidate)
    window.addEventListener('orientationchange', onOrientationLifecycle)
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onViewportResize)
    }
    revalidate()
  })

  function dispose() {
    if (disposed) return
    disposed = true
    clearTimeout(viewportRefitTimer)
    cancelAnimationFrame(orientationRevalidateFrame)
    naturalVH = 0
    imeOccluding.value = false
    window.removeEventListener('resize', onOrientationChange)
    window.removeEventListener('blur', reset)
    window.removeEventListener('focus', revalidate)
    window.removeEventListener('pagehide', reset)
    window.removeEventListener('pageshow', revalidate)
    window.removeEventListener('orientationchange', onOrientationLifecycle)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', onViewportResize)
    }
    document.documentElement.style.removeProperty('--sys-kb-height')
    document.documentElement.style.setProperty('--kb-open', '0')
  }

  onBeforeUnmount(dispose)

  return {
    isLandscape,
    imeOccluding,
    onViewportResize,
    onOrientationChange,
    reset,
    revalidate,
    dispose,
  }
}
