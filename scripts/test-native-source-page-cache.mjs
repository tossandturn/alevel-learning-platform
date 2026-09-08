import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readVerifiedSourcePage, sourcePageCachePath } from '../server/nativeSourcePages.js'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stem-source-page-test-'))
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
// Synthetic files only; this test does not use any learner or production data.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5yEAAAAASUVORK5CYII=', 'base64')
const pdf = Buffer.from('%PDF-1.4\nsynthetic source')
const spec = { libraryRoot: path.join(root, 'library'), subject: '0625', fileName: '0625_s25_qp_22.pdf', page: 15,
  expectedPdfSha256: sha(pdf), expectedPageImageSha256: sha(png), imageSize: [1, 1], role: 'question-paper' }
try {
  await fs.mkdir(path.join(spec.libraryRoot, '0625'), { recursive: true })
  await fs.writeFile(path.join(spec.libraryRoot, '0625', spec.fileName), pdf)
  const target = sourcePageCachePath(spec)
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, png)
  const result = await readVerifiedSourcePage(spec)
  assert.deepEqual(result.bytes, png); assert.deepEqual(result.imageSize, [1, 1]); assert.equal(result.contentType, 'image/png')
  await assert.rejects(readVerifiedSourcePage({ ...spec, imageSize: [2, 1] }), e => e.code === 'native_source_page_dimensions')
  await assert.rejects(readVerifiedSourcePage({ ...spec, fileName: '../0625_s25_qp_22.pdf' }), e => e.code === 'native_source_page_scope')
  await assert.rejects(readVerifiedSourcePage({ ...spec, role: 'mark-scheme' }), e => e.code === 'native_source_page_scope')
  await fs.writeFile(target, Buffer.concat([png, Buffer.from('changed')]))
  await assert.rejects(readVerifiedSourcePage(spec), e => e.code === 'native_source_page_checksum')
  await fs.writeFile(target, png); await fs.writeFile(path.join(spec.libraryRoot, '0625', spec.fileName), Buffer.from('%PDF-1.4\nchanged'))
  await assert.rejects(readVerifiedSourcePage(spec), e => e.code === 'native_source_pdf_checksum')
  console.log('Exact source page cache: PDF/PNG byte hashes, PNG dimensions, scoped QP-only paths and changed-byte rejection passed.')
} finally {
  assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('stem-source-page-test-'))
  await fs.rm(root, { recursive: true, force: true })
}
