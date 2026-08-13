import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function requiredOption(name) {
  const value = option(name)
  assert.ok(value, `Pass ${name} <path>`)
  return path.resolve(value)
}

function targetInsideRelease(releaseRoot, target) {
  const relative = path.relative(releaseRoot, target)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

const releaseRoot = requiredOption('--release-root')
const sourceAssets = requiredOption('--assets-dir')
const sourceCatalog = requiredOption('--catalog-file')
const sourcePdfLibrary = requiredOption('--pdf-library-root')
const targetAssets = path.join(releaseRoot, 'public', 'question-assets')
const targetCatalog = path.join(releaseRoot, 'public', 'data', 'papers.json')
const verifier = path.join(releaseRoot, 'scripts', 'verify-stem-release.mjs')

assert.ok(fs.existsSync(releaseRoot) && fs.statSync(releaseRoot).isDirectory(), `Release root is missing: ${releaseRoot}`)
assert.ok(fs.existsSync(sourceAssets) && fs.statSync(sourceAssets).isDirectory(), `Source assets are missing: ${sourceAssets}`)
assert.ok(fs.existsSync(sourceCatalog) && fs.statSync(sourceCatalog).isFile(), `Source catalog is missing: ${sourceCatalog}`)
assert.ok(fs.existsSync(sourcePdfLibrary) && fs.statSync(sourcePdfLibrary).isDirectory(), `Governed PDF library is missing: ${sourcePdfLibrary}`)
assert.ok(targetInsideRelease(releaseRoot, targetAssets) && targetInsideRelease(releaseRoot, targetCatalog), 'Release content target escapes release root')
assert.ok(!fs.existsSync(targetAssets), `Release already has question-assets: ${targetAssets}`)
assert.ok(!fs.existsSync(targetCatalog), `Release already has papers.json: ${targetCatalog}`)
assert.ok(fs.existsSync(verifier), `Release verifier is missing: ${verifier}`)

fs.mkdirSync(path.dirname(targetAssets), { recursive: true })
fs.mkdirSync(path.dirname(targetCatalog), { recursive: true })
fs.cpSync(sourceAssets, targetAssets, { recursive: true, dereference: true, force: false, errorOnExist: true })
fs.copyFileSync(sourceCatalog, targetCatalog, fs.constants.COPYFILE_EXCL)

const result = spawnSync(process.execPath, [verifier, '--release-root', releaseRoot, '--pdf-library-root', sourcePdfLibrary], {
  cwd: releaseRoot,
  env: process.env,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
assert.equal(result.status, 0, `Prepared release did not verify:\n${result.stdout}\n${result.stderr}`)
process.stdout.write(result.stdout)
