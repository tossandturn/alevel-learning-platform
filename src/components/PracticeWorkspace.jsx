import { useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock3, FileText, Lightbulb, ListChecks, Maximize2, Minimize2, Save, Sparkles } from 'lucide-react'
import { AiCoach } from './AiCoach'
import { HandwritingPad } from './HandwritingPad'
import './QuestionPlayer.css'

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
  if (part.answerType !== 'multiple-choice' || !part.options?.length) return part.prompt
  const firstOption = String(part.options[0] || '').trim()
  const optionStart = firstOption ? String(part.prompt || '').lastIndexOf(firstOption) : -1
  return optionStart > 0 ? String(part.prompt).slice(0, optionStart).trim() : part.prompt
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

export function PracticeWorkspace({ attempt, unit, setActivePart, updateAnswer, updateEvidence, submitAttempt, goBack }) {
  const [showSubmitCheck, setShowSubmitCheck] = useState(false)
  const [coachRequest, setCoachRequest] = useState(0)
  const [immersive, setImmersive] = useState(false)
  const parts = unit.parts || []
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

  function goToPart(partId) {
    setActivePart(partId)
    document.getElementById(`question-${partId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function openCoach() {
    if (!activePart) return
    setActivePart(activePart.id)
    setCoachRequest((value) => value + 1)
  }

  function requestSubmit() {
    if (unanswered > 0) setShowSubmitCheck(true)
    else submitAttempt()
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
            <span>{unit.topic}{unit.subtopic ? ` / ${unit.subtopic}` : ''}</span>
          </div>
        </div>
        <div className="qp-header__status">
          <span className={`qp-mode qp-mode--${settings.mode}`}>{modeLabel}</span>
          <span className="qp-status-item"><CheckCircle2 size={16} />{answered}/{parts.length}</span>
          <span className="qp-status-item qp-timer"><Clock3 size={16} />{settings.timing === 'untimed' ? formatTime(attempt.elapsedSec) : formatTime(remaining)}</span>
          <span className="qp-status-item qp-save" aria-live="polite"><Save size={15} />{attempt.saveStatus || 'Saved'}</span>
          <button type="button" className="qp-focus-button" onClick={() => setImmersive((value) => !value)} aria-label={immersive ? 'Exit focus mode' : 'Enter focus mode'} aria-pressed={immersive} title={immersive ? 'Exit focus mode' : 'Enter focus mode'}>
            {immersive ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button type="button" className="qp-submit-button" onClick={requestSubmit} disabled={attempt.submitting}>
            {attempt.submitting ? 'Marking...' : 'Submit'}
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

              <div className="qp-question__body">
                <h2>{displayPrompt(activePart)}</h2>
                {activePart.sourceRef && <div className="question-source-label qp-source-label"><strong>Official Cambridge question · {activePart.sourceRef.question || activePart.label || activeIndex + 1}</strong><span>Source-bound question from the original paper. Marking feedback appears after submission.</span></div>}
                <p className={`qp-marking-capability qp-marking-capability--${activeMarkingCapability.mode}`} data-review-status={activePart.reviewStatus || 'unindexed'}>
                  <span>{activeMarkingCapability.label}</span>{activeMarkingCapability.detail}
                </p>
              </div>

              <div className="qp-attempt-label"><span>2</span><div><strong>Your answer</strong><small>Show enough reasoning for method marks.</small></div><span className={complete ? 'qp-answer-status qp-answer-status--saved' : 'qp-answer-status'}>{complete ? <><CheckCircle2 size={15} />Saved</> : 'Not answered'}</span></div>

              {activePart.answerType === 'multiple-choice' && <MultipleChoiceAnswer part={activePart} selected={attempt.answers[activePart.id]} onChange={(value) => updateAnswer(activePart.id, value)} />}
              {activePart.answerType === 'numeric' && <NumericAnswer part={activePart} value={attempt.answers[activePart.id]} onChange={(value) => updateAnswer(activePart.id, value)} />}
              {activePart.answerType !== 'multiple-choice' && <HandwritingPad
                key={activePart.id}
                answerId={activePart.id}
                aiReviewEligible={Boolean(activePart.aiAssistedMarkingAvailable && activePart.reviewStatus === 'reviewed')}
                image={attempt.evidence?.[activePart.id]}
                label={activePart.answerType === 'numeric' ? 'Working and method' : `${answerTypeLabel(activePart)} area`}
                text={attempt.answers[activePart.id] || attempt.working?.[activePart.id] || ''}
                onTextChange={(value) => updateAnswer(activePart.id, value)}
                onSnapshotChange={(evidence) => updateEvidence(activePart.id, evidence)}
              />}

              <div className="qp-question__help">
                <div><Lightbulb size={17} /><span>Need a nudge?</span></div>
                {settings.mode !== 'exam' && <button type="button" className="qp-text-action" onClick={openCoach}><Sparkles size={15} />Open AI Tutor</button>}
                {settings.mode === 'exam' && <small>Hints are available after you submit this exam.</small>}
              </div>

              {settings.hints && settings.mode !== 'exam' && <details className="question-hint qp-local-hint"><summary>See a small prompt</summary><p>{activePart.hint || 'Identify the command word, choose the relevant relationship, then check units and significant figures.'}</p></details>}

              <details className="question-source-evidence qp-source-evidence">
                <summary><span><FileText size={15} /><strong>View official source</strong><small>Original paper · question {activePart.sourceRef?.question || activePart.label || activeIndex + 1}</small></span><ChevronRight size={16} /></summary>
                <div className="question-source-pages" aria-label={`Official source pages for ${activePart.sourceRef?.question || 'this question'}`}>
                  {activePart.sourceRef?.assetUrls?.length > 0 && activePart.sourceRef.assetUrls.map((url, pageIndex) => <img src={url} alt={`${activePart.sourceRef.paper}, ${activePart.sourceRef.question || 'question'}, source page ${(activePart.sourceRef.pageStart || activePart.sourceRef.page || 1) + pageIndex}`} loading="lazy" key={url} />)}
                  {activePart.sourceRef?.localUrl && <a href={activePart.sourceRef.localUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Open the original paper</a>}
                  {activePart.sourceRef?.paper && <small className="qp-source-file">Source record: {activePart.sourceRef.paper}</small>}
                </div>
              </details>
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
          <p>Blank answers receive zero marks. You can return to the paper or submit it now.</p>
          <div><button type="button" className="qp-secondary-action" onClick={() => setShowSubmitCheck(false)}>Keep working</button><button type="button" className="qp-submit-button" disabled={attempt.submitting} onClick={submitAttempt}>{attempt.submitting ? 'Marking...' : 'Submit anyway'}</button></div>
        </div>
      </div>}

      {settings.mode !== 'exam' && <AiCoach
        key={`${attempt.id}:${activePart.id}`}
        openRequest={coachRequest}
        showTrigger={false}
        context={{
          attemptId: attempt.id,
          view: 'chapter-practice',
          subject: { code: unit.code || unit.specification, title: unit.board },
          stage: unit.stage || unit.specification,
          component: unit.type,
          topic: unit.topic,
          paper: activePart.sourceRef && activePart.answerRef ? { questionFile: activePart.sourceRef.paper, markSchemeFile: activePart.answerRef.file } : null,
          question: { id: activePart.id, label: `Question ${activePart.label || activeIndex + 1}`, prompt: activePart.prompt, hint: activePart.hint, marks: activePart.marks },
          response: attempt.answers[activePart.id] || attempt.working?.[activePart.id] || '',
          handwritingAttached: Boolean(attempt.evidence?.[activePart.id]),
          submitted: false,
        }}
      />}
    </section>
  )
}
