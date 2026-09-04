import assert from 'node:assert/strict'

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

console.log('Coach image payload limits are consistent across client and server.')
