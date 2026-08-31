import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { routeById } from '../src/data/routeRegistry.js'
import { syllabusPracticeComponentsForRoute, supportsSyllabusPracticeRoute } from '../src/lib/syllabusPracticeRoutes.js'
import {
  AI_PDF_INGESTION_SCHEMA_VERSION,
  hasValidAiStudentStudyRelease,
  resolveArtifactSourcePdfPath,
} from './ai-pdf-ingestion/contract.mjs'
import {
  buildCropCommand,
  buildCropManifest,
  imageSha256,
} from './ai-pdf-ingestion/render.mjs'

export const AI_PDF_TOPIC_PACK_SCHEMA_VERSION = 'ai-pdf-topic-pack.v2'

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const DEFAULT_ARTIFACT_ROOT = 'data/ai-pdf-ingestion'
const DEFAULT_OUTPUT_ROOT = 'data/ai-pdf-topic-packs'
const PDF_MERGE_PROGRAM = [
  'from pypdf import PdfReader, PdfWriter',
  'import sys',
  'out = sys.argv[1]',
  'inputs = sys.argv[2:]',
  'writer = PdfWriter()',
  'for item in inputs:',
  '    reader = PdfReader(item)',
  '    for page in reader.pages:',
  '        writer.add_page(page)',
  'with open(out, "wb") as stream:',
  '    writer.write(stream)',
].join('\n')

export function parseArgs(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const values = {}
  const flags = new Set(['--dry-run'])
  const options = new Set(['--artifact-root', '--library-root', '--output-root', '--route-id', '--subject', '--topic-id'])

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (flags.has(argument)) {
      if (values[argument]) throw new RangeError(`${argument} may only be provided once.`)
      values[argument] = true
      continue
    }
    if (!options.has(argument)) throw new RangeError(`Unknown argument: ${String(argument)}`)
    if (Object.hasOwn(values, argument)) throw new RangeError(`${argument} may only be provided once.`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new RangeError(`${argument} requires a value.`)
    values[argument] = value
    index += 1
  }

  const routeId = values['--route-id'] || ''
  if (!routeId) throw codedError('ROUTE_ID_REQUIRED')
  if (!SAFE_SEGMENT.test(routeId) || !supportsSyllabusPracticeRoute(routeId)) throw codedError('UNSUPPORTED_ROUTE')
  const route = routeById(routeId)
  if (!route?.subjectCode || !Array.isArray(route?.syllabus?.topics)) throw codedError('UNSUPPORTED_ROUTE')
  const subject = values['--subject'] || route.subjectCode
  if (!SAFE_SEGMENT.test(subject)) throw codedError('UNSUPPORTED_SUBJECT')
  if (subject !== route.subjectCode) throw codedError('ROUTE_SUBJECT_MISMATCH')
  const topicId = values['--topic-id'] || ''
  if (topicId && !officialTopicById(route).has(topicId)) throw codedError('OFFICIAL_TOPIC_INVALID')
  const dryRun = values['--dry-run'] === true
  if (!dryRun && !topicId) throw codedError('TOPIC_ID_REQUIRED')

  return Object.freeze({
    artifactRoot: path.resolve(cwd, values['--artifact-root'] ?? env.AI_PDF_INGESTION_ROOT ?? DEFAULT_ARTIFACT_ROOT),
    libraryRoot: values['--library-root'] || env.CIE_LIBRARY_ROOT
      ? path.resolve(cwd, values['--library-root'] ?? env.CIE_LIBRARY_ROOT)
      : null,
    outputRoot: path.resolve(cwd, values['--output-root'] ?? env.AI_PDF_TOPIC_PACK_ROOT ?? DEFAULT_OUTPUT_ROOT),
    routeId,
    subject,
    topicId,
    dryRun,
  })
}

export async function runTopicPack(options, {
  artifactPaths = discoverArtifactPaths,
  runCropCommand = runProcessForCrop,
  mergePdfs = mergePdfFiles,
  writeJson = writeJsonSafely,
} = {}) {
  const route = routeById(options.routeId)
  if (!route || route.subjectCode !== options.subject || !supportsSyllabusPracticeRoute(route.routeId)) throw codedError('UNSUPPORTED_ROUTE')
  const officialTopics = officialTopicById(route)
  const topicGroups = new Map([...officialTopics.keys()].map(topicId => [topicId, []]))
  const skipped = []

  const artifactRecords = []
  const selectedArtifacts = new Map()
  for (const artifactPath of artifactPaths(options.artifactRoot)) {
    let artifact
    try {
      artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
    } catch {
      skipped.push({ artifactPath, reason: 'artifact-json-invalid' })
      continue
    }
    const dedupeKey = eligibleArtifactDedupeKey(artifact, options, route)
    if (!dedupeKey) {
      artifactRecords.push({ artifactPath, artifact })
      continue
    }
    const current = selectedArtifacts.get(dedupeKey)
    const candidate = { artifactPath, artifact }
    if (!current || compareArtifactRecords(candidate, current, route.routeId) > 0) {
      if (current) skipped.push({
        artifactPath: current.artifactPath,
        artifactId: current.artifact.artifactId,
        reason: 'duplicate-artifact-superseded',
      })
      selectedArtifacts.set(dedupeKey, candidate)
    } else {
      skipped.push({ artifactPath, artifactId: artifact.artifactId, reason: 'duplicate-artifact-superseded' })
    }
  }

  artifactRecords.push(...selectedArtifacts.values())
  for (const { artifactPath, artifact } of artifactRecords) {
    for (const result of entriesForArtifact({ artifact, artifactPath, officialTopics, options, route })) {
      if (result.skip) {
        skipped.push(result.skip)
      } else {
        for (const topicId of result.entry.topicIds || [result.entry.topicId]) {
          if (!topicGroups.has(topicId)) continue
          topicGroups.get(topicId).push({ ...result.entry, topicId })
        }
      }
    }
  }

  const packs = []
  for (const [topicId, entries] of topicGroups) {
    if (options.topicId && topicId !== options.topicId) continue
    if (!entries.length) continue
    entries.sort((left, right) => left.paperId.localeCompare(right.paperId)
      || naturalQuestionNumber(left.questionNumber) - naturalQuestionNumber(right.questionNumber)
      || left.questionId.localeCompare(right.questionId))
    const topic = officialTopics.get(topicId)
    const topicDirectory = path.join(options.outputRoot, options.routeId, topicId)
    const questionOutputRoot = path.join(topicDirectory, 'questions')
    const questionPdfs = []
    const questions = []

    for (const entry of entries) {
      const manifest = buildCropManifest({
        paperId: entry.paperId,
        questionId: entry.questionId,
        sourcePdfPath: entry.sourceQuestionPdfPath,
        sourcePdfSha256: entry.sourceQuestionPdfSha256,
        regions: entry.regions,
        pageSizes: entry.pageSizes,
        outputRoot: questionOutputRoot,
      })
      questions.push({
        questionId: entry.questionId,
        paperId: entry.paperId,
        artifactId: entry.artifactId,
        questionNumber: entry.questionNumber,
        topicId,
        topicCode: topic.code,
        topicName: topic.name,
        parts: entry.parts,
        tags: entry.tags,
        regions: entry.regions,
        diagramRegions: entry.diagramRegions,
        markSchemeEvidence: entry.markSchemeEvidence,
        source: {
          questionPdfSha256: entry.sourceQuestionPdfSha256,
          markSchemePdfSha256: entry.sourceMarkSchemePdfSha256,
          pages: [...new Set(entry.regions.map(region => region.page))].sort((left, right) => left - right),
        },
        generatedQuestionPdfPath: manifest.questionPdfPath,
      })
      if (!options.dryRun) {
        await runCropCommand(buildCropCommand(manifest), manifest)
        if (!fs.statSync(manifest.questionPdfPath, { throwIfNoEntry: false })?.isFile()) throw codedError('TOPIC_CROP_FAILED')
      }
      questionPdfs.push(manifest.questionPdfPath)
    }

    const topicPdfPath = path.join(topicDirectory, 'topic.pdf')
    const manifestPath = path.join(topicDirectory, 'manifest.json')
    const manifest = {
      schemaVersion: AI_PDF_TOPIC_PACK_SCHEMA_VERSION,
      routeId: options.routeId,
      subject: options.subject,
      topic: {
        id: topic.id,
        code: topic.code,
        name: topic.name,
        order: topic.order,
        syllabusVersion: topic.syllabusVersion,
        officialPage: topic.officialPage,
        officialUrl: route.syllabus.url,
      },
      renderMode: 'on-demand-coordinate-only',
      generatedAt: new Date().toISOString(),
      questionCount: questions.length,
      topicPdfPath,
      topicPdfSha256: null,
      questions,
    }
    if (!options.dryRun) {
      fs.mkdirSync(topicDirectory, { recursive: true })
      await mergePdfs(topicPdfPath, questionPdfs)
      manifest.topicPdfSha256 = imageSha256(topicPdfPath)
      writeJson(manifestPath, manifest, options.outputRoot)
    }
    packs.push({
      topicId,
      topicName: topic.name,
      questionCount: questions.length,
      topicPdfPath,
      manifestPath,
      topicPdfSha256: manifest.topicPdfSha256,
    })
  }

  return {
    schemaVersion: AI_PDF_TOPIC_PACK_SCHEMA_VERSION,
    routeId: options.routeId,
    subject: options.subject,
    officialSyllabus: {
      routeId: route.routeId,
      version: route.syllabus.version,
      officialUrl: route.syllabus.url,
    },
    packs,
    skipped,
  }
}

function eligibleArtifactDedupeKey(artifact, options, route) {
  if (artifact?.schemaVersion !== AI_PDF_INGESTION_SCHEMA_VERSION
    || artifact?.status !== 'ai-verified'
    || artifact?.storageMode !== 'coordinate-only'
    || !hasValidAiStudentStudyRelease(artifact)
    || artifact.subject !== options.subject
    || artifact.syllabusRouteId !== options.routeId
    || String(artifact.stage || '').toUpperCase() !== route.stage
    || typeof artifact.paperId !== 'string'
    || !artifact.paperId.trim()) return null
  return `${artifact.paperId.trim()}::${artifact.syllabusRouteId}`
}

function compareArtifactRecords(left, right, routeId) {
  const leftGeneratedAt = validTimestamp(left.artifact.generatedAt)
  const rightGeneratedAt = validTimestamp(right.artifact.generatedAt)
  if (leftGeneratedAt !== rightGeneratedAt) return leftGeneratedAt - rightGeneratedAt

  const leftQuestionCount = Array.isArray(left.artifact.candidate?.questions)
    ? left.artifact.candidate.questions.length : 0
  const rightQuestionCount = Array.isArray(right.artifact.candidate?.questions)
    ? right.artifact.candidate.questions.length : 0
  if (leftQuestionCount !== rightQuestionCount) return leftQuestionCount - rightQuestionCount

  const routeSuffix = `--route-${routeId}.json`
  const leftRouteSpecific = left.artifactPath.endsWith(routeSuffix) ? 1 : 0
  const rightRouteSpecific = right.artifactPath.endsWith(routeSuffix) ? 1 : 0
  if (leftRouteSpecific !== rightRouteSpecific) return leftRouteSpecific - rightRouteSpecific
  return left.artifactPath.localeCompare(right.artifactPath)
}

function validTimestamp(value) {
  const parsed = Date.parse(typeof value === 'string' ? value : '')
  return Number.isFinite(parsed) ? parsed : 0
}

function* entriesForArtifact({ artifact, artifactPath, officialTopics, options, route }) {
  if (artifact?.schemaVersion !== AI_PDF_INGESTION_SCHEMA_VERSION
    || artifact?.status !== 'ai-verified'
    || artifact?.storageMode !== 'coordinate-only') {
    yield { skip: { artifactPath, artifactId: artifact?.artifactId, reason: 'artifact-not-coordinate-verified' } }
    return
  }
  if (!hasValidAiStudentStudyRelease(artifact)) {
    yield { skip: { artifactPath, artifactId: artifact.artifactId, reason: 'student-release-invalid' } }
    return
  }
  if (artifact.subject !== options.subject) {
    yield { skip: { artifactPath, artifactId: artifact.artifactId, reason: 'subject-mismatch' } }
    return
  }
  if (artifact.syllabusRouteId !== options.routeId || String(artifact.stage || '').toUpperCase() !== route.stage) {
    yield { skip: { artifactPath, artifactId: artifact.artifactId, reason: 'route-mismatch' } }
    return
  }
  const source = artifact.source || {}
  const questionPdfPath = resolveArtifactSourcePdfPath({
    source,
    absoluteField: 'questionPdfPath',
    relativeField: 'questionPdfRelativePath',
    libraryRoot: options.libraryRoot,
    subjectCode: options.subject,
  })
  const markSchemePdfPath = resolveArtifactSourcePdfPath({
    source,
    absoluteField: 'markSchemePdfPath',
    relativeField: 'markSchemePdfRelativePath',
    libraryRoot: options.libraryRoot,
    subjectCode: options.subject,
  })
  if (!questionPdfPath || !markSchemePdfPath || !source.questionPdfSha256 || !source.markSchemePdfSha256
    || !source.pageSizes || !source.markSchemePageSizes) {
    yield { skip: { artifactPath, artifactId: artifact.artifactId, reason: 'missing-rerender-metadata' } }
    return
  }
  if (!fs.statSync(questionPdfPath, { throwIfNoEntry: false })?.isFile()) {
    yield { skip: { artifactPath, artifactId: artifact.artifactId, reason: 'source-question-pdf-missing' } }
    return
  }
  if (!fs.statSync(markSchemePdfPath, { throwIfNoEntry: false })?.isFile()) {
    yield { skip: { artifactPath, artifactId: artifact.artifactId, reason: 'source-mark-scheme-pdf-missing' } }
    return
  }
  if (normalizeSha256(source.questionPdfSha256) !== fileSha256(questionPdfPath)) {
    yield { skip: { artifactPath, artifactId: artifact.artifactId, reason: 'source-question-pdf-hash-mismatch' } }
    return
  }
  if (normalizeSha256(source.markSchemePdfSha256) !== fileSha256(markSchemePdfPath)) {
    yield { skip: { artifactPath, artifactId: artifact.artifactId, reason: 'source-mark-scheme-pdf-hash-mismatch' } }
    return
  }
  const paper = pairedPaperMetadata(questionPdfPath, markSchemePdfPath)
  if (!paper || paper.subject !== options.subject || paper.paperId !== artifact.paperId
    || !syllabusPracticeComponentsForRoute(options.routeId).includes(paper.component)) {
    yield { skip: { artifactPath, artifactId: artifact.artifactId, reason: 'paper-component-mismatch' } }
    return
  }

  const verificationByNumber = new Map((artifact.verification?.questions || [])
    .map(question => [String(question?.questionNumber || ''), question]))
  for (const question of artifact.candidate?.questions || []) {
    const questionNumber = String(question?.questionNumber || '')
    const topicId = String(question?.tags?.primaryTopicId || '')
    if (!officialTopics.has(topicId)) {
      yield { skip: { artifactPath, artifactId: artifact.artifactId, questionNumber: question?.questionNumber, reason: 'official-topic-missing' } }
      continue
    }
    const topic = officialTopics.get(topicId)
    const secondaryTopicIds = sortedStrings(question?.tags?.secondaryTopicIds)
    const taggedTopicIds = [topicId, ...secondaryTopicIds]
    if (options.topicId && !taggedTopicIds.includes(options.topicId)) continue
    const regions = renderRegionsForQuestion(question).filter(region => validRegion(region, source.pageSizes))
    if (!regions.length) {
      yield { skip: { artifactPath, artifactId: artifact.artifactId, questionNumber: question?.questionNumber, reason: 'regions-missing' } }
      continue
    }
    if (Number.isInteger(Number(topic.component)) && Number(topic.component) !== paper.component) {
      yield { skip: { artifactPath, artifactId: artifact.artifactId, questionNumber, reason: 'topic-component-mismatch' } }
      continue
    }
    if (new Set(taggedTopicIds).size !== taggedTopicIds.length
      || secondaryTopicIds.some((secondaryTopicId) => !officialTopics.has(secondaryTopicId))) {
      yield { skip: { artifactPath, artifactId: artifact.artifactId, questionNumber, reason: 'official-topic-binding-invalid' } }
      continue
    }
    if (secondaryTopicIds.some((secondaryTopicId) => {
      const secondaryTopic = officialTopics.get(secondaryTopicId)
      return Number.isInteger(Number(secondaryTopic?.component)) && Number(secondaryTopic.component) !== paper.component
    })) {
      yield { skip: { artifactPath, artifactId: artifact.artifactId, questionNumber, reason: 'topic-component-mismatch' } }
      continue
    }
    if (!validOfficialPointBinding(question?.tags?.syllabusPointIds, taggedTopicIds, officialTopics)) {
      yield { skip: { artifactPath, artifactId: artifact.artifactId, questionNumber, reason: 'official-point-missing' } }
      continue
    }
    const verification = verificationByNumber.get(questionNumber)
    if (!sameQuestionReview(question, verification, regions, source.markSchemePageSizes)) {
      yield { skip: { artifactPath, artifactId: artifact.artifactId, questionNumber, reason: 'review-binding-mismatch' } }
      continue
    }
    yield {
      entry: {
        artifactId: artifact.artifactId,
        paperId: artifact.paperId,
         questionId: `${artifact.paperId}:q${questionNumber}`,
         questionNumber,
         topicId,
         topicIds: taggedTopicIds,
         tags: question.tags,
        parts: (question.parts || []).map(part => ({ label: part.label, marks: part.marks, math: part.math || [] })),
        regions,
        diagramRegions: question.diagramRegions || [],
        markSchemeEvidence: question.markSchemeEvidence || [],
        pageSizes: source.pageSizes,
        sourceQuestionPdfPath: questionPdfPath,
        sourceQuestionPdfSha256: normalizeSha256(source.questionPdfSha256),
        sourceMarkSchemePdfPath: markSchemePdfPath,
        sourceMarkSchemePdfSha256: normalizeSha256(source.markSchemePdfSha256),
      },
    }
  }
}

function pairedPaperMetadata(questionPdfPath, markSchemePdfPath) {
  const questionFile = path.basename(questionPdfPath)
  const markSchemeFile = path.basename(markSchemePdfPath)
  const match = /^(\d{4})_([msw])(\d{2})_qp_([1-6])(\d)\.pdf$/i.exec(questionFile)
  if (!match || markSchemeFile.toLowerCase() !== questionFile.replace(/_qp_/i, '_ms_').toLowerCase()) return null
  return Object.freeze({
    subject: match[1],
    component: Number(match[4]),
    paperId: `cie-${match[1]}-${questionFile.replace(/\.pdf$/i, '')}`,
  })
}

function validRegion(region, pageSizes) {
  const page = Number(region?.page)
  const size = pageSizes?.[page]
  const coordinates = ['x0', 'y0', 'x1', 'y1'].map(field => Number(region?.[field]))
  if (!Number.isInteger(page) || page < 1 || !size || !normalizeSha256(region?.pageImageSha256)) return false
  if (!Number.isFinite(Number(size.width)) || !Number.isFinite(Number(size.height))) return false
  const [x0, y0, x1, y1] = coordinates
  return coordinates.every(Number.isFinite) && x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1 && x0 < x1 && y0 < y1
}

function sameRegion(left, right) {
  return Number(left?.page) === Number(right?.page)
    && ['x0', 'y0', 'x1', 'y1'].every(field => Number(left?.[field]) === Number(right?.[field]))
}

function regionContains(outer, inner) {
  return Number(outer?.page) === Number(inner?.page)
    && Number(outer?.x0) <= Number(inner?.x0)
    && Number(outer?.y0) <= Number(inner?.y0)
    && Number(outer?.x1) >= Number(inner?.x1)
    && Number(outer?.y1) >= Number(inner?.y1)
}

function renderRegionsForQuestion(question) {
  const questionRegions = Array.isArray(question?.regions) ? question.regions.filter(Boolean) : []
  const diagramRegions = Array.isArray(question?.diagramRegions) ? question.diagramRegions.filter(Boolean) : []
  const result = [...questionRegions]
  for (const diagram of diagramRegions) {
    if (questionRegions.some(region => regionContains(region, diagram))) continue
    if (!result.some(region => sameRegion(region, diagram))) result.push(diagram)
  }
  return result
}

function normalizedEvidence(value, pageSizes) {
  if (!Array.isArray(value) || !value.length) return null
  const normalized = value.map((entry) => {
    const page = Number(entry?.page)
    const pageImageSha256 = normalizeSha256(entry?.pageImageSha256)
    if (!Number.isInteger(page) || page < 1 || !pageSizes?.[page] || !pageImageSha256) return null
    return { page, pageImageSha256 }
  })
  return normalized.every(Boolean) ? normalized : null
}

function normalizedParts(value) {
  if (!Array.isArray(value) || !value.length) return null
  const parts = value.map(part => ({ label: String(part?.label || '').trim(), marks: Number(part?.marks) }))
  return parts.every(part => part.label && Number.isInteger(part.marks) && part.marks > 0) ? parts : null
}

function sortedStrings(value) {
  return Array.isArray(value) ? [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].sort() : []
}

function sameQuestionReview(candidate, verification, regions, markSchemePageSizes) {
  if (!verification || String(candidate?.questionNumber || '') !== String(verification?.questionNumber || '')) return false
  const candidateParts = normalizedParts(candidate?.parts)
  const verifiedParts = normalizedParts(verification?.parts)
  if (!candidateParts || !verifiedParts || JSON.stringify(candidateParts) !== JSON.stringify(verifiedParts)) return false
  if (String(candidate?.tags?.primaryTopicId || '') !== String(verification?.tags?.primaryTopicId || '')) return false
  for (const field of ['secondaryTopicIds', 'syllabusPointIds']) {
    if (JSON.stringify(sortedStrings(candidate?.tags?.[field])) !== JSON.stringify(sortedStrings(verification?.tags?.[field]))) return false
  }
  const candidateEvidence = normalizedEvidence(candidate?.markSchemeEvidence, markSchemePageSizes)
  const verifiedEvidence = normalizedEvidence(verification?.markSchemeEvidence, markSchemePageSizes)
  if (!candidateEvidence || !verifiedEvidence || JSON.stringify(candidateEvidence) !== JSON.stringify(verifiedEvidence)) return false
  const expectedPages = [...new Set(regions.map(region => Number(region.page)))].sort((left, right) => left - right)
  const verifiedPages = [...new Set((verification?.pages || []).map(Number))].sort((left, right) => left - right)
  return JSON.stringify(expectedPages) === JSON.stringify(verifiedPages)
}

function validOfficialPointBinding(pointIds, topicIds, officialTopics) {
  const officialPointIds = new Set(topicIds
    .map(topicId => officialTopics.get(topicId))
    .flatMap(topic => topic?.points || [])
    .map(point => String(point?.id || ''))
    .filter(Boolean))
  const selectedPointIds = sortedStrings(pointIds)
  if (!officialPointIds.size) return selectedPointIds.length === 0
  return selectedPointIds.length > 0 && selectedPointIds.every(pointId => officialPointIds.has(pointId))
}

function discoverArtifactPaths(root) {
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) return []
  const paths = []
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(fullPath)
      else if (entry.isFile() && entry.name.endsWith('.json')) paths.push(fullPath)
    }
  }
  return paths.sort()
}

async function runProcessForCrop(command, manifest) {
  fs.mkdirSync(manifest.outputDirectory, { recursive: true })
  await runProcess(command.command, command.args)
}

async function mergePdfFiles(outputPath, inputPaths) {
  if (!inputPaths.length) throw codedError('TOPIC_PDF_EMPTY')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const executable = process.platform === 'win32' ? 'py' : 'python3'
  const args = process.platform === 'win32'
    ? ['-3.12', '-c', PDF_MERGE_PROGRAM, outputPath, ...inputPaths]
    : ['-c', PDF_MERGE_PROGRAM, outputPath, ...inputPaths]
  await runProcess(executable, args)
}

function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true })
    child.once('error', () => reject(codedError('TOPIC_PROCESS_FAILED')))
    child.once('exit', code => code === 0 ? resolve() : reject(codedError('TOPIC_PROCESS_FAILED')))
  })
}

function writeJsonSafely(outputPath, value, root) {
  const target = path.resolve(outputPath)
  assertPathWithinRoot(path.resolve(root), target)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporaryPath = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`)
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
  fs.renameSync(temporaryPath, target)
}

function officialTopicById(route) {
  return new Map((route?.syllabus?.topics || []).map(topic => [topic.id, topic]))
}

function naturalQuestionNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER
}

function fileSha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function normalizeSha256(value) {
  const match = typeof value === 'string' ? /^(?:sha256:)?([a-fA-F0-9]{64})$/.exec(value) : null
  return match ? match[1].toLowerCase() : ''
}

function assertPathWithinRoot(root, target) {
  const relative = path.relative(root, target)
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new RangeError('Output path must remain below --output-root.')
}

function codedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

async function main() {
  try {
    const result = await runTopicPack(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stderr.write(`${typeof error?.code === 'string' ? error.code : 'TOPIC_PACK_FAILED'}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
