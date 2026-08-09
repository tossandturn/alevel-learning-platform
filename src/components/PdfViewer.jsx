import { useEffect, useRef, useState } from 'react'
import { Download, ZoomIn, ZoomOut } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { canvasPoint, createInkMetrics, drawDot, drawSegment, exposeInkMetrics, pointDistance, pointerSamples } from '../lib/inkStroke'

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

function PdfInkCanvas({ pageNumber, baseCanvas, width, height, ink, questionNumber, tool = 'pen', onChange, readOnly = false, panMode = false }) {
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const movedRef = useRef(false)
  const lastPointRef = useRef(null)
  const activePointerIdRef = useRef(null)
  const initializedRef = useRef(false)
  const latestInkRef = useRef(ink?.inkDataUrl || '')
  const inkMetricsRef = useRef(createInkMetrics())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width || !height) return undefined
    const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
    const pixelWidth = baseCanvas?.width || Math.round(width * ratio)
    const pixelHeight = baseCanvas?.height || Math.round(height * ratio)
    if (initializedRef.current && canvas.width === pixelWidth && canvas.height === pixelHeight) return undefined
    const previous = initializedRef.current ? canvas.toDataURL('image/png') : latestInkRef.current
    setReady(false)
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    drawDataUrl(canvas, previous).finally(() => {
      initializedRef.current = true
      exposeInkMetrics(canvas, inkMetricsRef.current)
      setReady(true)
    })
    return undefined
  }, [baseCanvas, height, width])

  function brushFor(point) {
    const canvas = canvasRef.current
    const ratio = canvas.width / canvas.getBoundingClientRect().width
    return {
      color: '#14243a',
      composite: tool === 'eraser' ? 'destination-out' : 'source-over',
      width: (tool === 'eraser' ? 22 : 1.15 + point.pressure * 2.35) * ratio,
    }
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

  function startStroke(event) {
    if (readOnly || !ready || drawingRef.current || event.isPrimary === false || event.pointerType === 'touch') return
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
    inkMetricsRef.current.activePointerId = event.pointerId
    lastPointRef.current = canvasPoint(canvas, event.nativeEvent || event)
    exposeInkMetrics(canvas, inkMetricsRef.current)
  }

  function continueStroke(event) {
    if (!drawingRef.current || event.pointerId !== activePointerIdRef.current) return
    event.preventDefault()
    event.stopPropagation()
    appendSamples(event)
  }

  function finishStroke(event) {
    if (!drawingRef.current || event.pointerId !== activePointerIdRef.current) return
    event.preventDefault()
    event.stopPropagation()
    appendSamples(event)
    drawingRef.current = false
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
    exposeInkMetrics(canvas, inkMetricsRef.current)
    const inkDataUrl = canvas.toDataURL('image/png')
    latestInkRef.current = inkDataUrl
    const composite = window.document.createElement('canvas')
    composite.width = canvas.width
    composite.height = canvas.height
    const context = composite.getContext('2d')
    if (baseCanvas) context.drawImage(baseCanvas, 0, 0, composite.width, composite.height)
    context.drawImage(canvas, 0, 0)
    onChange?.(pageNumber, {
      dataUrl: composite.toDataURL('image/jpeg', 0.82),
      inkDataUrl,
      questionNumber,
      strokeCount: inkMetricsRef.current.strokes,
      segmentCount: inkMetricsRef.current.segments,
      maxSegmentGap: inkMetricsRef.current.maxSegmentGap,
    })
  }

  const inert = readOnly || panMode
  return <canvas ref={canvasRef} className={`pdf-ink-layer ${readOnly ? 'read-only' : ''} ${panMode ? 'pdf-pan-mode' : ''}`} aria-label={`Handwriting layer for PDF page ${pageNumber}`} data-stroke-count={inkMetricsRef.current.strokes} data-segment-count={inkMetricsRef.current.segments} onPointerDown={inert ? undefined : startStroke} onPointerMove={inert ? undefined : continueStroke} onPointerUp={inert ? undefined : finishStroke} onPointerCancel={inert ? undefined : finishStroke} onLostPointerCapture={inert ? undefined : finishStroke} onDragStart={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()} />
}

export function PdfViewer({ file, annotate = false, readOnly = false, inkByPage = {}, inkTool = 'pen', questionNumber = 1, onInkChange }) {
  const containerRef = useRef(null)
  const canvasRefs = useRef(new Map())
  const [document, setDocument] = useState(null)
  const [containerWidth, setContainerWidth] = useState(900)
  const [zoom, setZoom] = useState(1)
  const [pageSizes, setPageSizes] = useState({})
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width))
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let active = true
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
    task.promise
      .then((nextDocument) => {
        if (!active) return nextDocument.destroy()
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
      task.destroy()
    }
  }, [file.id, file.localUrl])

  useEffect(() => {
    if (!document) return undefined
    let cancelled = false
    const renderTasks = []
    const outputScale = Math.min(window.devicePixelRatio || 1, 2)

    async function renderAllPages() {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
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

    renderAllPages()
    return () => {
      cancelled = true
      renderTasks.forEach((renderTask) => renderTask.cancel())
    }
  }, [containerWidth, document, zoom])

  return (
    <div className="pdf-viewer" ref={containerRef}>
      <div className="pdf-viewer-toolbar">
        <span className="pdf-continuous-status">Continuous view <strong>{document?.numPages || '...'} pages</strong></span>
        <span className="pdf-toolbar-spacer" />
        <button type="button" onClick={() => setZoom((value) => Math.max(0.7, value - 0.15))} aria-label="Zoom out"><ZoomOut size={17} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((value) => Math.min(2, value + 0.15))} aria-label="Zoom in"><ZoomIn size={17} /></button>
        <a href={file.localUrl} download={file.file} aria-label="Download PDF"><Download size={17} /></a>
      </div>
      <div className="pdf-canvas-scroll">
        {status === 'loading' && <div className="pdf-loading"><span className="loading-line" />Rendering verified PDF...</div>}
        {status === 'error' && <div className="pdf-loading error">Could not render this PDF. <a href={file.localUrl} target="_blank" rel="noreferrer">Open it directly</a><small>{error}</small></div>}
        {document && <div className="pdf-page-stack">{Array.from({ length: document.numPages }, (_, index) => {
          const pageNumber = index + 1
          const size = pageSizes[pageNumber]
          return <figure className="pdf-page" key={pageNumber}>
            <figcaption>Page {pageNumber}</figcaption>
            <div className="pdf-page-layer" style={size ? { width: size.width, height: size.height } : undefined}>
              <canvas ref={(canvas) => { if (canvas) canvasRefs.current.set(pageNumber, canvas); else canvasRefs.current.delete(pageNumber) }} aria-label={`${file.file}, page ${pageNumber}`} />
              {annotate && size && <PdfInkCanvas pageNumber={pageNumber} baseCanvas={canvasRefs.current.get(pageNumber)} width={size.width} height={size.height} ink={inkByPage[pageNumber]} tool={inkTool} questionNumber={questionNumber} onChange={onInkChange} readOnly={readOnly} panMode={inkTool === 'hand'} />}
            </div>
          </figure>
        })}</div>}
      </div>
    </div>
  )
}
