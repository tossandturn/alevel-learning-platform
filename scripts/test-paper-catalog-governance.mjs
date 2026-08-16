import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  PAPER_ACCESS_POLICIES,
  PAPER_CATALOG_SCHEMA_VERSION,
  PAPER_GOVERNANCE_POLICIES,
  PAPER_GOVERNANCE_SCHEMA_VERSION,
  paperGovernanceForItem,
} from '../src/lib/paperGovernance.js'

const root = path.resolve(import.meta.dirname, '..')
const sourceCatalog = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', 'papers.json'), 'utf8'))
const sourceRoot = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')
const fixtureSource = sourceCatalog.items.find((item) => item.kind === 'qp' && fs.existsSync(path.join(sourceRoot, item.subject, item.file)))
assert.ok(fixtureSource, 'a local authorised PDF fixture is required for catalog governance regression')

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-paper-governance-'))
const libraryRoot = path.join(scratch, 'pdf')
const fixturePath = path.join(libraryRoot, fixtureSource.subject, fixtureSource.file)
const catalogPath = path.join(scratch, 'public', 'data', 'papers.json')

function writeCatalog(item) {
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true })
  fs.writeFileSync(catalogPath, `${JSON.stringify({
    schemaVersion: PAPER_CATALOG_SCHEMA_VERSION,
    generatedAt: '2026-08-12T00:00:00.000Z',
    paperGovernance: {
      schemaVersion: PAPER_GOVERNANCE_SCHEMA_VERSION,
      sourcePolicies: PAPER_GOVERNANCE_POLICIES,
      accessPolicies: PAPER_ACCESS_POLICIES,
    },
    totals: { files: 1, bytes: item.bytes, questionPapers: 1, pairedQuestionPapers: 0, unpairedQuestionPapers: 1 },
    items: [item],
  }, null, 2)}\n`, 'utf8')
}

function runAudit() {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'audit-paper-catalog.mjs'), '--write-report'], {
    cwd: root,
    env: { ...process.env, PAPER_CATALOG_AUDIT_ROOT: scratch, CIE_LIBRARY_ROOT: libraryRoot },
    encoding: 'utf8',
  })
}

try {
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true })
  fs.copyFileSync(path.join(sourceRoot, fixtureSource.subject, fixtureSource.file), fixturePath)
  const base = {
    ...fixtureSource,
    bytes: fs.statSync(fixturePath).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex'),
    markSchemeId: null,
    governance: paperGovernanceForItem({ ...fixtureSource, markSchemeId: null }, { answerStatus: 'missing' }),
  }
  writeCatalog(base)
  const passing = runAudit()
  assert.equal(passing.status, 0, `a governed local PDF must pass:\n${passing.stdout}\n${passing.stderr}`)

  const releaseRoot = path.join(scratch, 'deploy', 'releases', 'candidate')
  const adjacentLibraryRoot = path.join(scratch, 'deploy', 'library', 'pdf')
  const adjacentFixturePath = path.join(adjacentLibraryRoot, fixtureSource.subject, fixtureSource.file)
  fs.mkdirSync(path.dirname(adjacentFixturePath), { recursive: true })
  fs.copyFileSync(path.join(sourceRoot, fixtureSource.subject, fixtureSource.file), adjacentFixturePath)
  fs.mkdirSync(path.join(releaseRoot, 'public', 'data'), { recursive: true })
  fs.copyFileSync(catalogPath, path.join(releaseRoot, 'public', 'data', 'papers.json'))
  const adjacentEnv = { ...process.env, PAPER_CATALOG_AUDIT_ROOT: releaseRoot }
  delete adjacentEnv.CIE_LIBRARY_ROOT
  delete adjacentEnv.CIE_SOURCE_ROOT
  const adjacentRun = spawnSync(process.execPath, [path.join(root, 'scripts', 'audit-paper-catalog.mjs')], {
    cwd: root,
    env: adjacentEnv,
    encoding: 'utf8',
  })
  assert.equal(adjacentRun.status, 0, `release-adjacent PDF library fallback must pass:\n${adjacentRun.stdout}\n${adjacentRun.stderr}`)

  fs.appendFileSync(fixturePath, Buffer.from('tamper', 'utf8'))
  const tampered = runAudit()
  assert.notEqual(tampered.status, 0, 'same-URL PDF byte tampering must fail catalog audit')
  assert.match(`${tampered.stdout}\n${tampered.stderr}`, /SHA-256 does not match catalog/, 'tampering must be diagnosed as a checksum mismatch')

  const withdrawn = {
    ...base,
    governance: { ...base.governance, state: 'withdrawn' },
  }
  writeCatalog(withdrawn)
  fs.copyFileSync(path.join(sourceRoot, fixtureSource.subject, fixtureSource.file), fixturePath)
  const withdrawnRun = runAudit()
  assert.equal(withdrawnRun.status, 0, `withdrawn records remain auditable without becoming missing:\n${withdrawnRun.stdout}\n${withdrawnRun.stderr}`)
  const report = JSON.parse(fs.readFileSync(path.join(scratch, 'artifacts', 'paper-catalog-audit.json'), 'utf8'))
  assert.deepEqual(report.withdrawals, [withdrawn.id], 'withdrawal state must be retained in the auditable report')

  const quarantined = {
    ...base,
    governance: {
      ...base.governance,
      state: 'quarantined',
      integrityStatus: 'quarantined',
      reasonCode: 'pdf-eof-missing',
      reviewedAt: '2026-08-12T00:00:00.000Z',
      reviewEvidence: 'fixture audit evidence',
    },
  }
  fs.writeFileSync(fixturePath, Buffer.from('%PDF-1.4\nfixture without EOF', 'ascii'))
  writeCatalog(quarantined)
  const quarantinedRun = runAudit()
  assert.equal(quarantinedRun.status, 0, `an evidence-backed damage quarantine must remain auditable:\n${quarantinedRun.stdout}\n${quarantinedRun.stderr}`)

  console.log(JSON.stringify({
    ok: true,
    fixture: fixtureSource.id,
    checks: ['valid-local-pdf', 'release-adjacent-library-root', 'same-url-byte-tamper', 'withdrawn-audit-state', 'evidence-backed-damage-quarantine'],
  }))
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
}
