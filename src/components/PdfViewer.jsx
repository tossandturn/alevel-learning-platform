import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { canvasPoint, createInkMetrics, drawDot, drawSegment, exposeInkMetrics, pointDistance, pointerSamples } from '../lib/inkStroke'
import { deletePaperEvidence, getPaperEvidence, putPaperEvidence } from '../lib/evidenceStorage'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

function drawDataUrl(canvas, dataUrl) {
  return new Promise((resolve, reject) => {
    if (!dataUrl) {
      resolve()
      return
    }
    const image = new Image()
    image.onload = () => {
      const context = canvas.getContext('2d')
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve()
    }
    image.onerror = reject
    image.src = dataUrl
  })
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PDF handwriting could not be saved.')), type, quality))
}

function cloneCanvas(canvas) {
  const clone = window.document.createElement('canvas')
  clone.width = canvas.width
  clone.height = canvas.height
  clone.getContext('2d').drawImage(canvas, 0, 0)
  return clone
}

function PdfInkCanvas({ pageNumber, baseCanvas, width, height, ink, evidenceStorageKey = '', questionNumber, tool = 'pen', onChange, onTouchZoom, registerInkFlush, readOnly = false, panMode = false }) {
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const movedRef = useRef(false)
  const lastPointRef = useRef(null)
  const activePointerIdRef = useRef(null)
  const rawPenInputRef = useRef(false)
  const initializedRef = useRef(false)
  const latestInkRef = useRef(ink?.inkDataUrl || '')
  const inkMetricsRef = useRef(createInkMetrics())
  const emitTimerRef = useRef(null)
  const encodingPromiseRef = useRef(null)
  const dirtyRevisionRef = useRef(0)
  const persistedRevisionRef = useRef(0)
  const dirtyQuestionNumberRef = useRef(questionNumber)
  const changedAtRef = useRef(0)
  const touchPointersRef = useRef(new Map())
  const pinchDistanceRef = useRef(0)
  const storedPreviewUrlRef = useRef('')
  const [ready, setReady] = useState(false)

  const evidenceIds = useMemo(() => {
    const prefix = `${String(evidenceStorageKey || 'pdf-document')}:page:${pageNumber}`
    return {
      ink: `${prefix}:ink`,
      image: `${prefix}:image`,
    }
  }, [evidenceStorageKey, pageNumber])

  function rememberStoredPreview(blob) {
    if (storedPreviewUrlRef.current) URL.revokeObjectURL(storedPreviewUrlRef.current)
    storedPreviewUrlRef.current = URL.createObjectURL(blob)
    latestInkRef.current = storedPreviewUrlRef.current
    return storedPreviewUrlRef.current
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width || !height) return undefined
    const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
    const pixelWidth = baseCanvas?.width || Math.round(width * ratio)
    const pixelHeight = baseCanvas?.height || Math.round(height * ratio)
    if (initializedRef.current && canvas.width === pixelWidth && canvas.height === pixelHeight) return undefined
    const previousCanvas = initializedRef.current ? cloneCanvas(canvas) : null
    const previousUrl = initializedRef.current ? '' : latestInkRef.current
    setReady(false)
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const restore = async () => {
      if (previousCanvas) {
        canvas.getContext('2d').drawImage(previousCanvas, 0, 0, previousCanvas.width, previousCanvas.height, 0, 0, canvas.width, canvas.height)
        return
      }
      if (previousUrl) {
        await drawDataUrl(canvas, previousUrl)
        return
      }
      if (ink?.inkEvidenceId) {
        const stored = await getPaperEvidence(ink.inkEvidenceId)
        if (!stored?.blob) throw new Error('Stored PDF handwriting is unavailable.')
        await drawDataUrl(canvas, rememberStoredPreview(stored.blob))
      }
    }
    restore().catch(() => {}).finally(() => {
      initializedRef.current = true
      exposeInkMetrics(canvas, inkMetricsRef.current)
      setReady(true)
    })
    return undefined
  }, [baseCanvas, height, ink?.inkDataUrl, ink?.inkEvidenceId, width])

  useEffect(() => {
    const externalInk = ink?.inkDataUrl || ''
    if (externalInk) {
      latestInkRef.current = externalInk
      return
    }
    if (ink?.inkEvidenceId) return
    const canvas = canvasRef.current
    if (!canvas || !latestInkRef.current || dirtyRevisionRef.current > persistedRevisionRef.current) return
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    latestInkRef.current = ''
    dirtyRevisionRef.current = 0
    persistedRevisionRef.current = 0
    inkMetricsRef.current = createInkMetrics()
    exposeInkMetrics(canvas, inkMetricsRef.current)
  }, [ink?.inkDataUrl, ink?.inkEvidenceId])

  const emitInk = useCallback(async () => {
    while (encodingPromiseRef.current) {
      try {
        await encodingPromiseRef.current
      } catch {
        // A fresh flush below retries the current dirty revision.
      }
    }
    const canvas = canvasRef.current
    if (!canvas) return null
    const revision = dirtyRevisionRef.current
    if (revision <= persistedRevisionRef.current) return null
    const startedAt = performance.now()
    const encoding = (async () => {
      const snapshot = cloneCanvas(canvas)
      const inkBlob = await canvasBlob(snapshot, 'image/png')
      const composite = window.document.createElement('canvas')
      composite.width = snapshot.width
      composite.height = snapshot.height
      const context = composite.getContext('2d')
      if (baseCanvas) context.drawImage(baseCanvas, 0, 0, composite.width, composite.height)
      context.drawImage(snapshot, 0, 0)
      const imageBlob = await canvasBlob(composite, 'image/jpeg', 0.82)
      if (revision < persistedRevisionRef.current) return null
      const { ink: inkEvidenceId, image: imageEvidenceId } = evidenceIds
      const updatedAt = changedAtRef.current || Date.now()
      try {
        await Promise.all([
          putPaperEvidence({
            id: inkEvidenceId,
            attemptId: evidenceStorageKey || null,
            pageNumber,
            blob: inkBlob,
            name: `page-${pageNumber}-ink.png`,
            type: inkBlob.type || 'image/png',
            width: snapshot.width,
            height: snapshot.height,
            createdAt: new Date(updatedAt).toISOString(),
          }),
          putPaperEvidence({
            id: imageEvidenceId,
            attemptId: evidenceStorageKey || null,
            pageNumber,
            blob: imageBlob,
            name: `page-${pageNumber}-response.jpg`,
            type: imageBlob.type || 'image/jpeg',
            width: composite.width,
            height: composite.height,
            createdAt: new Date(updatedAt).toISOString(),
          }),
        ])
      } catch (error) {
        await Promise.allSettled([deletePaperEvidence(inkEvidenceId), deletePaperEvidence(imageEvidenceId)])
        throw error
      }
      persistedRevisionRef.current = revision
      latestInkRef.current = rememberStoredPreview(inkBlob)
      canvas.dataset.lastEncodeMs = String(Math.round(performance.now() - startedAt))
      canvas.dataset.encodedRevision = String(revision)
      const nextInk = {
        inkEvidenceId,
        imageEvidenceId,
        bytes: inkBlob.size + imageBlob.size,
        inkBytes: inkBlob.size,
        imageBytes: imageBlob.size,
        width: composite.width,
        height: composite.height,
        questionNumber: dirtyQuestionNumberRef.current,
        strokeCount: inkMetricsRef.current.strokes,
        segmentCount: inkMetricsRef.current.segments,
        maxSegmentGap: inkMetricsRef.current.maxSegmentGap,
        updatedAt,
      }
      onChange?.(pageNumber, nextInk)
      return { pageNumber, ink: nextInk }
    })()
    encodingPromiseRef.current = encoding
    try {
      return await encoding
    } finally {
      if (encodingPromiseRef.current === encoding) encodingPromiseRef.current = null
    }
  }, [baseCanvas, evidenceIds, evidenceStorageKey, onChange, pageNumber])

  function scheduleEmit() {
    window.clearTimeout(emitTimerRef.current)
    emitTimerRef.current = window.setTimeout(() => {
      emitTimerRef.current = null
      void emitInk().catch(() => {})
    }, 180)
  }

  useEffect(() => {
    if (!registerInkFlush) return undefined
    return registerInkFlush(pageNumber, async () => {
      window.clearTimeout(emitTimerRef.current)
      emitTimerRef.current = null
      return emitInk()
    })
  }, [emitInk, pageNumber, registerInkFlush])

  useEffect(() => () => {
    const pending = emitTimerRef.current
    window.clearTimeout(pending)
    if (pending) void emitInk().catch(() => {})
    if (storedPreviewUrlRef.current) URL.revokeObjectURL(storedPreviewUrlRef.current)
    storedPreviewUrlRef.current = ''
  }, [emitInk])

  function brushFor(point) {
    const canvas = canvasRef.current
    const ratio = canvas.width / canvas.getBoundingClientRect().width
    return {
      color: '#14243a',
      composite: tool === 'eraser' ? 'destination-out' : 'source-over',
      width: (tool === 'eraser' ? 22 : 1.15 + point.pressure * 2.35) * ratio,
    }
  }

  function touchDistance() {
    const points = [...touchPointersRef.current.values()]
    if (points.length < 2) return 0
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
  }

  function startTouchGesture(event) {
    const canvas = canvasRef.current
    try {
      canvas?.setPointerCapture?.(event.pointerId)
    } catch {
      // Synthetic pointers do not always own capture.
    }
    touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (touchPointersRef.current.size >= 2) pinchDistanceRef.current = touchDistance()
    event.preventDefault()
    event.stopPropagation()
  }

  function continueTouchGesture(event) {
    const previous = touchPointersRef.current.get(event.pointerId)
    if (!previous) return
    const next = { x: event.clientX, y: event.clientY }
    touchPointersRef.current.set(event.pointerId, next)
    if (touchPointersRef.current.size >= 2) {
      const distance = touchDistance()
      if (pinchDistanceRef.current > 0 && distance > 0) {
        const scale = distance / pinchDistanceRef.current
        if (Math.abs(scale - 1) >= 0.025) {
          onTouchZoom?.(scale)
          pinchDistanceRef.current = distance
        }
      } else {
        pinchDistanceRef.current = distance
      }
    } else {
      const surface = canvasRef.current?.closest('.pdf-canvas-scroll')
      if (surface) {
        surface.scrollLeft -= next.x - previous.x
        surface.scrollTop -= next.y - previous.y
      }
    }
    event.preventDefault()
    event.stopPropagation()
  }

  function finishTouchGesture(event) {
    if (!touchPointersRef.current.has(event.pointerId)) return
    touchPointersRef.current.delete(event.pointerId)
    if (touchPointersRef.current.size < 2) pinchDistanceRef.current = 0
    event.preventDefault()
    event.stopPropagation()
  }

  function appendSamples(event) {
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    for (const sample of pointerSamples(event)) {
      const previous = lastPointRef.current
      const next = canvasPoint(canvas, sample)
      if (!previous) {
        lastPointRef.current = next
        continue
      }
      if (pointDistance(previous, next) < 0.01) continue
      drawSegment(context, previous, next, brushFor(next))
      inkMetricsRef.current.segments += 1
      lastPointRef.current = next
      movedRef.current = true
    }
    exposeInkMetrics(canvas, inkMetricsRef.current)
  }

  function applyNativePencilStroke(detail) {
    const canvas = canvasRef.current
    if (!canvas || readOnly || panMode) return
    if (!detail || detail.surfaceId !== `pdf:${String(evidenceStorageKey || 'document')}:page:${pageNumber}`) return
    const points = Array.isArray(detail.points) ? detail.points : []
    if (!points.length) return
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const nativeTool = detail.tool === 'eraser' ? 'eraser' : 'pen'
    const context = canvas.getContext('2d')
    const mapped = points
      .map((point) => ({
        x: (Number(point.x) - rect.left) * scaleX,
        y: (Number(point.y) - rect.top) * scaleY,
        pressure: Number(point.pressure) > 0 ? Number(point.pressure) : 0.5,
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    if (!mapped.length) return
    const brush = (point) => ({
      color: '#14243a',
      composite: nativeTool === 'eraser' ? 'destination-out' : 'source-over',
      width: (nativeTool === 'eraser' ? 22 : 1.15 + point.pressure * 2.35) * scaleX,
    })
    let previous = mapped[0]
    for (const next of mapped.slice(1)) {
      if (pointDistance(previous, next) < 0.01) continue
      drawSegment(context, previous, next, brush(next))
      inkMetricsRef.current.segments += 1
      previous = next
    }
    if (mapped.length === 1 || pointDistance(mapped[0], previous) < 0.01) {
      drawDot(context, mapped[0], brush(mapped[0]))
      inkMetricsRef.current.dots += 1
    }
    inkMetricsRef.current.strokes += 1
    dirtyRevisionRef.current += 1
    changedAtRef.current = Date.now()
    exposeInkMetrics(canvas, inkMetricsRef.current)
    scheduleEmit()
  }

  function startStroke(event) {
    if (event.pointerType === 'touch') {
      startTouchGesture(event)
      return
    }
    if (readOnly || !ready || drawingRef.current || event.isPrimary === false) return
    if (event.pointerType === 'pen') rawPenInputRef.current = false
    event.preventDefault()
    event.stopPropagation()
    const canvas = canvasRef.current
    try {
      canvas.setPointerCapture?.(event.pointerId)
    } catch {
      // Synthetic QA pointer events do not own a browser pointer to capture.
    }
    drawingRef.current = true
    movedRef.current = false
    activePointerIdRef.current = event.pointerId
    dirtyQuestionNumberRef.current = questionNumber
    inkMetricsRef.current.activePointerId = event.pointerId
    lastPointRef.current = canvasPoint(canvas, event.nativeEvent || event)
    exposeInkMetrics(canvas, inkMetricsRef.current)
  }

  function continueStroke(event) {
    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      continueTouchGesture(event)
      return
    }
    if (!drawingRef.current || event.pointerId !== activePointerIdRef.current) return
    event.preventDefault()
    event.stopPropagation()
    // WKWebView may deliver pointerrawupdate in bursts rather than as a
    // complete stream. Keep pointermove as the lossless fallback; the shared
    // sampler removes duplicate coalesced points.
    appendSamples(event)
  }

  function finishStroke(event) {
    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      finishTouchGesture(event)
      return
    }
    if (!drawingRef.current || event.pointerId !== activePointerIdRef.current) return
    event.preventDefault()
    event.stopPropagation()
    appendSamples(event)
    drawingRef.current = false
    rawPenInputRef.current = false
    const canvas = canvasRef.current
    if (!movedRef.current && lastPointRef.current) {
      drawDot(canvas.getContext('2d'), lastPointRef.current, brushFor(lastPointRef.current))
      inkMetricsRef.current.dots += 1
    }
    inkMetricsRef.current.strokes += 1
    inkMetricsRef.current.activePointerId = null
    activePointerIdRef.current = null
    lastPointRef.current = null
    movedRef.current = false
    dirtyRevisionRef.current += 1
    changedAtRef.current = Date.now()
    exposeInkMetrics(canvas, inkMetricsRef.current)
    scheduleEmit()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || readOnly || panMode || typeof canvas.addEventListener !== 'function') return undefined
    const handleRawPenUpdate = (event) => {
      if (event.pointerType !== 'pen' || !drawingRef.current) return
      rawPenInputRef.current = true
      event.preventDefault()
      event.stopPropagation()
      appendSamples(event)
    }
    if (!('onpointerrawupdate' in canvas)) return undefined
    canvas.addEventListener('pointerrawupdate', handleRawPenUpdate, { passive: false })
    return () => canvas.removeEventListener('pointerrawupdate', handleRawPenUpdate)
    // The listener reads current drawing refs; it only needs replacement when
    // the active tool or the canvas interaction mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panMode, readOnly, tool])

  useEffect(() => {
    if (readOnly || panMode) return undefined
    const handleNativeStroke = (event) => applyNativePencilStroke(event.detail)
    window.addEventListener('stemist-native-pencil-stroke', handleNativeStroke)
    return () => window.removeEventListener('stemist-native-pencil-stroke', handleNativeStroke)
    // The native bridge targets this page's stable surface id; keep the
    // handler attached while the virtualized page remains mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber, readOnly, panMode, evidenceStorageKey])

  const inert = readOnly || panMode
  return <canvas ref={canvasRef} className={`pdf-ink-layer ${readOnly ? 'read-only' : ''} ${panMode ? 'pdf-pan-mode' : ''}`} data-ink-surface="pdf" data-ink-surface-id={`pdf:${String(evidenceStorageKey || 'document')}:page:${pageNumber}`} data-ink-interactive={inert ? 'false' : 'true'} data-ink-tool={tool} aria-label={`Handwriting layer for PDF page ${pageNumber}`} data-stroke-count={inkMetricsRef.current.strokes} data-segment-count={inkMetricsRef.current.segments} onPointerDown={inert ? undefined : startStroke} onPointerMove={inert ? undefined : continueStroke} onPointerUp={inert ? undefined : finishStroke} onPointerCancel={inert ? undefined : finishStroke} onLostPointerCapture={inert ? undefined : finishStroke} onDragStart={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()} />
}

export function PdfViewer({ file, annotate = false, readOnly = false, inkByPage = {}, inkTool = 'pen', questionNumber = 1, evidenceStorageKey = '', onInkChange, registerInkFlush }) {
  const PAGE_WINDOW_BUFFER = 2
  const PAGE_CAPTION_HEIGHT = 30
  const containerRef = useRef(null)
  const scrollRef = useRef(null)
  const canvasRefs = useRef(new Map())
  const [document, setDocument] = useState(null)
  const [containerWidth, setContainerWidth] = useState(900)
  const [zoom, setZoom] = useState(1)
  const [pageSizes, setPageSizes] = useState({})
  const [requestedPages, setRequestedPages] = useState(() => new Set([1, 2]))
  const [activePage, setActivePage] = useState(1)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const pageWidth = Math.max(280, Math.floor(Math.min(1.55, Math.max(0.35, (containerWidth - 40) / 595)) * 595 * zoom))
  const defaultPageHeight = Math.max(360, Math.floor(pageWidth * 1.414))
  const pageHeight = useCallback((pageNumber) => (pageSizes[pageNumber]?.height || defaultPageHeight) + PAGE_CAPTION_HEIGHT, [defaultPageHeight, pageSizes])
  const pageOffset = useCallback((pageNumber) => {
    let offset = 0
    for (let index = 1; index < pageNumber; index += 1) offset += pageHeight(index) + 18
    return offset
  }, [pageHeight])
  const pageWindow = useMemo(() => {
    if (!document) return []
    const start = Math.max(1, activePage - PAGE_WINDOW_BUFFER)
    const end = Math.min(document.numPages, activePage + PAGE_WINDOW_BUFFER)
    return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  }, [activePage, document])
  const zoomFromTouch = useCallback((scale) => {
    if (!Number.isFinite(scale) || scale <= 0) return
    setZoom((value) => Math.min(2, Math.max(0.7, value * scale)))
  }, [])

  const scrollToPage = useCallback((pageNumber, behavior = 'smooth') => {
    const root = scrollRef.current
    if (!document || !root) return
    const next = Math.min(document.numPages, Math.max(1, Number(pageNumber) || 1))
    setActivePage(next)
    root.scrollTo({ top: pageOffset(next), behavior })
  }, [document, pageOffset])

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width))
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let active = true
    let loadedDocument = null
    const task = pdfjs.getDocument({
      url: file.localUrl,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
    })
    setStatus('loading')
    setError('')
    setDocument(null)
    setPageSizes({})
    setRequestedPages(new Set([1, 2]))
    setActivePage(1)
    task.promise
      .then((nextDocument) => {
        loadedDocument = nextDocument
        if (!active) return nextDocument.destroy().catch(() => {})
        setDocument(nextDocument)
        setStatus('ready')
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError.message)
          setStatus('error')
        }
      })
    return () => {
      active = false
      if (loadedDocument) void loadedDocument.destroy().catch(() => {})
    }
  }, [file.id, file.localUrl])

  useEffect(() => {
    const root = scrollRef.current
    if (!root || !document) return undefined
    let frame = 0
    const onScroll = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const target = root.scrollTop + Math.max(1, root.clientHeight * 0.3)
        let cursor = 0
        let nextPage = 1
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          cursor += pageHeight(pageNumber) + 18
          if (target < cursor) {
            nextPage = pageNumber
            break
          }
          nextPage = pageNumber
        }
        setActivePage((current) => current === nextPage ? current : nextPage)
      })
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      window.cancelAnimationFrame(frame)
      root.removeEventListener('scroll', onScroll)
    }
  }, [document, pageHeight])

  useEffect(() => {
    if (!pageWindow.length) return
    setRequestedPages(new Set(pageWindow))
  }, [pageWindow])

  useEffect(() => {
    if (!document) return undefined
    let cancelled = false
    const renderTasks = []
    const outputScale = Math.min(window.devicePixelRatio || 1, 2)

    async function renderVisiblePages() {
      for (const pageNumber of requestedPages) {
        if (cancelled) return
        const canvas = canvasRefs.current.get(pageNumber)
        if (!canvas) continue
        const page = await document.getPage(pageNumber)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const fitScale = Math.min(1.55, Math.max(0.35, (containerWidth - 40) / base.width))
        const viewport = page.getViewport({ scale: fitScale * zoom })
        const context = canvas.getContext('2d', { alpha: false })
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        setPageSizes((current) => current[pageNumber]?.width === Math.floor(viewport.width) && current[pageNumber]?.height === Math.floor(viewport.height)
          ? current
          : { ...current, [pageNumber]: { width: Math.floor(viewport.width), height: Math.floor(viewport.height) } })
        const renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
        })
        renderTasks.push(renderTask)
        try {
          await renderTask.promise
        } catch (renderError) {
          if (!cancelled && renderError.name !== 'RenderingCancelledException') setError(renderError.message)
        }
      }
    }

    renderVisiblePages()
    return () => {
      cancelled = true
      renderTasks.forEach((renderTask) => renderTask.cancel())
    }
  }, [containerWidth, document, requestedPages, zoom])

  const beforePages = pageWindow[0] ? pageWindow[0] - 1 : 0
  const afterPages = document && pageWindow.length ? document.numPages - pageWindow.at(-1) : 0
  const beforeHeight = beforePages ? pageOffset(beforePages + 1) : 0
  const afterHeight = afterPages ? Array.from({ length: afterPages }, (_, index) => pageHeight(pageWindow.at(-1) + index + 1) + 18).reduce((sum, height) => sum + height, 0) : 0

  return (
    <div className="pdf-viewer" ref={containerRef} data-rendered-page-window={pageWindow.join(',')}>
      <div className="pdf-viewer-toolbar">
        <span className="pdf-continuous-status">Page <strong>{document ? `${activePage} of ${document.numPages}` : '...'}</strong></span>
        <button type="button" onClick={() => scrollToPage(activePage - 1)} disabled={!document || activePage <= 1} aria-label="Previous PDF page"><ChevronLeft size={17} /></button>
        <button type="button" onClick={() => scrollToPage(activePage + 1)} disabled={!document || activePage >= document.numPages} aria-label="Next PDF page"><ChevronRight size={17} /></button>
        <span className="pdf-toolbar-spacer" />
        <button type="button" onClick={() => setZoom((value) => Math.max(0.7, value - 0.15))} aria-label="Zoom out"><ZoomOut size={17} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((value) => Math.min(2, value + 0.15))} aria-label="Zoom in"><ZoomIn size={17} /></button>
        <a href={file.localUrl} download={file.file} aria-label="Download PDF"><Download size={17} /></a>
      </div>
      <div
        className={`pdf-canvas-scroll ${annotate ? 'pdf-canvas-scroll--annotating' : ''}`}
        ref={scrollRef}
        onContextMenu={annotate ? (event) => event.preventDefault() : undefined}
      >
        {status === 'loading' && <div className="pdf-loading"><span className="loading-line" />Rendering verified PDF...</div>}
        {status === 'error' && <div className="pdf-loading error">Could not render this PDF. <a href={file.localUrl} target="_blank" rel="noreferrer">Open it directly</a><small>{error}</small></div>}
        {document && <div className="pdf-page-stack" data-virtualized-pages="true">
          {beforeHeight > 0 && <div className="pdf-page-spacer" aria-hidden="true" style={{ height: beforeHeight }} />}
          {pageWindow.map((pageNumber) => {
          const size = pageSizes[pageNumber]
          const placeholderStyle = size
            ? { width: size.width, height: size.height }
            : { width: pageWidth, height: defaultPageHeight }
          return <figure className="pdf-page" key={pageNumber} data-page-number={pageNumber}>
            <figcaption>Page {pageNumber}</figcaption>
            <div className="pdf-page-layer" style={placeholderStyle}>
              <canvas ref={(canvas) => { if (canvas) canvasRefs.current.set(pageNumber, canvas); else canvasRefs.current.delete(pageNumber) }} aria-label={`${file.file}, page ${pageNumber}`} />
              {!size && <span className="pdf-page-placeholder">Scroll to render this page</span>}
              {annotate && size && <PdfInkCanvas pageNumber={pageNumber} baseCanvas={canvasRefs.current.get(pageNumber)} width={size.width} height={size.height} ink={inkByPage[pageNumber]} evidenceStorageKey={evidenceStorageKey} tool={inkTool} questionNumber={questionNumber} onChange={onInkChange} onTouchZoom={zoomFromTouch} registerInkFlush={registerInkFlush} readOnly={readOnly} panMode={inkTool === 'hand'} />}
            </div>
          </figure>
          })}
          {afterHeight > 0 && <div className="pdf-page-spacer" aria-hidden="true" style={{ height: afterHeight }} />}
        </div>}
      </div>
    </div>
  )
}
