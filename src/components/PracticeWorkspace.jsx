import { useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Lightbulb, ListChecks, Save, Sparkles } from 'lucide-react'
import { AiCoach } from './AiCoach'
import { HandwritingPad } from './HandwritingPad'

function formatTime(totalSec) {
  const minutes = Math.floor(totalSec / 60)
  return `${minutes}:${String(totalSec % 60).padStart(2, '0')}`
}

function hasAnswer(value) {
  return Boolean(String(value || '').trim())
}

function responseLabel(part) {
  if (part.answerType === 'multiple-choice') return 'Multiple choice'
  if (part.answerType === 'numeric') return 'Calculation'
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
    plural(sourceMix.pastPaperItems || 0, 'indexed past-paper item'),
    plural(sourceMix.referencedPapers || 0, 'official PDF reference'),
  ].join(' · ')
}

function prepareEvidence(file) {
  if (!file) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onload = () => {
      const maxSide = 1600
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      const canvas = window.document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, width, height)
      resolve({
        name: file.name,
        type: 'image/jpeg',
        dataUrl: canvas.toDataURL('image/jpeg', 0.82),
        width,
        height,
        pages: file.answerPages || 1,
        recognitionStatus: 'visual-review-required',
        attachedAt: new Date().toISOString(),
      })
      URL.revokeObjectURL(objectUrl)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('This image could not be read.'))
    }
    image.src = objectUrl
  })
}

function isComplete(attempt, part) {
  if (part.answerType === 'multiple-choice') return hasAnswer(attempt.answers[part.id])
  return hasAnswer(attempt.answers[part.id]) || Boolean(attempt.evidence?.[part.id])
}

export function PracticeWorkspace({ attempt, unit, setActivePart, updateAnswer, updateEvidence, submitAttempt, goBack }) {
  const [showSubmitCheck, setShowSubmitCheck] = useState(false)
  const [coachRequest, setCoachRequest] = useState(0)
  const answered = unit.parts.filter((part) => isComplete(attempt, part)).length
  const unanswered = unit.parts.length - answered
  const remaining = Math.max(0, attempt.durationSec - attempt.elapsedSec)
  const settings = attempt.settings || { mode: 'practice', timing: 'recommended', hints: true }
  const modeLabel = settings.mode === 'exam' ? 'Exam mode' : settings.mode === 'guided' ? 'Guided practice' : 'Independent practice'
  const activePart = unit.parts.find((part) => part.id === attempt.activePartId) || unit.parts[0]
  const activeIndex = Math.max(0, unit.parts.findIndex((part) => part.id === activePart.id))

  function goToPart(partId) {
    setActivePart(partId)
    document.getElementById(`question-${partId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function requestSubmit() {
    if (unanswered > 0) setShowSubmitCheck(true)
    else submitAttempt()
  }

  function askCoach(partId) {
    setActivePart(partId)
    setCoachRequest((value) => value + 1)
  }

  return (
    <section className="practice-view">
      <header className="workspace-header">
        <button type="button" className="icon-button" onClick={goBack} aria-label="Back to library"><ArrowLeft size={19} /></button>
        <div className="workspace-title"><strong>{unit.title}</strong><small>{unit.board} · {unit.provenance.licenseStatus}</small></div>
        <div className="workspace-tools">
          <span className={`practice-mode-label mode-${settings.mode}`}>{modeLabel}</span>
          <span className="answer-progress"><CheckCircle2 size={16} />{answered}/{unit.parts.length} answered</span>
          <span className="timer"><Clock3 size={16} />{settings.timing === 'untimed' ? formatTime(attempt.elapsedSec) : formatTime(remaining)}</span>
          <span className="save-state"><Save size={16} />{attempt.saveStatus}</span>
          <button type="button" className="submit-button" onClick={requestSubmit} disabled={attempt.submitting}>{attempt.submitting ? 'Marking...' : 'Submit'}</button>
        </div>
      </header>

      <section className="practice-progress-strip" aria-label="Live practice progress">
        <div><strong>Question {activeIndex + 1} of {unit.parts.length}</strong><span>{answered} answered · {unanswered} remaining</span></div>
        <div className="practice-progress-track"><i style={{ width: `${Math.round((answered / Math.max(1, unit.parts.length)) * 100)}%` }} /></div>
        <div className="practice-progress-meta"><span>{activePart.marks} marks on this question</span><span>{settings.timing === 'untimed' ? 'Untimed' : `${Math.ceil(remaining / 60)} min left`}</span></div>
      </section>

      <div className="student-workspace">
        <aside className="question-index" aria-label="Question navigation">
          <div className="index-heading"><span>Questions</span><strong>{answered}/{unit.parts.length}</strong></div>
          <div className="index-list">{unit.parts.map((part, index) => {
            const complete = isComplete(attempt, part)
            return <button type="button" key={part.id} className={part.id === attempt.activePartId ? 'active' : ''} onClick={() => goToPart(part.id)}><span>{unit.agentGenerated ? index + 1 : part.label}</span><small>{part.marks}m</small>{complete ? <CheckCircle2 size={15} /> : <i />}</button>
          })}</div>
        </aside>

        <main className="answer-paper">
          <header className="answer-paper-heading">
            <div><span>{unit.specification}</span><h1>{unit.topic}</h1><p>{unit.subtopic || 'Structured practice'}</p></div>
            <dl><div><dt>Time</dt><dd>{unit.estimatedMinutes} min</dd></div><div><dt>Marks</dt><dd>{unit.maxMarks}</dd></div></dl>
          </header>

          {unit.sourceMix && <section className="practice-source-strip practice-source-summary" aria-label="Drill source mix">
            <div className="practice-source-copy"><strong>Verified past-paper set</strong><span>{sourceMixText(unit.sourceMix)} · exact QP/MS bindings</span></div>
          </section>}

          <div className="question-flow">{[activePart].map((part) => {
            const index = activeIndex
            const complete = isComplete(attempt, part)
            return (
              <section className="question-block" id={`question-${part.id}`} key={part.id} onFocus={() => setActivePart(part.id)}>
                <div className="question-block-heading">
                  <span className="question-number">{unit.agentGenerated ? index + 1 : `${index + 1}${part.label}`}</span>
                  <div>{settings.mode !== 'exam' && <button type="button" className="ask-coach-button" onClick={() => askCoach(part.id)}><Sparkles size={14} />Ask Coach</button>}<span>{responseLabel(part)}</span><strong>{part.marks} {part.marks === 1 ? 'mark' : 'marks'}</strong></div>
                </div>
                <p className="question-prompt">{displayPrompt(part)}</p>
                {part.sourceLabel && <div className={`question-source-label source-${part.sourceKind || 'generated-practice'}`}><strong>{part.sourceLabel}</strong><span>{part.sourceDescription}</span></div>}

                {part.answerType === 'multiple-choice' && (
                  <fieldset className="mcq-answer"><legend>Select one answer</legend>{part.options.map((option, optionIndex) => {
                    const letter = String.fromCharCode(65 + optionIndex)
                    const optionText = String(option).replace(new RegExp(`^${letter}[.)\\s:-]+`, 'i'), '')
                    const selected = attempt.answers[part.id] === letter
                    return <label className={selected ? 'selected' : ''} key={`${letter}:${option}`}><input type="radio" name={part.id} value={letter} checked={selected} onChange={() => updateAnswer(part.id, letter)} aria-label={`${letter}. ${optionText}`} /><span className="option-letter">{letter}</span><span>{optionText}</span></label>
                  })}</fieldset>
                )}

                {part.answerType !== 'multiple-choice' && (
                  <HandwritingPad
                    answerId={part.id}
                    image={attempt.evidence?.[part.id]}
                    label={`${responseLabel(part)} for part ${part.label}`}
                    text={attempt.answers[part.id] || attempt.working?.[part.id] || ''}
                    onTextChange={(value) => updateAnswer(part.id, value)}
                    onImageChange={async (file) => updateEvidence(part.id, file ? await prepareEvidence(file) : null)}
                  />
                )}

                {part.sourceRef && <details className="question-source-evidence">
                  <summary><span><strong>Original paper evidence</strong><small>{part.sourceRef.paper} · {part.sourceRef.question} · page {part.sourceRef.page}</small></span><a href={part.sourceRef.localUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Open PDF</a></summary>
                  {part.sourceRef.assetUrls?.length > 0 && <div className="question-source-pages" aria-label={`Official source pages for ${part.sourceRef.question}`}>{part.sourceRef.assetUrls.map((url, pageIndex) => <img src={url} alt={`${part.sourceRef.paper}, ${part.sourceRef.question}, source page ${part.sourceRef.pageStart + pageIndex}`} loading="lazy" key={url} />)}</div>}
                </details>}

                <div className={`response-state ${complete ? 'complete' : ''}`}>{complete ? <CheckCircle2 size={15} /> : <span />}{complete ? 'Answer saved' : 'Not answered'}</div>
                {settings.hints && <details className="question-hint"><summary><Lightbulb size={16} />Need a hint?</summary><p>{part.hint || 'Identify the command word, select the relevant relationship, then check units and significant figures. The worked answer stays hidden until submission.'}</p></details>}
                <nav className="question-stepper" aria-label="Move between questions">
                  <button type="button" className="secondary-action" disabled={activeIndex === 0} onClick={() => goToPart(unit.parts[activeIndex - 1]?.id)}><ChevronLeft size={17} />Previous</button>
                  <span>Question {activeIndex + 1} of {unit.parts.length}</span>
                  <button type="button" className="primary-action" disabled={activeIndex === unit.parts.length - 1} onClick={() => goToPart(unit.parts[activeIndex + 1]?.id)}>Next<ChevronRight size={17} /></button>
                </nav>
              </section>
            )
          })}</div>
        </main>

        <aside className="exam-checklist">
          <div className="checklist-heading"><ListChecks size={18} /><strong>Before you submit</strong></div>
          <ul><li>Show substitutions for method marks.</li><li>Keep the final value and unit clear in the same answer area.</li><li>Use the requested significant figures.</li><li>Answer every command word.</li></ul>
          <p>{settings.mode === 'exam' ? 'Exam mode: hints and mark schemes stay hidden until submission.' : 'Answers stay hidden until submission. Your full response is included in assisted review.'}</p>
        </aside>
      </div>

      {showSubmitCheck && (
        <div className="submit-dialog-backdrop" role="presentation" onMouseDown={() => setShowSubmitCheck(false)}>
          <div className="submit-dialog" role="dialog" aria-modal="true" aria-labelledby="submit-check-title" onMouseDown={(event) => event.stopPropagation()}>
            <AlertTriangle size={24} />
            <h2 id="submit-check-title">{unanswered} {unanswered === 1 ? 'question is' : 'questions are'} unanswered</h2>
            <p>Blank answers receive zero marks. You can return to the paper or submit it now.</p>
            <div><button type="button" className="secondary-action" onClick={() => setShowSubmitCheck(false)}>Keep working</button><button type="button" className="submit-button" disabled={attempt.submitting} onClick={submitAttempt}>{attempt.submitting ? 'Marking...' : 'Submit anyway'}</button></div>
          </div>
        </div>
      )}

      {settings.mode !== 'exam' && <AiCoach
        key={`${attempt.id}:${activePart.id}`}
        openRequest={coachRequest}
        context={{
          attemptId: attempt.id,
          view: 'chapter-practice',
          subject: { code: unit.code || unit.specification, title: unit.board },
          stage: unit.stage || unit.specification,
          component: unit.type,
          topic: unit.topic,
          paper: activePart.sourceRef && activePart.answerRef ? {
            questionFile: activePart.sourceRef.paper,
            markSchemeFile: activePart.answerRef.file,
          } : null,
          question: { id: activePart.id, label: `Question ${activePart.label}`, prompt: activePart.prompt, hint: activePart.hint, marks: activePart.marks },
          response: attempt.answers[activePart.id] || attempt.working?.[activePart.id] || '',
          handwritingAttached: Boolean(attempt.evidence?.[activePart.id]),
          submitted: false,
        }}
      />}
    </section>
  )
}
