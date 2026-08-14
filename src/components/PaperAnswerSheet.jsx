import { useId, useState } from 'react'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { HandwritingPad } from './HandwritingPad'
import { normalizePaperStudyMode, paperStudyModeLabel } from '../lib/paperStudyMode'

const CHOICES = ['A', 'B', 'C', 'D']
const MODES = new Set(['mcq', 'structured', 'practical'])
const QUESTION_INDEX_WINDOW = 11

function hasText(value) {
  return Boolean(String(value ?? '').trim())
}

function questionState(mode, answer, hasPdfInk = false) {
  if (mode === 'mcq') return answer.choice ? 'complete' : 'unanswered'
  if (hasText(answer.response) || hasText(answer.finalAnswer) || hasText(answer.working) || answer.image || hasPdfInk) return 'complete'
  return 'unanswered'
}

function stateLabel(state) {
  if (state === 'complete') return 'Complete'
  if (state === 'in-progress') return 'In progress'
  return 'Not answered'
}

function maxMarksFor(questionNumber, mode, maxMarksByQuestion) {
  const rawConfigured = maxMarksByQuestion?.[questionNumber]
  const configured = rawConfigured === '' || rawConfigured == null ? Number.NaN : Number(rawConfigured)
  if (Number.isFinite(configured) && configured >= 0) return configured
  return mode === 'mcq' ? 1 : undefined
}

function markValue(value) {
  if (value === '' || value == null) return null
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : null
}

function legacyResponse(answer) {
  if (hasText(answer.response)) return answer.response
  return [answer.working, answer.finalAnswer].filter(hasText).join('\n\n')
}

function AiMarkResult({ result, questionNumber, onRetryMarking }) {
  if (!result) return null
  if (result.status === 'checking_availability') return <div className="vision-mark vision-mark--loading"><Sparkles size={16} /><span>Checking availability</span></div>
  if (result.status === 'queued') return <div className="vision-mark vision-mark--loading"><Sparkles size={16} /><span>Marking queued</span></div>
  if (result.status === 'processing') return <div className="vision-mark vision-mark--loading"><Sparkles size={16} /><span>Marking in progress</span></div>
  if (result.status === 'failed' && result.loginRequired) return <div className="vision-mark vision-mark--inactive"><span>AI mark pending sign-in.</span></div>
  if (result.status === 'failed') return <div className="vision-mark vision-mark--error"><span>{result.failureCode === 'service_unavailable' ? 'Marking service unavailable; response saved.' : 'Marking failed; response saved.'}</span>{result.retryable && result.submissionId && onRetryMarking && <button type="button" onClick={() => onRetryMarking(questionNumber)}>Retry shared marking</button>}</div>
  if (result.status === 'missing_metadata' || result.status === 'review-only') return <div className="vision-mark vision-mark--inactive"><span>This question has no reviewed question-level mark allocation in the current index. Your response is saved; use the paired mark scheme for self-marking.</span></div>
  if (result.status !== 'completed') return null
  return (
    <div className="vision-mark vision-mark--success">
      <header><span>AI-assisted mark · not official</span><strong>{result.rawMarks}/{result.maxMarks}</strong><small>{Math.round((result.confidence || 0) * 100)}% confidence{result.reviewRequired ? ' · check required' : ''}</small></header>
      <p>{result.summary}</p>
      {result.recognizedWork && <details><summary>Recognised working</summary><p>{result.recognizedWork}</p></details>}
      {result.markPoints?.length > 0 && <ul>{result.markPoints.map((point) => <li key={point.id} data-awarded={point.awarded}><strong>{point.awarded ? 'Awarded' : 'Not awarded'}</strong><span>{point.reason}</span></li>)}</ul>}
      {result.nextAction && <small>{result.nextAction}</small>}
    </div>
  )
}

function SelfMarkInput({ mode, questionNumber, maxMarksByQuestion, officialMaxMarks, selfMarks, onMaxMarkChange, onSelfMarkChange }) {
  const maxMarks = maxMarksFor(questionNumber, mode, maxMarksByQuestion)
  const value = selfMarks?.[questionNumber] ?? ''
  const hasAvailableMarks = Number.isFinite(maxMarks)
  const awardedMarks = markValue(value)
  const isComplete = hasAvailableMarks && awardedMarks != null
  const automatic = mode === 'mcq'
  const fieldId = `self-mark-${questionNumber}`

  return (
    <fieldset className="paper-answer-sheet__self-mark">
      <legend>{automatic ? 'Official answer check' : `Self-mark question ${questionNumber}`}{officialMaxMarks ? ' · reviewed allocation' : ''}</legend>
      <label>
        <small>Mark scheme total</small>
        <input
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={maxMarks ?? ''}
          disabled={mode === 'mcq' || Boolean(officialMaxMarks)}
          placeholder={hasAvailableMarks ? undefined : 'From mark scheme'}
          aria-label={`Mark scheme total for question ${questionNumber}`}
          aria-describedby={`${fieldId}-help`}
          onChange={(event) => onMaxMarkChange?.(questionNumber, event.target.value === '' ? null : Math.max(1, Number(event.target.value)))}
        />
      </label>
      <label>
        <small>Your awarded mark</small>
        <input
          type="number"
          min="0"
          max={maxMarks}
          step="1"
          inputMode="numeric"
          value={value}
          disabled={automatic || !hasAvailableMarks}
          placeholder={automatic ? 'After submission' : hasAvailableMarks ? '0' : 'Set total first'}
          aria-label={`Awarded mark for question ${questionNumber}`}
          aria-describedby={`${fieldId}-help`}
          onChange={(event) => {
            const nextValue = event.target.value
            if (nextValue === '') {
              onSelfMarkChange?.(questionNumber, null)
              return
            }
            onSelfMarkChange?.(questionNumber, Math.min(maxMarks, Math.max(0, Number(nextValue))))
          }}
        />
      </label>
      <p id={`${fieldId}-help`} className={isComplete ? 'is-complete' : ''} role="status">
        {automatic
          ? (isComplete ? `Official answer check: ${awardedMarks}/${maxMarks} marks.` : 'Select an option and submit to check it against the official answer key.')
          : (isComplete ? `Recorded for this attempt: ${awardedMarks}/${maxMarks} marks.` : hasAvailableMarks ? 'Enter the mark you awarded after checking the mark scheme.' : 'Enter the total marks printed beside this question in the mark scheme first.')}
      </p>
    </fieldset>
  )
}

export function SelfMarkSummary({ mode = 'structured', responseQuestionNumbers, selfMarks, maxMarksByQuestion, lastSavedReview, onOpenMarkScheme, onReviewSubmit }) {
  const scoredQuestionNumbers = responseQuestionNumbers.filter((questionNumber) => {
    const awarded = markValue(selfMarks?.[questionNumber])
    const available = markValue(maxMarksByQuestion?.[questionNumber])
    return awarded != null && available != null && awarded <= available
  })
  const totals = scoredQuestionNumbers.reduce((summary, questionNumber) => ({
    awarded: summary.awarded + markValue(selfMarks[questionNumber]),
    available: summary.available + markValue(maxMarksByQuestion[questionNumber]),
  }), { awarded: 0, available: 0 })
  const hasScore = scoredQuestionNumbers.length > 0
  const allSubmittedResponsesScored = responseQuestionNumbers.length > 0 && scoredQuestionNumbers.length === responseQuestionNumbers.length

  return (
    <section className="paper-answer-sheet__self-mark-summary" aria-labelledby="self-mark-summary-title">
      <div>
        <span>Submitted answer sheet</span>
        <h3 id="self-mark-summary-title">{mode === 'mcq' ? 'Official answer check' : 'Self-mark with the paired mark scheme'}</h3>
        <p>{mode === 'mcq' ? 'Objective answers are checked against the reviewed official answer key after submission.' : 'For each answered question, enter the total shown in the mark scheme, then the marks you awarded yourself.'}</p>
      </div>
      <dl>
        <div><dt>Scored responses</dt><dd>{scoredQuestionNumbers.length}/{responseQuestionNumbers.length}</dd></div>
        <div><dt>Current total</dt><dd>{hasScore ? `${totals.awarded}/${totals.available}` : 'Not scored'}</dd></div>
      </dl>
      <div className="paper-answer-sheet__self-mark-summary-actions">
        <p role="status">{lastSavedReview ? `${lastSavedReview.partial ? 'Saved provisional result' : 'Saved result'}: ${lastSavedReview.rawMarks}/${lastSavedReview.maxMarks} marks. ${lastSavedReview.unansweredQuestionNumbers?.length ? `${lastSavedReview.unansweredQuestionNumbers.length} unanswered question${lastSavedReview.unansweredQuestionNumbers.length === 1 ? '' : 's'} remain unmarked.` : ''}` : hasScore ? (allSubmittedResponsesScored ? 'All submitted responses are ready to save. Unanswered questions remain unmarked.' : 'Progress is saved in this attempt; score the remaining responses when ready.') : 'Start with the mark scheme total for an answered question.'}</p>
        <div>
          <button type="button" className="paper-answer-sheet__mark-scheme-action" onClick={onOpenMarkScheme}>Open mark scheme</button>
          <button type="button" onClick={onReviewSubmit} disabled={!hasScore}>{mode === 'mcq' ? 'Save result' : 'Save self-mark'}</button>
        </div>
      </div>
    </section>
  )
}

/**
 * Controlled answer sheet for one paper profile. The parent owns drafts, images,
 * submission state and self-marks so this component can share the app's storage.
 */
export function PaperAnswerSheet({
  profile,
  paperStudyMode = 'past-paper-practice',
  questionCount,
  activeQuestion = 1,
  draftAnswers = {},
  pdfInkActive = false,
  pdfInkQuestionNumbers = [],
  submitted = false,
  selfMarks = {},
  maxMarksByQuestion = {},
  aiMarks = {},
  questionMetadataByNumber = {},
  reviewedResponseQuestionNumbers = [],
  sharedMarkingContract = null,
  sharedIdentityConnected = false,
  onOpenAccount,
  aiMarkingInProgress = false,
  disabled = false,
  onAnswerChange,
  onQuestionFocus,
  onAskCoach,
  onImageChange,
  onLinkPdfInkQuestion,
  onMaxMarkChange,
  onReviewSubmit,
  onRequestAiMarking,
  onSelfMarkChange,
  onSubmit,
  onRetryMarking,
}) {
  const instanceId = useId()
  const mode = profile?.mode
  const studyModeLabel = paperStudyModeLabel(normalizePaperStudyMode(paperStudyMode))

  if (!MODES.has(mode)) {
    throw new TypeError("PaperAnswerSheet profile.mode must be 'mcq', 'structured' or 'practical'.")
  }

  const totalQuestions = Math.max(0, Math.floor(Number(questionCount) || 0))
  const questionNumbers = Array.from({ length: totalQuestions }, (_, index) => index + 1)
  const currentQuestion = Math.min(totalQuestions || 1, Math.max(1, Number(activeQuestion) || 1))
  const pdfInkQuestions = new Set(pdfInkQuestionNumbers)
  const states = questionNumbers.map((questionNumber) => questionState(mode, draftAnswers[questionNumber] || {}, pdfInkQuestions.has(questionNumber)))
  const completedCount = states.filter((state) => state === 'complete').length
  const renderedQuestionNumbers = [currentQuestion]
  const questionIndexStart = Math.max(1, Math.min(Math.max(1, totalQuestions - QUESTION_INDEX_WINDOW + 1), currentQuestion - Math.floor(QUESTION_INDEX_WINDOW / 2)))
  const visibleQuestionNumbers = questionNumbers.slice(questionIndexStart - 1, questionIndexStart - 1 + QUESTION_INDEX_WINDOW)
  const answersLocked = disabled || submitted
  const paperLabel = profile.paperNumber ? `Paper ${profile.paperNumber}` : profile.title || 'Paper'
  const modeLabel = mode === 'mcq' ? `${paperLabel} multiple choice` : mode === 'practical' ? 'Practical paper' : 'Structured paper'
  const responseGuidance = mode === 'mcq'
    ? 'Select one option for each question. Submitted answers are checked against the reviewed official key.'
    : paperStudyMode === 'exam-simulation'
      ? 'Keep the official order and timer, then review the paired mark scheme after submission.'
      : 'Write on paper, upload a clear photo, or type your response. Reviewed written evidence can be sent for formative AI review.'
  const [saveNotice, setSaveNotice] = useState('')
  const reviewedResponseSet = new Set(reviewedResponseQuestionNumbers)
  const submittedResponseQuestionNumbers = questionNumbers.filter((questionNumber, index) => states[index] === 'complete')
  const allSubmittedResponsesReviewed = submittedResponseQuestionNumbers.length > 0 && reviewedResponseQuestionNumbers.length === submittedResponseQuestionNumbers.length

  function saveSelfMark() {
    onReviewSubmit?.()
    setSaveNotice('Self-mark saved to your results history.')
  }

  function updateAnswer(questionNumber, patch) {
    const current = draftAnswers[questionNumber] || {}
    onAnswerChange?.(questionNumber, { ...current, ...patch })
  }

  return (
    <form
      className={`paper-answer-sheet paper-answer-sheet--${mode}`}
      aria-labelledby={`${instanceId}-title`}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit?.()
      }}
    >
      <header className="paper-answer-sheet__header">
        <div>
          <span>{profile.code || modeLabel}</span>
          <h2 id={`${instanceId}-title`}>{profile.title || 'Paper answer sheet'}</h2>
          <p>{modeLabel} · {studyModeLabel}: {responseGuidance}</p>
        </div>
        <output aria-live="polite" aria-label="Answer completion">
          {completedCount} of {totalQuestions} complete
        </output>
      </header>

      {mode !== 'mcq' && submitted && reviewedResponseQuestionNumbers.length > 0 && (
        <section className="paper-answer-sheet__ai-marking-status" aria-live="polite">
          <strong>AI-assisted marking is formative, source-grounded, and not an official grade.</strong>
          <span>{sharedMarkingContract ? (sharedIdentityConnected ? (allSubmittedResponsesReviewed ? 'Marking starts automatically after submission for every reviewed photo, typed or Pencil response.' : 'Marking starts automatically for reviewed responses; unreviewed questions stay saved for self-marking.') : 'Sign in to STEM with the same account to mark submitted reviewed responses. Your saved handwriting stays here.') : 'This paper has no server-approved reviewed marking manifest. Use the paired mark scheme to self-mark every response.'}</span>
          {sharedMarkingContract && (sharedIdentityConnected ? <button type="button" className="paper-answer-sheet__ai-marking-action" onClick={() => onRequestAiMarking?.()} disabled={!onRequestAiMarking || aiMarkingInProgress}><Sparkles size={15} />{aiMarkingInProgress ? 'AI marking in progress' : 'Retry AI marking'}</button> : <button type="button" className="paper-answer-sheet__ai-marking-action" onClick={() => onOpenAccount?.('login')}><Sparkles size={15} />Sign in to mark with AI</button>)}
        </section>
      )}

      <nav className="paper-answer-sheet__index" aria-label="Question completion">
        <button type="button" className="paper-answer-sheet__index-step" aria-label="Previous answer question" disabled={currentQuestion <= 1} onClick={() => onQuestionFocus?.(currentQuestion - 1)}><ChevronLeft size={15} /></button>
        <ol>
          {visibleQuestionNumbers.map((questionNumber) => {
            const index = questionNumber - 1
            return (
            <li key={questionNumber} data-state={states[index]}>
              <a href={`#${instanceId}-question-${questionNumber}`} aria-current={questionNumber === currentQuestion ? 'step' : undefined} aria-label={`Question ${questionNumber}, ${stateLabel(states[index])}`} onClick={(event) => { event.preventDefault(); onQuestionFocus?.(questionNumber) }}>
                <span aria-hidden="true">{questionNumber}</span>
                <span className="sr-only">{stateLabel(states[index])}</span>
              </a>
            </li>
            )
          })}
        </ol>
        <button type="button" className="paper-answer-sheet__index-step" aria-label="Next answer question" disabled={currentQuestion >= totalQuestions} onClick={() => onQuestionFocus?.(currentQuestion + 1)}><ChevronRight size={15} /></button>
        <span className="paper-answer-sheet__index-range">{questionIndexStart}-{Math.min(totalQuestions, questionIndexStart + QUESTION_INDEX_WINDOW - 1)} of {totalQuestions}</span>
      </nav>

      <div className="paper-answer-sheet__questions">
        {renderedQuestionNumbers.map((questionNumber) => {
          const index = questionNumber - 1
          const answer = draftAnswers[questionNumber] || {}
          const sectionId = `${instanceId}-question-${questionNumber}`
          const aiReviewEligible = reviewedResponseSet.has(questionNumber) && questionMetadataByNumber[questionNumber]?.reviewStatus === 'reviewed' && Boolean(sharedMarkingContract)

          return (
            <section id={sectionId} className="paper-answer-sheet__question" data-state={states[index]} key={questionNumber}>
              <header>
                <h3>Question {questionNumber}</h3>
                <div>{onAskCoach && <button type="button" className="ask-coach-button" onClick={() => onAskCoach(questionNumber)}><Sparkles size={14} />Ask Coach</button>}<span role="status">{stateLabel(states[index])}</span></div>
              </header>

              {mode === 'mcq' ? (
                <fieldset disabled={answersLocked}>
                  <legend>Choose one answer for question {questionNumber}</legend>
                  <div className="paper-answer-sheet__choices">
                    {CHOICES.map((choice) => (
                      <label key={choice}>
                        <input
                          type="radio"
                          name={`${instanceId}-question-${questionNumber}`}
                          value={choice}
                          checked={answer.choice === choice}
                          aria-label={`Question ${questionNumber}, answer ${choice}`}
                          onChange={() => updateAnswer(questionNumber, { choice })}
                        />
                        <span>{choice}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : pdfInkActive && !submitted ? (
                <div className="paper-answer-sheet__pdf-note"><strong>Write on the original PDF</strong><span>{aiReviewEligible ? 'Select the pen on the paper pane and write your working beside this question. Your PDF page and handwriting are available for AI-assisted review after submission.' : 'Select the pen on the paper pane and write your working beside this question. Your handwriting is saved with this attempt; after submission, use the paired mark scheme to self-mark.'}</span><button type="button" onClick={() => onLinkPdfInkQuestion?.(questionNumber)}>Link current PDF writing</button></div>
              ) : submitted && pdfInkQuestions.has(questionNumber) && !hasText(legacyResponse(answer)) && !answer.image ? (
                <div className="paper-answer-sheet__pdf-note paper-answer-sheet__pdf-note--saved"><strong>Handwriting saved on the original PDF</strong><span>Your Pencil response remains visible on the question-paper pane and is bound to this submitted attempt.</span></div>
              ) : (
                <div className="paper-answer-sheet__response">
                  <HandwritingPad
                    answerId={`paper-${questionNumber}`}
                    aiReviewEligible={aiReviewEligible}
                    disabled={answersLocked}
                    image={answer.image}
                    label={mode === 'practical' ? `Question ${questionNumber} observations, working and conclusion` : `Question ${questionNumber} working and answer`}
                    text={legacyResponse(answer)}
                    onTextChange={(response) => updateAnswer(questionNumber, { response })}
                    onImageChange={(file) => onImageChange?.(questionNumber, file)}
                  />
                </div>
              )}

              {submitted && <AiMarkResult result={aiMarks[questionNumber]} questionNumber={questionNumber} onRetryMarking={onRetryMarking} />}

              {submitted && (
                <SelfMarkInput
                  mode={mode}
                  questionNumber={questionNumber}
                  maxMarksByQuestion={maxMarksByQuestion}
                  officialMaxMarks={questionMetadataByNumber[questionNumber]?.maxMarks}
                  selfMarks={selfMarks}
                  onMaxMarkChange={onMaxMarkChange}
                  onSelfMarkChange={onSelfMarkChange}
                />
              )}
            </section>
          )
        })}
      </div>

      <footer className="paper-answer-sheet__footer">
        {!submitted ? (
          <button type="submit" disabled={disabled || totalQuestions === 0}>
            Submit answer sheet
          </button>
        ) : (
          <><span role="status">{saveNotice || 'Self-mark progress is saved in this attempt.'}</span><button type="button" onClick={saveSelfMark}>Save self-mark</button></>
        )}
      </footer>
    </form>
  )
}
