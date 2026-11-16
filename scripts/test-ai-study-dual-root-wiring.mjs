import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { createRuntimeAiQuestionBank } from '../vite.config.js'

const workspace = fs.realpathSync(path.resolve(import.meta.dirname, '..'))
const root = fs.mkdtempSync(path.join(workspace, '.dual-root-wiring-'))
const legacy = path.join(root, 'legacy'), candidate = path.join(root, 'candidate')
try {
  fs.mkdirSync(legacy)
  fs.mkdirSync(candidate)
  fs.writeFileSync(path.join(candidate, 'candidate-manifest.json'), JSON.stringify({ productionEligible: false }))
  const loader = createRuntimeAiQuestionBank({ env: { AI_PDF_INGESTION_ROOT: legacy,
    STEM_AI_STUDY_CANDIDATE_ROOT: candidate, STEM_AI_STUDY_CANDIDATE_ROUTES: 'cie-9708-a2-economics' }, libraryRoot: root })
  const unaffected = loader({ routeId: 'cie-9702-as-physics' })
  assert.equal(unaffected.complete, false, 'a rejected separate candidate must expose an incomplete snapshot')
  assert.equal(unaffected.candidateErrorCode, 'AI_STUDY_PROMOTION_INVALID')
  assert.deepEqual(unaffected.groups, [])
  assert.throws(() => loader({ routeId: 'cie-9708-a2-economics' }),
    (error) => error.code === 'AI_STUDY_PROMOTION_INVALID' && error.statusCode === 503)
  assert.throws(() => loader({ subject: '9708' }), (error) => error.code === 'AI_STUDY_PROMOTION_INVALID')
  assert.equal(loader({ subject: '9702' }).complete, false)
  const missingLegacy = createRuntimeAiQuestionBank({ env: { AI_PDF_INGESTION_ROOT: path.join(root, 'absent'),
    STEM_AI_STUDY_CANDIDATE_ROOT: candidate, STEM_AI_STUDY_CANDIDATE_ROUTES: 'cie-9708-a2-economics' }, libraryRoot: root })
  assert.throws(() => missingLegacy({ routeId: 'cie-9702-as-physics' }),
    (error) => error.code === 'AI_STUDY_LEGACY_UNAVAILABLE' && error.statusCode === 503)
  console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'vite-dual-root-failure-isolation' }))
} finally {
  const resolved = fs.realpathSync(root)
  assert.equal(path.dirname(resolved), workspace)
  assert.ok(path.basename(resolved).startsWith('.dual-root-wiring-'))
  fs.rmSync(resolved, { recursive: true, force: true })
}
