import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { renderCandidateSourcePage } from './chapter-ready-source-page-renderer.mjs'

const pdfPath = path.resolve('D:/CodexWork/cie-fraft-fetcher/output/pdf/9700/9700_s25_qp_12.pdf')
const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-cell-membranes-poppler-'))
assert.equal(path.dirname(path.resolve(outputRoot)), path.resolve(os.tmpdir()), 'cleanup root must stay inside the OS temp directory')

try {
  const page = renderCandidateSourcePage({
    renderer: 'poppler-png',
    pdfPath,
    expectedPdfSha256: 'e6f95f47e51486f404ff5636d5dbfe9bd0e0dc3aebf4a13a0b8f358cfdd20461',
    page: 10,
    dpi: 180,
    outputRoot,
    expectedImageSha256: 'aa56d92bafd98b136fde78ed7c5e0fbae4e249e1713570c9df2dd3660672348e',
    expectedWidth: 1488,
    expectedHeight: 2105,
  })

  assert.equal(page.renderer, 'poppler-png')
  assert.equal(page.page, 10)
  assert.equal(page.dpi, 180)
  assert.equal(page.width, 1488)
  assert.equal(page.height, 2105)
  assert.equal(page.sha256, 'aa56d92bafd98b136fde78ed7c5e0fbae4e249e1713570c9df2dd3660672348e')
  assert.equal(fs.existsSync(page.path), true)
  assert.equal(fs.statSync(page.path).size, 116851)
  assert.equal(fs.readdirSync(outputRoot).length, 1, 'one page render must create exactly one PNG')

  assert.throws(() => renderCandidateSourcePage({
    renderer: 'poppler-png',
    pdfPath,
    expectedPdfSha256: '0'.repeat(64),
    page: 10,
    dpi: 180,
    outputRoot: path.join(outputRoot, 'mismatch'),
    expectedImageSha256: 'aa56d92bafd98b136fde78ed7c5e0fbae4e249e1713570c9df2dd3660672348e',
    expectedWidth: 1488,
    expectedHeight: 2105,
  }), /PDF SHA-256 mismatch/)
} finally {
  fs.rmSync(outputRoot, { recursive: true, force: true })
}

console.log(JSON.stringify({
  status: 'PASS_CHAPTER_READY_SOURCE_PAGE_RENDERER',
  renderer: 'poppler-png',
  page: 10,
  sha256: 'aa56d92bafd98b136fde78ed7c5e0fbae4e249e1713570c9df2dd3660672348e',
  dimensions: [1488, 2105],
}))
