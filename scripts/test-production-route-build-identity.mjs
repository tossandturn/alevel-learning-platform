import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveProductionBuildIdentity } from './productionRouteBuildIdentity.mjs'

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-production-route-identity-'))
const commit = 'a'.repeat(40)

try {
  assert.deepEqual(
    resolveProductionBuildIdentity({
      cwd: scratchRoot,
      env: { STEM_BUILD_COMMIT: commit },
    }),
    { commit, sourceState: 'clean' },
    'an archive release without .git must use its declared build commit',
  )

  assert.throws(
    () => resolveProductionBuildIdentity({ cwd: scratchRoot, env: {} }),
    /STEM_BUILD_COMMIT|Git commit/i,
    'an archive release without .git must reject a missing build commit',
  )

  console.log(JSON.stringify({ ok: true }, null, 2))
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
}
