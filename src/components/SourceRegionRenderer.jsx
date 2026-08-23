import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

const MAX_RENDER_WIDTH = 960
const MIN_RENDER_WIDTH = 320

function pageAssetUrl(manifest, page) {
  return (manifest?.fallbackAssetUrls || []).find((url) => {
    const match = String(url || '').match(/\/qp-(\d+)\.(?:png|jpe?g|webp)$/i)
    return match && Number(match[1]) === Number(page)
  }) || ''
}

function cropStyle(region) {
  const [left, top, right, bottom] = region
  const width = right - left
  const height = bottom - top
  return {
    aspectRatio: `${width} / ${height}`,
    '--source-crop-width': `${100 / width}%`,
    '--source-crop-offset-left': `-${left * 100}%`,
    '--source-crop-offset-top': `-${top * 100}%`,
  }
}

function fallbackPages(manifest, mode) {
  return (manifest?.pages || []).map((entry) => ({
    ...entry,
    normalizedRegion: mode === 'original' ? [0, 0, 1, 1] : entry.normalizedRegion,
    exactRegion: mode === 'original' ? false : entry.exactRegion,
    assetUrl: pageAssetUrl(manifest, entry.page),
  })).filter((entry) => entry.assetUrl)
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('The browser could not encode the rendered question crop.'))
    }, 'image/png')
  })
}

function revokeObjectUrls(urls) {
  for (const url of urls) URL.revokeObjectURL(url)
}

export function SourceRegionRenderer({ manifest, mode = 'regions', onStatus = () => {} }) {
  const containerRef = useRef(null)
  const renderedObjectUrlsRef = useRef([])
  const [containerWidth, setContainerWidth] = useState(720)
  const [renderedPages, setRenderedPages] = useState([])
  const [, setFallbackLoadedPages] = useState([])
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const fallback = fallbackPages(manifest, mode)

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width)
      if (width > 0) setContainerWidth(width)
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    let loadingTask = null
    let documentProxy = null
    let pendingObjectUrls = []
    const pages = (Array.isArray(manifest?.pages) ? manifest.pages : []).map((entry) => mode === 'original'
      ? { ...entry, normalizedRegion: [0, 0, 1, 1], exactRegion: false }
      : entry)
    if (!manifest?.sourcePdfUrl || !pages.length) {
      setStatus('error')
      setError('This question has no renderable source coordinates.')
      onStatus('error')
      return undefined
    }

    setStatus('loading')
    setError('')
    setRenderedPages([])
    setFallbackLoadedPages([])
    onStatus('loading')

    async function renderSource() {
      loadingTask = pdfjs.getDocument({
        url: manifest.sourcePdfUrl,
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
      })
      documentProxy = await loadingTask.promise
      if (cancelled) {
        await documentProxy.destroy().catch(() => {})
        documentProxy = null
        return
      }
      const outputScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
      const cssWidth = Math.min(MAX_RENDER_WIDTH, Math.max(MIN_RENDER_WIDTH, containerWidth))
      const output = []

      for (const entry of pages) {
        if (cancelled) return
        const page = await documentProxy.getPage(entry.page)
        const baseViewport = page.getViewport({ scale: 1 })
        const scale = (cssWidth / baseViewport.width) * outputScale
        const viewport = page.getViewport({ scale })
        const fullCanvas = document.createElement('canvas')
        fullCanvas.width = Math.max(1, Math.ceil(viewport.width))
        fullCanvas.height = Math.max(1, Math.ceil(viewport.height))
        const fullContext = fullCanvas.getContext('2d', { alpha: false })
        if (!fullContext) throw new Error('The browser could not create a PDF rendering surface.')
        await page.render({ canvasContext: fullContext, viewport }).promise

        const [left, top, right, bottom] = entry.normalizedRegion
        const crop = {
          x: Math.max(0, Math.floor(left * fullCanvas.width)),
          y: Math.max(0, Math.floor(top * fullCanvas.height)),
          width: Math.max(1, Math.ceil((right - left) * fullCanvas.width)),
          height: Math.max(1, Math.ceil((bottom - top) * fullCanvas.height)),
        }
        crop.width = Math.min(crop.width, fullCanvas.width - crop.x)
        crop.height = Math.min(crop.height, fullCanvas.height - crop.y)
        const croppedCanvas = document.createElement('canvas')
        croppedCanvas.width = crop.width
        croppedCanvas.height = crop.height
        const croppedContext = croppedCanvas.getContext('2d', { alpha: false })
        if (!croppedContext) throw new Error('The browser could not create a question crop surface.')
        croppedContext.drawImage(fullCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
        const blob = await canvasToBlob(croppedCanvas)
        if (cancelled) return
        const objectUrl = URL.createObjectURL(blob)
        pendingObjectUrls.push(objectUrl)
        output.push({
          page: entry.page,
          exactRegion: entry.exactRegion,
          normalizedRegion: entry.normalizedRegion,
          width: crop.width / outputScale,
          height: crop.height / outputScale,
          objectUrl,
        })
        fullCanvas.width = 0
        fullCanvas.height = 0
        croppedCanvas.width = 0
        croppedCanvas.height = 0
        page.cleanup()
      }

      if (cancelled) return
      renderedObjectUrlsRef.current = pendingObjectUrls
      pendingObjectUrls = []
      setRenderedPages(output)
      setStatus('ready')
      onStatus('ready')
    }

    renderSource().catch((renderError) => {
      if (cancelled) return
      revokeObjectUrls(pendingObjectUrls)
      pendingObjectUrls = []
      const message = String(renderError?.message || 'The official PDF could not be rendered.')
      if (fallback.length === pages.length) {
        setStatus('fallback-loading')
        setError(message)
        onStatus('loading')
      } else {
        setStatus('error')
        setError(message)
        onStatus('error')
      }
    })

    return () => {
      cancelled = true
      revokeObjectUrls(pendingObjectUrls)
      revokeObjectUrls(renderedObjectUrlsRef.current)
      renderedObjectUrlsRef.current = []
      if (documentProxy) void documentProxy.destroy().catch(() => {})
      documentProxy = null
    }
  }, [containerWidth, fallback.length, manifest, mode, onStatus])

  function handleFallbackLoad(page) {
    setFallbackLoadedPages((current) => {
      const next = current.includes(page) ? current : [...current, page]
      if (next.length === fallback.length) {
        setStatus('fallback')
        onStatus('fallback')
      }
      return next
    })
  }

  function handleFallbackError() {
    setStatus('error')
    setError('Neither the source PDF nor its audited fallback image could be loaded.')
    onStatus('error')
  }

  return (
    <div className="source-region-renderer" ref={containerRef} data-source-render-status={status} data-source-document={manifest?.sourceDocumentId || ''}>
      {status === 'loading' && <div className="source-region-renderer__status" role="status">Rendering the official question from its source PDF...</div>}
      {status === 'fallback-loading' && <div className="source-region-renderer__status" role="status">Loading the audited source-page fallback...</div>}
      {status === 'error' && <div className="source-region-renderer__status source-region-renderer__status--error" role="alert">The official source PDF could not be rendered. <small>{error}</small></div>}
      {status === 'fallback' && <div className="source-region-renderer__status source-region-renderer__status--fallback" role="status">Showing the audited source page while the PDF renderer recovers.</div>}
      {status === 'ready' && renderedPages.map((entry) => (
        <figure className="source-region-renderer__page" key={entry.page} data-source-page={entry.page} data-source-region={entry.normalizedRegion.join(',')} data-exact-region={entry.exactRegion ? 'true' : 'false'}>
          <img src={entry.objectUrl} alt={`Rendered official question crop, page ${entry.page}`} />
          <figcaption>Source PDF page {entry.page}{entry.exactRegion ? '' : ' · complete page fallback'}</figcaption>
        </figure>
      ))}
      {(status === 'fallback-loading' || status === 'fallback') && fallback.map((entry) => (
        <figure className="source-region-renderer__page source-region-renderer__page--fallback" key={entry.page} data-source-page={entry.page} data-source-region={entry.normalizedRegion.join(',')} data-exact-region={entry.exactRegion ? 'true' : 'false'}>
          {entry.exactRegion
            ? <div className="source-region-renderer__crop" style={cropStyle(entry.normalizedRegion)}><img src={entry.assetUrl} alt={`Audited official question crop, page ${entry.page}`} onLoad={() => handleFallbackLoad(entry.page)} onError={handleFallbackError} /></div>
            : <img src={entry.assetUrl} alt={`Audited complete official source page ${entry.page}`} onLoad={() => handleFallbackLoad(entry.page)} onError={handleFallbackError} />}
          <figcaption>Source PDF page {entry.page}{entry.exactRegion ? '' : ' · complete page fallback'}</figcaption>
        </figure>
      ))}
    </div>
  )
}
