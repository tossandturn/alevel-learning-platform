import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FileCheck2, FileText, Search, SlidersHorizontal } from 'lucide-react'
import { examStructures, getRouteGuidance, getRouteOptions, getStageGuidance, getStageOptions } from '../data/examStructure'

const PAGE_SIZE = 20
const EMPTY_ITEMS = []
const SUBJECT_NAMES = {
  '0580': 'IGCSE Mathematics',
  '0606': 'IGCSE Additional Mathematics',
  '0610': 'IGCSE Biology',
  '0625': 'IGCSE Physics',
  '9231': 'A-Level Further Mathematics',
  '9700': 'A-Level Biology',
  '9701': 'A-Level Chemistry',
  '9702': 'A-Level Physics',
  '9708': 'A-Level Economics',
  '9709': 'A-Level Mathematics',
  bpho: 'British Physics Olympiad',
  amc12: 'AMC 12',
  esat: 'ESAT',
  tmua: 'TMUA',
}
const KIND_NAMES = {
  qp: 'Question paper',
  ms: 'Mark scheme',
  ak: 'Answer key',
  er: 'Examiner report',
  gt: 'Grade thresholds',
  ci: 'Confidential instructions',
  ir: 'Insert',
  guide: 'Guide',
  other: 'Other file',
}

function bytesLabel(bytes) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.ceil(bytes / 1000)} KB`
}

export function PaperLibrary({ catalogState, initialSubject = 'all', onOpenPaper }) {
  const [filters, setFilters] = useState({ subject: initialSubject, stage: 'all', route: 'all', paperNumber: 'all', year: 'all', season: 'all', kind: 'qp', query: '' })
  const [page, setPage] = useState(1)
  const items = catalogState.catalog?.items || EMPTY_ITEMS

  useEffect(() => {
    const subject = initialSubject || 'all'
    setFilters((current) => current.subject === subject ? current : { ...current, subject, stage: 'all', route: 'all', paperNumber: 'all' })
    setPage(1)
  }, [initialSubject])

  const years = useMemo(() => [...new Set(items.map((item) => item.year).filter(Boolean))].sort((a, b) => b - a), [items])
  const seasons = useMemo(() => [...new Set(items.map((item) => item.season).filter(Boolean))].sort(), [items])
  const stageOptions = getStageOptions(filters.subject)
  const routeOptions = getRouteOptions(filters.subject, filters.stage)
  const paperOptions = useMemo(() => {
    const profiles = items
      .filter((item) => (filters.subject === 'all' || item.subject === filters.subject) && item.examProfile?.paperNumber)
      .sort((a, b) => b.year - a.year)
    const byNumber = new Map()
    profiles.forEach((item) => {
      if (!byNumber.has(item.examProfile.paperNumber)) byNumber.set(item.examProfile.paperNumber, item.examProfile.title)
    })
    return [...byNumber.entries()].sort(([a], [b]) => a - b).map(([paperNumber, title]) => ({ paperNumber, title }))
  }, [filters.subject, items])
  const filtered = useMemo(() => {
    const query = filters.query.trim().toLowerCase()
    return items.filter((item) => {
      const isSeriesDocument = !item.variant && ['er', 'gt'].includes(item.kind)
      return (
        (filters.subject === 'all' || item.subject === filters.subject) &&
        (filters.stage === 'all' || item.examProfile?.stages.includes(filters.stage) || isSeriesDocument) &&
        (filters.route === 'all' || item.examProfile?.routeIds?.includes(filters.route) || isSeriesDocument) &&
        (filters.paperNumber === 'all' || item.examProfile?.paperNumbers?.includes(Number(filters.paperNumber))) &&
        (filters.year === 'all' || String(item.year) === filters.year) &&
        (filters.season === 'all' || item.season === filters.season) &&
        (filters.kind === 'all' || item.kind === filters.kind) &&
        (!query || `${item.file} ${item.subject} ${item.year} ${item.season} ${item.variant}`.toLowerCase().includes(query))
      )
    })
  }, [filters, items])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function updateFilter(key, value) {
    setFilters((current) => {
      if (key === 'subject') return { ...current, subject: value, stage: 'all', route: 'all', paperNumber: 'all' }
      if (key === 'stage') {
        const routes = getRouteOptions(current.subject, value)
        return { ...current, stage: value, route: routes[0]?.id || 'all' }
      }
      return { ...current, [key]: value }
    })
    setPage(1)
  }

  if (catalogState.status === 'loading') {
    return <div className="paper-state"><span className="loading-line" />Loading the verified local catalog...</div>
  }
  if (catalogState.status === 'error') {
    return <div className="paper-state error"><FileText size={24} />Catalog unavailable: {catalogState.error}</div>
  }

  return (
    <div className="paper-library">
      <div className="paper-summary">
        <div><strong>{catalogState.catalog.totals.files.toLocaleString()}</strong><span>verified PDFs</span></div>
        <div><strong>{(catalogState.catalog.totals.bytes / 1_000_000_000).toFixed(2)} GB</strong><span>local library</span></div>
        <p>{catalogState.catalog.totals.pairedQuestionPapers.toLocaleString()} question papers have an exact mark scheme. {catalogState.catalog.totals.unpairedQuestionPapers} source files do not.</p>
      </div>

      <div className="paper-filters" aria-label="Past paper filters">
        <label className="search-box paper-search"><Search size={17} /><input value={filters.query} onChange={(event) => updateFilter('query', event.target.value)} placeholder="Search filename or paper code" /></label>
        <label><SlidersHorizontal size={17} /><select value={filters.subject} onChange={(event) => updateFilter('subject', event.target.value)}><option value="all">All subjects</option>{Object.entries(SUBJECT_NAMES).map(([code, name]) => <option value={code} key={code}>{code} {name}</option>)}</select></label>
        <label><span>Stage</span><select value={filters.stage} disabled={!stageOptions.length} onChange={(event) => updateFilter('stage', event.target.value)}><option value="all">All stages</option>{stageOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        <label><span>Route</span><select value={filters.route} disabled={!routeOptions.length} onChange={(event) => updateFilter('route', event.target.value)}><option value="all">All routes</option>{routeOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
        <label><span>Paper</span><select value={filters.paperNumber} disabled={!paperOptions.length} onChange={(event) => updateFilter('paperNumber', event.target.value)}><option value="all">All papers</option>{paperOptions.map((option) => <option value={String(option.paperNumber)} key={option.paperNumber}>P{option.paperNumber} {option.title}</option>)}</select></label>
        <label><span>Year</span><select value={filters.year} onChange={(event) => updateFilter('year', event.target.value)}><option value="all">All years</option>{years.map((year) => <option key={year}>{year}</option>)}</select></label>
        <label><span>Session</span><select value={filters.season} onChange={(event) => updateFilter('season', event.target.value)}><option value="all">All sessions</option>{seasons.map((season) => <option key={season}>{season}</option>)}</select></label>
        <label><span>Type</span><select value={filters.kind} onChange={(event) => updateFilter('kind', event.target.value)}><option value="all">All files</option><option value="qp">Question papers</option><option value="ms">Mark schemes</option><option value="ak">Answer keys</option><option value="er">Examiner reports</option><option value="gt">Grade thresholds</option><option value="ci">Confidential instructions</option><option value="ir">Inserts</option><option value="guide">Guides</option><option value="other">Other files</option></select></label>
      </div>

      {filters.stage !== 'all' && getStageGuidance(filters.subject, filters.stage) && <div className="paper-route-note"><strong>{routeOptions.find((option) => option.id === filters.route)?.label || stageOptions.find((option) => option.value === filters.stage)?.label}</strong><span>{getRouteGuidance(filters.subject, filters.route) || getStageGuidance(filters.subject, filters.stage)}</span><a href={examStructures[filters.subject]?.syllabusUrl || examStructures[filters.subject]?.sourceUrl} target="_blank" rel="noreferrer">Official syllabus</a></div>}

      <div className="paper-result-bar"><span>{filtered.length.toLocaleString()} files</span><small>Page {safePage} of {pageCount}</small></div>
      {visible.length ? (
        <div className="paper-table-wrap">
          <table className="paper-table">
            <thead><tr><th>Paper</th><th>Subject</th><th>Session</th><th>Type</th><th>Answer</th><th>Size</th><th><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{visible.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.file}</strong><small>{item.examProfile ? `${item.examProfile.paperNumber ? `P${item.examProfile.paperNumber} ` : ''}${item.examProfile.title}` : `Variant ${item.variant || 'general'}`} · {item.sha256.slice(0, 10)}</small></td>
                <td><span className="subject-code">{item.subject}</span><small>{SUBJECT_NAMES[item.subject]}</small></td>
                <td>{item.season} {item.year}</td>
                <td><span className={`document-kind ${item.kind}`}>{KIND_NAMES[item.kind] || item.kind.toUpperCase()}</span></td>
                <td>{item.kind === 'qp' ? <span className={`answer-availability ${item.markSchemeId ? 'available' : 'missing'}`}>{item.markSchemeId ? 'Answer file' : 'Not in source'}</span> : <span className="answer-availability neutral">-</span>}</td>
                <td>{bytesLabel(item.bytes)}</td>
                <td><button type="button" className="table-action" onClick={() => onOpenPaper(item)}>{item.kind === 'ms' ? <FileCheck2 size={16} /> : <FileText size={16} />}Open</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <div className="paper-state"><Search size={24} />No files match these filters.</div>}

      <div className="pagination">
        <button type="button" disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Previous page"><ChevronLeft size={18} /></button>
        <span>{safePage} / {pageCount}</span>
        <button type="button" disabled={safePage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} aria-label="Next page"><ChevronRight size={18} /></button>
      </div>
    </div>
  )
}
