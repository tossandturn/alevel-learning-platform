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

function AiMarkResult({ result }) {
  if (!result) return null
  if (result.status === 'loading') return <div className="vision-mark vision-mark--loading"><Sparkles size={16} /><span>AI is reading the handwriting and matching mark points...</span></div>
  if (result.status === 'unconfigured') return <div className="vision-mark vision-mark--inactive"><span>AI handwriting marking is not configured on this server. Your response remains saved for self-marking.</span></div>
  if (result.status === 'error') return <div className="vision-mark vision-mark--error"><span>{result.error || 'AI review could not be completed. Your response remains saved.'}</span></div>
  if (result.status === 'review-only') return <div className="vision-mark vision-mark--inactive"><span>AI image reading is available, but marks are unavailable because this PDF question has no reviewed question-level mark allocation. Enter the marks manually against the paired mark scheme.</span></div>
  if (result.status !== 'success') return null
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

function SelfMarkInput({ mode, questionNumber, maxMarksByQuestion, selfMarks, onMaxMarkChange, onSelfMarkChange }) {
  const maxMarks = maxMarksFor(questionNumber, mode, maxMarksByQuestion)
  const value = selfMarks?.[questionNumber] ?? ''

  return (
    <div className="paper-answer-sheet__self-mark">
      <span>Self-mark for question {questionNumber}</span>
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
          disabled={mode === 'mcq'}
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
  disabled = false,
  onAnswerChange,
  onQuestionFocus,
  onAskCoach,
  onImageChange,
  onMaxMarkChange,
  onReviewSubmit,
  onSelfMarkChange,
  onSubmit,
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
                <div className="paper-answer-sheet__pdf-note"><strong>Write on the original PDF</strong><span>Select the pen on the paper pane and write your working beside this question. Your PDF page and handwriting will be combined for AI review after submission.</span></div>
              ) : (
                <div className="paper-answer-sheet__response">
                  <HandwritingPad
                    answerId={`paper-${questionNumber}`}
                    disabled={answersLocked}
                    image={answer.image}
                    label={mode === 'practical' ? `Question ${questionNumber} observations, working and conclusion` : `Question ${questionNumber} working and answer`}
                    text={legacyResponse(answer)}
                    onTextChange={(response) => updateAnswer(questionNumber, { response })}
                    onImageChange={(file) => onImageChange?.(questionNumber, file)}
                  />
                  {submitted && <AiMarkResult result={aiMarks[questionNumber]} />}
                </div>
              )}

              {submitted && (
                <SelfMarkInput
                  mode={mode}
                  questionNumber={questionNumber}
                  maxMarksByQuestion={maxMarksByQuestion}
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
