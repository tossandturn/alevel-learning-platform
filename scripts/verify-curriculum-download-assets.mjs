import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { createCurriculumPaperCatalog } from '../server/curriculumPaperCatalog.js'

function requiredOption(name) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : ''
  assert.ok(value, `Pass ${name} <path>`)
  return path.resolve(value)
}

const manifestPath = requiredOption('--catalog')
const assetRoot = requiredOption('--asset-root')
const catalog = createCurriculumPaperCatalog({ manifestPath, assetRoot })
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (await catalog.handle(request, response, url)) return
  response.statusCode = 404
  response.end()
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`

try {
  const [ap, ib] = await Promise.all([catalog.list({ board: 'ap', pageSize: 100 }), catalog.list({ board: 'ib', pageSize: 100 })])
  assert.equal(ap.summary.downloadable, ap.summary.papers, 'Every AP paper must expose a licensed question-paper download')
  assert.equal(ib.summary.downloadable, ib.summary.papers, 'Every IB paper must expose a licensed question-paper download')
  const sampled = [ap.items[0], ib.items[0]]
  for (const paper of sampled) {
    const file = paper.questionPaper
    assert.ok(file.downloadUrl, `${paper.board} sample is missing a download URL`)
    const head = await fetch(baseUrl + file.downloadUrl, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(Number(head.headers.get('content-length')), file.bytes)
    const etag = head.headers.get('etag')
    assert.equal(etag, `\"${file.sha256}\"`)
    const range = await fetch(baseUrl + file.downloadUrl, { headers: { Range: 'bytes=0-63', 'If-Range': etag } })
    assert.equal(range.status, 206)
    assert.equal(Number(range.headers.get('content-length')), Math.min(64, file.bytes))
    const bytes = Buffer.from(await range.arrayBuffer())
    assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii')), 'Downloaded range must begin with a PDF signature')
  }
  process.stdout.write(`${JSON.stringify({
    status: 'pass',
    ap: ap.summary,
    ib: ib.summary,
    sampled: sampled.map(paper => paper.id),
  })}\n`)
} finally {
  await new Promise(resolve => server.close(resolve))
}
