const POINT_EPSILON = 0.01

function pointerSource(event) {
  return event?.nativeEvent || event
}

function samePoint(left, right) {
  return Boolean(left && right && Math.abs(left.clientX - right.clientX) < POINT_EPSILON && Math.abs(left.clientY - right.clientY) < POINT_EPSILON)
}

export function pointerSamples(event) {
  const source = pointerSource(event)
  const coalesced = source?.getCoalescedEvents?.()
  const samples = Array.isArray(coalesced) ? coalesced.filter(Boolean) : []
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
  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.globalCompositeOperation = composite
  context.strokeStyle = color
  context.lineWidth = width
  context.beginPath()
  context.moveTo(from.x, from.y)
  context.lineTo(to.x, to.y)
  context.stroke()
  context.restore()
}

export function drawDot(context, point, { color, composite, width }) {
  context.save()
  context.globalCompositeOperation = composite
  context.fillStyle = color
  context.beginPath()
  context.arc(point.x, point.y, width / 2, 0, Math.PI * 2)
  context.fill()
  context.restore()
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
