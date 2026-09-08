import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const HASH = /^[a-f0-9]{64}$/
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_PAGE_BYTES = 8 * 1024 * 1024
const fail = code => { throw Object.assign(new Error('题目原图暂时不可用，请重新加载。'), { statusCode: 422, code }) }

function validate(spec) {
  const role = spec.role === 'question-paper' ? 'qp' : spec.allowMarkScheme === true && spec.role === 'mark-scheme' ? 'ms' : ''
  const knownSize = Array.isArray(spec.imageSize) && spec.imageSize.length === 2 && spec.imageSize.every(n => Number.isInteger(n) && n > 0 && n <= 10000) && spec.imageSize[0] * spec.imageSize[1] <= 24000000
  if (!spec.libraryRoot || !/^\d{4}$/.test(spec.subject || '') ||
    !role || !new RegExp('^' + spec.subject + '_[msw]\\d{2}_' + role + '_\\d{2}\\.pdf$').test(spec.fileName || '') ||
    !HASH.test(spec.expectedPdfSha256 || '') || !HASH.test(spec.expectedPageImageSha256 || '') ||
    !Number.isInteger(spec.page) || spec.page < 1 || spec.page > 1000 ||
    !(knownSize || spec.allowUnknownSize === true && spec.imageSize === undefined)) fail('native_source_page_scope')
}

export function sourcePageCachePath(spec) {
  validate(spec)
  const root = path.resolve(spec.cacheRoot || path.join(spec.libraryRoot, '.source-page-cache'))
  return path.join(root, spec.expectedPdfSha256, `${spec.page}-${spec.expectedPageImageSha256}.png`)
}

async function containedFile(root, file, maxBytes) {
  try {
    const realRoot = await fsp.realpath(root), realFile = await fsp.realpath(file)
    const relative = path.relative(realRoot, realFile)
    if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) fail('native_source_page_scope')
    const stat = await fsp.stat(realFile)
    if (!stat.isFile() || !stat.size || stat.size > maxBytes) fail('native_source_page_size')
    return realFile
  } catch (error) {
    if (error.statusCode) throw error
    fail('native_source_page_unavailable')
  }
}

export async function readVerifiedSourcePage(spec) {
  validate(spec)
  const pdfPath = await containedFile(spec.libraryRoot, path.join(spec.libraryRoot, spec.subject, spec.fileName), 128 * 1024 * 1024)
  const hash = crypto.createHash('sha256')
  try { for await (const chunk of fs.createReadStream(pdfPath)) hash.update(chunk) }
  catch { fail('native_source_page_unavailable') }
  if (hash.digest('hex') !== spec.expectedPdfSha256) fail('native_source_pdf_checksum')
  const cacheRoot = spec.cacheRoot || path.join(spec.libraryRoot, '.source-page-cache')
  const pagePath = await containedFile(cacheRoot, sourcePageCachePath(spec), MAX_PAGE_BYTES)
  const bytes = await fsp.readFile(pagePath)
  if (bytes.length > MAX_PAGE_BYTES || crypto.createHash('sha256').update(bytes).digest('hex') !== spec.expectedPageImageSha256) fail('native_source_page_checksum')
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('ascii', 12, 16) !== 'IHDR') fail('native_source_page_format')
  const imageSize = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
  if (imageSize.some(n => n < 1 || n > 10000) || imageSize[0] * imageSize[1] > 24000000 || spec.imageSize && imageSize.some((n, i) => n !== spec.imageSize[i])) fail('native_source_page_dimensions')
  // This is the exact producer PNG, not a re-rendered JPEG. The native client
  // clips only the approved normalized region while retaining original pixels.
  return { bytes, contentType: 'image/png', imageSize, sha256: spec.expectedPageImageSha256 }
}
