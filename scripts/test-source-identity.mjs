import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { canonicalTextSha256, canonicalUtf8LfText } from './canonical-text.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const auditScript = path.join(repoRoot, 'scripts', 'audit-question-bank.mjs')
const indexRelativePath = path.join('src', 'data', 'importedQuestionIndex.json')
const sourceAssetRoot = path.join(repoRoot, 'public', 'question-assets')
const scratchParent = process.env.SOURCE_IDENTITY_TEST_ROOT
  || (process.platform === 'win32' && fs.existsSync('D:\\CodexWork') ? 'D:\\CodexWork' : os.tmpdir())
const scratchRoot = fs.mkdtempSync(path.join(scratchParent, 'stem-source-identity-'))

function writeFixture(name, indexText) {
  const fixtureRoot = path.join(scratchRoot, name)
  const dataRoot = path.join(fixtureRoot, 'src', 'data')
  fs.mkdirSync(dataRoot, { recursive: true })
  fs.writeFileSync(path.join(dataRoot, 'importedQuestionIndex.json'), indexText, 'utf8')
  return fixtureRoot
}

function runAudit(name, indexText) {
  const fixtureRoot = writeFixture(name, indexText)
  const result = spawnSync(process.execPath, [auditScript, '--write-manifest'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SOURCE_AUDIT_ROOT: fixtureRoot,
      SOURCE_AUDIT_ASSET_ROOT: sourceAssetRoot,
    },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `${name} audit must pass:\n${result.stdout}\n${result.stderr}`)
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'src', 'data', 'sourceContentManifest.json'), 'utf8'))
  const identity = fs.readFileSync(path.join(fixtureRoot, 'src', 'data', 'sourceContentIdentity.js'), 'utf8')
  return { manifest, identity }
}

try {
  const worktreeIndexText = fs.readFileSync(path.join(repoRoot, indexRelativePath), 'utf8')
  const lfIndexText = canonicalUtf8LfText(worktreeIndexText)
  const crlfIndexText = lfIndexText.replace(/\n/g, '\r\n')

  assert.equal(
    canonicalTextSha256(lfIndexText),
    canonicalTextSha256(crlfIndexText),
    'LF and CRLF source index fixtures must have the same canonical digest',
  )

  const archivePath = path.join(scratchRoot, 'head.tar')
  execFileSync('git', ['archive', '--format=tar', '--output', archivePath, 'HEAD', '--', indexRelativePath], {
    cwd: repoRoot,
    stdio: 'ignore',
  })
  const archiveRoot = path.join(scratchRoot, 'archive')
  fs.mkdirSync(archiveRoot, { recursive: true })
  execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', archivePath, '-C', archiveRoot], { stdio: 'ignore' })
  const archiveIndexText = fs.readFileSync(path.join(archiveRoot, indexRelativePath), 'utf8')
  assert.equal(
    canonicalTextSha256(archiveIndexText),
    canonicalTextSha256(crlfIndexText),
    'git archive LF content and a CRLF checkout must have the same canonical digest',
  )

  const archiveRun = runAudit('archive-lf', archiveIndexText)
  const lfRun = runAudit('working-lf', lfIndexText)
  const crlfRun = runAudit('working-crlf', crlfIndexText)
  assert.deepEqual(crlfRun.manifest, lfRun.manifest, 'CRLF and LF audits must produce identical runtime manifests')
  assert.deepEqual(archiveRun.manifest, lfRun.manifest, 'git archive and working-tree audits must produce identical runtime manifests')
  assert.equal(crlfRun.identity, lfRun.identity, 'CRLF and LF audits must produce identical source identity files')
  assert.equal(archiveRun.identity, lfRun.identity, 'git archive and working-tree audits must produce identical source identity files')

  console.log(JSON.stringify({
    ok: true,
    sourceIndexSha256: lfRun.manifest.sourceIndexSha256,
    manifestChecksum: lfRun.manifest.checksum,
    variants: ['git-archive-lf', 'working-lf', 'working-crlf'],
  }, null, 2))
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
}
