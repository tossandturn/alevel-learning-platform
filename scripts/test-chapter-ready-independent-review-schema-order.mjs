import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const expected = {
  status: 'PASS_TERMINAL_REVIEW_FIELD_ORDER',
  terminalFields: ['reasoning', 'disagreementReasons', 'independentDerivedAnswer', 'markSchemeAnswer', 'reviewDecision'],
}
for (const relative of [
  'scripts/verify-chapter-ready-mitotic-cell-cycle-modality-correction.mjs',
  'scripts/verify-chapter-ready-mitotic-cell-cycle-q11q19-modality.mjs',
]) {
  const verifier = path.resolve(relative)
  const result = spawnSync(process.execPath, [verifier, '--schema-order-check'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.deepEqual(JSON.parse(result.stdout.trim()), expected)
}

console.log(JSON.stringify({ ...expected, verifiers: 2 }))
