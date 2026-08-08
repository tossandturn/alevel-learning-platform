import { useEffect, useId, useRef, useState } from 'react'
import { Eraser, FilePlus2, Hand, Keyboard, PenTool, Trash2, Undo2, Upload } from 'lucide-react'

const CANVAS_HEIGHT = 340
const MAX_HISTORY = 24
const PEN_MIN_WIDTH = 1.15
const PEN_PRESSURE_WIDTH = 2.35
const ERASER_WIDTH = 22

function imageUrl(image) {
  return image?.previewUrl || image?.dataUrl || ''
}

function canvasFile(canvas, name, pages) {
  return new Promise((resolve, reject) => {
    const exportCanvas = window.document.createElement('canvas')
    exportCanvas.width = canvas.width
    exportCanvas.height = canvas.height
    const context = exportCanvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, exportCanvas.width, exportCanvas.height)
    context.drawImage(canvas, 0, 0)
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
  image,
  label = 'Response',
  onImageChange,
  onTextChange,
  text = '',
}) {
  const instanceId = useId()
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef(null)
  const historyRef = useRef([])
  const latestSnapshotRef = useRef('')
  const initializedRef = useRef(false)
  const saveTimerRef = useRef(null)
  const [mode, setMode] = useState(imageUrl(image) ? 'handwrite' : text ? 'type' : 'handwrite')
  const [tool, setTool] = useState('pen')
  const [pageCount, setPageCount] = useState(() => Math.max(1, Number(image?.pages) || 1))
  const [pencilOnly, setPencilOnly] = useState(() => (window.navigator.maxTouchPoints || 0) > 1)
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
    try {
      const file = await canvasFile(canvas, `${answerId || 'response'}-handwriting.jpg`, pageCount)
      await onImageChange?.(file)
      setStatus('Saved locally')
    } catch (error) {
      setStatus(error.message || 'Handwriting could not be saved')
    }
  }

  function scheduleEmit(canvas) {
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => emitCanvas(canvas), 1100)
  }

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
      if (previous) {
        drawImage(canvas, previous).then(() => {
          if (!initializedRef.current) setBaseline(canvas)
          initializedRef.current = true
        }).catch(() => fillPaper(canvas))
      } else {
        fillPaper(canvas)
        if (!initializedRef.current) setBaseline(canvas)
        initializedRef.current = true
      }
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      initializedRef.current = false
      window.clearTimeout(saveTimerRef.current)
    }
    // The stored image is only used to hydrate a newly mounted pad. New strokes
    // already live on the canvas and must not be replaced by parent rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pageCount])

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
    if (disabled || mode !== 'handwrite' || (pencilOnly && event.pointerType === 'touch')) return
    event.preventDefault()
    event.stopPropagation()
    const canvas = canvasRef.current
    canvas.setPointerCapture?.(event.pointerId)
    drawingRef.current = true
    lastPointRef.current = pointFor(event)
    setStatus(event.pointerType === 'pen' ? 'Apple Pencil active' : 'Editing')
  }

  function continueStroke(event) {
    if (!drawingRef.current || disabled) return
    event.preventDefault()
    event.stopPropagation()
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    const samples = event.getCoalescedEvents?.() || [event]
    const ratio = canvas.width / canvas.getBoundingClientRect().width
    for (const sample of samples) {
      const previous = lastPointRef.current
      if (!previous) continue
      const next = pointFor(sample)
      const midpoint = { x: (previous.x + next.x) / 2, y: (previous.y + next.y) / 2 }
      context.save()
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
      context.strokeStyle = '#172033'
      context.lineWidth = tool === 'eraser' ? ERASER_WIDTH * ratio : (PEN_MIN_WIDTH + next.pressure * PEN_PRESSURE_WIDTH) * ratio
      context.beginPath()
      context.moveTo(previous.x, previous.y)
      context.quadraticCurveTo(previous.x, previous.y, midpoint.x, midpoint.y)
      context.stroke()
      context.restore()
      lastPointRef.current = next
    }
  }

  function finishStroke(event) {
    if (!drawingRef.current) return
    event.preventDefault()
    event.stopPropagation()
    drawingRef.current = false
    lastPointRef.current = null
    const canvas = canvasRef.current
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
  }

  async function undo() {
    if (disabled || historyRef.current.length <= 1) return
    historyRef.current = historyRef.current.slice(0, -1)
    const previous = historyRef.current.at(-1)
    await drawImage(canvasRef.current, previous)
    latestSnapshotRef.current = previous
    setCanUndo(historyRef.current.length > 1)
    scheduleEmit(canvasRef.current)
  }

  async function clear() {
    if (disabled) return
    fillPaper(canvasRef.current)
    window.clearTimeout(saveTimerRef.current)
    historyRef.current = [snapshot(canvasRef.current, false)]
    setCanUndo(false)
    setStatus('Answer area cleared')
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

  return (
    <section className="handwriting-pad" aria-labelledby={`${instanceId}-label`} onSelectStart={mode === 'handwrite' ? preventSelection : undefined} onDragStart={mode === 'handwrite' ? preventSelection : undefined} onContextMenu={preventSelection}>
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
            <button type="button" className={pencilOnly ? 'active' : ''} disabled={disabled} onClick={() => setPencilOnly((value) => !value)} title="Palm rejection" aria-label="Toggle palm rejection"><Hand size={17} /></button>
            <button type="button" disabled={disabled || !canUndo} onClick={undo} title="Undo" aria-label="Undo last stroke"><Undo2 size={17} /></button>
            <button type="button" disabled={disabled} onClick={clear} title="Clear" aria-label="Clear handwriting"><Trash2 size={17} /></button>
            <button type="button" disabled={disabled || pageCount >= 4} onClick={() => setPageCount((value) => Math.min(4, value + 1))} title="Add answer page" aria-label="Add answer page"><FilePlus2 size={17} /></button>
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
            onSelectStart={preventSelection}
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
      <footer><span aria-live="polite">{status}</span><span>{pageCount} answer page{pageCount === 1 ? '' : 's'}{imageUrl(image) ? ' · image ready for AI review after submission' : ''}</span></footer>
    </section>
  )
}
