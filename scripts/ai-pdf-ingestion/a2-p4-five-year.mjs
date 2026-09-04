const SEASON_ORDER = Object.freeze({ m: 0, s: 1, w: 2 })

function parsePaperFile(file) {
  const match = /^9702_([msw])(\d{2})_(qp|ms)_4([1-4])?\.pdf$/i.exec(String(file || '').trim())
  if (!match) return null
  const year = 2000 + Number(match[2])
  if (!Number.isInteger(year)) return null
  return {
    file: match[0],
    season: match[1].toLowerCase(),
    year,
    kind: match[3].toLowerCase(),
    variant: Number(match[4] || 0),
  }
}

function paperId(file) {
  return `cie-9702-${file.replace(/\.pdf$/i, '')}`
}

export function selectA2P4FiveYearPairs(files = [], { firstYear = 2021, lastYear = 2025 } = {}) {
  const available = new Set((Array.isArray(files) ? files : []).map((file) => String(file || '').trim().toLowerCase()))
  return (Array.isArray(files) ? files : [])
    .map(parsePaperFile)
    .filter((entry) => entry && entry.kind === 'qp' && entry.year >= firstYear && entry.year <= lastYear)
    .map((entry) => {
      const markSchemeFile = entry.file.replace(/_qp_/i, '_ms_')
      return {
        questionFile: entry.file,
        markSchemeFile,
        paperId: paperId(entry.file),
        year: entry.year,
        season: entry.season,
        component: 4,
        variant: entry.variant,
        hasMarkScheme: available.has(markSchemeFile.toLowerCase()),
      }
    })
    .filter((entry) => entry.hasMarkScheme)
    .sort((left, right) => left.year - right.year
      || SEASON_ORDER[left.season] - SEASON_ORDER[right.season]
      || left.variant - right.variant
      || left.questionFile.localeCompare(right.questionFile))
    .map(({ hasMarkScheme: _hasMarkScheme, ...entry }) => Object.freeze(entry))
}

export function a2P4MarkSchemeFile(questionFile) {
  const parsed = parsePaperFile(questionFile)
  return parsed?.kind === 'qp' ? parsed.file.replace(/_qp_/i, '_ms_') : null
}
