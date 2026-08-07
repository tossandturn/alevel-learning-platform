import { Download, FileText, History, RotateCcw } from 'lucide-react'

function formatDate(value) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function HistoryView({ attempts, paperSessions, paperReviews = [], onRetest, units, onExport }) {
  const records = [
    ...attempts.map((attempt) => ({ type: 'practice', date: attempt.submittedAt, value: attempt })),
    ...paperSessions.map((session) => ({ type: 'paper', date: session.completedAt, value: session })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date))

  return (
    <section className="history-view page-band">
      <div className="library-header">
        <div><p className="section-label">Learning record</p><h1>History stays append-only</h1><p className="page-intro">Practice results, paper sessions and retests remain separate so progress is explainable.</p></div>
        <button type="button" className="secondary-action" onClick={onExport}><Download size={17} />Export my data</button>
      </div>
      {records.length ? <div className="history-list">{records.map((record) => {
        if (record.type === 'paper') {
          const session = record.value
          const review = paperReviews.filter((item) => item.attemptId === session.attemptId).at(-1)
          const result = review ? `${review.rawMarks}/${review.maxMarks || '?'}` : `${session.answeredCount || 0}/${session.questionCount || '?'} answered`
          return <article className="history-row" key={session.id}><span className="history-icon"><FileText size={19} /></span><div><strong>{session.file}</strong><small>{session.retestOf ? 'Linked PDF retest' : review ? 'Student self-mark · not an official result' : 'Submitted PDF answer sheet'} · {session.subject}</small></div><span>{result}</span><time>{formatDate(session.completedAt)}</time></article>
        }
        const attempt = record.value
        const unit = units.find((item) => item.id === attempt.unitId)
        return <article className="history-row" key={attempt.id}><span className="history-icon"><History size={19} /></span><div><strong>{unit?.title || attempt.contentScope?.title}</strong><small>{attempt.retestOf ? 'Linked retest' : 'Practice attempt'} · {attempt.scoreResult.gradeEstimate}</small></div><span>{attempt.scoreResult.rawMarks}/{attempt.scoreResult.maxMarks}</span><time>{formatDate(attempt.submittedAt)}</time><button type="button" className="icon-button" onClick={() => unit && onRetest(unit, { clearDraft: true, retestOf: attempt.id })} aria-label={`Retest ${unit?.title || 'practice'}`}><RotateCcw size={17} /></button></article>
      })}</div> : <div className="empty-state"><History size={28} /><h2>No history yet</h2><p>Finish a topic or PDF session to create your first record.</p></div>}
    </section>
  )
}
