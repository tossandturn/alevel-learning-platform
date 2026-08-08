import { useEffect, useMemo, useRef, useState } from 'react'
import { BrainCircuit, FileText, ImagePlus, Send, Sparkles, X } from 'lucide-react'
import { resolveCoachIntent } from '../lib/coachIntent'

const STORAGE_PREFIX = 'alevel-ai-coach-v3'
const EMPTY_PRACTICE_OPTIONS = Object.freeze([])

function conversationKey(context) {
  const attempt = context.attemptId || context.view || 'general'
  const question = context.question?.id || context.question?.number || context.question?.label || 'overview'
  return `${STORAGE_PREFIX}:${attempt}:${question}`
}

function loadMessages(key) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.slice(-30) : []
  } catch {
    return []
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('The image could not be attached.'))
    reader.readAsDataURL(file)
  })
}

export function AiCoach({
  context = {},
  openRequest = 0,
  practiceOptions = EMPTY_PRACTICE_OPTIONS,
  onGeneratePractice,
  onAgentAction,
}) {
  const storageKey = conversationKey(context)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState(() => loadMessages(storageKey))
  const [draft, setDraft] = useState('')
  const [hintLevel, setHintLevel] = useState(1)
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderSubjectId, setBuilderSubjectId] = useState(practiceOptions[0]?.id || '')
  const [builderStage, setBuilderStage] = useState(practiceOptions[0]?.stages?.[0] || 'AS')
  const [builderTopicId, setBuilderTopicId] = useState(practiceOptions[0]?.topics?.[0]?.id || '')
  const [builderCount, setBuilderCount] = useState('10')
  const [generating, setGenerating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)
  const triggerRef = useRef(null)
  const lastOpenRequestRef = useRef(openRequest)

  const builderSubject = useMemo(
    () => practiceOptions.find((item) => item.id === builderSubjectId) || practiceOptions[0],
    [builderSubjectId, practiceOptions],
  )
  const builderTopics = useMemo(() => builderSubject?.topics || [], [builderSubject])
  const builderTopic = useMemo(() => builderTopics.find((topic) => topic.id === builderTopicId) || builderTopics[0], [builderTopicId, builderTopics])
  const verifiedCount = builderTopic?.inventoryByStage?.[builderStage] ?? builderTopic?.inventory ?? 0
  const requestedCount = Number(builderCount) || 10
  const sourceReady = verifiedCount > 0

  useEffect(() => {
    if (!builderSubject) return
    if (!builderSubject.stages.includes(builderStage)) setBuilderStage(builderSubject.stages[0])
    if (!builderTopics.some((topic) => topic.id === builderTopicId)) setBuilderTopicId(builderTopics[0]?.id || '')
  }, [builderSubject, builderStage, builderTopicId, builderTopics])

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(messages.slice(-30)))
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, storageKey])

  useEffect(() => {
    if (openRequest === lastOpenRequestRef.current) return
    lastOpenRequestRef.current = openRequest
    if (openRequest) setOpen(true)
  }, [openRequest])

  useEffect(() => {
    if (!open) return undefined
    function closeOnEscape(event) {
      if (event.key !== 'Escape') return
      closeCoach()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  function closeCoach() {
    setOpen(false)
    setBuilderOpen(false)
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }

  async function ask(message, level = hintLevel) {
    const clean = String(message || '').trim()
    if ((!clean && !imageDataUrl) || loading) return
    const studentMessage = { role: 'user', content: clean || 'Please check the attached work.', createdAt: new Date().toISOString() }
    const previous = messages.slice(-10).map(({ role, content }) => ({ role, content }))
    const intent = imageDataUrl ? null : resolveCoachIntent(clean, previous)
    setMessages((current) => [...current, studentMessage])
    setDraft('')
    setLoading(true)
    setError('')
    try {
      if (intent && onAgentAction) {
        const action = await onAgentAction(intent)
        if (action?.handled) {
          setMessages((current) => [...current, {
            role: 'assistant',
            content: action.message,
            mode: 'agent',
            createdAt: new Date().toISOString(),
          }])
          setImageDataUrl('')
          closeCoach()
          return
        }
      }

      const response = await fetch('/api/ai/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: studentMessage.content, history: previous, context: intent?.type === 'clarify-practice' ? { ...context, agentIntent: intent } : context, hintLevel: level, imageDataUrl }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'AI Coach could not answer this request.')
      setMessages((current) => [...current, {
        role: 'assistant',
        content: payload.answer,
        mode: payload.mode,
        warning: payload.warning || '',
        createdAt: new Date().toISOString(),
      }])
      setImageDataUrl('')
      if (/hint|提示|下一步|截图|手写/i.test(clean)) setHintLevel((current) => Math.min(5, current + 1))
    } catch (requestError) {
      setError(requestError.message || 'AI Coach is temporarily unavailable.')
    } finally {
      setLoading(false)
    }
  }

  async function attachImage(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) {
      setError('Choose an image under 12 MB.')
      return
    }
    try {
      setImageDataUrl(await fileToDataUrl(file))
      setError('')
    } catch (attachError) {
      setError(attachError.message)
    }
  }

  async function generatePractice() {
    if (!onGeneratePractice || !builderSubject || !builderTopicId || generating) return
    setGenerating(true)
    setError('')
    try {
      const unit = await onGeneratePractice({
        routeId: builderSubject.routeId,
        subjectId: builderSubject.subjectId,
        stage: builderSubject.stage,
        knowledgeGroupId: builderTopicId,
        questionCount: Number(builderCount),
        allowPartial: true,
      })
      setMessages((current) => [...current, {
        role: 'assistant',
        content: `已生成 ${unit.title}: ${unit.parts.length} 题，${unit.maxMarks} 分。每题都有独立答题区；提交后按答案规则批改，手写题会连同图片交给 AI 复核。`,
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

  return (
    <>
      <button ref={triggerRef} type="button" className="ai-coach-trigger" onClick={() => setOpen(true)} aria-label="Open AI Coach">
        <Sparkles size={18} /><span>AI Coach</span>
      </button>
      {open && <button type="button" className="ai-coach-backdrop" onPointerDown={closeCoach} onClick={closeCoach} aria-label="Close AI Coach" />}
      <aside className={`ai-coach ${open ? 'open' : ''} ${builderOpen ? 'builder-open' : ''}`} inert={!open ? '' : undefined} aria-hidden={!open} aria-label="AI Coach">
        <header>
          <div className="ai-coach__identity"><span><BrainCircuit size={19} /></span><div><strong>AI Coach</strong><small>{context.question?.label || context.question?.title || context.subject?.code || 'Study support'}</small></div></div>
          <button type="button" className="icon-button" onClick={closeCoach} aria-label="Close AI Coach"><X size={18} /></button>
        </header>

        <div className="ai-coach__context">
          <span>{context.stage || 'Cambridge practice'}</span>
          <strong>{context.question?.prompt || 'Choose a question and ask about the next step.'}</strong>
          {!context.submitted && <small>Before submission, Coach gives progressive hints without revealing the final answer.</small>}
        </div>

        <div className="ai-coach__quick-actions">
          {onGeneratePractice && <button type="button" className={builderOpen ? 'active' : ''} onClick={() => setBuilderOpen((value) => !value)}><Sparkles size={13} />Build practice</button>}
          <label className="ai-coach__screenshot"><ImagePlus size={13} /><span>Screenshot hint</span><input type="file" accept="image/*" capture="environment" onChange={attachImage} /></label>
          {onAgentAction && <button type="button" onClick={() => ask('打开最新的 BPhO SPC 真题，带答案。')}><FileText size={13} />Latest BPhO SPC</button>}
          <button type="button" onClick={() => ask('Give me a hint for the next step.', hintLevel)}>Hint {hintLevel}/5</button>
          <button type="button" onClick={() => ask('Check my method and identify the first issue.', 3)}>Check method</button>
          {imageDataUrl && <button type="button" onClick={() => ask('Read my attached work. Give me the first issue and one next step, without giving the final answer.', hintLevel)}><ImagePlus size={13} />Review screenshot</button>}
          <button type="button" onClick={() => ask('What should I practise next based on this response?', 2)}>Next practice</button>
        </div>

        {builderOpen && <section className="ai-coach__builder" aria-label="Generate a focused practice set">
          <header><div><strong>Build a focused set</strong><span>Choose the syllabus point, then start writing.</span></div><Sparkles size={18} /></header>
          <label><span>Learning route</span><select value={builderSubject?.id || ''} onChange={(event) => setBuilderSubjectId(event.target.value)}>{practiceOptions.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <label><span>Knowledge point</span><select value={builderTopicId} onChange={(event) => setBuilderTopicId(event.target.value)}>{builderTopics.map((topic) => <option value={topic.id} key={topic.id}>{topic.label}</option>)}</select></label>
          <label><span>Questions</span><select value={builderCount} onChange={(event) => setBuilderCount(event.target.value)}><option value="10">10 questions</option><option value="15">15 questions</option><option value="20">20 questions</option></select></label>
          <p>Source policy: indexed official paper only. Each question is bound to its own QP and mark scheme. <strong>{verifiedCount} verified for this stage</strong>{sourceReady && verifiedCount < requestedCount ? ' · available questions will be used' : sourceReady ? ' · ready to build' : ' · indexing in progress'}</p>
          <button type="button" className="primary-action" onClick={generatePractice} disabled={generating || !builderTopicId || !sourceReady}><Sparkles size={16} />{generating ? 'Building...' : sourceReady ? 'Generate and start' : 'No source yet'}</button>
        </section>}

        <div className="ai-coach__messages" aria-live="polite">
          {!messages.length && <div className="ai-coach__empty"><Sparkles size={20} /><strong>Ask about the question in front of you</strong><span>Coach already has the subject, paper, stage, current response and submission state.</span></div>}
          {messages.map((message, index) => (
            <article className={`ai-message ai-message--${message.role}`} key={`${message.createdAt || index}-${index}`}>
              <span>{message.role === 'assistant' ? 'Coach' : 'You'}</span>
              <p>{message.content}</p>
              {message.warning && <small>{message.warning}</small>}
              {message.role === 'assistant' && message.mode === 'local' && <small>Local guidance mode</small>}
            </article>
          ))}
          {loading && <div className="ai-coach__thinking"><span />Reviewing the current question...</div>}
          <div ref={endRef} />
        </div>

        <footer>
          {imageDataUrl && <div className="ai-coach__attachment"><img src={imageDataUrl} alt="Attached work" /><span>Image attached</span><button type="button" onClick={() => setImageDataUrl('')} aria-label="Remove attachment"><X size={15} /></button></div>}
          {error && <p className="ai-coach__error" role="alert">{error}</p>}
          <div className="ai-coach__composer">
            <label title="Attach work"><ImagePlus size={18} /><input type="file" accept="image/*" capture="environment" onChange={attachImage} /></label>
            <textarea rows="2" value={draft} placeholder="Ask about a concept or your next step..." onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                ask(draft)
              }
            }} />
            <button type="button" onClick={() => ask(draft)} disabled={loading || (!draft.trim() && !imageDataUrl)} aria-label="Send to AI Coach"><Send size={18} /></button>
          </div>
        </footer>
      </aside>
    </>
  )
}
