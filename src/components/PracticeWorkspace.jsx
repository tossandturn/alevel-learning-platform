import { useCallback, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Clock3, FileText, Lightbulb, ListChecks, Maximize2, Minimize2, Save, Sparkles } from 'lucide-react'
import { AiCoach } from './AiCoach'
import { HandwritingPad } from './HandwritingPad'
import { SourceRegionRenderer } from './SourceRegionRenderer'
import { buildSourceRenderManifest } from '../lib/sourceRenderManifest.js'
import { stripSourceVisualPlaceholders } from '../lib/questionContent.js'
import { evidencePresent, practiceAttemptMetrics, sourceQuestionDisplayLabel } from '../lib/practicePresentation.js'
import './QuestionPlayer.css'

const EMPTY_PARTS = Object.freeze([])

function formatTime(totalSec) {
  const minutes = Math.floor(totalSec / 60)
  return `${minutes}:${String(totalSec % 60).padStart(2, '0')}`
}

function hasAnswer(value) {
  if (value == null) return false
  if (typeof value === 'number') return Number.isFinite(value)
  return Boolean(String(value).trim())
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

function questionGroupKey(part) {
  return String(part?.sourceQuestionId || part?.questionGroupId || part?.bankId || part?.id || '')
}

function groupQuestionParts(parts) {
  const groups = []
  const byId = new Map()
  for (const part of parts) {
    const key = questionGroupKey(part)
    const group = byId.get(key)
    if (group) {
      group.parts.push(part)
      continue
    }
    const nextGroup = { id: key, parts: [part] }
    byId.set(key, nextGroup)
    groups.push(nextGroup)
  }
  return groups
}

function sourceQuestionLabel(part, fallback = 'this question') {
  return sourceQuestionDisplayLabel(part, fallback)
}

function requiresBoundSource(part) {
  return part?.sourceKind === 'past-paper' || Boolean(part?.sourceRef?.paperId)
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

function sourceMixText(sourceMix) {
  if (!sourceMix) return ''
  return [
    plural(sourceMix.pastPaperItems || 0, 'past-paper question'),
    plural(sourceMix.referencedPapers || 0, 'official paper'),
  ].join(' / ')
}

function markingCapability(part) {
  if (part.aiAssistedMarkingAvailable && part.reviewStatus === 'reviewed' && part.studyOnly !== true) {
    return {
      mode: 'ai-assisted',
      label: 'Semantic-reviewed',
      detail: 'AI reviews submitted evidence first, then you can compare the result with the paired mark scheme.',
    }
  }
  if (part.deterministicScoringAvailable || part.answerKey) {
    return {
      mode: 'deterministic',
      label: 'Auto-scored',
      detail: 'This response is checked against its source-bound answer key after submission.',
    }
  }
  return {
    mode: 'self-mark',
    label: 'Self-mark',
    detail: 'Compare this response with the paired mark scheme after the AI check; it stays outside formal mastery.',
  }
}

function isComplete(attempt, part) {
  if (part.answerType === 'multiple-choice') return hasAnswer(attempt.answers[part.id])
  return hasAnswer(attempt.answers[part.id]) || evidencePresent(attempt.evidence?.[part.id])
}

function NumericAnswer({ part, value, onChange }) {
  const normalizedValue = value ?? ''
  const displayValue = String(normalizedValue).includes('\n') ? '' : normalizedValue
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
      <legend>Select one option</legend>
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

function AnswerPartWorkspace({ part, partIndex, totalParts, attempt, active, sourceComplete, settings, updateAnswer, updateEvidence, registerFlush, onFocusPart, onOpenCoach }) {
  const complete = isComplete(attempt, part)
  const capability = markingCapability(part)
  const partLabel = part.displayLabel || part.label || `Part ${partIndex + 1}`

  return (
    <article className={`qp-answer-part ${active ? 'qp-answer-part--active' : ''}`} id={`qp-answer-panel-${part.id}`} data-source-question={partLabel} tabIndex="-1" onFocus={() => onFocusPart(part.id)} onPointerDown={() => onFocusPart(part.id)}>
      <div className="qp-attempt-label">
        <span>{totalParts > 1 ? partIndex + 1 : 2}</span>
        <div>
          <strong>{totalParts > 1 ? `Your answer - ${partLabel}` : 'Your answer'}</strong>
          <small>{part.marks} {part.marks === 1 ? 'mark' : 'marks'} · {answerTypeLabel(part)}</small>
        </div>
        <span className={complete ? 'qp-answer-status qp-answer-status--saved' : 'qp-answer-status'}>{complete ? <><CheckCircle2 size={15} />Saved</> : 'Not answered'}</span>
      </div>

      {sourceComplete && part.answerType === 'multiple-choice' && <MultipleChoiceAnswer part={part} selected={attempt.answers[part.id]} onChange={(value) => updateAnswer(part.id, value)} />}
      {sourceComplete && part.answerType === 'numeric' && <NumericAnswer part={part} value={attempt.answers[part.id]} onChange={(value) => updateAnswer(part.id, value)} />}
      {sourceComplete && part.answerType !== 'multiple-choice' && <HandwritingPad
        key={part.id}
        answerId={part.id}
        aiReviewEligible={Boolean(part.aiAssistedMarkingAvailable && part.reviewStatus === 'reviewed')}
        image={attempt.evidence?.[part.id]}
        label={part.answerType === 'numeric' ? 'Working and method' : `${answerTypeLabel(part)} area`}
        text={attempt.answers[part.id] ?? attempt.working?.[part.id] ?? ''}
        onTextChange={(value) => updateAnswer(part.id, value)}
        onSnapshotChange={(evidence) => updateEvidence(part.id, evidence)}
        registerFlush={registerFlush}
      />}

      <p className={`qp-marking-capability qp-marking-capability--${capability.mode}`} data-review-status={part.reviewStatus || 'unindexed'}>
        <span>{capability.label}</span>{capability.detail}
      </p>

      <div className="qp-question__help">
        <div><Lightbulb size={17} /><span>Need a nudge?</span></div>
        {settings.mode !== 'exam' && <button type="button" className="qp-text-action" onClick={() => onOpenCoach(part.id)}><Sparkles size={15} />Open AI Tutor</button>}
        {settings.mode === 'exam' && <small>Hints are available after you submit this exam.</small>}
      </div>

      {settings.hints && settings.mode !== 'exam' && <details className="question-hint qp-local-hint"><summary>See a small prompt</summary><p>{part.hint || 'Identify the command word, choose the relevant relationship, then check units and significant figures.'}</p></details>}

      {part.sourceRef?.localUrl && <a className="qp-original-paper-link" href={part.sourceRef.localUrl} target="_blank" rel="noreferrer">Open original question paper</a>}
    </article>
  )
}

export function PracticeWorkspace({ attempt, unit, setActivePart, updateAnswer, updateEvidence, submitAttempt, deferredMarking = false, stateOwnerId = '', sharedIdentityToken = '', sharedIdentityUserId = '', goBack, immersive = false, onToggleImmersive = () => {}, onGeneratePractice, onAgentAction }) {
  const [showSubmitCheck, setShowSubmitCheck] = useState(false)
  const [coachRequest, setCoachRequest] = useState(0)
  const [sourceRenderState, setSourceRenderState] = useState({ scope: '', status: 'idle' })
  const [flushing, setFlushing] = useState(false)
  const flushHandlersRef = useRef(new Set())
  const parts = unit.parts || EMPTY_PARTS
  const questionGroups = useMemo(() => groupQuestionParts(parts), [parts])
  const attemptMetrics = useMemo(() => practiceAttemptMetrics(attempt, unit), [attempt, unit])
  // The rendered group map is the authoritative count. A persisted or
  // client-generated declaration can be stale, and must never turn answer
  // parts into phantom questions in the student workflow.
  const sourceQuestionCount = questionGroups.length || parts.length
  const answeredQuestions = questionGroups.filter((group) => group.parts.every((part) => isComplete(attempt, part))).length
  const answerPartCount = parts.length
  const paperCount = attemptMetrics.paperCount
  const totalMarks = attemptMetrics.totalMarks
  const answeredPartCount = attemptMetrics.answeredPartCount
  const unansweredAnswerPartCount = Math.max(0, answerPartCount - answeredPartCount)
  const remaining = Math.max(0, attempt.durationSec - attempt.elapsedSec)
  const settings = attempt.settings || { mode: 'practice', timing: 'recommended', hints: true }
  const activePart = parts.find((part) => part.id === attempt.activePartId) || parts[0]
  const activeQuestion = questionGroups.find((group) => group.parts.some((part) => part.id === activePart?.id)) || questionGroups[0] || { id: '', parts: [] }
  const activeQuestionIndex = Math.max(0, questionGroups.findIndex((group) => group.id === activeQuestion?.id))
  const progress = Math.round((answeredQuestions / Math.max(1, sourceQuestionCount)) * 100)
  const modeLabel = settings.mode === 'exam' ? 'Exam mode' : settings.mode === 'guided' ? 'Guided practice' : 'Practice mode'
  const sourceParts = useMemo(() => parts.filter(requiresBoundSource), [parts])
  const activeRequiresBoundSource = requiresBoundSource(activePart)
  const activeSourceManifest = useMemo(() => buildSourceRenderManifest({ sourceRef: activePart?.sourceRef, parts: activeQuestion.parts }), [activePart?.sourceRef, activeQuestion.parts])
  const activeSourceScope = `${attempt.id || unit.id || 'practice'}:${activeQuestion.id}:${activeSourceManifest?.sourcePdfUrl || ''}:${JSON.stringify(activeSourceManifest?.pages || [])}`
  const activeSourceStatus = sourceRenderState.scope === activeSourceScope ? sourceRenderState.status : 'idle'
  const activeSourceView = activePart?.sourceFocus?.defaultView === 'original' ? 'original' : activePart?.sourceFocus ? 'focused' : 'pdf-regions'
  const activeSourceFocusPage = activePart?.sourceFocus?.pages?.find((entry) => entry.page === activeSourceManifest?.pages?.[0]?.page) || null
  const activeSourceDeclaredComplete = !activeRequiresBoundSource || ((activePart.sourceContentAvailable === true || activePart.sourceContentComplete === true) && Boolean(activeSourceManifest))
  const activeSourceComplete = !activeRequiresBoundSource || (activeSourceDeclaredComplete && (activeSourceStatus === 'ready' || activeSourceStatus === 'fallback'))
  const unitSourceDeclaredComplete = sourceParts.every((part) => (part.sourceContentAvailable === true || part.sourceContentComplete === true) && Boolean(buildSourceRenderManifest({ sourceRef: part.sourceRef, parts: [part] })))
  const unitSourceComplete = unitSourceDeclaredComplete
  const handleSourceRenderStatus = useCallback((status) => {
    setSourceRenderState((current) => current.scope === activeSourceScope && current.status === status
      ? current
      : { scope: activeSourceScope, status })
  }, [activeSourceScope])


  function goToPart(partId) {
    setActivePart(partId)
    document.getElementById(`question-${partId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function goToQuestion(questionId) {
    const group = questionGroups.find((item) => item.id === questionId)
    const targetPart = group?.parts.find((part) => !isComplete(attempt, part)) || group?.parts[0]
    if (!targetPart) return
    setActivePart(targetPart.id)
    document.getElementById(`question-${targetPart.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function goToQuestionOffset(offset) {
    const target = questionGroups[activeQuestionIndex + offset]
    if (target) goToQuestion(target.id)
  }

  function scrollToWorkspaceAnchor(anchor) {
    document.getElementById(`${anchor}-${activePart.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function openCoach(partId = activePart?.id) {
    if (!partId) return
    setActivePart(partId)
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
    if (!unitSourceComplete || !activeSourceComplete) return
    if (unansweredAnswerPartCount > 0) setShowSubmitCheck(true)
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
            <span>{sourceQuestionCount} official question{sourceQuestionCount === 1 ? '' : 's'} · {answerPartCount} answer part{answerPartCount === 1 ? '' : 's'} · {paperCount} paper{paperCount === 1 ? '' : 's'} · {totalMarks} mark{totalMarks === 1 ? '' : 's'}{unit.sourceSetIndex ? ` · Set ${unit.sourceSetIndex}` : ''}</span>
          </div>
        </div>
        <div className="qp-header__status">
          <span className={`qp-mode qp-mode--${settings.mode}`}>{modeLabel}</span>
          <span className="qp-status-item"><CheckCircle2 size={16} />{answeredPartCount}/{answerPartCount} answer parts</span>
          <span className="qp-status-item qp-timer"><Clock3 size={16} />{settings.timing === 'untimed' ? formatTime(attempt.elapsedSec) : formatTime(remaining)}</span>
          <span className="qp-status-item qp-save" aria-live="polite"><Save size={15} />{attempt.saveStatus || 'Saved'}</span>
          <button type="button" className="qp-focus-button" onClick={() => onToggleImmersive(!immersive)} aria-label={immersive ? 'Exit focus mode' : 'Enter focus mode'} aria-pressed={immersive} title={immersive ? 'Exit focus mode' : 'Enter focus mode'}>
            {immersive ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button type="button" className="qp-submit-button" onClick={requestSubmit} disabled={attempt.submitting || flushing || !unitSourceComplete || !activeSourceComplete}>
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
          <div className="qp-flow__meta"><strong>{progress}% complete</strong><span>{unansweredAnswerPartCount ? `${unansweredAnswerPartCount} answer part${unansweredAnswerPartCount === 1 ? '' : 's'} to go` : 'Ready to submit'}</span></div>
        </div>

        <div className="practice-progress-strip qp-progress" aria-label="Question progress">
          <div className="qp-progress__copy"><strong>Question {activeQuestionIndex + 1} of {sourceQuestionCount}</strong><span>{activeQuestion.parts.length} answer part{activeQuestion.parts.length === 1 ? '' : 's'} · {activePart.marks} {activePart.marks === 1 ? 'mark' : 'marks'} · {settings.timing === 'untimed' ? 'Untimed' : `${Math.ceil(remaining / 60)} min left`}</span></div>
          <div className="qp-progress__track"><i style={{ width: `${progress}%` }} /></div>
        </div>

        <div className="qp-layout">
          <aside className="question-index qp-index" aria-label="Question navigation">
            <div className="qp-index__heading"><span>Questions</span><strong>{answeredQuestions}/{sourceQuestionCount} complete</strong><small>{answeredPartCount}/{answerPartCount} parts</small></div>
            <div className="index-list qp-index__list">
              {questionGroups.map((group, index) => {
                const partComplete = group.parts.every((part) => isComplete(attempt, part))
                const sourceQuestionIdentity = sourceQuestionDisplayLabel(group.parts[0], `Question ${index + 1}`)
                const groupMarks = group.parts.reduce((sum, part) => sum + Number(part.marks || 0), 0)
                return (
                  <button type="button" key={group.id} className={group.id === activeQuestion.id ? 'active' : ''} onClick={() => goToQuestion(group.id)} data-source-question={sourceQuestionIdentity} aria-label={`${sourceQuestionIdentity}, question ${index + 1}${partComplete ? ', answered' : ', not answered'}`} aria-current={group.id === activeQuestion.id ? 'step' : undefined}>
                    <span className="qp-index__label" title={sourceQuestionIdentity}>{sourceQuestionIdentity}</span><small>{groupMarks}m</small>{partComplete ? <CheckCircle2 size={15} /> : <i />}
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
              <div className="qp-paper__stats"><span><strong>{totalMarks}</strong> marks</span><span><strong>{unit.estimatedMinutes || '--'}</strong> min</span></div>
            </div>

            {unit.sourceMix && (
              <details className="qp-provenance">
                <summary><FileText size={16} /><span><strong>Source details</strong><small>{sourceMixText(unit.sourceMix)} · paired answers available after submission</small></span></summary>
                <div className="qp-provenance__body"><strong>{unit.practiceMode === 'study-only' ? 'Official-question study set' : 'Official past-paper practice'}</strong><span>Every question stays linked to its original paper and marking guidance.</span></div>
              </details>
            )}

            <section className="question-block qp-question" id={`question-${activePart.id}`}>
              <div className="qp-question__topline">
                <div className="qp-question__number"><span>Question</span><strong>{activeQuestionIndex + 1}</strong></div>
                <div className="qp-question__meta"><span>{activeQuestion.parts.length} answer part{activeQuestion.parts.length === 1 ? '' : 's'} · current {activePart.label || 'part'}</span><strong>{activePart.marks} marks</strong><small>{activeQuestion.parts.reduce((sum, part) => sum + Number(part.marks || 0), 0)} marks total</small></div>
              </div>

              <nav className="qp-workbench-jumps" aria-label="Question and answer navigation">
                <button type="button" onClick={() => scrollToWorkspaceAnchor('qp-answer-panel')}><ArrowDown size={15} />Jump to answer</button>
                <button type="button" onClick={() => scrollToWorkspaceAnchor('qp-source-panel')}><ArrowUp size={15} />Back to question</button>
              </nav>

              <div className="qp-question__workbench">
                <section className="qp-question__source-panel qp-question__body" id={`qp-source-panel-${activePart.id}`} aria-label="Question source and prompt">
                  {activeSourceManifest && activeSourceDeclaredComplete ? <figure className="qp-question-asset qp-question-asset--rendered" data-source-view={activeSourceView} data-source-document={activeSourceManifest.sourceDocumentId} data-source-pages={activeSourceManifest.pages.map((entry) => entry.page).join(',')} data-source-state={activeSourceStatus} data-focus-safety={activeSourceFocusPage?.safetyStatus || 'runtime-pdf'} data-focus-region={activeSourceFocusPage?.region?.join(',') || activeSourceManifest.pages[0]?.normalizedRegion.join(',') || ''} data-focus-margin={activeSourceFocusPage?.safetyMargin?.join(',') || ''} aria-label={`Rendered official source material for ${sourceQuestionLabel(activePart, `Question ${activeQuestionIndex + 1}`)}`}>
                    <div className="qp-question-asset__toolbar"><strong>Complete question · {activeSourceManifest.pages.length} source page{activeSourceManifest.pages.length === 1 ? '' : 's'}</strong><span>Rendered from source PDF</span></div>
                    <SourceRegionRenderer manifest={activeSourceManifest} mode={activeSourceView === 'original' ? 'original' : 'regions'} onStatus={handleSourceRenderStatus} />
                    <figcaption>Question regions are rendered from the checksum-bound original PDF and joined here as one question. The complete paper remains available below.</figcaption>
                  </figure> : activeRequiresBoundSource ? <div className="qp-source-incomplete" role="alert"><AlertTriangle size={18} /><strong>This question is temporarily unavailable.</strong><span>The complete official question and marking guidance could not be confirmed, so answering and submission are blocked.</span></div> : null}
                  {!activePart.sourceRef?.paperId && <h2>{displayPrompt(activePart)}</h2>}
                  {activePart.sourceRef && <div className="question-source-label qp-source-label"><strong>Official Cambridge question · {sourceQuestionLabel(activePart, `Question ${activeQuestionIndex + 1}`)}</strong><span>Source-bound question from the original paper. Marking feedback appears after submission.</span></div>}
                  {activePart.studyOnly && <div className="qp-source-study-note" role="status"><strong>Study mode</strong><span>This official source is ready for practice while formal review is pending. You can submit and self-mark; it is excluded from AI marking and formal mastery.</span></div>}
                </section>

                <section className={`qp-question__answer-panel ${activeQuestion.parts.length > 1 ? 'qp-question__answer-panel--multi' : ''}`} aria-label="Answer workspace">
                  <div className="qp-answer-panel__heading">
                    <strong>{activeQuestion.parts.length === 1 ? 'Answer workspace' : 'Answer every part of this question'}</strong>
                    <span>{activeQuestion.parts.length} answer part{activeQuestion.parts.length === 1 ? '' : 's'} · {activeQuestion.parts.reduce((sum, part) => sum + Number(part.marks || 0), 0)} marks</span>
                  </div>
                  <div className={`qp-answer-list ${activeQuestion.parts.length > 1 ? 'qp-answer-list--multi' : ''}`}>
                    {activeQuestion.parts.map((part, partIndex) => (
                      <AnswerPartWorkspace
                        key={part.id}
                        part={part}
                        partIndex={partIndex}
                        totalParts={activeQuestion.parts.length}
                        attempt={attempt}
                        active={part.id === activePart.id}
                        sourceComplete={activeSourceComplete}
                        settings={settings}
                        updateAnswer={updateAnswer}
                        updateEvidence={updateEvidence}
                        registerFlush={registerFlush}
                        onFocusPart={goToPart}
                        onOpenCoach={openCoach}
                      />
                    ))}
                  </div>
                </section>
              </div>
            </section>

            <nav className="question-stepper qp-stepper" aria-label="Move between source questions">
              <button type="button" className="qp-secondary-action" disabled={activeQuestionIndex === 0} onClick={() => goToQuestionOffset(-1)}><ChevronLeft size={17} />Previous question</button>
              <span>Question {activeQuestionIndex + 1} of {sourceQuestionCount}</span>
              <button type="button" className="qp-next-action" disabled={activeQuestionIndex >= questionGroups.length - 1} onClick={() => goToQuestionOffset(1)}>Next question<ChevronRight size={17} /></button>
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
          <h2 id="submit-check-title">{unansweredAnswerPartCount} {unansweredAnswerPartCount === 1 ? 'answer part is' : 'answer parts are'} unanswered</h2>
          <p>{deferredMarking ? 'Blank written responses remain pending and never become an automatic zero. Objective blanks can still score zero. You can submit now; answered parts go through the AI or automatic check first.' : 'Blank objective answers receive zero marks. You can return to the paper or submit it now.'}</p>
          <div><button type="button" className="qp-secondary-action" onClick={() => setShowSubmitCheck(false)}>Keep working</button><button type="button" className="qp-submit-button" disabled={attempt.submitting || flushing} onClick={() => void performSubmit()}>{attempt.submitting || flushing ? (deferredMarking ? 'Saving and checking...' : 'Marking...') : 'Submit anyway'}</button></div>
        </div>
      </div>}

      {settings.mode !== 'exam' && <AiCoach
        key={`${attempt.id}:${activePart.id}`}
        stateOwnerId={stateOwnerId}
        sharedIdentityToken={sharedIdentityToken}
        sharedIdentityUserId={sharedIdentityUserId}
        openRequest={coachRequest}
        showTrigger={false}
        onGeneratePractice={onGeneratePractice}
        onAgentAction={onAgentAction}
        context={{
          attemptId: attempt.id,
          stateOwnerId,
          view: 'chapter-practice',
          subject: { code: unit.code || unit.specification, title: unit.board },
          stage: unit.stage || unit.specification,
          component: unit.type,
          topic: unit.topic,
          paper: activePart.sourceRef && activePart.answerRef ? { questionFile: activePart.sourceRef.paper, markSchemeFile: activePart.answerRef.file } : null,
          question: { id: activePart.id, label: sourceQuestionLabel(activePart, `Question ${activeQuestionIndex + 1}`), prompt: displayPrompt(activePart), hint: activePart.hint, marks: activePart.marks },
          response: attempt.answers[activePart.id] ?? attempt.working?.[activePart.id] ?? '',
          handwritingAttached: Boolean(attempt.evidence?.[activePart.id]),
          submitted: false,
        }}
      />}
    </section>
  )
}
