import assert from 'node:assert/strict'

import { runRenderer } from '../server/coordinatePdfImages.js'

const startedAt = Date.now()
await assert.rejects(
  runRenderer(process.execPath, ['-e', 'setTimeout(() => {}, 1200)'], { timeoutMs: 80 }),
  (error) => error?.code === 'source_page_render_timeout',
  'a stalled coordinate-PDF renderer must fail closed before the upstream proxy timeout',
)
assert.ok(Date.now() - startedAt < 700, 'the renderer timeout must terminate the child promptly')

console.log('Coordinate PDF renderer timeout regression passed.')
