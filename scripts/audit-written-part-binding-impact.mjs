import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const baselineRepo = path.resolve('D:/CodexWork/stem-integrated-release-20261004')
const candidateRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const batchRoot = path.resolve('D:/CodexWork/stem-ocr-work/postprocess-batches/chapter-20260927')
const libraryRoot = path.resolve('D:/CodexWork/cie-fraft-fetcher/output/pdf')
const outputArg = process.argv.find((value) => value.startsWith('--output='))?.slice('--output='.length)

const baselineLoader = await import(pathToFileURL(path.join(baselineRepo, 'server/aiVerifiedQuestionBank.js')).href)
const candidateLoader = await import(pathToFileURL(path.join(candidateRepo, 'server/aiVerifiedQuestionBank.js')).href)
const baselineContract = await import(pathToFileURL(path.join(baselineRepo, 'src/lib/sourceContentContract.js')).href)
const candidateContract = await import(pathToFileURL(path.join(candidateRepo, 'src/lib/sourceContentContract.js')).href)

function sortedIds(groups) {
  return groups.map((group) => `${group.routeId}:${group.sourceQuestionId}`).sort()
}

function partResults(groups, contract) {
  return groups.flatMap((group) => (group.parts || []).map((part) => ({
    routeId: group.routeId,
    sourceQuestionId: group.sourceQuestionId,
    partId: part.partId,
    label: part.label,
    component: Number(group.sourceRef?.component),
    multipart: group.parts.length > 1,
    ai: Boolean(contract.canonicalAiMarkingProvenance(group, part)),
    practice: Boolean(contract.canonicalSourcePracticeProvenance(group, part)),
  })))
}

const roots = fs.readdirSync(batchRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ batch: entry.name, artifactRoot: path.join(batchRoot, entry.name, 'reviewed-artifacts') }))
  .filter((entry) => fs.statSync(entry.artifactRoot, { throwIfNoEntry: false })?.isDirectory())
  .sort((left, right) => left.batch.localeCompare(right.batch))

const details = []
for (const entry of roots) {
  const baselineGroups = baselineLoader.createAiVerifiedQuestionBankLoader({ artifactRoot: entry.artifactRoot, libraryRoot })().groups
  const candidateGroups = candidateLoader.createAiVerifiedQuestionBankLoader({ artifactRoot: entry.artifactRoot, libraryRoot })().groups
  assert.deepEqual(sortedIds(candidateGroups), sortedIds(baselineGroups), `${entry.batch} question availability changed`)
  const before = partResults(baselineGroups, baselineContract)
  const after = new Map(partResults(candidateGroups, candidateContract).map((part) => [part.partId, part]))
  const affected = before.filter((part) => part.ai && !after.get(part.partId)?.ai)
  const practiceRegressions = before.filter((part) => part.practice && !after.get(part.partId)?.practice)
  assert.equal(practiceRegressions.length, 0, `${entry.batch} source-practice provenance changed`)
  if (baselineGroups.length || affected.length) {
    details.push({
      batch: entry.batch,
      artifactRoot: entry.artifactRoot.replaceAll('\\', '/'),
      localReleasedArtifactGroups: baselineGroups.length,
      localReleasedArtifactParts: before.length,
      candidateGroups: candidateGroups.length,
      normalQuestionAvailabilityPreserved: true,
      sourcePracticeProvenancePreserved: true,
      affectedAiMarkingParts: affected.length,
      affectedSourceQuestionIds: [...new Set(affected.map((part) => part.sourceQuestionId))].sort(),
      affectedParts: affected.map(({ sourceQuestionId, partId, label, component }) => ({ sourceQuestionId, partId, label, component })),
    })
  }
}

const affectedParts = details.reduce((sum, entry) => sum + entry.affectedAiMarkingParts, 0)
const affectedQuestionIds = [...new Set(details.flatMap((entry) => entry.affectedSourceQuestionIds))].sort()
const report = {
  schemaVersion: 'written-part-binding-impact-audit.v1',
  status: 'PASS_BOUNDED_LOCAL_ARTIFACT_IMPACT_AUDIT_NOT_PRODUCTION',
  baselineCommit: '692402f97ce3543b8f278de74b425dc5141dbf32',
  scopeKind: 'LOCAL_ONLY_APPROVED_CHAPTER_BATCH',
  scope: batchRoot.replaceAll('\\', '/'),
  rootsChecked: roots.length,
  batchesWithReleasedGroups: details.length,
  localReleasedArtifactGroups: details.reduce((sum, entry) => sum + entry.localReleasedArtifactGroups, 0),
  localReleasedArtifactParts: details.reduce((sum, entry) => sum + entry.localReleasedArtifactParts, 0),
  affectedAiMarkingGroups: affectedQuestionIds.length,
  affectedAiMarkingParts: affectedParts,
  normalQuestionAvailabilityPreserved: true,
  sourcePracticeProvenancePreserved: true,
  scopeLimit: 'Direct reviewed-artifacts roots under the approved chapter-20260927 batch only. These counts are not the production 542-file scope; no production or environment-derived artifact root was inspected.',
  details,
  productionModified: false,
}

assert.equal(report.affectedAiMarkingGroups, 11)
assert.equal(report.affectedAiMarkingParts, 30)
if (outputArg) {
  const output = path.resolve(outputArg)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
}
console.log(JSON.stringify(report))
