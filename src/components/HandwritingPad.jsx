import { useEffect, useId, useRef, useState } from 'react'
import { Camera, Eraser, FilePlus2, Hand, Keyboard, PenTool, Redo2, Trash2, Undo2, Upload } from 'lucide-react'
import { canvasPoint, createInkMetrics, drawDot, drawSegment, exposeInkMetrics, pointDistance, pointerSamples } from '../lib/inkStroke'
import { HANDWRITING_HISTORY_MAX_BYTES, HANDWRITING_HISTORY_MAX_ENTRIES, handwritingHistorySize, trimHandwritingHistory } from '../lib/inkHistory'

const CANVAS_HEIGHT = 340
const AUTOSAVE_DEBOUNCE_MS = 180
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

function canvasBlob(exportCanvas) {
  return new Promise((resolve, reject) => {
    exportCanvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The handwritten response could not be prepared.'))
        return
      }
      resolve(blob)
    }, 'image/jpeg', 0.82)
  })
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('The handwritten response could not be prepared.'))
    reader.readAsDataURL(blob)
  })
}

function cloneCanvas(canvas) {
  const clone = window.document.createElement('canvas')
  clone.width = canvas.width
  clone.height = canvas.height
  clone.getContext('2d').drawImage(canvas, 0, 0)
  return clone
}

function historySnapshot(canvas) {
  const size = handwritingHistorySize(canvas.width, canvas.height)
  const snapshot = window.document.createElement('canvas')
  snapshot.width = size.width
  snapshot.height = size.height
  snapshot.getContext('2d').drawImage(canvas, 0, 0, size.width, size.height)
  return { canvas: snapshot, bytes: size.bytes }
}

function restoreCanvas(canvas, snapshot) {
  const source = snapshot?.canvas || snapshot
  fillPaper(canvas)
  const scale = Math.min(1, canvas.width / source.width, canvas.height / source.height)
  canvas.getContext('2d').drawImage(source, 0, 0, source.width, source.height, 0, 0, source.width * scale, source.height * scale)
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
  registerFlush,
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
  const redoRef = useRef([])
  const historyBytesRef = useRef(0)
  const latestSnapshotRef = useRef('')
  const initializedRef = useRef(false)
  const pendingPageEmitRef = useRef(false)
  const saveVersionRef = useRef(0)
  const mountedRef = useRef(true)
  const emitTimerRef = useRef(null)
  const emitCanvasRef = useRef(null)
  const touchPointersRef = useRef(new Map())
  const [mode, setMode] = useState(imageUrl(image) ? 'handwrite' : text ? 'type' : 'handwrite')
  const [tool, setTool] = useState('pen')
  const [pageCount, setPageCount] = useState(() => Math.max(1, Number(image?.pages) || 1))
  const [pencilOnly, setPencilOnly] = useState(() => (window.navigator.maxTouchPoints || 0) > 0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [status, setStatus] = useState(imageUrl(image) ? 'Handwriting restored' : text ? 'Ready for typed response' : 'Ready for Apple Pencil')
  const uploadInputRef = useRef(null)
  const cameraInputRef = useRef(null)

  function exposeHistoryMetrics(canvas, lastEncodeMs) {
    if (!canvas) return
    canvas.dataset.historyEntries = String(historyRef.current.length)
    canvas.dataset.historyBytes = String(historyBytesRef.current)
    canvas.dataset.historyMaxBytes = String(HANDWRITING_HISTORY_MAX_BYTES)
    canvas.dataset.historyMaxEntries = String(HANDWRITING_HISTORY_MAX_ENTRIES)
    canvas.dataset.historyFullDprCanvases = '0'
    if (Number.isFinite(lastEncodeMs)) canvas.dataset.lastEncodeMs = String(Math.round(lastEncodeMs))
  }

  function updateHistoryControls(canvas = canvasRef.current) {
    setCanUndo(historyRef.current.length > 1)
    setCanRedo(redoRef.current.length > 0)
    exposeHistoryMetrics(canvas)
  }

  function snapshot(canvas, includeInHistory = true) {
    const canvasSnapshot = historySnapshot(canvas)
    if (includeInHistory) {
      const bounded = trimHandwritingHistory([...historyRef.current, canvasSnapshot])
      historyRef.current = bounded.entries
      historyBytesRef.current = bounded.bytes
      redoRef.current = []
      updateHistoryControls(canvas)
    }
    return canvasSnapshot
  }

  function setBaseline(canvas) {
    const baseline = historySnapshot(canvas)
    historyRef.current = [baseline]
    redoRef.current = []
    historyBytesRef.current = baseline.bytes
    updateHistoryControls(canvas)
  }

  async function prepareCanvas(canvas) {
    const name = `${answerId || 'response'}-handwriting.jpg`
    const exportCanvas = exportCanvasFor(canvas)
    const blob = await canvasBlob(exportCanvas)
    const dataUrl = await blobDataUrl(blob)
    const evidence = {
      name,
      type: 'image/jpeg',
      dataUrl,
      width: exportCanvas.width,
      height: exportCanvas.height,
      pages: pageCount,
      recognitionStatus: 'visual-review-required',
      attachedAt: new Date().toISOString(),
    }
    const file = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
    Object.defineProperty(file, 'answerPages', { value: pageCount })
    return { evidence, file }
  }

  async function emitCanvas(canvas) {
    const version = saveVersionRef.current + 1
    saveVersionRef.current = version
    if (mountedRef.current) setStatus('Saving locally...')
    const startedAt = performance.now()
    try {
      const { evidence, file } = await prepareCanvas(canvas)
      if (version !== saveVersionRef.current) return
      onSnapshotChange?.(evidence)
      latestSnapshotRef.current = evidence.dataUrl
      exposeHistoryMetrics(canvas, performance.now() - startedAt)
      if (!onImageChange) {
        if (mountedRef.current) setStatus('Saved locally')
        return evidence
      }
      await onImageChange?.(file)
      if (version === saveVersionRef.current && mountedRef.current) setStatus('Saved locally')
      return evidence
    } catch (error) {
      if (version === saveVersionRef.current && mountedRef.current) setStatus(error.message || 'Handwriting could not be saved')
      throw error
    }
  }

  emitCanvasRef.current = emitCanvas

  function scheduleEmit(canvas) {
    window.clearTimeout(emitTimerRef.current)
    emitTimerRef.current = window.setTimeout(() => {
      emitTimerRef.current = null
      void emitCanvas(canvas).catch(() => {})
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  useEffect(() => {
    const timerRef = emitTimerRef
    const mounted = mountedRef
    mounted.current = true
    return () => {
      window.clearTimeout(timerRef.current)
      mounted.current = false
    }
  }, [])

  useEffect(() => registerFlush?.(async () => {
    if (mode !== 'handwrite' || !canvasRef.current) return null
    window.clearTimeout(emitTimerRef.current)
    emitTimerRef.current = null
    const evidence = await emitCanvasRef.current(canvasRef.current)
    return { partId: answerId, evidence }
  }), [answerId, mode, registerFlush])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || mode !== 'handwrite') return undefined

    function resize() {
      const rect = canvas.getBoundingClientRect()
      const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
      const targetWidth = Math.max(1, Math.round(rect.width * ratio))
      const targetHeight = Math.max(1, Math.round(rect.height * ratio))
      if (initializedRef.current && canvas.width === targetWidth && canvas.height === targetHeight) return
      const previousCanvas = initializedRef.current ? cloneCanvas(canvas) : null
      const previousUrl = initializedRef.current ? '' : latestSnapshotRef.current || imageUrl(image)
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
      if (previousCanvas) {
        restoreCanvas(canvas, previousCanvas)
        finishResize()
      } else if (previousUrl) {
        drawImage(canvas, previousUrl).then(() => {
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

  function scrollSurfaceFor(canvas) {
    let node = canvas?.parentElement
    while (node) {
      const style = window.getComputedStyle(node)
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node
      node = node.parentElement
    }
    return window.document.scrollingElement
  }

  function startTouchScroll(event) {
    const canvas = canvasRef.current
    try {
      canvas?.setPointerCapture?.(event.pointerId)
    } catch {
      // Synthetic pointers do not always own capture.
    }
    touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.preventDefault()
    event.stopPropagation()
    setStatus('Finger scrolling - Pencil remains ready')
  }

  function continueTouchScroll(event) {
    const previous = touchPointersRef.current.get(event.pointerId)
    if (!previous) return
    const next = { x: event.clientX, y: event.clientY }
    touchPointersRef.current.set(event.pointerId, next)
    const surface = scrollSurfaceFor(canvasRef.current)
    if (surface) {
      surface.scrollLeft -= next.x - previous.x
      surface.scrollTop -= next.y - previous.y
    }
    event.preventDefault()
    event.stopPropagation()
  }

  function finishTouchScroll(event) {
    if (!touchPointersRef.current.has(event.pointerId)) return
    touchPointersRef.current.delete(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
    if (!touchPointersRef.current.size) setStatus('Ready for Apple Pencil')
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
    if (pencilOnly && event.pointerType === 'touch') {
      startTouchScroll(event)
      return
    }
    if (disabled || mode !== 'handwrite' || drawingRef.current || event.isPrimary === false) return
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
    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      continueTouchScroll(event)
      return
    }
    if (!drawingRef.current || disabled || event.pointerId !== activePointerIdRef.current) return
    event.preventDefault()
    event.stopPropagation()
    appendSamples(event)
  }

  function finishStroke(event) {
    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      finishTouchScroll(event)
      return
    }
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
    scheduleEmit(canvas)
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
    setStatus(nextMode === 'type' ? 'Ready for typed response' : imageUrl(image) ? 'Handwriting restored' : 'Ready for Apple Pencil')
  }

  async function undo() {
    if (disabled || historyRef.current.length <= 1) return
    const removed = historyRef.current.at(-1)
    historyRef.current = historyRef.current.slice(0, -1)
    redoRef.current = [removed, ...redoRef.current].slice(0, HANDWRITING_HISTORY_MAX_ENTRIES)
    historyBytesRef.current = historyRef.current.reduce((total, entry) => total + entry.bytes, 0)
    const previous = historyRef.current.at(-1)
    restoreCanvas(canvasRef.current, previous)
    updateHistoryControls()
    scheduleEmit(canvasRef.current)
  }

  async function redo() {
    if (disabled || !redoRef.current.length) return
    const [next, ...remaining] = redoRef.current
    redoRef.current = remaining
    const bounded = trimHandwritingHistory([...historyRef.current, next])
    historyRef.current = bounded.entries
    historyBytesRef.current = bounded.bytes
    restoreCanvas(canvasRef.current, next)
    updateHistoryControls()
    scheduleEmit(canvasRef.current)
  }

  async function clear() {
    if (disabled) return
    fillPaper(canvasRef.current)
    saveVersionRef.current += 1
    setBaseline(canvasRef.current)
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
      scheduleEmit(canvasRef.current)
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
        <div><strong id={`${instanceId}-label`}>{label}</strong><span>{mode === 'type' ? 'Type the complete method, substitutions, units and final answer.' : 'Write with Apple Pencil, upload a clear photo, or use the camera, then submit for review.'}</span></div>
        <div className="handwriting-pad__modes" role="group" aria-label="Answer input mode">
          <button type="button" className="handwriting-pad__capture" disabled={disabled} onClick={() => uploadInputRef.current?.click()}><Upload size={15} />Upload photo</button>
          <button type="button" className="handwriting-pad__capture" disabled={disabled} onClick={() => cameraInputRef.current?.click()}><Camera size={15} />Take photo</button>
          <button type="button" className={mode === 'handwrite' ? 'active' : ''} onClick={() => switchMode('handwrite')}><PenTool size={16} />Handwrite</button>
          <button type="button" className={mode === 'type' ? 'active' : ''} onClick={() => switchMode('type')}><Keyboard size={16} />Type</button>
        </div>
        <input ref={uploadInputRef} type="file" accept="image/*" hidden onChange={importImage} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={importImage} />
      </header>

      {mode === 'handwrite' ? (
        <div className="handwriting-pad__surface">
          <div className="handwriting-pad__toolbar" role="toolbar" aria-label="Handwriting tools">
            <button type="button" className={tool === 'pen' ? 'active' : ''} disabled={disabled} onClick={() => setTool('pen')} title="Pen" aria-label="Pen"><PenTool size={17} /></button>
            <button type="button" className={tool === 'eraser' ? 'active' : ''} disabled={disabled} onClick={() => setTool('eraser')} title="Eraser" aria-label="Eraser"><Eraser size={17} /></button>
            <button type="button" className={pencilOnly ? 'gesture-enabled' : ''} disabled={disabled} onClick={() => setPencilOnly((value) => !value)} title={pencilOnly ? 'Pencil writes; one or two fingers scroll without drawing' : 'Finger drawing enabled'} aria-label="Toggle palm rejection" aria-pressed={pencilOnly}><Hand size={17} /></button>
            <button type="button" disabled={disabled || !canUndo} onClick={undo} title="Undo" aria-label="Undo last stroke"><Undo2 size={17} /></button>
            <button type="button" disabled={disabled || !canRedo} onClick={redo} title="Redo" aria-label="Redo last stroke"><Redo2 size={17} /></button>
            <button type="button" disabled={disabled} onClick={clear} title="Clear" aria-label="Clear handwriting"><Trash2 size={17} /></button>
            <button type="button" disabled={disabled || pageCount >= 4} onClick={addPage} title="Add answer page" aria-label="Add answer page"><FilePlus2 size={17} /></button>
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
        <span>{mode === 'type'
          ? 'Typed response is saved with this attempt.'
          : `${pageCount} answer page${pageCount === 1 ? '' : 's'}${aiReviewEligible ? ' - AI-assisted review is available after submission' : ' - handwriting is saved with your answer; self-mark with the paired mark scheme after submission'}`}</span>
      </footer>
    </section>
  )
}
