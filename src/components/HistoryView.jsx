import { AlertTriangle, CheckCircle2, Download, FileText, History, LoaderCircle, RotateCcw } from 'lucide-react'
import { attemptResponseProjection, hasCurrentSourceBindingForAttempt, isPendingSelfMarkAttempt, isProvisionalAttempt, isScoredAttempt } from '../lib/attemptAudit'
import { paperStudyModeLabel } from '../lib/paperStudyMode'

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

export function HistoryView({ attempts, paperSessions, paperReviews = [], onRetest, onContinuePending, units, onExport, exportState = { status: 'idle' } }) {
  const unitById = new Map(units.map((unit) => [unit.id, unit]))
  const records = [
    ...attempts
      .flatMap((attempt) => {
        const unit = unitById.get(attempt.unitId)
        if (isPendingSelfMarkAttempt(attempt)) return [{ type: hasCurrentSourceBindingForAttempt(attempt, unit) ? 'practice-pending' : 'practice-stale', date: attempt.submittedAt, value: attempt }]
        if (unit && isProvisionalAttempt(attempt, unit)) return [{ type: 'practice-provisional', date: attempt.submittedAt, value: attempt }]
        if (unit && isScoredAttempt(attempt, unit)) return [{ type: 'practice', date: attempt.submittedAt, value: attempt }]
        // A superseded score remains visible as private audit evidence but
        // never re-enters progress, mistakes, retests or AI marking.
        if (isScoredAttempt(attempt)) return [{ type: 'practice-stale', date: attempt.submittedAt, value: attempt }]
        return []
      }),
    ...paperSessions.map((session) => ({ type: 'paper', date: session.completedAt, value: session })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date))

  return (
    <section className="history-view page-band">
      <div className="library-header">
        <div><p className="section-label">Learning record</p><h1>History keeps every attempt</h1><p className="page-intro">Practice results, paper sessions and retests remain separate so progress is explainable.</p></div>
        <div className="history-export" aria-live="polite">
          <button type="button" className="secondary-action" onClick={onExport} disabled={exportState.status === 'preparing'}>
            {exportState.status === 'preparing' ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
            {exportState.status === 'preparing' ? 'Preparing export' : exportState.status === 'failed' ? 'Retry export' : exportState.status === 'ready' ? 'Export again' : 'Export my data'}
          </button>
          {exportState.status === 'preparing' && <small role="status">Preparing your private learning record...</small>}
          {exportState.status === 'ready' && <small role="status" className="history-export__ready"><CheckCircle2 size={14} />Ready · {formatDate(exportState.exportedAt)} · SHA-256 {exportState.checksum.slice(0, 12)}...</small>}
          {exportState.status === 'failed' && <small role="alert" className="history-export__failed"><AlertTriangle size={14} />{exportState.error || 'Your export could not be prepared. Try again.'}</small>}
        </div>
      </div>
      {records.length ? <div className="history-list">{records.map((record) => {
        if (record.type === 'paper') {
          const session = record.value
          const review = paperReviews.filter((item) => item.attemptId === session.attemptId).at(-1)
          const result = review ? `${review.rawMarks}/${review.maxMarks || '?'}` : `${session.answeredCount || 0}/${session.questionCount || '?'} answered`
          return <article className="history-row" key={session.id}><span className="history-icon"><FileText size={19} /></span><div><strong>{session.file}</strong><small>{paperStudyModeLabel(session.paperStudyMode)} · {session.retestOf ? 'Linked PDF retest' : review ? 'Student self-mark · not an official result' : 'Submitted PDF answer sheet'} · {session.subject}</small></div><span>{result}</span><time>{formatDate(session.completedAt)}</time></article>
        }
        const attempt = record.value
        const unit = unitById.get(attempt.unitId)
        const retired = !unit
        if (record.type === 'practice-provisional') {
          const projection = attemptResponseProjection(attempt, unit)
          return <article className="history-row history-row--pending" key={attempt.id}><span className="history-icon"><History size={19} /></span><div><strong>{unit?.title || attempt.contentScope?.title || 'Submitted practice'}</strong><small>Provisional evidence only · {projection.answeredQuestionCount}/{unit?.parts?.length || 0} answered · {projection.incorrectQuestionCount} incorrect · {projection.unansweredQuestionCount} unanswered. This does not update mastery, weaknesses, weekly progress or the formal mistake queue.</small></div><span>{attempt.scoreResult?.rawMarks}/{attempt.scoreResult?.maxMarks}</span><time>{formatDate(attempt.submittedAt)}</time><button type="button" className="secondary-action compact-action" onClick={() => onContinuePending?.(attempt)}>Review attempt</button></article>
        }
        if (record.type === 'practice-stale') {
          const historicalScore = attempt.scoreResult
            ? `${attempt.scoreResult.rawMarks}/${attempt.scoreResult.maxMarks}`
            : 'Not scored'
          return <article className="history-row history-row--pending" key={attempt.id}><span className="history-icon"><AlertTriangle size={19} /></span><div><strong>{unit?.title || attempt.contentScope?.title || 'Saved practice'}</strong><small>Source review changed or is unavailable. Answers stay as read-only audit evidence and cannot affect progress, retests or marking.</small></div><span>Historical {historicalScore}</span><time>{formatDate(attempt.submittedAt)}</time></article>
        }
        if (record.type === 'practice-pending') {
          const resolved = attempt.markingLifecycle?.provisionalCriteria?.length || 0
          const pending = attempt.markingLifecycle?.pendingPartIds?.length || unit?.parts?.length || 0
          return <article className="history-row history-row--pending" key={attempt.id}><span className="history-icon"><History size={19} /></span><div><strong>{unit?.title || attempt.contentScope?.title || 'Submitted practice'}</strong><small>{retired ? 'Source record retired from current practice; saved work remains read-only.' : resolved ? `${resolved} parts checked · ${pending} marks still need review` : 'Self-mark pending'} · preserved in your learning record</small></div><span>Not scored</span><time>{formatDate(attempt.submittedAt)}</time>{!retired && <button type="button" className="secondary-action compact-action" onClick={() => onContinuePending?.(attempt)}>Continue marking</button>}</article>
        }
        return <article className="history-row" key={attempt.id}><span className="history-icon"><History size={19} /></span><div><strong>{unit?.title || attempt.contentScope?.title}</strong><small>{retired ? 'Source record retired from current practice; score retained only as historical evidence.' : `${attempt.retestOf ? 'Linked retest' : 'Practice attempt'} · ${attempt.scoreResult.gradeEstimate}`}</small></div><span>{attempt.scoreResult.rawMarks}/{attempt.scoreResult.maxMarks}</span><time>{formatDate(attempt.submittedAt)}</time>{!retired && <button type="button" className="icon-button" onClick={() => onRetest(unit, { clearDraft: true, retestOf: attempt.id })} aria-label={`Retest ${unit.title}`}><RotateCcw size={17} /></button>}</article>
      })}</div> : <div className="empty-state"><History size={28} /><h2>No history yet</h2><p>Finish a topic or PDF session to create your first record.</p></div>}
    </section>
  )
}
