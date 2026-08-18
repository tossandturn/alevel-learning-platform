import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { BrainCircuit, FileText, ImagePlus, MonitorUp, Send, Sparkles, Wrench, X } from 'lucide-react'
import { resolveCoachIntent } from '../lib/coachIntent'
import { parseCoachMessage } from '../lib/coachMessage'
import { MIN_VERIFIED_GROUPS_FOR_PRACTICE } from '../lib/practiceConstants'
import {
  beginCurrentPageCapture,
  cropCurrentPageCapture,
  cropVisiblePageVisuals,
  imageFileToDataUrl,
  MAX_COACH_IMAGE_ATTACHMENTS,
  MIN_CAPTURE_SELECTION_SIDE,
} from '../lib/coachScreenshot'

const STORAGE_PREFIX = 'alevel-ai-coach-v3'
const EMPTY_PRACTICE_OPTIONS = Object.freeze([])

function CoachMessage({ content }) {
  return (
    <p className="ai-message__content">
      {parseCoachMessage(content).map((token, index) => {
        if (token.type === 'break') return <br key={`break-${index}`} />
        if (token.type === 'bold') return <strong key={`bold-${index}`}>{token.value}</strong>
        if (token.type === 'math') return <code className="ai-message__math" key={`math-${index}`}>{token.value}</code>
        return <span key={`text-${index}`}>{token.value}</span>
      })}
    </p>
  )
}

function conversationKey(context) {
  // Coach history is learning-context data. It must never cross a route, stage,
  // course or workspace simply because the question label happens to match.
  const owner = String(context.stateOwnerId || 'guest').trim() || 'guest'
  const route = context.routeId || 'unscoped-route'
  const stage = context.stage || 'unscoped-stage'
  const course = context.subject?.code || context.subject?.id || 'unscoped-course'
  const view = context.view || 'general'
  const attempt = context.attemptId || 'no-attempt'
  const question = context.question?.id || context.question?.number || context.question?.label || 'overview'
  return `${STORAGE_PREFIX}:${encodeURIComponent(owner)}:${route}:${stage}:${course}:${view}:${attempt}:${question}`
}

function loadMessages(key) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.slice(-30) : []
  } catch {
    return []
  }
}

export function AiCoach({
  context = {},
  stateOwnerId = '',
  openRequest = 0,
  openBuilderRequest = 0,
  showTrigger = true,
  practiceOptions = EMPTY_PRACTICE_OPTIONS,
  onGeneratePractice,
  onAgentAction,
  disabled = false,
}) {
  const storageKey = conversationKey({ ...context, stateOwnerId: context.stateOwnerId || stateOwnerId || 'guest' })
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState(() => loadMessages(storageKey))
  const [draft, setDraft] = useState('')
  const [hintLevel, setHintLevel] = useState(1)
  const [imageDataUrls, setImageDataUrls] = useState([])
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderSubjectId, setBuilderSubjectId] = useState(practiceOptions[0]?.id || '')
  const [builderStage, setBuilderStage] = useState(practiceOptions[0]?.stages?.[0] || 'AS')
  const [builderTopicId, setBuilderTopicId] = useState(practiceOptions[0]?.topics?.[0]?.id || '')
  const [builderCount, setBuilderCount] = useState('10')
  const [generating, setGenerating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [captureSource, setCaptureSource] = useState('')
  const [captureSelection, setCaptureSelection] = useState(null)
  const [captureError, setCaptureError] = useState('')
  const [attachingCapture, setAttachingCapture] = useState(false)
  const [preparingImages, setPreparingImages] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)
  const triggerRef = useRef(null)
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)
  const captureButtonRef = useRef(null)
  const screenshotInputRef = useRef(null)
  const requestAbortRef = useRef(null)
  const lastOpenRequestRef = useRef(openRequest)
  const lastOpenBuilderRequestRef = useRef(openBuilderRequest)
  const hydratedStorageKeyRef = useRef(storageKey)
  const captureFrameRef = useRef(null)
  const captureStartRef = useRef(null)
  const canOpenBphoSpc = Boolean(onAgentAction && (context.stage === 'Competition' || context.routeId === 'bpho-admissions-physics'))

  const builderSubject = useMemo(
    () => practiceOptions.find((item) => item.id === builderSubjectId) || practiceOptions[0],
    [builderSubjectId, practiceOptions],
  )
  const builderTopics = useMemo(() => builderSubject?.topics || [], [builderSubject])
  const builderTopic = useMemo(() => builderTopics.find((topic) => topic.id === builderTopicId) || builderTopics[0], [builderTopicId, builderTopics])
  const verifiedCount = builderTopic?.inventoryByStage?.[builderStage] ?? builderTopic?.inventory ?? 0
  const requestedCount = Number(builderCount) || 10
  const hasMinimumVerifiedSource = verifiedCount >= MIN_VERIFIED_GROUPS_FOR_PRACTICE
  const sourceReady = hasMinimumVerifiedSource && verifiedCount >= requestedCount
  const hasCaptureSelection = Boolean(
    captureSelection
    && captureSelection.width >= MIN_CAPTURE_SELECTION_SIDE
    && captureSelection.height >= MIN_CAPTURE_SELECTION_SIDE,
  )
  const hasImageAttachments = imageDataUrls.length > 0
  const closeCoach = useCallback(() => {
    setOpen(false)
    setBuilderOpen(false)
    window.requestAnimationFrame(() => {
      if (!disabled) triggerRef.current?.focus?.()
    })
  }, [disabled])
  const closeScreenshotCapture = useCallback(({ focus = true } = {}) => {
    captureFrameRef.current = null
    captureStartRef.current = null
    setCaptureOpen(false)
    setCaptureSource('')
    setCaptureSelection(null)
    setCaptureError('')
    setAttachingCapture(false)
    setCapturing(false)
    if (!disabled) {
      setOpen(true)
      if (focus) {
        window.requestAnimationFrame(() => captureButtonRef.current?.focus?.())
      }
    }
  }, [disabled])

  useEffect(() => {
    if (!builderSubject) return
    setBuilderSubjectId((current) => practiceOptions.some((item) => item.id === current) ? current : practiceOptions[0]?.id || '')
    setBuilderStage((current) => builderSubject.stages.includes(current) ? current : builderSubject.stages[0])
    setBuilderTopicId((current) => builderTopics.some((topic) => topic.id === current) ? current : builderTopics[0]?.id || '')
  }, [builderSubject, builderTopics, practiceOptions])

  useEffect(() => {
    // Do not write A's in-memory messages into B's storage key during an
    // account switch. The reset effect below hydrates the new scoped history.
    if (hydratedStorageKeyRef.current !== storageKey) return
    const storedMessages = messages.slice(-30).map(({ imageDataUrls: messageImages, ...message }) => ({
      ...message,
      attachmentCount: Number(message.attachmentCount) || messageImages?.length || 0,
    }))
    window.localStorage.setItem(storageKey, JSON.stringify(storedMessages))
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, storageKey])

  useEffect(() => {
    if (hydratedStorageKeyRef.current === storageKey) return
    requestAbortRef.current?.abort()
    requestAbortRef.current = null
    hydratedStorageKeyRef.current = storageKey
    setMessages(loadMessages(storageKey))
    setDraft('')
    setHintLevel(1)
    setImageDataUrls([])
    setError('')
    setLoading(false)
    setCapturing(false)
    captureFrameRef.current = null
    captureStartRef.current = null
    setCaptureOpen(false)
    setCaptureSource('')
    setCaptureSelection(null)
    setCaptureError('')
    setAttachingCapture(false)
    setPreparingImages(false)
    setBuilderOpen(false)
    setOpen(false)
  }, [storageKey])

  useEffect(() => {
    if (openRequest === lastOpenRequestRef.current) return
    lastOpenRequestRef.current = openRequest
    if (openRequest && !disabled) setOpen(true)
  }, [disabled, openRequest])

  useEffect(() => {
    if (openBuilderRequest === lastOpenBuilderRequestRef.current) return
    lastOpenBuilderRequestRef.current = openBuilderRequest
    if (!openBuilderRequest || disabled) return
    const firstOption = practiceOptions[0]
    setOpen(true)
    setBuilderOpen(true)
    if (firstOption) {
      setBuilderSubjectId(firstOption.id)
      setBuilderStage(firstOption.stages?.[0] || 'AS')
      setBuilderTopicId(firstOption.topics?.[0]?.id || '')
    }
  }, [disabled, openBuilderRequest, practiceOptions])

  useEffect(() => () => {
    requestAbortRef.current?.abort()
    captureFrameRef.current = null
    captureStartRef.current = null
  }, [])

  useEffect(() => {
    if (!disabled) return
    requestAbortRef.current?.abort()
    requestAbortRef.current = null
    setOpen(false)
    setBuilderOpen(false)
    setLoading(false)
    setCapturing(false)
    captureFrameRef.current = null
    captureStartRef.current = null
    setCaptureOpen(false)
    setCaptureSource('')
    setCaptureSelection(null)
    setCaptureError('')
    setAttachingCapture(false)
    setDraft('')
    setImageDataUrls([])
    setPreparingImages(false)
    setError('')
  }, [disabled])

  useEffect(() => {
    if (!open) return undefined
    function closeOnEscape(event) {
      if (event.key !== 'Escape') return
      closeCoach()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeCoach, open])

  useEffect(() => {
    if (!open) return undefined
    const dialog = dialogRef.current
    if (!dialog) return undefined
    const focusableSelector = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]'
    closeButtonRef.current?.focus?.()
    function keepFocusInside(event) {
      if (event.key !== 'Tab') return
      const focusable = [...dialog.querySelectorAll(focusableSelector)].filter((element) => element.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', keepFocusInside)
    return () => dialog.removeEventListener('keydown', keepFocusInside)
  }, [open, builderOpen, captureOpen])

  useEffect(() => {
    if (!captureOpen) return undefined
    function closeCaptureOnEscape(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeScreenshotCapture()
    }
    window.addEventListener('keydown', closeCaptureOnEscape)
    return () => window.removeEventListener('keydown', closeCaptureOnEscape)
  }, [captureOpen, closeScreenshotCapture])

  async function ask(message, level = hintLevel) {
    const clean = String(message || '').trim()
    const attachments = imageDataUrls.slice(0, MAX_COACH_IMAGE_ATTACHMENTS)
    if ((!clean && !attachments.length) || loading) return
    const studentMessage = {
      role: 'user',
      content: clean || 'Please check the attached work.',
      imageDataUrls: attachments,
      attachmentCount: attachments.length,
      createdAt: new Date().toISOString(),
    }
    const previous = messages.slice(-10).map(({ role, content }) => ({ role, content }))
    const intent = attachments.length ? null : resolveCoachIntent(clean, previous)
    const assistantId = `coach-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    setMessages((current) => [...current, studentMessage])
    setDraft('')
    setLoading(true)
    setError('')
    requestAbortRef.current?.abort()
    const controller = new AbortController()
    requestAbortRef.current = controller
    const updateAssistant = (patch) => {
      setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, ...patch } : item))
    }
    try {
      if (intent && onAgentAction) {
        const action = await onAgentAction(intent)
        if (action?.handled) {
          setMessages((current) => [...current, {
            id: assistantId,
            role: 'assistant',
            content: action.message,
            mode: 'agent',
            createdAt: new Date().toISOString(),
          }])
          setImageDataUrls([])
          if (!action.keepOpen) closeCoach()
          return
        }
      }

      setMessages((current) => [...current, {
        id: assistantId,
        role: 'assistant',
        content: '',
        mode: 'streaming',
        createdAt: new Date().toISOString(),
      }])
      const response = await fetch('/api/ai/coach/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: studentMessage.content, history: previous, context: intent?.type === 'clarify-practice' ? { ...context, agentIntent: intent } : context, hintLevel: level, imageDataUrls: attachments }),
        signal: controller.signal,
      })
      const contentType = response.headers.get('content-type') || ''
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'AI Coach could not answer this request.')
      }
      if (!contentType.includes('text/event-stream')) {
        const payload = await response.json().catch(() => ({}))
        updateAssistant({ content: payload.answer || '', mode: payload.mode, warning: payload.warning || '' })
        if (payload.mode === 'offline') setError(payload.warning || 'AI Coach is offline. This response is only a controlled offline hint.')
      } else {
        const reader = response.body?.getReader()
        if (!reader) throw new Error('AI Coach returned no stream body.')
        const decoder = new TextDecoder()
        let buffer = ''
        let streamedAnswer = ''
        const consumeEvent = (rawEvent) => {
          const lines = rawEvent.split(/\r?\n/)
          const eventName = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() || 'message'
          const dataLine = lines.find((line) => line.startsWith('data:'))
          if (!dataLine) return
          let payload
          try {
            payload = JSON.parse(dataLine.slice(5).trim())
          } catch {
            return
          }
          if (eventName === 'delta') {
            streamedAnswer += String(payload.text || '')
            updateAssistant({ content: streamedAnswer, mode: 'ai' })
          }
          if (eventName === 'reset') {
            streamedAnswer = ''
            updateAssistant({ content: '', mode: 'streaming', warning: '' })
          }
          if (eventName === 'done') {
            updateAssistant({
              content: payload.answer || streamedAnswer,
              mode: payload.mode,
              warning: payload.warning || '',
            })
            if (payload.mode === 'offline') setError(payload.warning || 'AI Coach is offline. This response is only a controlled offline hint.')
          }
          if (eventName === 'meta' && payload.mode) updateAssistant({ mode: payload.mode, provider: payload.provider || '' })
        }
        while (true) {
          const { value, done } = await reader.read()
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
          const events = buffer.split(/\r?\n\r?\n/)
          buffer = events.pop() || ''
          events.forEach(consumeEvent)
          if (done) break
        }
        if (buffer) consumeEvent(buffer)
      }
      setImageDataUrls([])
      if (/hint|提示|下一步|截图|手写/i.test(clean)) setHintLevel((current) => Math.min(5, current + 1))
    } catch (requestError) {
      if (requestError?.name === 'AbortError') return
      updateAssistant({ content: 'AI Coach is temporarily unavailable.', mode: 'offline', warning: requestError.message || '' })
      setError(requestError.message || 'AI Coach is temporarily unavailable.')
    } finally {
      if (requestAbortRef.current === controller) requestAbortRef.current = null
      setLoading(false)
    }
  }

  async function attachImage(event) {
    const files = [...(event.target.files || [])]
    event.target.value = ''
    if (!files.length) return
    const available = MAX_COACH_IMAGE_ATTACHMENTS - imageDataUrls.length
    if (available <= 0) {
      setError(`Remove a photo before adding more. Coach accepts up to ${MAX_COACH_IMAGE_ATTACHMENTS}.`)
      return
    }
    const selected = files.slice(0, available)
    setPreparingImages(true)
    setError('')
    try {
      const prepared = await Promise.allSettled(selected.map((file) => imageFileToDataUrl(file)))
      const ready = prepared.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
      if (ready.length) {
        setImageDataUrls((current) => [...current, ...ready].slice(0, MAX_COACH_IMAGE_ATTACHMENTS))
      }
      const rejected = prepared.find((result) => result.status === 'rejected')
      if (rejected) setError(rejected.reason?.message || 'One of the selected photos could not be attached.')
      else if (files.length > selected.length) setError(`Only the first ${MAX_COACH_IMAGE_ATTACHMENTS} photos were attached.`)
    } catch (attachError) {
      setError(attachError.message)
    } finally {
      setPreparingImages(false)
    }
  }

  async function captureCurrentPage() {
    if (capturing) return
    if (imageDataUrls.length >= MAX_COACH_IMAGE_ATTACHMENTS) {
      setError(`Remove a photo before adding more. Coach accepts up to ${MAX_COACH_IMAGE_ATTACHMENTS}.`)
      return
    }
    setError('')
    setCapturing(true)
    setCaptureError('')
    setCaptureSelection(null)
    // Remove the drawer before the browser freezes the selected STEM-tab frame.
    // flushSync keeps getDisplayMedia inside the click gesture.
    flushSync(() => setOpen(false))
    try {
      captureFrameRef.current = await beginCurrentPageCapture()
      setCaptureSource('screen')
    } catch {
      captureFrameRef.current = null
      setCaptureSource('visible-page')
    } finally {
      setCapturing(false)
    }
    setCaptureOpen(true)
  }

  function capturePoint(event) {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    }
  }

  function selectionFromPoints(start, end) {
    return {
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    }
  }

  function startCaptureSelection(event) {
    if (event.target.closest('[data-capture-controls]')) return
    const point = capturePoint(event)
    captureStartRef.current = { pointerId: event.pointerId, ...point }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setCaptureError('')
    setCaptureSelection({ left: point.x, top: point.y, width: 0, height: 0 })
  }

  function updateCaptureSelection(event) {
    const start = captureStartRef.current
    if (!start || start.pointerId !== event.pointerId) return
    setCaptureSelection(selectionFromPoints(start, capturePoint(event)))
  }

  function finishCaptureSelection(event) {
    const start = captureStartRef.current
    if (!start || start.pointerId !== event.pointerId) return
    const selection = selectionFromPoints(start, capturePoint(event))
    captureStartRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setCaptureSelection(selection)
    if (selection.width < MIN_CAPTURE_SELECTION_SIDE || selection.height < MIN_CAPTURE_SELECTION_SIDE) {
      setCaptureError('Drag across a larger question area before attaching it.')
    }
  }

  async function attachCapturedArea() {
    if (!hasCaptureSelection || attachingCapture) {
      setCaptureError('Drag across a larger question area before attaching it.')
      return
    }
    setAttachingCapture(true)
    setCaptureError('')
    try {
      const screenshot = captureFrameRef.current
        ? await cropCurrentPageCapture(captureFrameRef.current, captureSelection)
        : await cropVisiblePageVisuals(captureSelection)
      setImageDataUrls((current) => [...current, screenshot].slice(0, MAX_COACH_IMAGE_ATTACHMENTS))
      setError('')
      closeScreenshotCapture({ focus: false })
    } catch (selectionError) {
      setCaptureError(selectionError.message || 'The selected area could not be attached.')
      setAttachingCapture(false)
    }
  }

  function submitComposer(event) {
    event?.preventDefault?.()
    void ask(draft)
  }

  async function generatePractice() {
    if (!onGeneratePractice || !builderSubject || !builderTopicId || generating) return
    if (!sourceReady) {
      setError(hasMinimumVerifiedSource
        ? `This topic currently has ${verifiedCount} checked official questions. Choose an available set size.`
        : `Source indexing is in progress. At least ${MIN_VERIFIED_GROUPS_FOR_PRACTICE} verified question groups are required before AI can build a set.`)
      return
    }
    setGenerating(true)
    setError('')
    try {
      const unit = await onGeneratePractice({
        routeId: builderSubject.routeId,
        subjectId: builderSubject.subjectId,
        stage: builderSubject.stage,
        knowledgeGroupId: builderTopicId,
        questionCount: Number(builderCount),
        allowPartial: false,
      })
      setMessages((current) => [...current, {
        role: 'assistant',
        content: `已生成 ${unit.title}: ${unit.questionGroupCount || unit.parts.length} 题，${unit.maxMarks} 分。每题都有独立答题区；提交后按答案规则批改，手写题会连同图片交给 AI 复核。`,
        createdAt: new Date().toISOString(),
      }])
      setBuilderOpen(false)
      closeCoach()
    } catch (generationError) {
      setError(generationError.message || 'Practice set could not be generated.')
    } finally {
      setGenerating(false)
    }
  }

  if (disabled) return null

  return (
    <>
      {showTrigger && <button ref={triggerRef} type="button" className="ai-coach-trigger" onClick={() => setOpen(true)} aria-label="Open AI Coach" title="Open AI Coach">
        <Sparkles size={18} /><span>AI Coach</span>
      </button>}
      {open && <button type="button" className="ai-coach-backdrop" onPointerDown={closeCoach} onClick={closeCoach} aria-label="Close AI Coach" />}
      <aside ref={dialogRef} className={`ai-coach ${open ? 'open' : ''} ${builderOpen ? 'builder-open' : ''}`} inert={!open ? true : undefined} aria-hidden={!open} aria-modal="true" role="dialog" aria-label="AI Coach">
        <header>
          <div className="ai-coach__identity"><span><BrainCircuit size={19} /></span><div><strong>AI Coach</strong><small>{context.question?.label || context.question?.title || context.subject?.code || 'Study support'}</small></div></div>
          <button ref={closeButtonRef} type="button" className="icon-button" onClick={closeCoach} aria-label="Close AI Coach"><X size={18} /></button>
        </header>

        <div className="ai-coach__context">
          <span>{context.stage || 'Cambridge practice'}</span>
          <strong>{context.question?.prompt || 'Choose a question and ask about the next step.'}</strong>
          {!context.submitted && <small>Before submission, Coach gives progressive hints without revealing the final answer.</small>}
        </div>

        <details className="ai-coach__tools">
          <summary><Wrench size={14} />Tools</summary>
          <div className="ai-coach__quick-actions">
            {onGeneratePractice && <button type="button" className={builderOpen ? 'active' : ''} onClick={() => setBuilderOpen((value) => !value)}><Sparkles size={13} />Build practice</button>}
            <button ref={captureButtonRef} type="button" className="ai-coach__screenshot" aria-label="Capture question area" disabled={capturing} onClick={captureCurrentPage}><MonitorUp size={13} />{capturing ? 'Capturing...' : 'Capture question area'}</button>
            <button type="button" className="ai-coach__screenshot" disabled={preparingImages || imageDataUrls.length >= MAX_COACH_IMAGE_ATTACHMENTS} onClick={() => screenshotInputRef.current?.click()}><ImagePlus size={13} />{preparingImages ? 'Preparing...' : `Provide screenshots (${imageDataUrls.length}/${MAX_COACH_IMAGE_ATTACHMENTS})`}</button>
            {canOpenBphoSpc && <button type="button" onClick={() => ask('打开最新的 BPhO SPC 真题，带答案。')}><FileText size={13} />Latest BPhO SPC</button>}
            <button type="button" onClick={() => ask('Give me a hint for the next step.', hintLevel)}>Hint {hintLevel}/5</button>
            <button type="button" onClick={() => ask('Check my method and identify the first issue.', 3)}>Check method</button>
            {hasImageAttachments && <button type="button" onClick={() => ask('Read my attached work. Give me the first issue and one next step, without giving the final answer.', hintLevel)}><ImagePlus size={13} />Review {imageDataUrls.length > 1 ? 'photos' : 'photo'}</button>}
            <button type="button" onClick={() => ask('What should I practise next based on this response?', 2)}>Next practice</button>
          </div>
        </details>

        {builderOpen && <section className="ai-coach__builder" aria-label="Generate a focused practice set">
          <header><div><strong>Build a focused set</strong><span>Choose the syllabus point, then start writing.</span></div><Sparkles size={18} /></header>
          <label><span>Learning route</span><select value={builderSubject?.id || ''} onChange={(event) => setBuilderSubjectId(event.target.value)}>{practiceOptions.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <label><span>Knowledge point</span><select value={builderTopicId} onChange={(event) => setBuilderTopicId(event.target.value)}>{builderTopics.map((topic) => <option value={topic.id} key={topic.id}>{topic.label}</option>)}</select></label>
          <label><span>Questions</span><select value={builderCount} onChange={(event) => setBuilderCount(event.target.value)}><option value="10">10 questions</option><option value="15" disabled={verifiedCount < 15}>15 questions</option><option value="20" disabled={verifiedCount < 20}>20 questions</option></select></label>
          <p>Uses complete official questions with linked mark schemes. <strong>{verifiedCount} available for this stage</strong>{sourceReady ? ' · ready to build' : hasMinimumVerifiedSource ? ` · choose ${Math.min(verifiedCount, 10)} questions or fewer` : ` · more questions are being prepared (${MIN_VERIFIED_GROUPS_FOR_PRACTICE} needed for a set)`}</p>
          <button type="button" className="primary-action" onClick={generatePractice} disabled={generating || !builderTopicId || !sourceReady}><Sparkles size={16} />{generating ? 'Building...' : sourceReady ? 'Generate and start' : hasMinimumVerifiedSource ? 'Choose an available size' : 'Source indexing in progress'}</button>
        </section>}

        <div className="ai-coach__messages" aria-live="polite">
          {!messages.length && <div className="ai-coach__empty"><Sparkles size={20} /><strong>Ask about the question in front of you</strong><span>Coach already has the subject, paper, stage, current response and submission state.</span></div>}
          {messages.map((message, index) => (
            <article className={`ai-message ai-message--${message.role}`} key={`${message.createdAt || index}-${index}`}>
              <span>{message.role === 'assistant' ? 'Coach' : 'You'}</span>
              <CoachMessage content={message.content} />
              {message.imageDataUrls?.length ? <div className="ai-message__attachments" aria-label={`${message.imageDataUrls.length} photos sent`}>{message.imageDataUrls.map((image, imageIndex) => <img src={image} alt={`Sent work ${imageIndex + 1}`} key={`${message.createdAt}-image-${imageIndex}`} />)}</div> : null}
              {!message.imageDataUrls?.length && message.attachmentCount > 0 ? <small>{message.attachmentCount} photos were attached to this message.</small> : null}
              {message.warning && <small>{message.warning}</small>}
              {message.role === 'assistant' && message.mode === 'local' && <small>Local hint first. Ask for a detailed explanation to use AI Coach.</small>}
              {message.role === 'assistant' && message.mode === 'offline' && <small>Offline hint only; retry when AI Coach is available.</small>}
            </article>
          ))}
          {loading && <div className="ai-coach__thinking"><span />Reviewing the current question...</div>}
          <div ref={endRef} />
        </div>

        <footer>
          {hasImageAttachments && <div className="ai-coach__attachments" role="status" aria-live="polite">
            <span className="ai-coach__attachment-summary"><strong>{imageDataUrls.length}/{MAX_COACH_IMAGE_ATTACHMENTS}</strong> photos ready</span>
            {imageDataUrls.map((image, index) => <div className="ai-coach__attachment" key={`${image.slice(-24)}-${index}`}>
              <img src={image} alt={`Attached work ${index + 1}`} />
              <button type="button" onClick={() => setImageDataUrls((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove attached photo ${index + 1}`}><X size={14} /></button>
            </div>)}
          </div>}
          {preparingImages && <p className="ai-coach__attachment-status" role="status">Preparing photos...</p>}
          {error && <p className="ai-coach__error" role="alert">{error}</p>}
          <form className="ai-coach__composer" onSubmit={submitComposer}>
            <button type="button" className="ai-coach__composer-attach" title="Add photos" aria-label="Add photos" disabled={preparingImages || imageDataUrls.length >= MAX_COACH_IMAGE_ATTACHMENTS} onClick={() => screenshotInputRef.current?.click()}><ImagePlus size={18} /></button>
            <input ref={screenshotInputRef} type="file" accept="image/*" multiple hidden onChange={attachImage} />
            <textarea rows="2" value={draft} placeholder="Ask about a concept or your next step..." onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void ask(draft)
              }
            }} />
            <button type="submit" disabled={loading || preparingImages || (!draft.trim() && !hasImageAttachments)} aria-label="Send to AI Coach"><Send size={18} /></button>
          </form>
        </footer>
      </aside>
      {captureOpen && <section
        className="ai-coach__capture-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Capture a question area"
        onPointerDown={startCaptureSelection}
        onPointerMove={updateCaptureSelection}
        onPointerUp={finishCaptureSelection}
        onPointerCancel={finishCaptureSelection}
      >
        <div className="ai-coach__capture-guide">
          <strong>{captureSource === 'screen' ? 'Drag around the question, graph, table or working you want Coach to read.' : 'Drag over a visible question, graph, or handwritten area to attach it.'}</strong>
          <span>{captureSource === 'screen' ? 'The selected STEM tab was frozen before this selector opened.' : 'Screen sharing was not started, so STEM will crop visible source images and writing instead.'}</span>
        </div>
        {captureSelection && <div
          className="ai-coach__capture-selection"
          aria-hidden="true"
          style={{
            left: `${captureSelection.left}px`,
            top: `${captureSelection.top}px`,
            width: `${captureSelection.width}px`,
            height: `${captureSelection.height}px`,
          }}
        />}
        <div className="ai-coach__capture-toolbar" data-capture-controls onPointerDown={(event) => event.stopPropagation()}>
          {captureError && <p role="alert">{captureError}</p>}
          <button type="button" onClick={() => {
            setCaptureSelection(null)
            setCaptureError('')
          }}>Retake</button>
          <button type="button" className="primary-action" disabled={!hasCaptureSelection || attachingCapture} onClick={attachCapturedArea}>{attachingCapture ? 'Attaching...' : 'Attach screenshot'}</button>
          <button type="button" onClick={() => closeScreenshotCapture()}>Cancel</button>
        </div>
      </section>}
    </>
  )
}
