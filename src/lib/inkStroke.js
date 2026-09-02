const POINT_EPSILON = 0.01

export const NATIVE_PENCIL_STROKE_EVENT = 'stemist-native-pencil-stroke'

function pointerSource(event) {
  return event?.nativeEvent || event
}

function samePoint(left, right) {
  return Boolean(left && right && Math.abs(left.clientX - right.clientX) < POINT_EPSILON && Math.abs(left.clientY - right.clientY) < POINT_EPSILON)
}

export function pointerSamples(event) {
  const source = pointerSource(event)
  let coalesced = []
  try {
    // WebKit exposes this as a FrozenArray in some iPadOS builds rather than
    // a true Array. Array.from keeps the hardware-rate samples in both cases.
    coalesced = source?.getCoalescedEvents?.() || []
  } catch {
    coalesced = []
  }
  const samples = Array.from(coalesced).filter(Boolean)
  if (!samples.length || !samePoint(samples.at(-1), source)) samples.push(source)
  return samples.filter(Boolean)
}

export function canvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
    pressure: event.pressure > 0 ? event.pressure : 0.5,
  }
}

export function pointDistance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y)
}

export function drawSegment(context, from, to, { color, composite, width }) {
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.globalCompositeOperation = composite
  context.strokeStyle = color
  context.lineWidth = width
  context.beginPath()
  context.moveTo(from.x, from.y)
  context.lineTo(to.x, to.y)
  context.stroke()
}

export function drawDot(context, point, { color, composite, width }) {
  context.globalCompositeOperation = composite
  context.fillStyle = color
  context.beginPath()
  context.arc(point.x, point.y, width / 2, 0, Math.PI * 2)
  context.fill()
}

export function createInkMetrics() {
  return { strokes: 0, segments: 0, dots: 0, maxSegmentGap: 0, activePointerId: null }
}

export function exposeInkMetrics(canvas, metrics) {
  canvas.dataset.strokeCount = String(metrics.strokes)
  canvas.dataset.segmentCount = String(metrics.segments)
  canvas.dataset.dotCount = String(metrics.dots)
  canvas.dataset.maxSegmentGap = String(Number(metrics.maxSegmentGap.toFixed(3)))
  if (metrics.activePointerId == null) delete canvas.dataset.activePointerId
  else canvas.dataset.activePointerId = String(metrics.activePointerId)
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nativeSurfaceFrame(detail) {
  const frame = detail?.surfaceFrame || detail?.frame
  if (!frame || typeof frame !== 'object') return null
  const x = finiteNumber(frame.x)
  const y = finiteNumber(frame.y)
  const width = finiteNumber(frame.width)
  const height = finiteNumber(frame.height)
  if (x == null || y == null || width == null || height == null || width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

/** Map native PencilKit viewport points into this canvas' backing pixels. */
export function nativePencilPoints(canvas, detail) {
  if (!canvas || !detail || !Array.isArray(detail.points)) return []
  const rect = canvas.getBoundingClientRect?.()
  if (!rect || rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) return []
  const frame = nativeSurfaceFrame(detail)
  const surfaceLocal = detail.coordinateSpace === 'surface'
  const sourceWidth = frame?.width || rect.width
  const sourceHeight = frame?.height || rect.height
  const originX = surfaceLocal ? 0 : (frame?.x ?? rect.left)
  const originY = surfaceLocal ? 0 : (frame?.y ?? rect.top)
  const scaleX = canvas.width / sourceWidth
  const scaleY = canvas.height / sourceHeight
  return detail.points.map((point) => {
    const sourceX = finiteNumber(point?.x ?? point?.clientX)
    const sourceY = finiteNumber(point?.y ?? point?.clientY)
    if (sourceX == null || sourceY == null) return null
    const pressure = finiteNumber(point?.pressure)
    return {
      x: (sourceX - originX) * scaleX,
      y: (sourceY - originY) * scaleY,
      pressure: pressure != null && pressure > 0 ? pressure : 0.5,
    }
  }).filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
}

/** Paint one completed native stroke without bypassing the web persistence model. */
export function applyNativePencilStroke(canvas, detail, getBrush) {
  const points = nativePencilPoints(canvas, detail)
  if (!points.length) return null
  const context = canvas.getContext?.('2d')
  if (!context) return null
  const brush = typeof getBrush === 'function'
    ? getBrush
    : () => ({ color: '#172033', composite: 'source-over', width: 2 })
  let segments = 0
  let dots = 0
  let previous = points[0]
  for (const next of points.slice(1)) {
    if (pointDistance(previous, next) >= POINT_EPSILON) {
      drawSegment(context, previous, next, brush(next))
      segments += 1
    }
    previous = next
  }
  if (!segments) {
    drawDot(context, points[0], brush(points[0]))
    dots = 1
  }
  return { points, segments, dots }
}
