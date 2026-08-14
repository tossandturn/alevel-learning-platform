const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_CAPTURE_SIDE = 2400
const MAX_CROP_SIDE = 1800
export const MIN_CAPTURE_SELECTION_SIDE = 28

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('The screenshot could not be attached.'))
    reader.readAsDataURL(blob)
  })
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The selected area could not be captured.'))
        return
      }
      resolve(blob)
    }, 'image/jpeg', 0.88)
  })
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function normaliseSelection(selection) {
  const left = Number(selection?.left)
  const top = Number(selection?.top)
  const width = Number(selection?.width)
  const height = Number(selection?.height)
  if (![left, top, width, height].every(Number.isFinite) || width < MIN_CAPTURE_SELECTION_SIDE || height < MIN_CAPTURE_SELECTION_SIDE) {
    throw new Error('Drag across a larger question area before attaching it.')
  }
  return { left, top, width, height }
}

function waitForVideoFrame(video) {
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let timeout
    const cleanup = () => {
      window.clearTimeout(timeout)
      video.removeEventListener('loadeddata', ready)
      video.removeEventListener('canplay', ready)
      video.removeEventListener('error', failed)
    }
    const ready = () => {
      cleanup()
      resolve()
    }
    const failed = () => {
      cleanup()
      reject(new Error('The browser could not read the selected page.'))
    }
    timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('The browser did not provide a page image.'))
    }, 8_000)
    video.addEventListener('loadeddata', ready, { once: true })
    video.addEventListener('canplay', ready, { once: true })
    video.addEventListener('error', failed, { once: true })
  })
}

function captureError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') {
    return new Error('Screen sharing was cancelled.')
  }
  if (error?.message) return error
  return new Error('Screen sharing is unavailable in this browser.')
}

function croppedCanvas(source, sourceViewport, selection) {
  const rect = normaliseSelection(selection)
  const viewportWidth = Math.max(1, Number(sourceViewport?.width) || window.innerWidth)
  const viewportHeight = Math.max(1, Number(sourceViewport?.height) || window.innerHeight)
  const scaleX = source.width / viewportWidth
  const scaleY = source.height / viewportHeight
  const sourceLeft = clamp(Math.round(rect.left * scaleX), 0, source.width - 1)
  const sourceTop = clamp(Math.round(rect.top * scaleY), 0, source.height - 1)
  const sourceWidth = clamp(Math.round(rect.width * scaleX), 1, source.width - sourceLeft)
  const sourceHeight = clamp(Math.round(rect.height * scaleY), 1, source.height - sourceTop)
  const outputScale = Math.min(1, MAX_CROP_SIDE / Math.max(sourceWidth, sourceHeight))
  const canvas = window.document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceWidth * outputScale))
  canvas.height = Math.max(1, Math.round(sourceHeight * outputScale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The browser could not prepare the selected screenshot.')
  context.drawImage(source, sourceLeft, sourceTop, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
  return canvas
}

function intersectRects(a, b) {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)
  if (right <= left || bottom <= top) return null
  return { left, top, width: right - left, height: bottom - top }
}

async function ensureImageReady(image) {
  if (image.complete && image.naturalWidth && image.naturalHeight) return
  await new Promise((resolve, reject) => {
    image.addEventListener('load', resolve, { once: true })
    image.addEventListener('error', () => reject(new Error('The visible source image could not be loaded.')), { once: true })
  })
}

function visibleVisualNodes() {
  return [...window.document.querySelectorAll('img, canvas')].filter((node) => {
    if (node.closest('.ai-coach, .ai-coach__capture-overlay')) return false
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    const box = node.getBoundingClientRect()
    return box.width > 0 && box.height > 0
  })
}

function sourceDimensions(node) {
  if (node instanceof window.HTMLImageElement) return { width: node.naturalWidth, height: node.naturalHeight }
  if (node instanceof window.HTMLCanvasElement) return { width: node.width, height: node.height }
  return { width: 0, height: 0 }
}

export async function cropVisiblePageVisuals(selection) {
  const rect = normaliseSelection(selection)
  const candidates = visibleVisualNodes()
  const visuals = []
  for (const node of candidates) {
    if (node instanceof window.HTMLImageElement) await ensureImageReady(node)
    const box = node.getBoundingClientRect()
    const hit = intersectRects(rect, box)
    const dimensions = sourceDimensions(node)
    if (!hit || !dimensions.width || !dimensions.height) continue
    visuals.push({ node, box, hit, dimensions })
  }
  if (!visuals.length) {
    throw new Error('No visible question, graph, PDF page or handwritten work was selected. Share the STEM tab to capture other page content.')
  }

  const outputScale = Math.min(2, MAX_CROP_SIDE / Math.max(rect.width, rect.height), window.devicePixelRatio || 1)
  const canvas = window.document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rect.width * outputScale))
  canvas.height = Math.max(1, Math.round(rect.height * outputScale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The browser could not prepare the selected screenshot.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  for (const visual of visuals) {
    const sourceX = ((visual.hit.left - visual.box.left) / visual.box.width) * visual.dimensions.width
    const sourceY = ((visual.hit.top - visual.box.top) / visual.box.height) * visual.dimensions.height
    const sourceWidth = (visual.hit.width / visual.box.width) * visual.dimensions.width
    const sourceHeight = (visual.hit.height / visual.box.height) * visual.dimensions.height
    const targetX = (visual.hit.left - rect.left) * outputScale
    const targetY = (visual.hit.top - rect.top) * outputScale
    const targetWidth = visual.hit.width * outputScale
    const targetHeight = visual.hit.height * outputScale
    context.drawImage(visual.node, sourceX, sourceY, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight)
  }

  const blob = await canvasToBlob(canvas)
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('The selected screenshot is too large. Capture a smaller area.')
  return blobToDataUrl(blob)
}

export async function beginCurrentPageCapture() {
  const mediaDevices = window.navigator?.mediaDevices
  if (!mediaDevices?.getDisplayMedia) {
    throw new Error('Screen sharing is unavailable in this browser.')
  }

  let stream
  let video
  try {
    stream = await mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', preferCurrentTab: true, frameRate: 1 },
      audio: false,
    })
    const track = stream.getVideoTracks?.()[0]
    if (!track) throw new Error('Choose the STEM browser tab to capture the current page.')

    video = window.document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play().catch(() => {})
    await waitForVideoFrame(video)

    const width = video.videoWidth || track.getSettings?.().width || 0
    const height = video.videoHeight || track.getSettings?.().height || 0
    if (!width || !height) throw new Error('The browser did not provide a page image.')
    const scale = Math.min(1, MAX_CAPTURE_SIDE / Math.max(width, height))
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The browser could not prepare the selected screenshot.')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return {
      canvas,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  } catch (error) {
    throw captureError(error)
  } finally {
    video?.pause?.()
    if (video) video.srcObject = null
    stream?.getTracks?.().forEach((track) => track.stop())
  }
}

export async function cropCurrentPageCapture(capture, selection) {
  if (!capture?.canvas) throw new Error('The selected page capture is no longer available. Start again.')
  const blob = await canvasToBlob(croppedCanvas(capture.canvas, capture.viewport, selection))
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('The selected screenshot is too large. Capture a smaller area.')
  return blobToDataUrl(blob)
}

export async function captureCurrentPageScreenshot() {
  const capture = await beginCurrentPageCapture()
  return cropCurrentPageCapture(capture, {
    left: 0,
    top: 0,
    width: capture.viewport.width,
    height: capture.viewport.height,
  })
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('The screenshot could not be attached.'))
    reader.readAsDataURL(file)
  })
}

export async function imageFileToDataUrl(file) {
  if (!file?.type?.startsWith('image/') || file.size > MAX_IMAGE_BYTES) {
    throw new Error('Choose a screenshot under 12 MB.')
  }
  return fileToDataUrl(file)
}
