import { useEffect, useId, useRef, useState } from 'react'
import { Eraser, FilePlus2, Hand, Keyboard, PenTool, Trash2, Undo2, Upload } from 'lucide-react'
import { canvasPoint, createInkMetrics, drawDot, drawSegment, exposeInkMetrics, pointDistance, pointerSamples } from '../lib/inkStroke'

const CANVAS_HEIGHT = 340
const MAX_HISTORY = 24
const PEN_MIN_WIDTH = 1.15
const PEN_PRESSURE_WIDTH = 2.35
const ERASER_WIDTH = 22
const MAX_EXPORT_SIDE = 1600

function imageUrl(image) {
  return image?.previewUrl || image?.dataUrl || ''
}

function exportCanvasFor(canvas) {
  const scale = Math.min(1, MAX_EXPORT_SIDE / Math.max(canvas.width, canvas.height))
  const exportCanvas = window.document.createElement('canvas')
  exportCanvas.width = Math.max(1, Math.round(canvas.width * scale))
  exportCanvas.height = Math.max(1, Math.round(canvas.height * scale))
  const context = exportCanvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, exportCanvas.width, exportCanvas.height)
  context.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height)
  return exportCanvas
}

function canvasEvidence(exportCanvas, name, pages) {
  return {
    name,
    type: 'image/jpeg',
    dataUrl: exportCanvas.toDataURL('image/jpeg', 0.82),
    width: exportCanvas.width,
    height: exportCanvas.height,
    pages,
    recognitionStatus: 'visual-review-required',
    attachedAt: new Date().toISOString(),
  }
}

function canvasFile(exportCanvas, name, pages) {
  return new Promise((resolve, reject) => {
    exportCanvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The handwritten response could not be prepared.'))
        return
      }
      const file = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
      Object.defineProperty(file, 'answerPages', { value: pages })
      resolve(file)
    }, 'image/jpeg', 0.9)
  })
}

function fillPaper(canvas) {
  const context = canvas.getContext('2d')
  context.save()
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.restore()
}

function drawImage(canvas, source, { allowUpscale = true } = {}) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      fillPaper(canvas)
      const fitScale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight)
      const scale = allowUpscale ? fitScale : Math.min(1, fitScale)
      const width = image.naturalWidth * scale
      const height = image.naturalHeight * scale
      const y = canvas.height > height * 1.2 ? 0 : (canvas.height - height) / 2
      const context = canvas.getContext('2d')
      context.save()
      context.globalCompositeOperation = 'source-over'
      context.drawImage(image, (canvas.width - width) / 2, y, width, height)
      context.restore()
      resolve()
    }
    image.onerror = () => reject(new Error('The response image could not be restored.'))
    image.src = source
  })
}

export function HandwritingPad({
  answerId,
  disabled = false,
  aiReviewEligible = false,
  image,
  label = 'Response',
  onImageChange,
  onSnapshotChange,
  onTextChange,
  text = '',
}) {
  const instanceId = useId()
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const movedRef = useRef(false)
  const lastPointRef = useRef(null)
  const activePointerIdRef = useRef(null)
  const inkMetricsRef = useRef(createInkMetrics())
  const historyRef = useRef([])
  const latestSnapshotRef = useRef('')
  const initializedRef = useRef(false)
  const pendingPageEmitRef = useRef(false)
  const saveVersionRef = useRef(0)
  const mountedRef = useRef(true)
  const [mode, setMode] = useState(imageUrl(image) ? 'handwrite' : text ? 'type' : 'handwrite')
  const [tool, setTool] = useState('pen')
  const [pageCount, setPageCount] = useState(() => Math.max(1, Number(image?.pages) || 1))
  const [pencilOnly, setPencilOnly] = useState(() => (window.navigator.maxTouchPoints || 0) > 0)
  const [canUndo, setCanUndo] = useState(false)
  const [status, setStatus] = useState(imageUrl(image) ? 'Handwriting restored' : 'Ready for Apple Pencil')
  const fileInputRef = useRef(null)

  function snapshot(canvas, includeInHistory = true) {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    latestSnapshotRef.current = dataUrl
    if (includeInHistory) {
      historyRef.current = [...historyRef.current, dataUrl].slice(-MAX_HISTORY)
      setCanUndo(historyRef.current.length > 1)
    }
    return dataUrl
  }

  function setBaseline(canvas) {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    latestSnapshotRef.current = dataUrl
    historyRef.current = [dataUrl]
    setCanUndo(false)
  }

  async function emitCanvas(canvas) {
    const name = `${answerId || 'response'}-handwriting.jpg`
    const exportCanvas = exportCanvasFor(canvas)
    const version = saveVersionRef.current + 1
    saveVersionRef.current = version
    onSnapshotChange?.(canvasEvidence(exportCanvas, name, pageCount))
    if (!onImageChange) {
      if (mountedRef.current) setStatus('Saved locally')
      return
    }
    if (mountedRef.current) setStatus('Saving locally...')
    try {
      const file = await canvasFile(exportCanvas, name, pageCount)
      if (version !== saveVersionRef.current) return
      await onImageChange?.(file)
      if (version === saveVersionRef.current && mountedRef.current) setStatus('Saved locally')
    } catch (error) {
      if (version === saveVersionRef.current && mountedRef.current) setStatus(error.message || 'Handwriting could not be saved')
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || mode !== 'handwrite') return undefined

    function resize() {
      const rect = canvas.getBoundingClientRect()
      const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
      const targetWidth = Math.max(1, Math.round(rect.width * ratio))
      const targetHeight = Math.max(1, Math.round(rect.height * ratio))
      if (initializedRef.current && canvas.width === targetWidth && canvas.height === targetHeight) return
      const previous = initializedRef.current ? canvas.toDataURL('image/jpeg', 0.9) : latestSnapshotRef.current || imageUrl(image)
      canvas.width = targetWidth
      canvas.height = targetHeight
      canvas.getContext('2d').setTransform(1, 0, 0, 1, 0, 0)
      const finishResize = () => {
        if (!initializedRef.current) setBaseline(canvas)
        initializedRef.current = true
        if (pendingPageEmitRef.current) {
          pendingPageEmitRef.current = false
          snapshot(canvas, false)
          void emitCanvas(canvas)
        }
      }
      if (previous) {
        drawImage(canvas, previous).then(() => {
          finishResize()
        }).catch(() => {
          fillPaper(canvas)
          finishResize()
        })
      } else {
        fillPaper(canvas)
        finishResize()
      }
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      initializedRef.current = false
    }
    // The stored image is only used to hydrate a newly mounted pad. New strokes
    // already live on the canvas and must not be replaced by parent rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pageCount])

  function brushFor(point) {
    const canvas = canvasRef.current
    const ratio = canvas.width / canvas.getBoundingClientRect().width
    return {
      color: '#172033',
      composite: tool === 'eraser' ? 'destination-out' : 'source-over',
      width: tool === 'eraser' ? ERASER_WIDTH * ratio : (PEN_MIN_WIDTH + point.pressure * PEN_PRESSURE_WIDTH) * ratio,
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
      // Every rendered segment begins exactly where the previous one ended.
      inkMetricsRef.current.maxSegmentGap = Math.max(inkMetricsRef.current.maxSegmentGap, 0)
      lastPointRef.current = next
      movedRef.current = true
    }
    exposeInkMetrics(canvas, inkMetricsRef.current)
  }

  function startStroke(event) {
    if (disabled || mode !== 'handwrite' || drawingRef.current || event.isPrimary === false || (pencilOnly && event.pointerType === 'touch')) return
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
    setStatus(event.pointerType === 'pen' ? 'Apple Pencil active' : 'Editing')
  }

  function continueStroke(event) {
    if (!drawingRef.current || disabled || event.pointerId !== activePointerIdRef.current) return
    event.preventDefault()
    event.stopPropagation()
    appendSamples(event)
  }

  function finishStroke(event) {
    if (!drawingRef.current || event.pointerId !== activePointerIdRef.current) return
    event.preventDefault()
    event.stopPropagation()
    const canvas = canvasRef.current
    appendSamples(event)
    drawingRef.current = false
    if (!movedRef.current && lastPointRef.current) {
      const context = canvas.getContext('2d')
      drawDot(context, lastPointRef.current, brushFor(lastPointRef.current))
      inkMetricsRef.current.dots += 1
    }
    inkMetricsRef.current.strokes += 1
    inkMetricsRef.current.activePointerId = null
    activePointerIdRef.current = null
    lastPointRef.current = null
    movedRef.current = false
    exposeInkMetrics(canvas, inkMetricsRef.current)
    snapshot(canvas)
    void emitCanvas(canvas)
  }

  function preventSelection(event) {
    event.preventDefault()
  }

  function switchMode(nextMode) {
    if (nextMode === mode) return
    if (nextMode === 'handwrite') {
      const active = window.document.activeElement
      if (active instanceof HTMLElement) active.blur()
      window.getSelection?.()?.removeAllRanges()
    }
    setMode(nextMode)
  }

  async function undo() {
    if (disabled || historyRef.current.length <= 1) return
    historyRef.current = historyRef.current.slice(0, -1)
    const previous = historyRef.current.at(-1)
    await drawImage(canvasRef.current, previous)
    latestSnapshotRef.current = previous
    setCanUndo(historyRef.current.length > 1)
    await emitCanvas(canvasRef.current)
  }

  async function clear() {
    if (disabled) return
    fillPaper(canvasRef.current)
    saveVersionRef.current += 1
    historyRef.current = [snapshot(canvasRef.current, false)]
    setCanUndo(false)
    setStatus('Answer area cleared')
    onSnapshotChange?.(null)
    await onImageChange?.(null)
  }

  async function importImage(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) {
      setStatus('Choose an image under 12 MB')
      return
    }
    const source = URL.createObjectURL(file)
    try {
      await drawImage(canvasRef.current, source, { allowUpscale: false })
      snapshot(canvasRef.current)
      await emitCanvas(canvasRef.current)
    } finally {
      URL.revokeObjectURL(source)
    }
  }

  function addPage() {
    if (disabled || pageCount >= 4) return
    pendingPageEmitRef.current = true
    setPageCount((value) => Math.min(4, value + 1))
    setStatus('Adding answer page...')
  }

  return (
    <section className="handwriting-pad" aria-labelledby={`${instanceId}-label`} onDragStart={mode === 'handwrite' ? preventSelection : undefined} onContextMenu={mode === 'handwrite' ? preventSelection : undefined}>
      <header className="handwriting-pad__header">
        <div><strong id={`${instanceId}-label`}>{label}</strong><span>Write the full method and final answer in one place</span></div>
        <div className="handwriting-pad__modes" role="group" aria-label="Answer input mode">
          <button type="button" className={mode === 'handwrite' ? 'active' : ''} onClick={() => switchMode('handwrite')}><PenTool size={16} />Handwrite</button>
          <button type="button" className={mode === 'type' ? 'active' : ''} onClick={() => switchMode('type')}><Keyboard size={16} />Type</button>
        </div>
      </header>

      {mode === 'handwrite' ? (
        <div className="handwriting-pad__surface">
          <div className="handwriting-pad__toolbar" role="toolbar" aria-label="Handwriting tools">
            <button type="button" className={tool === 'pen' ? 'active' : ''} disabled={disabled} onClick={() => setTool('pen')} title="Pen" aria-label="Pen"><PenTool size={17} /></button>
            <button type="button" className={tool === 'eraser' ? 'active' : ''} disabled={disabled} onClick={() => setTool('eraser')} title="Eraser" aria-label="Eraser"><Eraser size={17} /></button>
            <button type="button" className={pencilOnly ? 'active' : ''} disabled={disabled} onClick={() => setPencilOnly((value) => !value)} title={pencilOnly ? 'Pencil only: page gestures stay outside the writing surface' : 'Finger drawing enabled'} aria-label="Toggle palm rejection" aria-pressed={pencilOnly}><Hand size={17} /></button>
            <button type="button" disabled={disabled || !canUndo} onClick={undo} title="Undo" aria-label="Undo last stroke"><Undo2 size={17} /></button>
            <button type="button" disabled={disabled} onClick={clear} title="Clear" aria-label="Clear handwriting"><Trash2 size={17} /></button>
            <button type="button" disabled={disabled || pageCount >= 4} onClick={addPage} title="Add answer page" aria-label="Add answer page"><FilePlus2 size={17} /></button>
            <button type="button" disabled={disabled} onClick={() => fileInputRef.current?.click()} title="Import image" aria-label="Import notebook image"><Upload size={17} /></button>
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" hidden onChange={importImage} />
          </div>
          <canvas
            ref={canvasRef}
            className={`handwriting-pad__canvas ${pencilOnly ? 'pencil-only' : ''}`}
            style={{ height: `${CANVAS_HEIGHT * pageCount}px` }}
            aria-label={`${label} handwriting canvas`}
            onPointerDown={startStroke}
            onPointerMove={continueStroke}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
            onPointerLeave={(event) => event.pointerType === 'mouse' && finishStroke(event)}
            onLostPointerCapture={finishStroke}
          />
        </div>
      ) : (
        <textarea
          className="handwriting-pad__textarea"
          value={text}
          readOnly={disabled}
          rows="10"
          aria-label={`${label} typed response`}
          placeholder="Type your complete method, substitutions, units and final answer here..."
          onChange={(event) => onTextChange?.(event.target.value)}
        />
      )}
      <footer>
        <span aria-live="polite">{status}</span>
        <span>{pageCount} answer page{pageCount === 1 ? '' : 's'}{aiReviewEligible ? ' - AI-assisted review is available after submission' : ' - handwriting is saved with your answer; self-mark with the paired mark scheme after submission'}</span>
      </footer>
    </section>
  )
}
