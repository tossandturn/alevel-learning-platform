import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { createAiVerifiedQuestionBankLoader, questionGroupsFromAiArtifacts } from '../server/aiVerifiedQuestionBank.js'
import { isAiMarkablePastPaperItem } from '../src/data/questionBank.js'
import { canonicalAiMarkingProvenance } from '../src/lib/sourceContentContract.js'
import {
  TRANSFORMATIONS_BINDING_V2_EVIDENCE_ROOT,
  TRANSFORMATIONS_BINDING_V2_MANIFEST,
  TRANSFORMATIONS_BINDING_V2_OUTPUT_ROOT,
} from './prepare-chapter-ready-0580-transformations-binding-v2.mjs'

const libraryRoot = 'D:/CodexWork/cie-fraft-fetcher/output/pdf'
const manifestPath = path.resolve(TRANSFORMATIONS_BINDING_V2_EVIDENCE_ROOT, TRANSFORMATIONS_BINDING_V2_MANIFEST)
const manifestShaPath = `${manifestPath}.sha256`

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const manifest = readJson(manifestPath)
const declaredManifestSha256 = fs.readFileSync(manifestShaPath, 'utf8').trim().split(/\s+/)[0]
assert.equal(sha256File(manifestPath), declaredManifestSha256)
assert.equal(manifest.status, 'PREPARED_UNPUBLISHED_PENDING_INDEPENDENT_REVIEW')
assert.equal(manifest.providerCalls, 0)
assert.equal(manifest.studentStudyEligible, false)
assert.equal(manifest.formalProgressEligible, false)
assert.equal(manifest.published, false)
assert.deepEqual(manifest.counts.components, { 1: 3, 3: 3 })
assert.equal(manifest.counts.questions, 6)
assert.equal(manifest.counts.parts, 13)
assert.equal(manifest.counts.marks, 30)
assert.equal(manifest.outputs.length, 6)

const artifacts = manifest.outputs.map((output) => {
  assert.equal(sha256File(output.artifact), output.artifactSha256, `v2 artifact hash drift for ${output.sourceQuestionId}`)
  assert.equal(sha256File(output.sourceArtifact), output.sourceArtifactSha256, `v1 source artifact changed for ${output.sourceQuestionId}`)
  assert.equal(output.partBindings.length, output.parts)
  const artifact = readJson(output.artifact)
  assert.equal(artifact.studentStudyEligible, false)
  assert.equal(artifact.formalProgressEligible, false)
  assert.equal(artifact.studentRelease, undefined)
  assert.equal(artifact.sourceReview, undefined)
  assert.equal(artifact.priorSourceReview.status, 'HISTORICAL_V1_REVIEW_NOT_AUTHORITY_FOR_V2_CONTENT_BINDING')
  assert.equal(artifact.bindingPreparation.providerCalls, 0)
  assert.equal(artifact.candidate.reviewSummary.studentRelease, false)
  assert.equal(artifact.verification.reviewSummary.studentRelease, false)
  return artifact
})

const groups = questionGroupsFromAiArtifacts(artifacts, { libraryRoot })
assert.equal(groups.length, 6)
assert.equal(groups.reduce((sum, group) => sum + group.parts.length, 0), 13)
assert.equal(groups.reduce((sum, group) => sum + group.totalMarks, 0), 30)
assert.ok(groups.every((group) => group.formalProgressEligible === false && group.studentStudyEligible === false))
for (const group of groups) {
  assert.equal(isAiMarkablePastPaperItem(group), true, 'exact local provenance may be validated before release')
  for (const part of group.parts) {
    const provenance = canonicalAiMarkingProvenance(group, part)
    assert.ok(provenance)
    assert.equal(provenance.sourceEvidence.partLabel, part.label)
    assert.equal(provenance.sourceEvidence.markSchemePage, part.answerSourcePage)
    assert.ok(Array.isArray(provenance.sourceEvidence.markSchemeRegion))
    assert.equal(part.answerKey, null)
    assert.deepEqual(part.options, [])
    assert.equal(part.markSchemeEvidence.length, 1)
    assert.equal(part.markSchemeEvidence[0].partLabels[0], part.label)
    assert.equal(part.markSchemeEvidence[0].text, undefined)
  }
}

const releasedLoader = createAiVerifiedQuestionBankLoader({
  artifactRoot: path.resolve(TRANSFORMATIONS_BINDING_V2_OUTPUT_ROOT),
  libraryRoot,
})()
assert.equal(releasedLoader.groups.length, 0, 'unpublished v2 artifacts must not enter the released runtime loader')
assert.equal(releasedLoader.documents.length, 0)

const q19 = groups.find((group) => group.sourceQuestionId === 'cie-0580-0580_w25_qp_12:q19')
const q19c = q19.parts.find((part) => part.label === 'c')
assert.equal(q19c.answerSourcePage, 9)
assert.equal(q19c.markSchemeEvidence[0].page, 9)
assert.equal(canonicalAiMarkingProvenance(q19, q19c).sourceEvidence.markSchemePage, 9)

const publicIndex = fs.readFileSync('public/data/study-question-index/cie-0580-igcse-mathematics.json', 'utf8')
for (const output of manifest.outputs) assert.equal(publicIndex.includes(output.sourceQuestionId), false)

console.log(JSON.stringify({
  status: 'pass',
  suite: 'chapter-ready-0580-transformations-binding-v2',
  manifest: manifestPath.replaceAll('\\', '/'),
  manifestSha256: declaredManifestSha256,
  questions: groups.length,
  parts: groups.reduce((sum, group) => sum + group.parts.length, 0),
  releasedRuntimeGroups: releasedLoader.groups.length,
  providerCalls: 0,
  published: false,
}))
