import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { CAMBRIDGE_9702_AS_SYLLABUS } from '../src/data/syllabus/cambridge-9702-as-2025-2027.js'
import { CAMBRIDGE_0580_IGCSE_SYLLABUS } from '../src/data/syllabus/cambridge-0580-igcse-2025-2027.js'
import { CAMBRIDGE_0625_IGCSE_SYLLABUS } from '../src/data/syllabus/cambridge-0625-igcse-2026-2028.js'
import { CAMBRIDGE_9709_AS_P1_S1_SYLLABUS } from '../src/data/syllabus/cambridge-9709-as-p1-s1-2026-2027.js'
import { AI_PDF_INGESTION_SCHEMA_VERSION } from './ai-pdf-ingestion/contract.mjs'
import {
  buildCropCommand,
  buildCropManifest,
  imageSha256,
} from './ai-pdf-ingestion/render.mjs'

export const AI_PDF_TOPIC_PACK_SCHEMA_VERSION = 'ai-pdf-topic-pack.v1'

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

const syllabuses = Object.freeze({
  '0580': CAMBRIDGE_0580_IGCSE_SYLLABUS,
  '0625': CAMBRIDGE_0625_IGCSE_SYLLABUS,
  '9702': CAMBRIDGE_9702_AS_SYLLABUS,
  '9709': CAMBRIDGE_9709_AS_P1_S1_SYLLABUS,
})

export function parseArgs(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const values = {}
  const flags = new Set(['--dry-run'])
  const options = new Set(['--artifact-root', '--output-root', '--subject', '--topic-id'])

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

  const subject = values['--subject'] || '9702'
  if (!SAFE_SEGMENT.test(subject) || !syllabuses[subject]) throw codedError('UNSUPPORTED_SUBJECT')
  const topicId = values['--topic-id'] || ''
  if (topicId && !officialTopicById(subject).has(topicId)) throw codedError('OFFICIAL_TOPIC_INVALID')

  return Object.freeze({
    artifactRoot: path.resolve(cwd, values['--artifact-root'] ?? env.AI_PDF_INGESTION_ROOT ?? DEFAULT_ARTIFACT_ROOT),
    outputRoot: path.resolve(cwd, values['--output-root'] ?? env.AI_PDF_TOPIC_PACK_ROOT ?? DEFAULT_OUTPUT_ROOT),
    subject,
    topicId,
    dryRun: values['--dry-run'] === true,
  })
}

export async function runTopicPack(options, {
  artifactPaths = discoverArtifactPaths,
  runCropCommand = runProcessForCrop,
  mergePdfs = mergePdfFiles,
  writeJson = writeJsonSafely,
} = {}) {
  const officialTopics = officialTopicById(options.subject)
  const topicGroups = new Map([...officialTopics.keys()].map(topicId => [topicId, []]))
  const skipped = []

  for (const artifactPath of artifactPaths(options.artifactRoot)) {
    let artifact
    try {
      artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
    } catch {
      skipped.push({ artifactPath, reason: 'artifact-json-invalid' })
      continue
    }
    for (const result of entriesForArtifact({ artifact, artifactPath, officialTopics, options })) {
      if (result.skip) {
        skipped.push(result.skip)
      } else {
        topicGroups.get(result.entry.topicId).push(result.entry)
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
    const topicDirectory = path.join(options.outputRoot, options.subject, topicId)
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
      subject: options.subject,
      topic: {
        id: topic.id,
        code: topic.code,
        name: topic.name,
        order: topic.order,
        syllabusVersion: topic.syllabusVersion,
        officialPage: topic.officialPage,
        officialUrl: syllabuses[options.subject].officialUrl,
      },
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
    subject: options.subject,
    officialSyllabus: {
      routeId: syllabuses[options.subject].routeId,
      version: syllabuses[options.subject].syllabusVersion,
      officialUrl: syllabuses[options.subject].officialUrl,
    },
    packs,
    skipped,
  }
}

function* entriesForArtifact({ artifact, artifactPath, officialTopics, options }) {
  if (artifact?.schemaVersion !== AI_PDF_INGESTION_SCHEMA_VERSION || artifact?.status !== 'ai-verified') return
  if (artifact.subject !== options.subject) {
    yield { skip: { artifactPath, artifactId: artifact.artifactId, reason: 'subject-mismatch' } }
    return
  }
  const source = artifact.source || {}
  if (!source.questionPdfPath || !source.questionPdfSha256 || !source.markSchemePdfSha256 || !source.pageSizes) {
    yield { skip: { artifactPath, artifactId: artifact.artifactId, reason: 'missing-rerender-metadata' } }
    return
  }
  if (!fs.statSync(source.questionPdfPath, { throwIfNoEntry: false })?.isFile()) {
    yield { skip: { artifactPath, artifactId: artifact.artifactId, reason: 'source-question-pdf-missing' } }
    return
  }
  if (normalizeSha256(source.questionPdfSha256) !== fileSha256(source.questionPdfPath)) {
    yield { skip: { artifactPath, artifactId: artifact.artifactId, reason: 'source-question-pdf-hash-mismatch' } }
    return
  }

  for (const question of artifact.candidate?.questions || []) {
    const topicId = question?.tags?.primaryTopicId
    if (!officialTopics.has(topicId)) {
      yield { skip: { artifactPath, artifactId: artifact.artifactId, questionNumber: question?.questionNumber, reason: 'official-topic-missing' } }
      continue
    }
    if (options.topicId && topicId !== options.topicId) continue
    const regions = [...(question.regions || []), ...(question.diagramRegions || [])]
    if (!regions.length) {
      yield { skip: { artifactPath, artifactId: artifact.artifactId, questionNumber: question?.questionNumber, reason: 'regions-missing' } }
      continue
    }
    yield {
      entry: {
        artifactId: artifact.artifactId,
        paperId: artifact.paperId,
        questionId: `${artifact.paperId}:q${question.questionNumber}`,
        questionNumber: question.questionNumber,
        topicId,
        tags: question.tags,
        parts: (question.parts || []).map(part => ({ label: part.label, marks: part.marks, math: part.math || [] })),
        regions,
        diagramRegions: question.diagramRegions || [],
        markSchemeEvidence: question.markSchemeEvidence || [],
        pageSizes: source.pageSizes,
        sourceQuestionPdfPath: source.questionPdfPath,
        sourceQuestionPdfSha256: normalizeSha256(source.questionPdfSha256),
        sourceMarkSchemePdfSha256: normalizeSha256(source.markSchemePdfSha256),
      },
    }
  }
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

function officialTopicById(subject) {
  return new Map(syllabuses[subject].topics.map(topic => [topic.id, topic]))
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
