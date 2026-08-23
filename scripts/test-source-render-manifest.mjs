import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildSourceRenderManifest } from '../src/lib/sourceRenderManifest.js'

const question = {
  sourceRef: {
    paperId: 'paper-1',
    paper: 'paper-1.pdf',
    localUrl: '/local-pdf/9702/paper-1.pdf',
    sha256: 'a'.repeat(64),
    pageStart: 3,
    pageEnd: 4,
    assetUrls: [
      '/question-assets/paper-1/qp-03.jpg',
      '/question-assets/paper-1/qp-04.jpg',
    ],
  },
  parts: [
    {
      partId: 'paper-1:q1:part-a',
      sourcePage: 3,
      sourceEvidence: [{
        documentSha256: 'a'.repeat(64),
        page: 3,
        coordinateSpace: 'pixel-xyxy',
        imageSize: [1000, 2000],
        region: [100, 200, 800, 900],
      }],
    },
    {
      partId: 'paper-1:q1:part-b',
      sourcePage: 4,
      sourceRegion: {
        normalizedBounds: [0.2, 0.1, 0.9, 0.8],
        assetSha256: 'c'.repeat(64),
      },
    },
  ],
}

const manifest = buildSourceRenderManifest(question)
assert.equal(manifest.schemaVersion, 'source-render-manifest-v1')
assert.equal(manifest.sourcePdfUrl, '/local-pdf/9702/paper-1.pdf')
assert.equal(manifest.sourcePdfSha256, 'a'.repeat(64))
assert.deepEqual(manifest.pages.map((page) => page.page), [3, 4])
assert.deepEqual(manifest.pages[0].normalizedRegion, [0.1, 0.1, 0.8, 0.45])
assert.deepEqual(manifest.pages[1].normalizedRegion, [0.2, 0.1, 0.9, 0.8])
assert.equal(manifest.pages[0].exactRegion, true)
assert.equal(manifest.pages[1].exactRegion, true)
assert.deepEqual(manifest.parts.map((part) => part.partId), ['paper-1:q1:part-a', 'paper-1:q1:part-b'])

const mismatched = buildSourceRenderManifest({
  ...question,
  parts: [{
    partId: 'paper-1:q1:part-a',
    sourcePage: 3,
    sourceEvidence: [{
      documentSha256: 'b'.repeat(64),
      page: 3,
      coordinateSpace: 'pixel-xyxy',
      imageSize: [1000, 2000],
      region: [100, 200, 800, 900],
    }],
  }],
})
assert.deepEqual(mismatched.pages[0].normalizedRegion, [0, 0, 1, 1])
assert.equal(mismatched.pages[0].exactRegion, false)

const unboundLegacyRegion = buildSourceRenderManifest({
  ...question,
  parts: [{
    partId: 'paper-1:q1:part-a',
    sourcePage: 3,
    sourceRegion: { normalizedBounds: [0.2, 0.1, 0.9, 0.8] },
  }],
})
assert.deepEqual(unboundLegacyRegion.pages[0].normalizedRegion, [0, 0, 1, 1])
assert.equal(unboundLegacyRegion.pages[0].exactRegion, false)

const safetyTrimmed = buildSourceRenderManifest({
  ...question,
  parts: [{
    partId: 'paper-1:q1:part-a',
    sourcePage: 3,
    sourceEvidence: [{
      documentSha256: 'a'.repeat(64),
      page: 3,
      coordinateSpace: 'normalized-xyxy',
      normalizedRegion: [0.1, 0.1, 0.8, 0.5],
      imageSize: [1000, 2000],
      safetyMargin: [20, 20, 20, 20],
      safetyStatus: 'reviewed-display-bounds-v1',
    }],
  }],
})
assert.deepEqual(safetyTrimmed.pages[0].normalizedRegion, [0.1, 0.1, 0.8, 0.495])

const noRegion = buildSourceRenderManifest({
  sourceRef: { ...question.sourceRef, pageStart: 7, pageEnd: 7 },
  parts: [{ partId: 'paper-1:q2:part-a', sourcePage: 7 }],
})
assert.deepEqual(noRegion.pages.map((page) => page.page), [7])
assert.deepEqual(noRegion.pages[0].normalizedRegion, [0, 0, 1, 1])
assert.equal(noRegion.pages[0].exactRegion, false)

const externalPdf = buildSourceRenderManifest({
  sourceRef: { ...question.sourceRef, localUrl: 'https://untrusted.example/paper-1.pdf' },
  parts: question.parts,
})
assert.equal(externalPdf, null)

const rendererSource = fs.readFileSync(new URL('../src/components/SourceRegionRenderer.jsx', import.meta.url), 'utf8')
assert.doesNotMatch(rendererSource, /\.toDataURL\(/, 'PDF crops must not be retained as base64 data URLs')
assert.match(rendererSource, /\.toBlob\(/, 'PDF crops must use Blob URLs')
assert.match(rendererSource, /URL\.revokeObjectURL\(/, 'PDF crop Blob URLs must be released')
assert.doesNotMatch(rendererSource, /loadingTask\.destroy\(/, 'an already-loaded PDF worker must not be destroyed twice')
assert.match(rendererSource, /documentProxy\.destroy\(\)\.catch/, 'the loaded PDF document must be released safely')
assert.match(rendererSource, /onLoad=\{\(\) => handleFallbackLoad\(entry\.page\)\}/, 'JPG fallback must confirm that every page loaded')
assert.match(rendererSource, /onError=\{handleFallbackError\}/, 'a broken JPG fallback must block the question')

console.log(JSON.stringify({ passed: true, pages: manifest.pages.length, parts: manifest.parts.length }))
