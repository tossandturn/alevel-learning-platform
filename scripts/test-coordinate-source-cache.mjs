import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { sourcePageCachePath } from '../server/nativeSourcePages.js'
import { renderVerifiedCoordinatePdfPage } from '../server/coordinatePdfImages.js'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stem-coordinate-png-test-')), hash = b => crypto.createHash('sha256').update(b).digest('hex')
try {
  const libraryRoot = path.join(root, 'library'), cacheRoot = path.join(root, 'pages')
  await fs.mkdir(path.join(libraryRoot, '0625'), { recursive: true })
  const canvas = createCanvas(160, 200), ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 160, 200); ctx.fillStyle = '#00f'; ctx.fillRect(40, 60, 80, 100)
  const png = await canvas.encode('png')
  for (const [role, kind] of [['question-paper', 'qp'], ['mark-scheme', 'ms']]) {
    const fileName = `0625_s25_${kind}_22.pdf`, pdf = Buffer.from('%PDF-1.4\nsynthetic-' + kind)
    await fs.writeFile(path.join(libraryRoot, '0625', fileName), pdf)
    const spec = { libraryRoot, cacheRoot, subject: '0625', fileName, role, expectedPdfSha256: hash(pdf), page: 1,
      expectedPageImageSha256: hash(png), allowMarkScheme: true, allowUnknownSize: true }
    const file = sourcePageCachePath(spec); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, png)
    const args = { ...spec, env: { STEM_SOURCE_PAGE_CACHE_ROOT: cacheRoot }, region: kind === 'qp' ? [.25, .3, .75, .8] : null, deadlineAt: Date.now() + 10000 }
    const result = await renderVerifiedCoordinatePdfPage(args)
    assert.equal(result.sourcePageSha256, hash(png)); assert.deepEqual(result.sourcePageImageSize, [160, 200])
    assert.deepEqual(result.imageSize, kind === 'qp' ? [80, 100] : [160, 200])
    const image = await loadImage(Buffer.from(result.dataUrl.split(',')[1], 'base64'))
    assert.equal(image.width, result.imageSize[0]); assert.equal(image.height, result.imageSize[1])
    await assert.rejects(renderVerifiedCoordinatePdfPage({ ...args, deadlineAt: Date.now() - 1 }), e => e.code === 'source_page_render_timeout')
    await fs.writeFile(file, Buffer.concat([png, Buffer.from('tampered')]))
    await assert.rejects(renderVerifiedCoordinatePdfPage(args), e => e.code === 'native_source_page_checksum')
  }
  console.log('AI canonical PNG cache: byte-bound QP/MS, exact regional crop dimensions, JPEG provider payload, deadline and tamper rejection passed.')
} finally { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('stem-coordinate-png-test-')); await fs.rm(root, { recursive: true, force: true }) }
