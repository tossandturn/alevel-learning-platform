import { useEffect, useRef, useState } from 'react'
import { Download, ZoomIn, ZoomOut } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

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

function PdfInkCanvas({ pageNumber, baseCanvas, width, height, ink, questionNumber, tool = 'pen', onChange }) {
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef(null)
  const [ready, setReady] = useState(false)

  function preventSelection(event) {
    event.preventDefault()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width || !height) return undefined
    const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
    const pixelWidth = baseCanvas?.width || Math.round(width * ratio)
    const pixelHeight = baseCanvas?.height || Math.round(height * ratio)
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    drawDataUrl(canvas, ink?.inkDataUrl).finally(() => setReady(true))
    return () => setReady(false)
  }, [baseCanvas, height, ink?.inkDataUrl, width])

  function pointFor(event) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
      pressure: event.pressure > 0 ? event.pressure : 0.5,
    }
  }

  function startStroke(event) {
    if (!ready || event.pointerType === 'touch') return
    event.preventDefault()
    const canvas = canvasRef.current
    canvas.setPointerCapture?.(event.pointerId)
    drawingRef.current = true
    lastPointRef.current = pointFor(event)
  }

  function continueStroke(event) {
    if (!drawingRef.current) return
    event.preventDefault()
    const context = canvasRef.current.getContext('2d')
    const ratio = canvasRef.current.width / canvasRef.current.getBoundingClientRect().width
    for (const sample of event.getCoalescedEvents?.() || [event]) {
      const previous = lastPointRef.current
      if (!previous) continue
      const next = pointFor(sample)
      context.save()
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
      context.strokeStyle = '#14243a'
      context.lineWidth = (tool === 'eraser' ? 22 : 1.15 + next.pressure * 2.35) * ratio
      context.beginPath()
      context.moveTo(previous.x, previous.y)
      context.lineTo(next.x, next.y)
      context.stroke()
      context.restore()
      lastPointRef.current = next
    }
  }

  function finishStroke(event) {
    if (!drawingRef.current) return
    event.preventDefault()
    drawingRef.current = false
    lastPointRef.current = null
    const inkDataUrl = canvasRef.current.toDataURL('image/png')
    const composite = window.document.createElement('canvas')
    composite.width = canvasRef.current.width
    composite.height = canvasRef.current.height
    const context = composite.getContext('2d')
    if (baseCanvas) context.drawImage(baseCanvas, 0, 0, composite.width, composite.height)
    context.drawImage(canvasRef.current, 0, 0)
    onChange?.(pageNumber, { dataUrl: composite.toDataURL('image/jpeg', 0.82), inkDataUrl, questionNumber })
  }

  return <canvas ref={canvasRef} className="pdf-ink-layer" aria-label={`Handwriting layer for PDF page ${pageNumber}`} onPointerDown={startStroke} onPointerMove={continueStroke} onPointerUp={finishStroke} onPointerCancel={finishStroke} onLostPointerCapture={finishStroke} onSelectStart={preventSelection} onDragStart={preventSelection} onContextMenu={preventSelection} />
}

export function PdfViewer({ file, annotate = false, inkByPage = {}, inkTool = 'pen', questionNumber = 1, onInkChange }) {
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
              {annotate && size && <PdfInkCanvas pageNumber={pageNumber} baseCanvas={canvasRefs.current.get(pageNumber)} width={size.width} height={size.height} ink={inkByPage[pageNumber]} tool={inkTool} questionNumber={questionNumber} onChange={onInkChange} />}
            </div>
          </figure>
        })}</div>}
      </div>
    </div>
  )
}
