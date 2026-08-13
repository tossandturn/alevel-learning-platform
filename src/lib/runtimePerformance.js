const METRICS_KEY = '__stemPerformanceMetrics'

function readMemory() {
  const memory = performance.memory
  if (!memory || !Number.isFinite(memory.usedJSHeapSize)) return null
  return {
    usedJSHeapBytes: Number(memory.usedJSHeapSize),
    totalJSHeapBytes: Number(memory.totalJSHeapSize) || null,
    limitJSHeapBytes: Number(memory.jsHeapSizeLimit) || null,
  }
}

function publish(metrics) {
  window[METRICS_KEY] = Object.freeze({
    ...metrics,
    memory: readMemory(),
    sampledAt: new Date().toISOString(),
  })
}

export function startRuntimePerformanceMonitoring() {
  if (typeof window === 'undefined' || window[METRICS_KEY]?.schemaVersion === 'stem-runtime-performance-v1') return

  const metrics = {
    schemaVersion: 'stem-runtime-performance-v1',
    startedAt: new Date().toISOString(),
    lcpMs: null,
    inpMs: null,
    longTaskCount: 0,
  }
  publish(metrics)

  function observe(type, handler) {
    if (!window.PerformanceObserver?.supportedEntryTypes?.includes(type)) return null
    const observer = new PerformanceObserver((list) => {
      handler(list.getEntries())
      publish(metrics)
    })
    observer.observe({ type, buffered: true })
    return observer
  }

  observe('largest-contentful-paint', (entries) => {
    const latest = entries.at(-1)
    if (latest?.startTime) metrics.lcpMs = Math.round(latest.startTime)
  })
  observe('event', (entries) => {
    for (const entry of entries) {
      if (Number.isFinite(entry.duration)) metrics.inpMs = Math.max(metrics.inpMs || 0, Math.round(entry.duration))
    }
  })
  observe('longtask', (entries) => {
    metrics.longTaskCount += entries.length
  })

  const sample = () => publish(metrics)
  const timer = window.setInterval(sample, 15_000)
  window.addEventListener('pagehide', () => {
    window.clearInterval(timer)
    sample()
  }, { once: true })
}
