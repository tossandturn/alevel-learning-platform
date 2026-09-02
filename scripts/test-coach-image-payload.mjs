import assert from 'node:assert/strict'
import fs from 'node:fs'

import { COACH_IMAGE_LIMITS } from '../server/aiApi.js'
import {
  MAX_COACH_IMAGE_ATTACHMENTS,
  MAX_COACH_IMAGE_OUTPUT_BYTES,
} from '../src/lib/coachScreenshot.js'

assert.equal(
  MAX_COACH_IMAGE_ATTACHMENTS,
  COACH_IMAGE_LIMITS.maxImageCount,
  'the Coach client and server must allow the same attachment count',
)

const maximumClientImageBytes = MAX_COACH_IMAGE_ATTACHMENTS * MAX_COACH_IMAGE_OUTPUT_BYTES
assert.ok(
  MAX_COACH_IMAGE_OUTPUT_BYTES <= COACH_IMAGE_LIMITS.maxImageBytes,
  'each client-prepared Coach image must fit the server per-image limit',
)
assert.ok(
  maximumClientImageBytes <= COACH_IMAGE_LIMITS.maxTotalImageBytes,
  'every attachment combination accepted by the client must fit the server total-image limit',
)

const base64CharactersPerImage = Math.ceil(MAX_COACH_IMAGE_OUTPUT_BYTES / 3) * 4
const maximumJsonBody = JSON.stringify({
  message: 'Analyze these photographed questions.',
  history: [],
  context: { view: 'dashboard' },
  hintLevel: 3,
  imageDataUrls: Array.from(
    { length: MAX_COACH_IMAGE_ATTACHMENTS },
    () => `data:image/jpeg;base64,${'A'.repeat(base64CharactersPerImage)}`,
  ),
})
assert.ok(
  Buffer.byteLength(maximumJsonBody) <= COACH_IMAGE_LIMITS.maxBodyBytes,
  'the largest client-approved multi-image request must fit the server JSON body limit after base64 encoding',
)

const screenshotSource = fs.readFileSync(new URL('../src/lib/coachScreenshot.js', import.meta.url), 'utf8')
assert.match(screenshotSource, /createImageBitmap/, 'iPad HEIC/HEIF uploads need a native bitmap decode fallback before JPEG compression')
assert.match(screenshotSource, /looksLikeImage/, 'image uploads must accept camera formats even when the browser omits a MIME type')

const coachSource = fs.readFileSync(new URL('../src/components/AiCoach.jsx', import.meta.url), 'utf8')
assert.match(coachSource, /function looksLikeImageFile\(file\)/, 'Coach attachment filtering must have a MIME-and-extension image predicate')
assert.match(coachSource, /const imageFiles = \[\.\.\.\(files \|\| \[\]\)\]\.filter\(\(file\) => assumeImage \|\| looksLikeImageFile\(file\)\)/, 'camera files with an empty MIME type must reach the image preparation path')
assert.match(coachSource, /file\?\.name[\s\S]{0,260}avif\|heic\|heif\|jpe\?g\|png\|webp/, 'the Coach predicate must recognize common camera extensions without a MIME type')
assert.match(coachSource, /\.filter\(\(item\) => item\.kind === 'file'\)[\s\S]{0,180}\.filter\(\(file\) => looksLikeImageFile\(file\)\)/, 'pasted images must be classified from the File after clipboard extraction')
assert.match(coachSource, /attachImage\(event, 'camera'\)/, 'native camera results must reach the decoder even when iOS omits File.type and File.name')
assert.match(screenshotSource, /imageFileToDataUrl\(file, \{ assumeImage = false \} = \{\}\)/, 'camera capture may use the input accept contract while decoding remains fail-closed')

console.log('Coach image payload limits are consistent across client and server.')
