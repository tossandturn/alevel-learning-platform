import { AlertTriangle, CheckCircle2, Download, FileText, History, LoaderCircle, RotateCcw } from 'lucide-react'
import { attemptResponseProjection, hasCurrentSourceBindingForAttempt, isPendingSelfMarkAttempt, isProvisionalAttempt, isScoredAttempt, isStudyOnlyAttempt } from '../lib/attemptAudit'
import { paperStudyModeLabel } from '../lib/paperStudyMode'
import { practiceUnitMetrics } from '../lib/practicePresentation'

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
        if (unit && isStudyOnlyAttempt(attempt, unit)) return [{ type: 'practice-study', date: attempt.submittedAt, value: attempt }]
        if (unit && isScoredAttempt(attempt, unit)) return [{ type: 'practice', date: attempt.submittedAt, value: attempt }]
        // A superseded score remains visible as private audit evidence but
        // never re-enters progress, mistakes, retests or AI marking.
        if (isScoredAttempt(attempt)) return [{ type: 'practice-stale', date: attempt.submittedAt, value: attempt }]
        return []
      }),
    ...paperSessions.map((session) => ({ type: 'paper', date: session.completedAt, value: session })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date))
  const formalAttempts = attempts.filter((attempt) => {
    const unit = unitById.get(attempt.unitId)
    return Boolean(unit && isScoredAttempt(attempt, unit) && !isProvisionalAttempt(attempt, unit) && !isStudyOnlyAttempt(attempt, unit))
  })
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000
  const weeklyAttempts = formalAttempts.filter((attempt) => Date.parse(attempt.submittedAt) >= weekStart)
  const weeklyOfficialQuestions = weeklyAttempts.reduce((sum, attempt) => sum + practiceUnitMetrics(unitById.get(attempt.unitId)).sourceQuestionCount, 0)
  const weeklyMarks = weeklyAttempts.reduce((totals, attempt) => ({
    raw: totals.raw + Number(attempt.scoreResult?.rawMarks || 0),
    max: totals.max + Number(attempt.scoreResult?.maxMarks || 0),
  }), { raw: 0, max: 0 })
  const weeklyAccuracy = weeklyMarks.max ? Math.round(weeklyMarks.raw / weeklyMarks.max * 100) : null
  const weeklyMinutes = Math.round(weeklyAttempts.reduce((sum, attempt) => sum + Number(attempt.elapsedSec || 0), 0) / 60)
  const topicProgress = [...formalAttempts.reduce((topics, attempt) => {
    const unit = unitById.get(attempt.unitId)
    const key = unit?.knowledgeGroupId || unit?.topic || unit?.id
    if (!key) return topics
    const current = topics.get(key)
    const score = Number(attempt.scoreResult?.percentage)
    const topic = String(unit.topic || unit.title || 'Practice topic')
    const label = /-topic-\d+/i.test(topic) ? String(unit.title || 'Practice topic') : topic.replace(/^\d+(?:\.\d+)?\s+/, '')
    if (!current || score > current.score) topics.set(key, { key, label, score })
    return topics
  }, new Map()).values()].toSorted((left, right) => right.score - left.score)
  const trendAttempts = formalAttempts.slice(-6)

  return (
    <section className="history-view page-band">
      <div className="library-header">
        <div><p className="section-label">Progress</p><h1>Your learning progress</h1><p className="page-intro">See this week, syllabus mastery and every saved attempt in one place.</p></div>
        <div className="history-export" aria-live="polite">
          <button type="button" className="secondary-action" onClick={onExport} disabled={exportState.status === 'preparing'}>
            {exportState.status === 'preparing' ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
            {exportState.status === 'preparing' ? 'Preparing export' : exportState.status === 'failed' ? 'Retry export' : exportState.status === 'ready' ? 'Download again' : 'Export my data'}
          </button>
          {exportState.status === 'preparing' && <small role="status">Preparing your private learning record...</small>}
          {exportState.status === 'ready' && <small role="status" className="history-export__ready"><CheckCircle2 size={14} />Downloaded {exportState.filename || 'stem-learning-data.json'}</small>}
          {exportState.status === 'failed' && <small role="alert" className="history-export__failed"><AlertTriangle size={14} />{exportState.error || 'Your export could not be prepared. Try again.'}</small>}
        </div>
      </div>
      <div className="progress-summary" aria-label="This week">
        <div><span>Official questions</span><strong>{weeklyOfficialQuestions}</strong><small>Completed in the last 7 days</small></div>
        <div><span>Accuracy</span><strong>{weeklyAccuracy == null ? '--' : `${weeklyAccuracy}%`}</strong><small>From completed scored attempts</small></div>
        <div><span>Study time</span><strong>{weeklyMinutes} min</strong><small>Active attempt time</small></div>
        <div><span>Completed sets</span><strong>{weeklyAttempts.length}</strong><small>Provisional attempts excluded</small></div>
      </div>
      <div className="progress-overview">
        <section className="progress-topic-mastery"><header><div><p className="section-label">Syllabus mastery</p><h2>Strongest completed topics</h2></div></header>{topicProgress.length ? <div>{topicProgress.slice(0, 6).map((topic) => <div key={topic.key}><span><strong>{topic.label}</strong><small>{topic.score >= 80 ? 'Secure' : topic.score >= 50 ? 'In progress' : 'Needs review'}</small></span><b>{topic.score}%</b><i><em style={{ width: `${topic.score}%` }} /></i></div>)}</div> : <p>Complete a reviewed practice set to start syllabus mastery.</p>}</section>
        <section className="progress-trend"><header><div><p className="section-label">Recent trend</p><h2>Last completed sets</h2></div></header>{trendAttempts.length ? <div>{trendAttempts.map((attempt) => <span key={attempt.id} title={`${attempt.scoreResult.percentage}%`}><i style={{ height: `${Math.max(8, attempt.scoreResult.percentage)}%` }} /><small>{attempt.scoreResult.percentage}%</small></span>)}</div> : <p>Your recent scores will appear here.</p>}</section>
      </div>
      <div className="history-section-heading"><p className="section-label">Attempt history</p><h2>Every submission stays separate</h2></div>
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
        if (record.type === 'practice-study') {
          return <article className="history-row history-row--pending" key={attempt.id}><span className="history-icon"><History size={19} /></span><div><strong>{unit?.title || attempt.contentScope?.title || 'Official-question study practice'}</strong><small>This self-marked record is saved privately. It will not update mastery, weekly progress, mistakes or AI marking until its marking evidence is ready.</small></div><span>{attempt.scoreResult?.rawMarks}/{attempt.scoreResult?.maxMarks}</span><time>{formatDate(attempt.submittedAt)}</time>{!retired && <button type="button" className="secondary-action compact-action" onClick={() => onRetest(unit, { clearDraft: true, retestOf: attempt.id })}>Practise again</button>}</article>
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
