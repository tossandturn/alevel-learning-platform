export const NATIVE_PENCIL_EVENT = 'stemist-native-pencil-stroke'

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizedRect(value) {
  if (!value || typeof value !== 'object') return null
  const x = finiteNumber(value.x)
  const y = finiteNumber(value.y)
  const width = finiteNumber(value.width)
  const height = finiteNumber(value.height)
  if (x == null || y == null || width == null || height == null || width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

/**
 * Convert the native PencilKit bridge payload into the local pixel space of a
 * DOM canvas. Native coordinates are relative to the WKWebView viewport,
 * while canvas coordinates are backed by its device-pixel dimensions.
 *
 * This function is deliberately pure so the coordinate contract can be tested
 * without a browser or an iOS simulator. Invalid/legacy payloads fail closed;
 * the normal web Pointer Events path remains available in that case.
 */
export function mapNativePencilStroke({ detail, surfaceId, rect, canvasWidth, canvasHeight }) {
  if (!detail || typeof detail !== 'object' || detail.surfaceId !== surfaceId) return null
  if (detail.coordinateSpace && detail.coordinateSpace !== 'webViewViewport') return null
  if (!normalizedRect(detail.surfaceFrame)) return null

  const targetRect = normalizedRect(rect)
  const pixelWidth = finiteNumber(canvasWidth)
  const pixelHeight = finiteNumber(canvasHeight)
  if (!targetRect || pixelWidth == null || pixelHeight == null || pixelWidth <= 0 || pixelHeight <= 0) return null
  if (!Array.isArray(detail.points) || detail.points.length === 0 || detail.points.length > 4096) return null

  const points = detail.points.map((point) => {
    const clientX = finiteNumber(point?.x)
    const clientY = finiteNumber(point?.y)
    if (clientX == null || clientY == null) return null
    const pressure = finiteNumber(point?.pressure)
    return {
      x: (clientX - targetRect.x) * (pixelWidth / targetRect.width),
      y: (clientY - targetRect.y) * (pixelHeight / targetRect.height),
      pressure: pressure != null && pressure > 0 ? Math.min(1, pressure) : 0.5,
    }
  }).filter(Boolean)

  if (!points.length) return null
  return {
    tool: detail.tool === 'eraser' ? 'eraser' : 'pen',
    points,
  }
}

export function stableNativeSurfaceId(prefix, value) {
  const safePrefix = String(prefix || 'surface').replace(/[^A-Za-z0-9_-]/g, '') || 'surface'
  const safeValue = String(value || '').replace(/[^A-Za-z0-9_-]/g, '')
  return `${safePrefix}-${safeValue || 'default'}`
}
