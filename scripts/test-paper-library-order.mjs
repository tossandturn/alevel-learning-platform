import assert from 'node:assert/strict'

import paperCatalog from '../public/data/papers.json' with { type: 'json' }
import { sortPaperLibraryItems, sortPaperLibrarySessions } from '../src/lib/paperOrdering.js'

const physicsItems = paperCatalog.items.filter((item) => item.subject === '9702')
const physicsYears = [...new Set(physicsItems.map((item) => item.year).filter((year) => Number(year) > 0))]
  .sort((left, right) => right - left)
assert.ok(physicsYears.length > 1, 'the real Physics catalog must expose multiple usable years')
assert.ok(
  physicsYears.every((year, index) => index === 0 || physicsYears[index - 1] > year),
  'real Past Paper years must come from the catalog in descending order',
)

const physicsSessions = sortPaperLibrarySessions([...new Set(physicsItems.map((item) => item.season).filter(Boolean))])
assert.deepEqual(physicsSessions, ['Nov', 'Jun', 'Mar'], 'real Cambridge sessions must be newest-first in the filter')

const sorted = sortPaperLibraryItems([
  { id: 'old', year: 2021, season: 's', file: '9702_s21_qp_12.pdf' },
  { id: 'same-year-early', year: 2025, season: 'Mar', file: '9702_m25_qp_22.pdf' },
  { id: 'same-year-middle', year: 2025, season: 'Jun', file: '9702_s25_qp_12.pdf' },
  { id: 'same-year-latest', year: 2025, season: 'Nov', file: '9702_w25_qp_12.pdf' },
])

assert.deepEqual(sorted.map((item) => item.id), [
  'same-year-latest',
  'same-year-middle',
  'same-year-early',
  'old',
], 'past paper rows must be ordered newest-first before pagination')

const firstPage = sortPaperLibraryItems(physicsItems).slice(0, 20)
const newestYear = physicsYears[0]
const newestSession = sortPaperLibrarySessions([
  ...new Set(physicsItems.filter((item) => item.year === newestYear).map((item) => item.season).filter(Boolean)),
])[0]
assert.ok(
  firstPage.length === 20 && firstPage.every((item) => item.year === newestYear && item.season === newestSession),
  'the first real catalog page must be sliced only after global year/session ordering',
)

console.log('Past paper library ordering regression passed.')
