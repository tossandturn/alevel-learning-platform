import assert from 'node:assert/strict'
import fs from 'node:fs'
import { routeById } from '../src/data/routeRegistry.js'
import { paperItemMatchesActiveRoute } from '../src/lib/paperRouteEligibility.js'

const catalog = JSON.parse(fs.readFileSync(new URL('../public/data/papers.json', import.meta.url), 'utf8'))
const route = routeById('cie-9709-as-p1-p5')

function catalogItem(file) {
  const item = catalog.items.find((candidate) => candidate.file === file)
  assert.ok(item, `${file} must exist in the local paper catalog`)
  return item
}

assert.equal(
  paperItemMatchesActiveRoute(catalogItem('9709_s02_qp_1.pdf'), route),
  true,
  'P1 question papers belong in the P1 + S1 route',
)
assert.equal(
  paperItemMatchesActiveRoute(catalogItem('9709_s02_qp_6.pdf'), route),
  true,
  'legacy S1 papers belong in the P1 + S1 route even when Cambridge numbered them Paper 6',
)
assert.equal(
  paperItemMatchesActiveRoute(catalogItem('9709_m25_qp_52.pdf'), route),
  true,
  'current S1 papers belong in the P1 + S1 route when Cambridge numbers them Paper 5',
)
assert.equal(
  paperItemMatchesActiveRoute(catalogItem('9709_s02_qp_5.pdf'), route),
  false,
  'legacy Paper 5 Mechanics 2 must not be shown as S1 in the P1 + S1 route',
)

console.log(JSON.stringify({ status: 'passed', routeId: route.routeId, checks: 4 }))
