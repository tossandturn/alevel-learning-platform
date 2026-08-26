import assert from 'node:assert/strict'

import { sortPaperLibraryItems } from '../src/lib/paperOrdering.js'

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

console.log('Past paper library ordering regression passed.')
