import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { prepareWholePaperMarkingOverlay } from './prepare-whole-paper-marking-overlay.mjs'

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-whole-paper-overlay-'))
const output = path.join(temporaryRoot, 'overlay')
try {
  const result = prepareWholePaperMarkingOverlay({ outputDirectory: output })
  assert.equal(result.manifest.schemaVersion, 'stem-whole-paper-overlay-v1')
  assert.equal(result.manifest.requiresServerBuild, false)
  assert.equal(result.manifest.requiresDependencyInstall, false)
  assert.equal(result.manifest.privateDataIncluded, false)
  assert.deepEqual(
    Object.fromEntries(result.manifest.dependencies.map((dependency) => [dependency.name, dependency.version])),
    { 'pdf-lib': '1.17.1', '@pdf-lib/standard-fonts': '1.0.0', '@pdf-lib/upng': '1.0.1', pako: '1.0.11', tslib: '1.14.1' },
  )
  assert.ok(result.manifest.files.length > 20)
  assert.ok(result.manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256) && file.bytes >= 0))
  assert.equal(result.manifest.files.some((file) => /(?:^|\/)(?:data|public|\.env)(?:\/|$)/.test(file.path)), false, 'overlay must not include private data, source assets, or env files')
  assert.equal(result.manifest.files.some((file) => file.path === 'runtime/server/wholePaperMarking.js'), true)
  assert.equal(result.manifest.files.some((file) => file.path === 'node_modules/pdf-lib/package.json'), true)
  assert.throws(() => prepareWholePaperMarkingOverlay({ outputDirectory: output }), /already exists/i, 'overlay generation must not overwrite an existing artifact')
  console.log(JSON.stringify({ status: 'passed', totalBytes: result.manifest.totalBytes, fileCount: result.manifest.files.length }))
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
