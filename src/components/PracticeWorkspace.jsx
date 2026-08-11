import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Clock3, FileText, Lightbulb, ListChecks, Maximize2, Minimize2, RotateCcw, Save, Search, Sparkles, X, ZoomIn, ZoomOut } from 'lucide-react'
import { AiCoach } from './AiCoach'
import { HandwritingPad } from './HandwritingPad'
import { stripSourceVisualPlaceholders, trustedSourceAssetUrls } from '../lib/questionContent.js'
import './QuestionPlayer.css'

const EMPTY_PARTS = Object.freeze([])

function formatTime(totalSec) {
  const minutes = Math.floor(totalSec / 60)
  return `${minutes}:${String(totalSec % 60).padStart(2, '0')}`
}

function hasAnswer(value) {
  return Boolean(String(value || '').trim())
}

function answerTypeLabel(part) {
  if (part.answerType === 'multiple-choice') return 'Choose one'
  if (part.answerType === 'numeric') return 'Calculation'
  if (part.answerType === 'graph') return 'Graph / diagram'
  return 'Written response'
}

function displayPrompt(part) {
  const prompt = stripSourceVisualPlaceholders(part.prompt)
  if (part.answerType !== 'multiple-choice' || !part.options?.length) return prompt
  const firstOption = String(part.options[0] || '').trim()
  const optionStart = firstOption ? prompt.lastIndexOf(firstOption) : -1
  return optionStart > 0 ? prompt.slice(0, optionStart).trim() : prompt
}

function sourceUrlsForPart(part) {
  return trustedSourceAssetUrls({ ...part?.sourceRef, assetUrls: part?.sourceAssetUrls || part?.sourceRef?.assetUrls || [] })
}

function sourcePageFromUrl(url) {
  const match = String(url || '').match(/\/qp-(\d+)\.(?:png|jpe?g|webp)$/i)
  return match ? Number(match[1]) : null
}

function sourceFocusNormalizedRegion(focus) {
  const normalized = Array.isArray(focus?.normalizedRegion) ? focus.normalizedRegion.map(Number) : []
  if (normalized.length === 4 && normalized.every(Number.isFinite)) return normalized
  const size = Array.isArray(focus?.imageSize) ? focus.imageSize.map(Number) : []
  const region = Array.isArray(focus?.region) ? focus.region.map(Number) : []
  if (size.length !== 2 || region.length !== 4 || !size.every(Number.isFinite) || !region.every(Number.isFinite) || size.some((value) => value <= 0)) return null
  return [region[0] / size[0], region[1] / size[1], region[2] / size[0], region[3] / size[1]]
}

function sourceFocusImageStyle(focus) {
  const region = sourceFocusNormalizedRegion(focus)
  if (!region) return undefined
  const [left, top, right] = region
  const width = right - left
  if (!(width > 0)) return undefined
  return {
    width: `${100 / width}%`,
    transform: `translate(-${left * 100}%, -${top * 100}%)`,
  }
}

function sourceFocusAspectRatio(focus) {
  const size = Array.isArray(focus?.imageSize) ? focus.imageSize.map(Number) : []
  const region = Array.isArray(focus?.region) ? focus.region.map(Number) : []
  if (
    size.length === 2
    && region.length === 4
    && size.every(Number.isFinite)
    && region.every(Number.isFinite)
    && region[2] > region[0]
    && region[3] > region[1]
  ) {
    return `${region[2] - region[0]} / ${region[3] - region[1]}`
  }
  const normalized = sourceFocusNormalizedRegion(focus)
  if (!normalized) return undefined
  const [left, top, right, bottom] = normalized
  if (!(right > left) || !(bottom > top)) return undefined
  // A normalized crop without its source image dimensions cannot supply a
  // reliable display ratio. Show the full source page instead of distorting it.
  return undefined
}

function sourceGroupKey(part) {
  return String(part?.sourceQuestionId || part?.questionGroupId || part?.sourceRef?.question || part?.id || '')
}

function sourceQuestionLabel(part, fallback = 'this question') {
  return String(part?.sourceRef?.question || '').trim() || fallback
}

function sourceLabelsOnPage(parts, activePart, assetUrl) {
  const activeKey = sourceGroupKey(activePart)
  const labels = new Set()
  for (const part of parts) {
    if (sourceGroupKey(part) === activeKey || !sourceUrlsForPart(part).includes(assetUrl)) continue
    const label = sourceQuestionLabel(part, '')
    if (label) labels.add(label)
  }
  return [...labels]
}

function requiresBoundSource(part) {
  return part?.sourceKind === 'past-paper' || Boolean(part?.sourceRef?.paperId)
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

function displayPartLabel(part, fallback = 'Question') {
  if (part?.displayLabel) return part.displayLabel
  const file = String(part?.sourceRef?.paper || '').replace(/\.[^.]+$/, '')
  const match = file.match(/(?:^|[_-])([msw])(\d{2})[_-]qp[_-]?(\d{1,2})(?:$|[_-])/i)
  const label = part?.label || fallback
  return match ? `${match[1].toUpperCase()}${match[2]}/${match[3]} · ${label}` : label
}

function sourceMixText(sourceMix) {
  if (!sourceMix) return ''
  return [
    plural(sourceMix.pastPaperItems || 0, 'past-paper question'),
    plural(sourceMix.referencedPapers || 0, 'official paper'),
  ].join(' / ')
}

function markingCapability(part) {
  if (part.aiAssistedMarkingAvailable || part.reviewStatus === 'reviewed') {
    return {
      mode: 'ai-assisted',
      label: 'AI-assisted marking',
      detail: 'Reviewed question-level marks are available after submission.',
    }
  }
  if (part.deterministicScoringAvailable || part.answerKey) {
    return {
      mode: 'deterministic',
      label: 'Deterministic scoring',
      detail: 'This response is checked against its source-bound answer key.',
    }
  }
  return {
    mode: 'self-mark',
    label: 'Self-mark only',
    detail: 'The source question is available for practice, but its question-level marking metadata still awaits review.',
  }
}

function isComplete(attempt, part) {
  if (part.answerType === 'multiple-choice') return hasAnswer(attempt.answers[part.id])
  return hasAnswer(attempt.answers[part.id]) || Boolean(attempt.evidence?.[part.id])
}

function NumericAnswer({ part, value, onChange }) {
  const displayValue = String(value || '').includes('\n') ? '' : value || ''
  return (
    <div className="qp-numeric-entry">
      <label htmlFor={`numeric-${part.id}`}>
        <span>Final value</span>
        <input
          id={`numeric-${part.id}`}
          inputMode="decimal"
          autoComplete="off"
          value={displayValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. 6.0 N"
        />
      </label>
      <p>Include the unit. You can show your working in the answer area below.</p>
    </div>
  )
}

function MultipleChoiceAnswer({ part, selected, onChange }) {
  return (
    <fieldset className="mcq-answer qp-mcq-answer">
      <legend>Select one answer</legend>
      {part.options.map((option, optionIndex) => {
        const letter = String.fromCharCode(65 + optionIndex)
        const optionText = String(option).replace(new RegExp(`^${letter}[.)\\s:-]+`, 'i'), '')
        const isSelected = selected === letter
        return (
          <label className={isSelected ? 'selected' : ''} key={`${letter}:${option}`}>
            <input type="radio" name={part.id} value={letter} checked={isSelected} onChange={() => onChange(letter)} aria-label={`${letter}. ${optionText}`} />
            <span className="qp-option-letter">{letter}</span>
            <span className="qp-option-text">{optionText}</span>
            {isSelected && <CheckCircle2 size={17} aria-hidden="true" />}
          </label>
        )
      })}
    </fieldset>
  )
}

export function PracticeWorkspace({ attempt, unit, setActivePart, updateAnswer, updateEvidence, submitAttempt, deferredMarking = false, stateOwnerId = '', goBack, immersive = false, onToggleImmersive = () => {} }) {
  const [showSubmitCheck, setShowSubmitCheck] = useState(false)
  const [coachRequest, setCoachRequest] = useState(0)
  const [sourceAssetIndex, setSourceAssetIndex] = useState(0)
  const [sourceViewMode, setSourceViewMode] = useState('focus')
  const [sourceZoomOpen, setSourceZoomOpen] = useState(false)
  const [sourceZoomScale, setSourceZoomScale] = useState(1)
  const [sourceAssetLoad, setSourceAssetLoad] = useState({ scope: '', statuses: {} })
  const [flushing, setFlushing] = useState(false)
  const flushHandlersRef = useRef(new Set())
  const sourceZoomTriggerRef = useRef(null)
  const sourceZoomToolbarTriggerRef = useRef(null)
  const sourceZoomCloseRef = useRef(null)
  const sourceZoomRestoreTargetRef = useRef(null)
  const sourceZoomRestorePendingRef = useRef(false)
  const parts = unit.parts || EMPTY_PARTS
  const answered = parts.filter((part) => isComplete(attempt, part)).length
  const unanswered = parts.length - answered
  const remaining = Math.max(0, attempt.durationSec - attempt.elapsedSec)
  const settings = attempt.settings || { mode: 'practice', timing: 'recommended', hints: true }
  const activePart = parts.find((part) => part.id === attempt.activePartId) || parts[0]
  const activeIndex = Math.max(0, parts.findIndex((part) => part.id === activePart?.id))
  const complete = activePart ? isComplete(attempt, activePart) : false
  const progress = Math.round((answered / Math.max(1, parts.length)) * 100)
  const modeLabel = settings.mode === 'exam' ? 'Exam mode' : settings.mode === 'guided' ? 'Guided practice' : 'Practice mode'
  const activeMarkingCapability = markingCapability(activePart)
  const sourceParts = useMemo(() => parts.filter(requiresBoundSource), [parts])
  const allSourceAssetUrls = useMemo(() => [...new Set(sourceParts.flatMap(sourceUrlsForPart))], [sourceParts])
  const sourceAssetScope = `${attempt.id || unit.id || 'practice'}:${allSourceAssetUrls.join('|')}`
  const sourceAssetStatuses = sourceAssetLoad.scope === sourceAssetScope ? sourceAssetLoad.statuses : {}
  const visualSourceUrls = useMemo(() => sourceUrlsForPart(activePart), [activePart])
  const sourceAssetPosition = Math.min(sourceAssetIndex, Math.max(0, visualSourceUrls.length - 1))
  const activeSourceAssetUrl = visualSourceUrls[sourceAssetPosition] || ''
  const sourceAssetPage = activeSourceAssetUrl.match(/\/qp-(\d+)\.(?:png|jpe?g|webp)$/i)?.[1] || activePart.sourceRef?.pageStart || '?'
  const sourceFocusPages = activePart.sourceFocus?.pages || []
  const activeSourceFocus = sourceFocusPages.find((entry) => entry.assetUrl === activeSourceAssetUrl) || null
  const showSourceFocus = sourceViewMode === 'focus' && Boolean(activeSourceFocus)
  const neighboringSourceLabels = sourceLabelsOnPage(parts, activePart, activeSourceAssetUrl)
  const activeRequiresBoundSource = requiresBoundSource(activePart)
  const activeSourceDeclaredComplete = !activeRequiresBoundSource || (activePart.sourceContentComplete === true && visualSourceUrls.length > 0)
  const activeSourceFailed = visualSourceUrls.some((url) => sourceAssetStatuses[url] === 'error')
  const activeSourceLoading = activeRequiresBoundSource && activeSourceDeclaredComplete && visualSourceUrls.some((url) => sourceAssetStatuses[url] !== 'loaded') && !activeSourceFailed
  const activeSourceComplete = !activeRequiresBoundSource || (activeSourceDeclaredComplete && !activeSourceFailed && visualSourceUrls.every((url) => sourceAssetStatuses[url] === 'loaded'))
  const unitSourceDeclaredComplete = sourceParts.every((part) => part.sourceContentComplete === true && sourceUrlsForPart(part).length > 0)
  const unitSourceFailed = allSourceAssetUrls.some((url) => sourceAssetStatuses[url] === 'error')
  const unitSourceComplete = unitSourceDeclaredComplete && !unitSourceFailed && allSourceAssetUrls.every((url) => sourceAssetStatuses[url] === 'loaded')
  const sourceReasonText = (activePart.sourceContentReasons || []).slice(0, 2).join(', ')

  useEffect(() => {
    let cancelled = false
    const initialStatuses = Object.fromEntries(allSourceAssetUrls.map((url) => [url, 'loading']))
    setSourceAssetLoad({ scope: sourceAssetScope, statuses: initialStatuses })
    const images = allSourceAssetUrls.map((url) => {
      const image = new Image()
      image.onload = () => {
        if (cancelled) return
        setSourceAssetLoad((current) => current.scope !== sourceAssetScope || current.statuses[url] === 'loaded'
          ? current
          : { ...current, statuses: { ...current.statuses, [url]: 'loaded' } })
      }
      image.onerror = () => {
        if (cancelled) return
        setSourceAssetLoad((current) => current.scope !== sourceAssetScope || current.statuses[url] === 'error'
          ? current
          : { ...current, statuses: { ...current.statuses, [url]: 'error' } })
      }
      image.src = url
      return image
    })
    return () => {
      cancelled = true
      for (const image of images) {
        image.onload = null
        image.onerror = null
      }
    }
  }, [sourceAssetScope, allSourceAssetUrls])

  useEffect(() => {
    const focusPage = Number(activePart?.sourceFocus?.focusPage)
    const focusIndex = Number.isFinite(focusPage)
      ? visualSourceUrls.findIndex((url) => Number(sourcePageFromUrl(url)) === focusPage)
      : -1
    setSourceAssetIndex(focusIndex >= 0 ? focusIndex : 0)
    setSourceViewMode(activePart?.sourceFocus?.defaultView === 'original' ? 'original' : 'focus')
    setSourceZoomOpen(false)
    setSourceZoomScale(1)
  }, [activePart?.id, activePart?.sourceFocus?.defaultView, activePart?.sourceFocus?.focusPage, visualSourceUrls])

  useLayoutEffect(() => {
    if (sourceZoomOpen) {
      sourceZoomCloseRef.current?.focus({ preventScroll: true })
      return
    }
    if (!sourceZoomRestorePendingRef.current) return

    const candidates = [
      sourceZoomRestoreTargetRef.current,
      sourceZoomTriggerRef.current,
      sourceZoomToolbarTriggerRef.current,
    ]
    const target = candidates.find((candidate) => candidate instanceof HTMLElement && candidate.isConnected && !candidate.disabled)
    sourceZoomRestorePendingRef.current = false
    if (target) target.focus({ preventScroll: true })
  }, [sourceZoomOpen])

  const markSourceAsset = useCallback((url, status) => {
    setSourceAssetLoad((current) => current.scope !== sourceAssetScope || current.statuses[url] === status
      ? current
      : { ...current, statuses: { ...current.statuses, [url]: status } })
  }, [sourceAssetScope])

  const changeSourceAsset = useCallback((nextIndex) => {
    setSourceAssetIndex(Math.max(0, Math.min(visualSourceUrls.length - 1, nextIndex)))
    setSourceZoomScale(1)
  }, [visualSourceUrls.length])

  function openSourceZoom(event) {
    sourceZoomTriggerRef.current = event.currentTarget
    sourceZoomRestoreTargetRef.current = event.currentTarget
    sourceZoomRestorePendingRef.current = false
    setSourceZoomScale(1)
    setSourceZoomOpen(true)
  }

  function closeSourceZoom() {
    sourceZoomRestorePendingRef.current = true
    setSourceZoomOpen(false)
  }

  function goToPart(partId) {
    setActivePart(partId)
    document.getElementById(`question-${partId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function scrollToWorkspaceAnchor(anchor) {
    document.getElementById(`${anchor}-${activePart.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function openCoach() {
    if (!activePart) return
    setActivePart(activePart.id)
    setCoachRequest((value) => value + 1)
  }

  const registerFlush = useCallback((handler) => {
    flushHandlersRef.current.add(handler)
    return () => flushHandlersRef.current.delete(handler)
  }, [])

  async function performSubmit() {
    if (flushing || attempt.submitting) return
    setFlushing(true)
    try {
      const flushed = await Promise.all([...flushHandlersRef.current].map((handler) => handler()))
      const evidencePatch = Object.fromEntries(flushed.filter((item) => item?.partId && item?.evidence).map((item) => [item.partId, item.evidence]))
      await submitAttempt(evidencePatch)
    } finally {
      setFlushing(false)
    }
  }

  function requestSubmit() {
    if (!unitSourceComplete) return
    if (unanswered > 0) setShowSubmitCheck(true)
    else void performSubmit()
  }

  if (!activePart) return null

  return (
    <section className={`practice-view qp-player ${immersive ? 'qp-player--immersive' : ''}`}>
      <header className="qp-header">
        <div className="qp-header__leading">
          <button type="button" className="qp-icon-button" onClick={goBack} aria-label="Back to library" title="Back to practice">
            <ArrowLeft size={19} />
          </button>
          <div className="qp-header__title">
            <strong>{unit.title}</strong>
            <span>{parts.length} verified question{parts.length === 1 ? '' : 's'}{unit.sourceSetIndex ? ` · Set ${unit.sourceSetIndex}` : ''}</span>
          </div>
        </div>
        <div className="qp-header__status">
          <span className={`qp-mode qp-mode--${settings.mode}`}>{modeLabel}</span>
          <span className="qp-status-item"><CheckCircle2 size={16} />{answered}/{parts.length}</span>
          <span className="qp-status-item qp-timer"><Clock3 size={16} />{settings.timing === 'untimed' ? formatTime(attempt.elapsedSec) : formatTime(remaining)}</span>
          <span className="qp-status-item qp-save" aria-live="polite"><Save size={15} />{attempt.saveStatus || 'Saved'}</span>
          <button type="button" className="qp-focus-button" onClick={() => onToggleImmersive(!immersive)} aria-label={immersive ? 'Exit focus mode' : 'Enter focus mode'} aria-pressed={immersive} title={immersive ? 'Exit focus mode' : 'Enter focus mode'}>
            {immersive ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button type="button" className="qp-submit-button" onClick={requestSubmit} disabled={attempt.submitting || flushing || !unitSourceComplete}>
            {attempt.submitting || flushing ? (deferredMarking ? 'Saving and checking...' : 'Marking...') : 'Submit'}
          </button>
        </div>
      </header>

      <div className="qp-shell">
        <div className="qp-flow" aria-label="Practice steps">
          <span className="qp-flow__step qp-flow__step--done"><CheckCircle2 size={15} />Question</span>
          <span className="qp-flow__line qp-flow__line--active" />
          <span className="qp-flow__step qp-flow__step--current"><span>2</span>Attempt</span>
          <span className="qp-flow__line" />
          <span className="qp-flow__step"><span>3</span>Submit</span>
          <div className="qp-flow__meta"><strong>{progress}% complete</strong><span>{unanswered ? `${unanswered} to go` : 'Ready to submit'}</span></div>
        </div>

        <div className="practice-progress-strip qp-progress" aria-label="Question progress">
          <div className="qp-progress__copy"><strong>Question {activeIndex + 1} of {parts.length}</strong><span>{activePart.marks} {activePart.marks === 1 ? 'mark' : 'marks'} · {settings.timing === 'untimed' ? 'Untimed' : `${Math.ceil(remaining / 60)} min left`}</span></div>
          <div className="qp-progress__track"><i style={{ width: `${progress}%` }} /></div>
        </div>

        <div className="qp-layout">
          <aside className="question-index qp-index" aria-label="Question navigation">
            <div className="qp-index__heading"><span>Questions</span><strong>{answered}/{parts.length}</strong></div>
            <div className="index-list qp-index__list">
              {parts.map((part, index) => {
                const partComplete = isComplete(attempt, part)
                return (
                  <button type="button" key={part.id} className={part.id === activePart.id ? 'active' : ''} onClick={() => goToPart(part.id)} aria-label={`Question ${index + 1}${partComplete ? ', answered' : ', not answered'}`} aria-current={part.id === activePart.id ? 'step' : undefined}>
                    <span>{index + 1}</span><small>{part.marks}m</small>{partComplete ? <CheckCircle2 size={15} /> : <i />}
                  </button>
                )
              })}
            </div>
          </aside>

          <main className="answer-paper qp-paper">
            <div className="qp-paper__intro">
              <div>
                <span className="qp-eyebrow">{unit.specification || unit.board || 'Cambridge practice'}</span>
                <h1>{unit.topic || unit.title}</h1>
                <p>Read the question, write your answer, then submit when you are ready.</p>
              </div>
              <div className="qp-paper__stats"><span><strong>{unit.maxMarks}</strong> marks</span><span><strong>{unit.estimatedMinutes || '--'}</strong> min</span></div>
            </div>

            {unit.sourceMix && (
              <details className="qp-provenance">
                <summary><FileText size={16} /><span><strong>Source details</strong><small>{sourceMixText(unit.sourceMix)} · paired answers available after submission</small></span></summary>
                <div className="qp-provenance__body"><strong>Verified past-paper set</strong><span>Every question stays linked to its official source and answer record.</span></div>
              </details>
            )}

            <section className="question-block qp-question" id={`question-${activePart.id}`} onFocus={() => setActivePart(activePart.id)}>
              <div className="qp-question__topline">
                <div className="qp-question__number"><span>Question</span><strong>{activeIndex + 1}</strong></div>
                <div className="qp-question__meta"><span>{answerTypeLabel(activePart)}</span><strong>{activePart.marks} {activePart.marks === 1 ? 'mark' : 'marks'}</strong></div>
              </div>

              <nav className="qp-workbench-jumps" aria-label="Question and answer navigation">
                <button type="button" onClick={() => scrollToWorkspaceAnchor('qp-answer-panel')}><ArrowDown size={15} />Jump to answer</button>
                <button type="button" onClick={() => scrollToWorkspaceAnchor('qp-source-panel')}><ArrowUp size={15} />Back to question</button>
              </nav>

              <div className="qp-question__workbench">
                <section className="qp-question__source-panel qp-question__body" id={`qp-source-panel-${activePart.id}`} aria-label="Question source and prompt">
                  {neighboringSourceLabels.length > 0 && <p className="qp-source-context" data-testid="source-page-context"><strong>Current {sourceQuestionLabel(activePart, `Question ${activeIndex + 1}`)}.</strong> This original page also contains {neighboringSourceLabels.length === 1 ? neighboringSourceLabels[0] : `${neighboringSourceLabels.slice(0, -1).join(', ')} and ${neighboringSourceLabels.at(-1)}`}. They are shown for source fidelity; only the current question is being answered and marked.</p>}
                  {activeSourceComplete && activeSourceAssetUrl ? <figure className={`qp-question-asset ${showSourceFocus ? 'qp-question-asset--focused' : 'qp-question-asset--original'}`} data-source-view={showSourceFocus ? 'focused' : 'original'} data-focus-safety={showSourceFocus ? activeSourceFocus.safetyStatus || 'unverified' : 'full-page'} data-focus-region={showSourceFocus ? activeSourceFocus.region.join(',') : ''} data-focus-raw-region={showSourceFocus ? activeSourceFocus.rawRegion?.join(',') || '' : ''} data-focus-margin={showSourceFocus ? activeSourceFocus.safetyMargin?.join(',') || '' : ''} aria-label={`${showSourceFocus ? 'Focused' : 'Complete'} official source material for ${displayPartLabel(activePart, `Question ${activeIndex + 1}`)}`}>
                    <div className="qp-question-asset__toolbar">
                      <strong>{showSourceFocus ? 'Focused question view' : 'Complete original page'} · {sourceAssetPosition + 1} of {visualSourceUrls.length}</strong>
                      <span>QP p.{sourceAssetPage}</span>
                      {activeSourceFocus && <button type="button" className="qp-source-view-toggle" aria-pressed={!showSourceFocus} onClick={() => setSourceViewMode((value) => value === 'focus' ? 'original' : 'focus')}>{showSourceFocus ? 'Show full original page' : 'Focus current question'}</button>}
                      {visualSourceUrls.length > 1 && <span className="qp-question-asset__pager"><button type="button" className="icon-button" aria-label="Previous source page" disabled={sourceAssetPosition === 0} onClick={() => changeSourceAsset(sourceAssetPosition - 1)}><ChevronLeft size={16} /></button><button type="button" className="icon-button" aria-label="Next source page" disabled={sourceAssetPosition === visualSourceUrls.length - 1} onClick={() => changeSourceAsset(sourceAssetPosition + 1)}><ChevronRight size={16} /></button></span>}
                      <button ref={sourceZoomToolbarTriggerRef} type="button" className="icon-button" aria-label="Expand source image" title="Expand source image" onClick={openSourceZoom}><Search size={16} /></button>
                    </div>
                    <button type="button" className={`qp-question-asset__image ${showSourceFocus ? 'qp-question-asset__image--focus' : 'qp-question-asset__image--page'}`} style={showSourceFocus && activeSourceFocus ? { aspectRatio: sourceFocusAspectRatio(activeSourceFocus) } : undefined} onClick={openSourceZoom} aria-label={showSourceFocus ? 'Expand full official question page' : 'Expand complete official question image'}>
                      <img src={activeSourceAssetUrl} style={showSourceFocus && activeSourceFocus ? sourceFocusImageStyle(activeSourceFocus) : undefined} alt={`${showSourceFocus ? 'Focused' : 'Complete'} official source page ${sourceAssetPosition + 1} for ${displayPartLabel(activePart, `Question ${activeIndex + 1}`)}`} loading="eager" onLoad={() => markSourceAsset(activeSourceAssetUrl, 'loaded')} onError={() => markSourceAsset(activeSourceAssetUrl, 'error')} />
                    </button>
                    <figcaption>{showSourceFocus ? `Verified crop for ${sourceQuestionLabel(activePart, `Question ${activeIndex + 1}`)}. Use the expand control to inspect the complete original page.` : 'Complete source-bound question material. The paired mark scheme stays hidden until submission.'}</figcaption>
                  </figure> : activeSourceLoading ? <div className="qp-source-loading" role="status" aria-live="polite"><FileText size={18} /><strong>Loading complete source material</strong><span>Checking {visualSourceUrls.length} required question page{visualSourceUrls.length === 1 ? '' : 's'} before this answer area opens.</span></div> : activeRequiresBoundSource ? <div className="qp-source-incomplete" role="alert"><AlertTriangle size={18} /><strong>This source question is not complete enough to practise.</strong><span>{activeSourceFailed ? 'A required official question page could not be loaded. Answering and submission are blocked for this attempt.' : `It has been quarantined and cannot be submitted${sourceReasonText ? ` (${sourceReasonText})` : ''}.`}</span></div> : null}
                  <h2>{displayPrompt(activePart)}</h2>
                  {activePart.sourceRef && <div className="question-source-label qp-source-label"><strong>Official Cambridge question · {displayPartLabel(activePart, `Question ${activeIndex + 1}`)}</strong><span>Source-bound question from the original paper. Marking feedback appears after submission.</span></div>}
                  <p className={`qp-marking-capability qp-marking-capability--${activeMarkingCapability.mode}`} data-review-status={activePart.reviewStatus || 'unindexed'}>
                    <span>{activeMarkingCapability.label}</span>{activeMarkingCapability.detail}
                  </p>
                </section>

                <section className="qp-question__answer-panel" id={`qp-answer-panel-${activePart.id}`} aria-label="Answer workspace">
                  <div className="qp-attempt-label"><span>2</span><div><strong>Your answer</strong><small>Show enough reasoning for method marks.</small></div><span className={complete ? 'qp-answer-status qp-answer-status--saved' : 'qp-answer-status'}>{complete ? <><CheckCircle2 size={15} />Saved</> : 'Not answered'}</span></div>

                  {activeSourceComplete && activePart.answerType === 'multiple-choice' && <MultipleChoiceAnswer part={activePart} selected={attempt.answers[activePart.id]} onChange={(value) => updateAnswer(activePart.id, value)} />}
                  {activeSourceComplete && activePart.answerType === 'numeric' && <NumericAnswer part={activePart} value={attempt.answers[activePart.id]} onChange={(value) => updateAnswer(activePart.id, value)} />}
                  {activeSourceComplete && activePart.answerType !== 'multiple-choice' && <HandwritingPad
                    key={activePart.id}
                    answerId={activePart.id}
                    aiReviewEligible={Boolean(activePart.aiAssistedMarkingAvailable && activePart.reviewStatus === 'reviewed')}
                    image={attempt.evidence?.[activePart.id]}
                    label={activePart.answerType === 'numeric' ? 'Working and method' : `${answerTypeLabel(activePart)} area`}
                    text={attempt.answers[activePart.id] || attempt.working?.[activePart.id] || ''}
                    onTextChange={(value) => updateAnswer(activePart.id, value)}
                    onSnapshotChange={(evidence) => updateEvidence(activePart.id, evidence)}
                    registerFlush={registerFlush}
                  />}

                  <div className="qp-question__help">
                    <div><Lightbulb size={17} /><span>Need a nudge?</span></div>
                    {settings.mode !== 'exam' && <button type="button" className="qp-text-action" onClick={openCoach}><Sparkles size={15} />Open AI Tutor</button>}
                    {settings.mode === 'exam' && <small>Hints are available after you submit this exam.</small>}
                  </div>

                  {settings.hints && settings.mode !== 'exam' && <details className="question-hint qp-local-hint"><summary>See a small prompt</summary><p>{activePart.hint || 'Identify the command word, choose the relevant relationship, then check units and significant figures.'}</p></details>}

                  {activePart.sourceRef?.localUrl && <a className="qp-original-paper-link" href={activePart.sourceRef.localUrl} target="_blank" rel="noreferrer">Open original question paper</a>}
                </section>
              </div>
            </section>

            <nav className="question-stepper qp-stepper" aria-label="Move between questions">
              <button type="button" className="qp-secondary-action" disabled={activeIndex === 0} onClick={() => goToPart(parts[activeIndex - 1]?.id)}><ChevronLeft size={17} />Previous</button>
              <span>Question {activeIndex + 1} of {parts.length}</span>
              <button type="button" className="qp-next-action" disabled={activeIndex === parts.length - 1} onClick={() => goToPart(parts[activeIndex + 1]?.id)}>Next question<ChevronRight size={17} /></button>
            </nav>
          </main>
        </div>

        <aside className="exam-checklist qp-checklist" aria-label="Answer checklist">
          <div><ListChecks size={17} /><strong>Before submitting</strong></div>
          <span>Have you answered every command word and included units where needed?</span>
          <small>{settings.mode === 'exam' ? 'Your working and mark scheme stay hidden until submission.' : 'Your answer and any handwriting evidence are saved as you work.'}</small>
        </aside>
      </div>

      {showSubmitCheck && <div className="submit-dialog-backdrop qp-dialog-backdrop" role="presentation" onMouseDown={() => setShowSubmitCheck(false)}>
        <div className="submit-dialog qp-dialog" role="dialog" aria-modal="true" aria-labelledby="submit-check-title" onMouseDown={(event) => event.stopPropagation()}>
          <AlertTriangle size={24} />
          <h2 id="submit-check-title">{unanswered} {unanswered === 1 ? 'question is' : 'questions are'} unanswered</h2>
          <p>{deferredMarking ? 'Blank written responses remain pending and never become an automatic zero. Objective blanks can still score zero. You can keep working or save this submission for review.' : 'Blank objective answers receive zero marks. You can return to the paper or submit it now.'}</p>
          <div><button type="button" className="qp-secondary-action" onClick={() => setShowSubmitCheck(false)}>Keep working</button><button type="button" className="qp-submit-button" disabled={attempt.submitting || flushing} onClick={() => void performSubmit()}>{attempt.submitting || flushing ? (deferredMarking ? 'Saving and checking...' : 'Marking...') : 'Submit anyway'}</button></div>
        </div>
      </div>}

      {settings.mode !== 'exam' && <AiCoach
        key={`${attempt.id}:${activePart.id}`}
        stateOwnerId={stateOwnerId}
        openRequest={coachRequest}
        showTrigger={false}
        context={{
          attemptId: attempt.id,
          stateOwnerId,
          view: 'chapter-practice',
          subject: { code: unit.code || unit.specification, title: unit.board },
          stage: unit.stage || unit.specification,
          component: unit.type,
          topic: unit.topic,
          paper: activePart.sourceRef && activePart.answerRef ? { questionFile: activePart.sourceRef.paper, markSchemeFile: activePart.answerRef.file } : null,
          question: { id: activePart.id, label: displayPartLabel(activePart, `Question ${activeIndex + 1}`), prompt: displayPrompt(activePart), hint: activePart.hint, marks: activePart.marks },
          response: attempt.answers[activePart.id] || attempt.working?.[activePart.id] || '',
          handwritingAttached: Boolean(attempt.evidence?.[activePart.id]),
          submitted: false,
        }}
      />}
      {sourceZoomOpen && activeSourceAssetUrl && <div className="qp-source-zoom-backdrop" role="presentation" onMouseDown={closeSourceZoom}><section className="qp-source-zoom" role="dialog" aria-modal="true" aria-label="Expanded official question image" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') closeSourceZoom() }}><header><strong>Official question page {sourceAssetPosition + 1} of {visualSourceUrls.length}</strong><span className="qp-source-zoom__tools">{visualSourceUrls.length > 1 && <><button type="button" className="icon-button" aria-label="Previous source page" disabled={sourceAssetPosition === 0} onClick={() => changeSourceAsset(sourceAssetPosition - 1)}><ChevronLeft size={17} /></button><button type="button" className="icon-button" aria-label="Next source page" disabled={sourceAssetPosition === visualSourceUrls.length - 1} onClick={() => changeSourceAsset(sourceAssetPosition + 1)}><ChevronRight size={17} /></button></>}<button type="button" className="icon-button" aria-label="Zoom out source image" disabled={sourceZoomScale <= 1} onClick={() => setSourceZoomScale((scale) => Math.max(1, Number((scale - 0.25).toFixed(2))))}><ZoomOut size={17} /></button><button type="button" className="icon-button" aria-label="Reset source image zoom" disabled={sourceZoomScale === 1} onClick={() => setSourceZoomScale(1)}><RotateCcw size={17} /></button><button type="button" className="icon-button" aria-label="Zoom in source image" disabled={sourceZoomScale >= 3} onClick={() => setSourceZoomScale((scale) => Math.min(3, Number((scale + 0.25).toFixed(2))))}><ZoomIn size={17} /></button><button ref={sourceZoomCloseRef} type="button" className="icon-button" aria-label="Close expanded source image" onClick={closeSourceZoom}><X size={18} /></button></span></header><div className="qp-source-zoom__canvas" aria-label={`Official question page ${sourceAssetPosition + 1}, zoom ${sourceZoomScale}x`} tabIndex="0"><img src={activeSourceAssetUrl} style={{ width: `${sourceZoomScale * 100}%` }} alt={`Expanded complete official source page ${sourceAssetPosition + 1}`} onLoad={() => markSourceAsset(activeSourceAssetUrl, 'loaded')} onError={() => markSourceAsset(activeSourceAssetUrl, 'error')} /></div></section></div>}
    </section>
  )
}
