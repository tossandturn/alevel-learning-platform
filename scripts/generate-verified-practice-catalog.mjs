import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { SOURCE_CONTENT_MANIFEST_CHECKSUM, SOURCE_INDEX_SHA256 } from '../src/data/sourceContentIdentity.js'
import { canonicalUtf8LfText } from './canonical-text.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = path.join(projectRoot, 'src', 'data', 'verifiedPracticeCatalog.json')
const write = process.argv.includes('--write')

function atomicWrite(target, text) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`)
  let descriptor
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o644)
    fs.writeFileSync(descriptor, text, 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.renameSync(temporary, target)
  } catch (error) {
    if (descriptor !== undefined) try { fs.closeSync(descriptor) } catch { /* already closed */ }
    try { fs.unlinkSync(temporary) } catch { /* no temporary file to remove */ }
    throw error
  }
}

function compactQuestion(question) {
  const { sourceContent: _sourceContent, ...rest } = question
  return {
    ...rest,
    parts: (question.parts || []).map(({ sourceFocus: _sourceFocus, ...part }) => part),
  }
}

const payload = {
  schemaVersion: 'verified-practice-catalog-v1',
  sourceIndexSha256: SOURCE_INDEX_SHA256,
  sourceContentManifestChecksum: SOURCE_CONTENT_MANIFEST_CHECKSUM,
  groups: unifiedQuestionBank.map(compactQuestion),
}
const expected = canonicalUtf8LfText(`${JSON.stringify(payload, null, 2)}\n`)

if (write) {
  atomicWrite(outputPath, expected)
  console.log(JSON.stringify({
    status: 'written',
    output: path.relative(projectRoot, outputPath).replaceAll('\\', '/'),
    groups: payload.groups.length,
  }))
  process.exit(0)
}

assert.ok(fs.existsSync(outputPath), 'verified practice catalog is missing; run npm run questions:write-runtime-catalog')
const actual = canonicalUtf8LfText(fs.readFileSync(outputPath, 'utf8'))
assert.equal(actual, expected, 'verified practice catalog is stale; run npm run questions:write-runtime-catalog')
console.log(JSON.stringify({
  status: 'current',
  output: path.relative(projectRoot, outputPath).replaceAll('\\', '/'),
  groups: payload.groups.length,
}))
