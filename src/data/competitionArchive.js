export const SPECIAL_ARCHIVE_SUBJECTS = Object.freeze(['bpho', 'amc12', 'esat', 'tmua'])

export const BPHO_ROUNDS = Object.freeze([
  Object.freeze({ value: 'r1', shortLabel: 'R1', label: 'Round 1', sourceUrl: 'https://www.bpho.org.uk/Papers/R1/' }),
  Object.freeze({ value: 'r2', shortLabel: 'R2', label: 'Round 2', sourceUrl: 'https://www.bpho.org.uk/Papers/R2/' }),
  Object.freeze({ value: 'spc', shortLabel: 'SPC', label: 'Senior Physics Challenge', sourceUrl: 'https://www.bpho.org.uk/Papers/SPC/' }),
  Object.freeze({ value: 'ipc', shortLabel: 'IPC', label: 'Intermediate Physics Challenge', sourceUrl: 'https://www.bpho.org.uk/Papers/IPC/' }),
  Object.freeze({ value: 'pc', shortLabel: 'PC', label: 'Physics Challenge', sourceUrl: 'https://www.bpho.org.uk/Papers/PC/' }),
  Object.freeze({ value: 'expt', shortLabel: 'EXP', label: 'Experimental Competition', sourceUrl: 'https://www.bpho.org.uk/Papers/Expt/' }),
])

export const ARCHIVE_SOURCES = Object.freeze({
  bpho: Object.freeze(BPHO_ROUNDS.map((round) => Object.freeze({ label: round.label, url: round.sourceUrl, relationship: 'Official archive' }))),
  amc12: Object.freeze([
    Object.freeze({ label: 'MAA AMC 12', url: 'https://maa.org/student-programs/amc/', relationship: 'Official competition information' }),
    Object.freeze({ label: 'Past problems and solutions', url: 'https://live.poshenloh.com/past-contests/amc12', relationship: 'Published with MAA permission' }),
  ]),
  esat: Object.freeze([
    Object.freeze({ label: 'ESAT preparation materials', url: 'https://esat-tmua.ac.uk/esat-preparation-materials/', relationship: 'Official UAT-UK archive' }),
  ]),
  tmua: Object.freeze([
    Object.freeze({ label: 'TMUA preparation materials', url: 'https://esat-tmua.ac.uk/tmua-preparation-materials/', relationship: 'Official UAT-UK archive' }),
  ]),
})

const SEASON_LABELS = Object.freeze({
  bpho: Object.freeze(Object.fromEntries(BPHO_ROUNDS.map((round) => [round.value, round.label]))),
  amc12: Object.freeze({ main: 'Single paper', A: 'Form A', B: 'Form B', C: 'Form C', D: 'Form D' }),
  esat: Object.freeze({ prep: 'Preparation archive' }),
  tmua: Object.freeze({ prep: 'Preparation archive' }),
})

export function archiveSeasonLabel(subject, season) {
  return SEASON_LABELS[subject]?.[season] || season || 'General'
}

function yearRange(items) {
  const years = [...new Set(items.map((item) => Number(item.year)).filter((year) => Number.isFinite(year) && year > 0))].sort((left, right) => left - right)
  if (!years.length) return { firstYear: null, lastYear: null, yearLabel: 'Specimen', missingYears: Object.freeze([]) }
  const firstYear = years[0]
  const lastYear = years.at(-1)
  const missingYears = []
  for (let year = firstYear; year <= lastYear; year += 1) if (!years.includes(year)) missingYears.push(year)
  return { firstYear, lastYear, yearLabel: firstYear === lastYear ? String(firstYear) : `${firstYear}-${lastYear}`, missingYears: Object.freeze(missingYears) }
}

export function buildArchiveStats(items = [], subject) {
  const archiveItems = items.filter((item) => item.subject === subject)
  const questionPapers = archiveItems.filter((item) => item.kind === 'qp')
  const roundOrder = subject === 'bpho'
    ? BPHO_ROUNDS
    : [...new Set(archiveItems.map((item) => item.season).filter(Boolean))].map((value) => ({ value, shortLabel: archiveSeasonLabel(subject, value), label: archiveSeasonLabel(subject, value) }))
  const rounds = roundOrder.map((round) => {
    const roundItems = archiveItems.filter((item) => item.season === round.value)
    const roundQuestionPapers = roundItems.filter((item) => item.kind === 'qp')
    return Object.freeze({
      ...round,
      files: roundItems.length,
      questionPapers: roundQuestionPapers.length,
      pairedQuestionPapers: roundQuestionPapers.filter((item) => item.markSchemeId).length,
      ...yearRange(roundItems),
    })
  }).filter((round) => round.files)
  return Object.freeze({
    subject,
    files: archiveItems.length,
    questionPapers: questionPapers.length,
    pairedQuestionPapers: questionPapers.filter((item) => item.markSchemeId).length,
    ...yearRange(archiveItems),
    rounds: Object.freeze(rounds),
  })
}
