import assert from 'node:assert/strict'

import { sortPaperLibraryItems } from '../src/lib/paperOrdering.js'

const sorted = sortPaperLibraryItems([
  { id: 'old', year: 2021, season: 's', file: '9702_s21_qp_12.pdf' },
  { id: 'new', year: 2025, season: 'm', file: '9702_m25_qp_12.pdf' },
  { id: 'same-year-late', year: 2025, season: 's', file: '9702_s25_qp_12.pdf' },
  { id: 'same-year-early', year: 2025, season: 'm', file: '9702_m25_qp_22.pdf' },
])

assert.deepEqual(sorted.map((item) => item.id), [
  'new',
  'same-year-early',
  'same-year-late',
  'old',
], 'past paper rows must be ordered newest-first before pagination')

console.log('Past paper library ordering regression passed.')
