import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, FileCheck2, FileText, Search, SlidersHorizontal } from 'lucide-react'
import { examStructures, getRouteGuidance, getRouteOptions, getStageGuidance, getStageOptions } from '../data/examStructure'
import { ARCHIVE_SOURCES, SPECIAL_ARCHIVE_SUBJECTS, archiveSeasonLabel, buildArchiveStats } from '../data/competitionArchive'
import { formatRouteComponents } from '../data/routeRegistry'
import { isPaperAvailableToStudents } from '../lib/paperGovernance'

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

function filterDefaults(subject) {
  return { subject: subject || 'all', stage: 'all', route: 'all', paperNumber: 'all', year: 'all', season: 'all', kind: 'qp', query: '' }
}

export function PaperLibrary({ catalogState, initialSubject = 'all', activeRoute = null, onOpenPaper }) {
  const [filters, setFilters] = useState(() => filterDefaults(initialSubject))
  const [page, setPage] = useState(1)
  const items = (catalogState.catalog?.items || EMPTY_ITEMS).filter(isPaperAvailableToStudents)

  useEffect(() => {
    const subject = initialSubject || 'all'
    setFilters((current) => current.subject === subject ? current : filterDefaults(subject))
    setPage(1)
  }, [initialSubject])

  const subjectItems = useMemo(
    () => filters.subject === 'all' ? items : items.filter((item) => item.subject === filters.subject),
    [filters.subject, items],
  )
  const years = useMemo(
    () => [...new Set(subjectItems.map((item) => item.year).filter((year) => Number(year) > 0))].sort((a, b) => b - a),
    [subjectItems],
  )
  const seasons = useMemo(
    () => [...new Set(subjectItems.map((item) => item.season).filter(Boolean))]
      .sort((left, right) => archiveSeasonLabel(filters.subject, left).localeCompare(archiveSeasonLabel(filters.subject, right))),
    [filters.subject, subjectItems],
  )
  const stageOptions = getStageOptions(filters.subject)
  const routeOptions = getRouteOptions(filters.subject, filters.stage)
  const isRouteScoped = Boolean(activeRoute)
  const isSpecialArchive = SPECIAL_ARCHIVE_SUBJECTS.includes(filters.subject)
  const archiveStats = useMemo(
    () => isSpecialArchive ? buildArchiveStats(items, filters.subject) : null,
    [filters.subject, isSpecialArchive, items],
  )
  const archiveSources = ARCHIVE_SOURCES[filters.subject] || EMPTY_ITEMS
  const paperOptions = useMemo(() => {
    const routeComponents = activeRoute?.paperComponents || []
    const specialistRoute = activeRoute?.stage === 'Competition' || activeRoute?.stage === 'Admissions'
    const profiles = items
      .filter((item) => {
        const component = Number(item.examProfile?.paperNumber)
        return (filters.subject === 'all' || item.subject === filters.subject)
          && item.examProfile?.paperNumber
          && (!activeRoute || (
            item.subject === activeRoute.subjectCode
            && (specialistRoute || !routeComponents.length || routeComponents.includes(component))
          ))
      })
      .sort((left, right) => right.year - left.year)
    const byNumber = new Map()
    profiles.forEach((item) => {
      if (!byNumber.has(item.examProfile.paperNumber)) byNumber.set(item.examProfile.paperNumber, item.examProfile.title)
    })
    return [...byNumber.entries()].sort(([left], [right]) => left - right).map(([paperNumber, title]) => ({ paperNumber, title }))
  }, [activeRoute, filters.subject, items])
  const filtered = useMemo(() => {
    const query = filters.query.trim().toLowerCase()
    return items.filter((item) => {
      const isSeriesDocument = !item.variant && ['er', 'gt'].includes(item.kind)
      const component = item.examProfile?.paperNumber == null ? null : Number(item.examProfile.paperNumber)
      const specialistRoute = activeRoute?.stage === 'Competition' || activeRoute?.stage === 'Admissions'
      const matchesActiveRoute = !activeRoute || (
        item.subject === activeRoute.subjectCode
        && (
          specialistRoute
          || isSeriesDocument
          || component == null
          || !Number.isFinite(component)
          || !activeRoute.paperComponents.length
          || activeRoute.paperComponents.includes(component)
        )
      )
      return (
        matchesActiveRoute
        && (filters.subject === 'all' || item.subject === filters.subject)
        && (filters.stage === 'all' || item.examProfile?.stages.includes(filters.stage) || isSeriesDocument)
        && (filters.route === 'all' || item.examProfile?.routeIds?.includes(filters.route) || isSeriesDocument)
        && (filters.paperNumber === 'all' || item.examProfile?.paperNumbers?.includes(Number(filters.paperNumber)))
        && (filters.year === 'all' || String(item.year) === filters.year)
        && (filters.season === 'all' || item.season === filters.season)
        && (filters.kind === 'all' || item.kind === filters.kind)
        && (!query || `${item.file} ${item.subject} ${item.year} ${item.season} ${item.variant}`.toLowerCase().includes(query))
      )
    })
  }, [activeRoute, filters, items])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function updateFilter(key, value) {
    setFilters((current) => {
      if (key === 'subject') return filterDefaults(value)
      if (key === 'stage') {
        const routes = getRouteOptions(current.subject, value)
        return { ...current, stage: value, route: routes[0]?.id || 'all' }
      }
      return { ...current, [key]: value }
    })
    setPage(1)
  }

  function clearFilters() {
    setFilters(filterDefaults(activeRoute?.subjectCode || initialSubject))
    setPage(1)
  }

  if (catalogState.status === 'loading') {
    return <div className="paper-state"><span className="loading-line" />Loading the verified local catalog...</div>
  }
  if (catalogState.status === 'error') {
    return <div className="paper-state error"><FileText size={24} />Catalog unavailable: {catalogState.error}</div>
  }

  const routeComponents = activeRoute ? formatRouteComponents(activeRoute.paperComponents) : ''
  const routeSummary = activeRoute
    ? [activeRoute.stage, activeRoute.subjectCode, activeRoute.subject, routeComponents].filter(Boolean).join(' / ')
    : `${items.filter((item) => item.kind === 'qp' && item.markSchemeId).length.toLocaleString()} locally approved question papers have an exact answer file.`

  return (
    <div className="paper-library">
      <div className="paper-summary">
        <div>
          <strong>{(archiveStats?.questionPapers ?? catalogState.catalog.totals.files).toLocaleString()}</strong>
          <span>{archiveStats ? 'historical question papers' : 'approved local PDFs'}</span>
        </div>
        <div>
          <strong>{archiveStats?.yearLabel || `${(catalogState.catalog.totals.bytes / 1_000_000_000).toFixed(2)} GB`}</strong>
          <span>{archiveStats ? 'year coverage' : 'local library'}</span>
        </div>
        <p>{archiveStats
          ? `${archiveStats.pairedQuestionPapers.toLocaleString()} question papers include a linked answer or mark scheme across ${archiveStats.files.toLocaleString()} verified files.`
          : routeSummary}</p>
      </div>

      {archiveStats && <section className="competition-archive" aria-labelledby="competition-archive-title">
        <header className={filters.subject === 'bpho' ? 'competition-archive__header--rounds' : ''}>
          <div><span>{activeRoute?.stage || 'Verified archive'}</span><h3 id="competition-archive-title">{SUBJECT_NAMES[filters.subject]} historical archive</h3></div>
          {filters.subject !== 'bpho' && <nav aria-label={`${SUBJECT_NAMES[filters.subject]} source archives`}>
            {archiveSources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}><span><strong>{source.label}</strong><small>{source.relationship}</small></span><ExternalLink size={15} /></a>)}
          </nav>}
        </header>
        {filters.subject === 'bpho' && <div className="competition-archive__rounds" aria-label="BPhO archive coverage by round">
          {archiveStats.rounds.map((round) => <div key={round.value}><strong>{round.shortLabel}</strong><a href={round.sourceUrl} target="_blank" rel="noreferrer" title={`Open official ${round.label} archive`} aria-label={`Open official ${round.label} archive`}><ExternalLink size={14} /></a><span>{round.label}</span><small>{round.questionPapers} QP / {round.yearLabel} / {round.pairedQuestionPapers} with answers{round.missingYears.length ? ` / source gap: ${round.missingYears.join(', ')}` : ''}</small></div>)}
        </div>}
      </section>}

      <div className="paper-filters" aria-label="Past paper filters">
        <label className="search-box paper-search"><Search size={17} /><input value={filters.query} onChange={(event) => updateFilter('query', event.target.value)} placeholder="Search filename or paper code" /></label>
        {!isRouteScoped && <label><SlidersHorizontal size={17} /><select aria-label="Subject" value={filters.subject} onChange={(event) => updateFilter('subject', event.target.value)}><option value="all">All subjects</option>{Object.entries(SUBJECT_NAMES).map(([code, name]) => <option value={code} key={code}>{code} {name}</option>)}</select></label>}
        {!isRouteScoped && stageOptions.length > 0 && <label><span>Stage</span><select aria-label="Stage" value={filters.stage} onChange={(event) => updateFilter('stage', event.target.value)}><option value="all">All stages</option>{stageOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>}
        {!isRouteScoped && routeOptions.length > 0 && <label><span>Route</span><select aria-label="Route" value={filters.route} onChange={(event) => updateFilter('route', event.target.value)}><option value="all">All routes</option>{routeOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>}
        {!isSpecialArchive && paperOptions.length > 0 && <label><span>Paper</span><select aria-label="Paper" value={filters.paperNumber} onChange={(event) => updateFilter('paperNumber', event.target.value)}><option value="all">All papers</option>{paperOptions.map((option) => <option value={String(option.paperNumber)} key={option.paperNumber}>P{option.paperNumber} {option.title}</option>)}</select></label>}
        <label><span>Year</span><select aria-label="Year" value={filters.year} onChange={(event) => updateFilter('year', event.target.value)}><option value="all">All years</option>{years.map((year) => <option value={String(year)} key={year}>{year}</option>)}</select></label>
        <label><span>{filters.subject === 'bpho' ? 'Round' : filters.subject === 'amc12' ? 'Form' : 'Session'}</span><select aria-label={filters.subject === 'bpho' ? 'Round' : filters.subject === 'amc12' ? 'Form' : 'Session'} value={filters.season} onChange={(event) => updateFilter('season', event.target.value)}><option value="all">{filters.subject === 'bpho' ? 'All rounds' : filters.subject === 'amc12' ? 'All forms' : 'All sessions'}</option>{seasons.map((season) => <option value={season} key={season}>{archiveSeasonLabel(filters.subject, season)}</option>)}</select></label>
        <label><span>Type</span><select aria-label="Type" value={filters.kind} onChange={(event) => updateFilter('kind', event.target.value)}><option value="all">All files</option><option value="qp">Question papers</option><option value="ms">Mark schemes</option><option value="ak">Answer keys</option><option value="er">Examiner reports</option><option value="gt">Grade thresholds</option><option value="ci">Confidential instructions</option><option value="ir">Inserts</option><option value="guide">Guides</option><option value="other">Other files</option></select></label>
      </div>

      {filters.stage !== 'all' && getStageGuidance(filters.subject, filters.stage) && <div className="paper-route-note"><strong>{routeOptions.find((option) => option.id === filters.route)?.label || stageOptions.find((option) => option.value === filters.stage)?.label}</strong><span>{getRouteGuidance(filters.subject, filters.route) || getStageGuidance(filters.subject, filters.stage)}</span><a href={examStructures[filters.subject]?.syllabusUrl || examStructures[filters.subject]?.sourceUrl} target="_blank" rel="noreferrer">Official syllabus</a></div>}

      <div className="paper-result-bar"><span>{filtered.length.toLocaleString()} files</span><small>Page {safePage} of {pageCount}</small></div>
      {visible.length ? (
        <div className="paper-table-wrap">
          <table className="paper-table">
            <thead><tr><th>Paper</th><th>Subject</th><th>{filters.subject === 'bpho' ? 'Round / year' : 'Session'}</th><th>Type</th><th>Answer</th><th>Size</th><th><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{visible.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.file}</strong><small>{item.examProfile ? `${item.examProfile.paperNumber ? `P${item.examProfile.paperNumber} ` : ''}${item.examProfile.title}` : `Variant ${item.variant || 'general'}`} / {item.sha256.slice(0, 10)} / {item.governance?.sourcePolicyId === 'cie-mirror-restricted-v1' ? 'restricted study access' : 'source-governed access'}</small></td>
                <td><span className="subject-code">{item.subject}</span><small>{SUBJECT_NAMES[item.subject]}</small></td>
                <td>{archiveSeasonLabel(item.subject, item.season)} {Number(item.year) > 0 ? item.year : 'Specimen'}</td>
                <td><span className={`document-kind ${item.kind}`}>{KIND_NAMES[item.kind] || item.kind.toUpperCase()}</span></td>
                <td>{item.kind === 'qp' ? <span className={`answer-availability ${item.markSchemeId ? 'available' : 'missing'}`}>{item.markSchemeId ? 'Answer file' : 'Not in source'}</span> : <span className="answer-availability neutral">-</span>}</td>
                <td>{bytesLabel(item.bytes)}</td>
                <td><button type="button" className="table-action" onClick={() => onOpenPaper(item)}>{item.kind === 'ms' ? <FileCheck2 size={16} /> : <FileText size={16} />}Open</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <div className="paper-state"><Search size={24} /><span>No files match these filters.</span><button type="button" className="secondary-action" onClick={clearFilters}>Clear filters</button></div>}

      <div className="pagination">
        <button type="button" disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Previous page"><ChevronLeft size={18} /></button>
        <span>{safePage} / {pageCount}</span>
        <button type="button" disabled={safePage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} aria-label="Next page"><ChevronRight size={18} /></button>
      </div>
    </div>
  )
}
