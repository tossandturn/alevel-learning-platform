const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_CAPTURE_SIDE = 1600

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
        reject(new Error('The current page could not be captured.'))
        return
      }
      resolve(blob)
    }, 'image/jpeg', 0.86)
  })
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

function currentPageCaptureError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') {
    return new Error('Page capture was cancelled. You can provide a screenshot instead.')
  }
  if (error?.message) return error
  return new Error('Current-page capture is unavailable. You can provide a screenshot instead.')
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

/**
 * Captures one frame from the user-selected browser tab. The caller must invoke
 * this directly from a user gesture because browsers require that for capture.
 */
export async function captureCurrentPageScreenshot() {
  const mediaDevices = window.navigator?.mediaDevices
  if (!mediaDevices?.getDisplayMedia) {
    throw new Error('Current-page capture is unavailable in this browser. You can provide a screenshot instead.')
  }

  let stream
  let video
  try {
    stream = await mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', preferCurrentTab: true },
      audio: false,
    })
    const track = stream.getVideoTracks?.()[0]
    if (!track) throw new Error('Choose the STEM tab to capture the current page.')

    video = window.document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await waitForVideoFrame(video)
    await video.play().catch(() => {})

    const width = video.videoWidth || track.getSettings?.().width || 0
    const height = video.videoHeight || track.getSettings?.().height || 0
    if (!width || !height) throw new Error('The browser did not provide a page image.')

    const scale = Math.min(1, MAX_CAPTURE_SIDE / Math.max(width, height))
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await canvasToBlob(canvas)
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('The captured page is too large. Provide a smaller screenshot instead.')
    return blobToDataUrl(blob)
  } catch (error) {
    throw currentPageCaptureError(error)
  } finally {
    video?.pause?.()
    if (video) video.srcObject = null
    stream?.getTracks?.().forEach((track) => track.stop())
  }
}
