import { useId } from 'react'
import { Sparkles } from 'lucide-react'
import { HandwritingPad } from './HandwritingPad'

const CHOICES = ['A', 'B', 'C', 'D']
const MODES = new Set(['mcq', 'structured', 'practical'])

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
  const configured = Number(maxMarksByQuestion?.[questionNumber])
  if (Number.isFinite(configured) && configured >= 0) return configured
  return mode === 'mcq' ? 1 : undefined
}

function legacyResponse(answer) {
  if (hasText(answer.response)) return answer.response
  return [answer.working, answer.finalAnswer].filter(hasText).join('\n\n')
}

function AiMarkResult({ result, questionNumber, onRetryMarking }) {
  if (!result) return null
  if (result.status === 'queued') return <div className="vision-mark vision-mark--loading"><Sparkles size={16} /><span>Queued by the shared IELTSist marking service with reviewed question metadata.</span></div>
  if (result.status === 'processing') return <div className="vision-mark vision-mark--loading"><Sparkles size={16} /><span>Shared AI marking is processing this sourced response...</span></div>
  if (result.status === 'failed') return <div className="vision-mark vision-mark--error"><span>{result.loginRequired ? 'Sign in with your IELTSist account to use AI-assisted marking. Your response remains saved.' : 'Shared AI marking failed. Your response remains saved; use the paired mark scheme or retry later.'}</span>{result.retryable && result.submissionId && onRetryMarking && <button type="button" onClick={() => onRetryMarking(questionNumber)}>Retry shared marking</button>}</div>
  if (result.status === 'missing_metadata' || result.status === 'review-only') return <div className="vision-mark vision-mark--inactive"><span>This question has no reviewed question-level mark allocation in the current index. Your response is saved; use the paired mark scheme for self-marking.</span></div>
  if (result.status !== 'completed') return null
  return (
    <div className="vision-mark vision-mark--success">
      <header><span>AI-assisted mark</span><strong>{result.rawMarks}/{result.maxMarks}</strong><small>{Math.round((result.confidence || 0) * 100)}% confidence{result.reviewRequired ? ' · check required' : ''}</small></header>
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

  return (
    <div className="paper-answer-sheet__self-mark">
      <span>Self-mark for question {questionNumber}{officialMaxMarks ? ' · reviewed allocation' : ''}</span>
      <label>
        <small>Awarded</small>
        <input
          type="number"
          min="0"
          max={maxMarks}
          step="1"
          inputMode="numeric"
          value={value}
          aria-label={`Self-mark awarded for question ${questionNumber}`}
          onChange={(event) => {
            const nextValue = event.target.value
            if (nextValue === '') {
              onSelfMarkChange?.(questionNumber, null)
              return
            }
            const numericValue = Number(nextValue)
            const boundedValue = maxMarks == null
              ? Math.max(0, numericValue)
              : Math.min(maxMarks, Math.max(0, numericValue))
            onSelfMarkChange?.(questionNumber, boundedValue)
          }}
        />
      </label>
      <label>
        <small>Available</small>
        <input
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={maxMarks ?? ''}
          disabled={mode === 'mcq' || Boolean(officialMaxMarks)}
          aria-label={`Maximum marks for question ${questionNumber}`}
          onChange={(event) => onMaxMarkChange?.(questionNumber, event.target.value === '' ? null : Math.max(1, Number(event.target.value)))}
        />
      </label>
    </div>
  )
}

/**
 * Controlled answer sheet for one paper profile. The parent owns drafts, images,
 * submission state and self-marks so this component can share the app's storage.
 */
export function PaperAnswerSheet({
  profile,
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
  disabled = false,
  onAnswerChange,
  onQuestionFocus,
  onAskCoach,
  onImageChange,
  onLinkPdfInkQuestion,
  onMaxMarkChange,
  onReviewSubmit,
  onSelfMarkChange,
  onSubmit,
  onRetryMarking,
}) {
  const instanceId = useId()
  const mode = profile?.mode

  if (!MODES.has(mode)) {
    throw new TypeError("PaperAnswerSheet profile.mode must be 'mcq', 'structured' or 'practical'.")
  }

  const totalQuestions = Math.max(0, Math.floor(Number(questionCount) || 0))
  const questionNumbers = Array.from({ length: totalQuestions }, (_, index) => index + 1)
  const currentQuestion = Math.min(totalQuestions || 1, Math.max(1, Number(activeQuestion) || 1))
  const pdfInkQuestions = new Set(pdfInkQuestionNumbers)
  const states = questionNumbers.map((questionNumber) => questionState(mode, draftAnswers[questionNumber] || {}, pdfInkQuestions.has(questionNumber)))
  const completedCount = states.filter((state) => state === 'complete').length
  const renderedQuestionNumbers = mode === 'mcq' || pdfInkActive ? [currentQuestion] : questionNumbers
  const answersLocked = disabled || submitted
  const paperLabel = profile.paperNumber ? `Paper ${profile.paperNumber}` : profile.title || 'Paper'
  const modeLabel = mode === 'mcq' ? `${paperLabel} multiple choice` : mode === 'practical' ? 'Practical paper' : 'Structured paper'

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
          <p>{modeLabel}</p>
        </div>
        <output aria-live="polite" aria-label="Answer completion">
          {completedCount} of {totalQuestions} complete
        </output>
      </header>

      <nav className="paper-answer-sheet__index" aria-label="Question completion">
        <ol>
          {questionNumbers.map((questionNumber, index) => (
            <li key={questionNumber} data-state={states[index]}>
              <a href={`#${instanceId}-question-${questionNumber}`} aria-current={questionNumber === currentQuestion ? 'step' : undefined} aria-label={`Question ${questionNumber}, ${stateLabel(states[index])}`} onClick={(event) => { event.preventDefault(); onQuestionFocus?.(questionNumber) }}>
                <span aria-hidden="true">{questionNumber}</span>
                <span className="sr-only">{stateLabel(states[index])}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="paper-answer-sheet__questions">
        {renderedQuestionNumbers.map((questionNumber) => {
          const index = questionNumber - 1
          const answer = draftAnswers[questionNumber] || {}
          const sectionId = `${instanceId}-question-${questionNumber}`
          const aiReviewEligible = questionMetadataByNumber[questionNumber]?.reviewStatus === 'reviewed'

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
          <><span role="status">Submitted for self-marking</span><button type="button" onClick={onReviewSubmit}>Save self-mark</button></>
        )}
      </footer>
    </form>
  )
}
