import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveLibraryRoot } from '../server/pdfLibrary.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-pdf-library-root-'))
const appRoot = path.join(root, 'alevel-physics')
const libraryRoot = path.join(appRoot, 'library', 'pdf')
const releaseCwd = path.join(appRoot, 'releases', 'release')
fs.mkdirSync(path.join(libraryRoot, '9702'), { recursive: true })
fs.mkdirSync(releaseCwd, { recursive: true })

try {
  assert.equal(
    resolveLibraryRoot({ cwd: releaseCwd, env: {} }),
    libraryRoot,
    'a release under the shared Physics server must resolve its adjacent PDF library when the env variable is absent',
  )
  assert.equal(
    resolveLibraryRoot({ cwd: releaseCwd, env: { CIE_LIBRARY_ROOT: path.join(root, 'explicit-library') } }),
    path.join(root, 'explicit-library'),
    'an explicit CIE_LIBRARY_ROOT must remain authoritative',
  )
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('PDF library root resolution checks passed')
