import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { createNativePaperCatalog } from '../server/nativePaperCatalog.js'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stem-native-component-filter-'))

function qp({ id, variant, year = 2025, season = 'Jun', title = 'Catalog fixture' }) {
  const pairKey = `pair-${id}`
  return {
    id,
    subject: '9702',
    year,
    season,
    variant,
    kind: 'qp',
    file: `9702_${id}_${season.toLowerCase()}${String(year).slice(-2)}_qp_${variant}.pdf`,
    pairKey,
    markSchemeId: `ms-${id}`,
    localUrl: `/local-pdf/9702/${id}.pdf`,
    // The decoded exam structure is authoritative; these stale values must
    // never turn variant 11 into P11 or route P1 by title.
    examProfile: { paperNumber: 11, code: '9702/11', title, stages: ['a2'], courseRouteIds: ['cie-9702-a2-physics'] },
    governance: { state: 'active' },
  }
}

function withMarkSchemes(questionPapers) {
  return questionPapers.flatMap((paper) => [paper, {
    ...paper,
    id: paper.markSchemeId,
    kind: 'ms',
    file: paper.file.replace('_qp_', '_ms_'),
    localUrl: paper.localUrl.replace('.pdf', '-ms.pdf'),
  }])
}

const p1 = Array.from({ length: 35 }, (_, index) => qp({ id: `p1-${index}`, variant: index % 2 ? '11' : '12' }))
const p2 = Array.from({ length: 34 }, (_, index) => qp({ id: `p2-${index}`, variant: index % 2 ? '21' : '22' }))
const focus = [
  qp({ id: 'focus-p1', variant: '11', year: 2024, season: 'Jun', title: 'Focus source P1' }),
  qp({ id: 'focus-p2', variant: '22', year: 2024, season: 'Jun', title: 'Focus source P2' }),
]
const p3 = qp({ id: 'as-p3', variant: '31', title: 'P3 practical source' })
const p5 = qp({ id: 'a2-p5', variant: '51', title: 'P5 planning source' })
const sourcePapers = [...p1, ...p2, ...focus, p3, p5]
await fs.writeFile(path.join(directory, '9702.json'), JSON.stringify({ schemaVersion: 2, items: withMarkSchemes(sourcePapers) }), 'utf8')

const competition = ['Final P1 title must not create a component', 'Round 2'].map((title, index) => ({
  id: `bpho-${index}`,
  subject: 'bpho',
  year: 2025,
  season: `R${index + 1}`,
  kind: 'qp',
  file: `bpho-round-${index + 1}.pdf`,
  examProfile: { title, stages: ['competition'] },
  governance: { state: 'active' },
}))
await fs.writeFile(path.join(directory, 'bpho.json'), JSON.stringify({ schemaVersion: 2, items: competition }), 'utf8')

const service = createNativePaperCatalog({ directory })
try {
  const legacy = await service.list({ subject: '9702', stage: 'as', routeId: 'cie-9702-as-physics', pageSize: 30 })
  const explicitAll = await service.list({ subject: '9702', stage: 'as', routeId: 'cie-9702-as-physics', component: 'all', pageSize: 30 })
  assert.equal(legacy.filterVersion, 'native-paper-filters-v1')
  assert.equal(legacy.componentFilterVersion, 'native-paper-components-v1')
  assert.equal(legacy.component, 'all')
  assert.deepEqual(legacy.items.map((item) => item.id), explicitAll.items.map((item) => item.id), 'missing component remains backward-compatible with component=all')
  assert.equal(legacy.total, explicitAll.total)
  assert.deepEqual(legacy.facets.paperComponents, [
    { value: '1', label: 'P1' },
    { value: '2', label: 'P2' },
    { value: '3', label: 'P3' },
  ])

  const p1First = await service.list({ subject: '9702', stage: 'as', routeId: 'cie-9702-as-physics', component: '1', pageSize: 30, page: 1 })
  const p1Next = await service.list({ subject: '9702', stage: 'as', routeId: 'cie-9702-as-physics', component: '1', pageSize: 30, page: 2 })
  assert.equal(p1First.total, 36);assert.equal(p1First.items.length, 30);assert.equal(p1Next.items.length, 6)
  assert.equal(p1First.pairedTotal, 36);assert.ok([...p1First.items, ...p1Next.items].every((item) => item.paperComponent === 1))
  assert.ok([...p1First.items, ...p1Next.items].some((item) => /_qp_11\.pdf$/.test(item.file)))
  assert.ok([...p1First.items, ...p1Next.items].some((item) => /_qp_12\.pdf$/.test(item.file)), 'P1 includes both variants 11 and 12')
  assert.ok([...p1First.items, ...p1Next.items].every((item) => item.paperComponent !== 11), 'variant 11 is P1, never P11')

  const p2First = await service.list({ subject: '9702', stage: 'as', routeId: 'cie-9702-as-physics', component: '2', pageSize: 30, page: 1 })
  const p2Next = await service.list({ subject: '9702', stage: 'as', routeId: 'cie-9702-as-physics', component: '2', pageSize: 30, page: 2 })
  assert.equal(p2First.total, 35);assert.equal(p2First.items.length, 30);assert.equal(p2Next.items.length, 5)
  assert.equal(p2First.pairedTotal, 35);assert.ok([...p2First.items, ...p2Next.items].every((item) => item.paperComponent === 2))
  assert.ok(!p2First.items.some((item) => item.paperComponent === 1), 'P2 filter cannot leak P1')

  const combinedAll = await service.list({ subject: '9702', stage: 'as', routeId: 'cie-9702-as-physics', year: '2024', season: 'summer', query: 'focus', component: 'all' })
  const combinedP1 = await service.list({ subject: '9702', stage: 'as', routeId: 'cie-9702-as-physics', year: '2024', season: 'summer', query: 'focus', component: '1' })
  assert.equal(combinedAll.total, 2);assert.equal(combinedP1.total, 1);assert.equal(combinedP1.items[0].id, 'focus-p1')
  assert.deepEqual(combinedP1.facets.paperComponents, [{ value: '1', label: 'P1' }, { value: '2', label: 'P2' }], 'component facets honor other filters but ignore the current component')

  const p3Result = await service.list({ subject: '9702', stage: 'as', routeId: 'cie-9702-as-physics', component: '3' })
  const p5Result = await service.list({ subject: '9702', stage: 'a2', routeId: 'cie-9702-a2-physics', component: '5' })
  assert.deepEqual(p3Result.items.map((item) => item.id), ['as-p3'], 'full paper catalog keeps legitimate P3')
  assert.deepEqual(p5Result.items.map((item) => item.id), ['a2-p5'], 'full paper catalog keeps legitimate P5')
  assert.equal((await service.list({ subject: '9702', stage: 'as', routeId: 'cie-9702-as-physics', component: '5' })).total, 0, 'route/stage scope is applied before component and cannot leak A2')

  for (const component of ['', '0', '-1', '01', '1.5', 'P1', '10', '999999999999999999999']) {
    await assert.rejects(() => service.list({ subject: '9702', component }), (error) => error.statusCode === 400 && error.code === 'invalid_paper_component', `invalid component ${JSON.stringify(component)}`)
  }

  const rounds = await service.list({ subject: 'bpho', stage: 'competition' })
  assert.deepEqual(rounds.facets.paperComponents, [])
  assert.ok(rounds.items.every((item) => item.paperComponent === null), 'competition records without official component metadata stay null')
  assert.equal((await service.list({ subject: 'bpho', stage: 'competition', component: '1' })).total, 0, 'a P1-looking competition title must not fabricate component metadata')

  const handler = createStemApi({ env: { STEM_DB_PATH: ':memory:' }, paperCatalogDirectory: directory })
  const server = http.createServer((request, response) => handler(request, response, () => { response.statusCode = 404;response.end() }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const origin = `http://127.0.0.1:${server.address().port}`
    const response = await fetch(`${origin}/api/stem/paper-catalog?subject=9702&stage=as&routeId=cie-9702-as-physics&component=2&pageSize=5&page=1`)
    const body = await response.json()
    assert.equal(response.status, 200);assert.equal(body.component, '2');assert.equal(body.total, 35);assert.ok(body.items.every((item) => item.paperComponent === 2))
    const invalid = await fetch(`${origin}/api/stem/paper-catalog?subject=9702&component=0`)
    assert.equal(invalid.status, 400);assert.equal((await invalid.json()).code, 'invalid_paper_component')
  } finally {
    await new Promise((resolve) => server.close(resolve));closeStemDatabaseForTests()
  }

  console.log(JSON.stringify({ status: 'passed', scope: 'native-paper-component-filter', p1: 36, p2: 35, componentFilterVersion: 'native-paper-components-v1' }))
} finally {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
  assert.ok(path.basename(directory).startsWith('stem-native-component-filter-'))
  await fs.rm(directory, { recursive: true, force: true })
}
