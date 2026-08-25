import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { buildA2P4FiveYearJobs, runA2P4FiveYearIngestion } from './a2-p4-five-year-ingestion.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-a2-p4-five-year-worker-'))
const libraryRoot = path.join(root, 'library')
const subjectRoot = path.join(libraryRoot, '9702')
const outputRoot = path.join(root, 'artifacts')
fs.mkdirSync(subjectRoot, { recursive: true })

for (const fileName of [
  '9702_m20_qp_42.pdf',
  '9702_m20_ms_42.pdf',
  '9702_m21_qp_42.pdf',
  '9702_m21_ms_42.pdf',
  '9702_s22_qp_43.pdf',
  '9702_s22_ms_43.pdf',
  '9702_w25_qp_44.pdf',
  '9702_w25_ms_44.pdf',
  '9702_w25_qp_45.pdf',
  '9702_w25_ms_45.pdf',
]) {
  fs.writeFileSync(path.join(subjectRoot, fileName), '%PDF-1.4\nfixture\n', 'utf8')
}

try {
  const jobs = buildA2P4FiveYearJobs({ libraryRoot, outputRoot })
  assert.deepEqual(jobs.map((job) => job.questionFile), [
    '9702_m21_qp_42.pdf',
    '9702_s22_qp_43.pdf',
    '9702_w25_qp_44.pdf',
  ])
  assert.ok(jobs.every((job) => job.year >= 2021 && job.year <= 2025))
  assert.ok(jobs.every((job) => job.component === 4 && job.subject === '9702' && job.stage === 'A2' && job.coordinateOnly === true && job.pageWindowed === true && job.pageWindowOwnedPages === 1 && job.pageWindowTrailingPages === 1 && job.maxAttempts === 2 && job.timeoutMs === 180000 && job.paperTimeoutMs === 7200000))
  assert.ok(jobs.every((job) => !/_[qm]p?_?5/i.test(job.questionFile)), 'P5 must never enter the A2 P4 ingestion queue')

  const calls = []
  const summary = await runA2P4FiveYearIngestion({ libraryRoot, outputRoot }, {
    runIngestion: async (job) => {
      calls.push(job)
      return { paperId: job.paperId, status: 'ai-verified', storageMode: 'coordinate-only' }
    },
  })
  assert.deepEqual(calls.map((job) => job.paperId), jobs.map((job) => job.paperId))
  assert.ok(calls.every((job) => job.coordinateOnly && job.pageWindowed && job.subject === '9702' && job.stage === 'A2' && job.renderDpi === 120 && job.pageWindowOwnedPages === 1 && job.pageWindowTrailingPages === 1 && job.maxAttempts === 2 && job.timeoutMs === 180000 && job.paperTimeoutMs === 7200000))
  assert.equal(summary.total, 3)
  assert.equal(summary.verified, 3)
  assert.equal(summary.quarantined, 0)
  assert.deepEqual(summary.outcomes.map((outcome) => outcome.questionFile), jobs.map((job) => job.questionFile))

  const cli = spawnSync(process.execPath, [
    'scripts/a2-p4-five-year-ingestion.mjs',
    '--library-root', libraryRoot,
    '--output-root', outputRoot,
    '--dry-run',
  ], {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
  })
  assert.equal(cli.status, 0, cli.stderr)
  const cliSummary = JSON.parse(cli.stdout)
  assert.equal(cliSummary.total, 3, 'direct worker execution must process the same constrained P4 queue')
  assert.ok(cliSummary.outcomes.every((outcome) => outcome.status === 'dry-run'))

  const currentRelease = path.join(root, 'current')
  fs.symlinkSync(path.resolve(import.meta.dirname, '..'), currentRelease, process.platform === 'win32' ? 'junction' : 'dir')
  const linkedCli = spawnSync(process.execPath, [
    path.join(currentRelease, 'scripts', 'a2-p4-five-year-ingestion.mjs'),
    '--library-root', libraryRoot,
    '--output-root', outputRoot,
    '--dry-run',
  ], {
    cwd: currentRelease,
    encoding: 'utf8',
  })
  assert.equal(linkedCli.status, 0, linkedCli.stderr)
  const linkedSummary = JSON.parse(linkedCli.stdout)
  assert.equal(linkedSummary.total, 3, 'worker must execute through a current release symlink')
  assert.ok(linkedSummary.outcomes.every((outcome) => outcome.status === 'dry-run'))
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(JSON.stringify({ status: 'passed', scope: '9702-p4-2021-2025' }))
