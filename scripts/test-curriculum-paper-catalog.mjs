import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createCurriculumPaperCatalog } from '../server/curriculumPaperCatalog.js'

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stem-curriculum-catalog-'))
const assetRoot = path.join(directory, 'assets')
const manifestPath = path.join(directory, 'curriculum-papers.json')
const goodPdf = Buffer.from('%PDF-1.4\nsynthetic licensed curriculum paper\n%%EOF\n', 'ascii')
const wrongPdf = Buffer.from('%PDF-1.4\nsynthetic wrong checksum curriculum pdf\n%%EOF\n', 'ascii')
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function sourceFile({ id, name = `${id}.pdf`, bytes = goodPdf, relativePath = 'licensed/good.pdf', rightsStatus = 'unverified', sourceUrl = null, hash = sha256(bytes) } = {}) {
  return {
    id,
    name,
    bytes: bytes.length,
    pages: 1,
    sha256: hash,
    relativePath,
    sourceUrl,
    rightsStatus,
    integrityStatus: 'verified',
  }
}

function paper(index, overrides = {}) {
  const id = overrides.id || `ap-paper-${String(index).padStart(2, '0')}`
  const course = index < 22 ? 'ap-physics-c-mechanics' : 'ap-chemistry'
  return {
    id,
    board: 'ap',
    course,
    courseLabel: course === 'ap-physics-c-mechanics' ? 'AP Physics C: Mechanics' : 'AP Chemistry',
    subject: course === 'ap-physics-c-mechanics' ? 'Physics' : 'Chemistry',
    level: 'AP',
    year: 2026 - (index % 3),
    session: 'May',
    paper: 'FRQ',
    variant: String(index + 1),
    title: `Released free-response set ${index + 1}`,
    section: 'Free Response Questions',
    fullExam: false,
    practiceReady: false,
    pairStatus: index === 0 ? 'verified' : 'missing',
    questionPaper: sourceFile({
      id: `ap-question-${index}`,
      sourceUrl: `https://apcentral.collegeboard.org/media/pdf/released-${index}.pdf`,
    }),
    markScheme: index === 0 ? sourceFile({ id: 'ap-mark-0', name: 'Scoring guidelines.pdf' }) : null,
    ...overrides,
  }
}

await fs.mkdir(path.join(assetRoot, 'licensed'), { recursive: true })
await fs.writeFile(path.join(assetRoot, 'licensed', 'good.pdf'), goodPdf)
await fs.writeFile(path.join(assetRoot, 'licensed', 'wrong.pdf'), wrongPdf)

const papers = Array.from({ length: 25 }, (_, index) => paper(index))
papers[0] = paper(0, {
  id: 'ap-paper-good',
  questionPaper: sourceFile({
    id: 'ap-question-good',
    name: 'AP Physics "FRQ"\r\nInjected.pdf',
    rightsStatus: 'licensed',
    sourceUrl: 'https://apcentral.collegeboard.org/media/pdf/ap-physics-frq.pdf',
  }),
  markScheme: sourceFile({
    id: 'ap-mark-good',
    name: 'AP Physics scoring guidelines.pdf',
    rightsStatus: 'licensed',
  }),
})
papers[1] = paper(1, {
  id: 'ap-paper-wrong-hash',
  questionPaper: sourceFile({
    id: 'ap-question-wrong-hash',
    bytes: wrongPdf,
    relativePath: 'licensed/wrong.pdf',
    rightsStatus: 'licensed',
    hash: '0'.repeat(64),
  }),
})
papers[2] = paper(2, {
  id: 'ap-paper-source-only',
  questionPaper: sourceFile({
    id: 'ap-question-source-only',
    relativePath: 'not-present/source-only.pdf',
    rightsStatus: 'unverified',
  }),
})
papers.push({
  id: 'ib-paper-source-only',
  board: 'ib',
  course: 'ib-physics',
  courseLabel: 'IB Physics',
  subject: 'Physics',
  level: 'HL',
  year: 2025,
  session: 'May',
  paper: '1',
  variant: 'TZ1',
  title: 'IB Physics Paper 1',
  section: 'Multiple choice',
  fullExam: true,
  practiceReady: false,
  pairStatus: 'missing',
  questionPaper: sourceFile({
    id: 'ib-question-source-only',
    sourceUrl: 'https://example-mirror.invalid/ib-physics-paper.pdf',
    relativePath: 'not-present/ib-paper.pdf',
  }),
  markScheme: null,
})

await fs.writeFile(manifestPath, JSON.stringify({
  schemaVersion: 'curriculum-paper-source-v1',
  generatedAt: '2026-09-24T00:00:00.000Z',
  courses: [
    { id: 'ap-physics-c-mechanics', board: 'ap', label: 'AP Physics C: Mechanics', subject: 'Physics' },
    { id: 'ap-chemistry', board: 'ap', label: 'AP Chemistry', subject: 'Chemistry' },
    { id: 'ib-physics', board: 'ib', label: 'IB Physics', subject: 'Physics' },
  ],
  papers,
}), 'utf8')

const catalog = createCurriculumPaperCatalog({ manifestPath, assetRoot })
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (await catalog.handle(request, response, url)) return
  response.statusCode = 404
  response.end()
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`

async function json(pathname, options) {
  const response = await fetch(baseUrl + pathname, options)
  const body = await response.json()
  return { response, body }
}

try {
  const defaults = await json('/api/stem/curriculum-papers?board=ap')
  assert.equal(defaults.response.status, 200)
  assert.equal(defaults.body.schemaVersion, 'curriculum-papers-v1')
  assert.equal(defaults.body.board, 'ap')
  assert.equal(defaults.body.total, 25)
  assert.equal(defaults.body.page, 1)
  assert.equal(defaults.body.pageSize, 20)
  assert.equal(defaults.body.pages, 2)
  assert.equal(defaults.body.items.length, 20)
  assert.deepEqual(defaults.body.courses.map(course => course.id).sort(), ['ap-chemistry', 'ap-physics-c-mechanics'])
  assert.equal(defaults.body.summary.papers, 25)
  assert.equal(defaults.body.summary.downloadable, 2)
  assert.equal(defaults.body.summary.sourceOnly, 23)
  assert.ok(defaults.body.items.every(item => item.practiceReady === false))
  assert.doesNotMatch(JSON.stringify(defaults.body), /relativePath|rightsStatus|integrityStatus|not-present/)

  const secondPage = await json('/api/stem/curriculum-papers?board=ap&page=2')
  assert.equal(secondPage.response.status, 200)
  assert.equal(secondPage.body.page, 2)
  assert.equal(secondPage.body.items.length, 5)
  assert.ok(!secondPage.body.items.some(item => defaults.body.items.some(first => first.id === item.id)))

  const filtered = await json('/api/stem/curriculum-papers?board=ap&course=ap-physics-c-mechanics&level=AP&year=2026&session=May&paper=FRQ&pageSize=5')
  assert.equal(filtered.response.status, 200)
  assert.equal(filtered.body.pageSize, 5)
  assert.ok(filtered.body.items.every(item => item.course === 'ap-physics-c-mechanics' && item.year === 2026))
  assert.deepEqual(filtered.body.filters.levels, ['AP'])
  assert.ok(filtered.body.filters.years.includes(2025))

  const sourceOnly = await json('/api/stem/curriculum-papers?board=ap&query=source-only')
  assert.equal(sourceOnly.response.status, 200)
  assert.equal(sourceOnly.body.total, 1)
  assert.equal(sourceOnly.body.items[0].availability, 'source-only')
  assert.equal(sourceOnly.body.items[0].questionPaper.downloadUrl, null)

  const ib = await json('/api/stem/curriculum-papers?board=ib')
  assert.equal(ib.response.status, 200)
  assert.equal(ib.body.total, 1)
  assert.equal(ib.body.items[0].questionPaper.sourceUrl, null, 'non-official IB mirrors are not exposed')

  const invalidBoard = await json('/api/stem/curriculum-papers?board=cie')
  assert.equal(invalidBoard.response.status, 400)
  assert.deepEqual(invalidBoard.body, { error: { code: 'invalid_curriculum_board', message: 'board must be ap or ib.' } })

  const crossCourse = await json('/api/stem/curriculum-papers?board=ap&course=ib-physics')
  assert.equal(crossCourse.response.status, 400)
  assert.equal(crossCourse.body.error.code, 'invalid_curriculum_scope')

  const full = await fetch(baseUrl + '/api/stem/curriculum-papers/files/ap-question-good')
  assert.equal(full.status, 200)
  assert.equal(full.headers.get('content-type'), 'application/pdf')
  assert.equal(full.headers.get('accept-ranges'), 'bytes')
  assert.equal(Number(full.headers.get('content-length')), goodPdf.length)
  assert.match(full.headers.get('content-disposition'), /^attachment; filename="[A-Za-z0-9._ -]+"; filename\*=UTF-8''/)
  assert.doesNotMatch(full.headers.get('content-disposition'), /[\r\n]/)
  const etag = full.headers.get('etag')
  assert.equal(etag, `"${sha256(goodPdf)}"`)
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), goodPdf)

  const head = await fetch(baseUrl + '/api/stem/curriculum-papers/files/ap-question-good', { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(Number(head.headers.get('content-length')), goodPdf.length)
  assert.equal((await head.arrayBuffer()).byteLength, 0)

  const range = await fetch(baseUrl + '/api/stem/curriculum-papers/files/ap-question-good', { headers: { Range: 'bytes=2-10' } })
  assert.equal(range.status, 206)
  assert.equal(range.headers.get('content-range'), `bytes 2-10/${goodPdf.length}`)
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), goodPdf.subarray(2, 11))

  const currentIfRange = await fetch(baseUrl + '/api/stem/curriculum-papers/files/ap-question-good', { headers: { Range: 'bytes=2-10', 'If-Range': etag } })
  assert.equal(currentIfRange.status, 206)
  assert.equal(currentIfRange.headers.get('content-range'), `bytes 2-10/${goodPdf.length}`)
  assert.deepEqual(Buffer.from(await currentIfRange.arrayBuffer()), goodPdf.subarray(2, 11))

  const staleIfRange = await fetch(baseUrl + '/api/stem/curriculum-papers/files/ap-question-good', { headers: { Range: 'bytes=2-10', 'If-Range': `"${'f'.repeat(64)}"` } })
  assert.equal(staleIfRange.status, 200)
  assert.equal(staleIfRange.headers.get('content-range'), null)
  assert.deepEqual(Buffer.from(await staleIfRange.arrayBuffer()), goodPdf, 'stale If-Range must not append a fragment to stale bytes')

  const weakIfRange = await fetch(baseUrl + '/api/stem/curriculum-papers/files/ap-question-good', { headers: { Range: 'bytes=2-10', 'If-Range': `W/${etag}` } })
  assert.equal(weakIfRange.status, 200)
  assert.deepEqual(Buffer.from(await weakIfRange.arrayBuffer()), goodPdf)

  const resumed = await fetch(baseUrl + '/api/stem/curriculum-papers/files/ap-question-good', { headers: { Range: 'bytes=10-' } })
  assert.equal(resumed.status, 206)
  assert.equal(resumed.headers.get('content-range'), `bytes 10-${goodPdf.length - 1}/${goodPdf.length}`)
  assert.deepEqual(Buffer.from(await resumed.arrayBuffer()), goodPdf.subarray(10))

  const unsatisfied = await json('/api/stem/curriculum-papers/files/ap-question-good', { headers: { Range: 'bytes=9999-' } })
  assert.equal(unsatisfied.response.status, 416)
  assert.equal(unsatisfied.response.headers.get('content-range'), `bytes */${goodPdf.length}`)
  assert.equal(unsatisfied.body.error.code, 'curriculum_paper_range_not_satisfiable')

  const unlicensed = await json('/api/stem/curriculum-papers/files/ap-question-source-only')
  assert.equal(unlicensed.response.status, 404)
  assert.equal(unlicensed.body.error.code, 'curriculum_paper_file_not_found')

  const wrongHash = await json('/api/stem/curriculum-papers/files/ap-question-wrong-hash')
  assert.equal(wrongHash.response.status, 404)
  assert.equal(wrongHash.body.error.code, 'curriculum_paper_file_not_found')

  const traversal = await json('/api/stem/curriculum-papers/files/%2e%2e%2Foutside.pdf')
  assert.equal(traversal.response.status, 404)
  assert.equal(traversal.body.error.code, 'curriculum_paper_file_not_found')

  await fs.writeFile(path.join(assetRoot, 'licensed', 'good.pdf'), Buffer.from(goodPdf.map(byte => byte ^ 1)))
  const changedAfterCachedHash = await json('/api/stem/curriculum-papers/files/ap-question-good')
  assert.equal(changedAfterCachedHash.response.status, 404, 'hash cache must invalidate when file stat changes')
  assert.equal(changedAfterCachedHash.body.error.code, 'curriculum_paper_file_not_found')

  const unsafeManifestPath = path.join(directory, 'unsafe-curriculum-papers.json')
  const unsafePaper = structuredClone(papers[0])
  unsafePaper.questionPaper.relativePath = '../outside.pdf'
  await fs.writeFile(unsafeManifestPath, JSON.stringify({
    schemaVersion: 'curriculum-paper-source-v1',
    generatedAt: '2026-09-24T00:00:00.000Z',
    courses: [{ id: 'ap-physics-c-mechanics', board: 'ap', label: 'AP Physics C: Mechanics', subject: 'Physics' }],
    papers: [unsafePaper],
  }), 'utf8')
  await assert.rejects(
    () => createCurriculumPaperCatalog({ manifestPath: unsafeManifestPath, assetRoot }).list({ board: 'ap' }),
    error => error.statusCode === 503 && error.code === 'curriculum_catalog_unavailable',
    'manifest traversal must fail closed before any asset path is used',
  )

  const productionCatalog = createCurriculumPaperCatalog()
  const productionAp = await productionCatalog.list({ board: 'ap' })
  const productionIb = await productionCatalog.list({ board: 'ib' })
  assert.deepEqual(productionAp.summary, { papers: 54, downloadable: 0, sourceOnly: 54 })
  assert.deepEqual(productionIb.summary, { papers: 334, downloadable: 0, sourceOnly: 334 })
  assert.ok(productionAp.items.every(item => item.fullExam === false && item.practiceReady === false))
  assert.ok(productionAp.items.every(item => item.questionPaper.sourceUrl?.startsWith('https://') && item.questionPaper.downloadUrl === null))
  assert.ok(productionIb.items.every(item => item.questionPaper.sourceUrl === null && item.questionPaper.downloadUrl === null))

  console.log(JSON.stringify({
    status: 'pass',
    scope: 'AP and IB curriculum paper catalog, policy-gated files, HEAD and byte ranges',
    apPapers: defaults.body.total,
    defaultPageSize: defaults.body.pageSize,
    production: { ap: productionAp.summary, ib: productionIb.summary },
  }))
} finally {
  await new Promise(resolve => server.close(resolve))
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
  assert.ok(path.basename(directory).startsWith('stem-curriculum-catalog-'))
  await fs.rm(directory, { recursive: true, force: true })
}
