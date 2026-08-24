import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs as parseIngestionArgs, runCli as runIngestionCli } from './ingest-ai-pdf-questions.mjs'
import { selectA2P4FiveYearPairs } from './ai-pdf-ingestion/a2-p4-five-year.mjs'

const SUBJECT = '9702'
const FIRST_YEAR = 2021
const LAST_YEAR = 2025
const DEFAULT_RENDER_DPI = 180
const PAGE_WINDOW_MAX_ATTEMPTS = 1
const PAGE_WINDOW_TIMEOUT_MS = 60000
const PAGE_WINDOW_PAPER_TIMEOUT_MS = 900000

function requiredDirectory(value, label) {
  const directory = path.resolve(String(value || ''))
  const stat = fs.statSync(directory, { throwIfNoEntry: false })
  if (!stat?.isDirectory()) throw new RangeError(`${label} must be an existing directory.`)
  return directory
}

function positiveInteger(value, label) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw new RangeError(`${label} must be a positive integer.`)
  return number
}

function optionValue(argv, option) {
  const index = argv.indexOf(option)
  if (index < 0) return null
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new RangeError(`${option} requires a value.`)
  return value
}

export function parseA2P4FiveYearArgs(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env } = {}) {
  const args = Array.isArray(argv) ? argv : []
  const allowed = new Set(['--library-root', '--output-root', '--render-dpi', '--retry', '--dry-run'])
  for (const argument of args) {
    if (argument.startsWith('--') && !allowed.has(argument)) throw new RangeError(`Unknown argument: ${argument}`)
  }
  const libraryRoot = requiredDirectory(optionValue(args, '--library-root') || env.CIE_LIBRARY_ROOT, '--library-root or CIE_LIBRARY_ROOT')
  const configuredOutputRoot = optionValue(args, '--output-root') || env.AI_PDF_INGESTION_ROOT || path.join(cwd, 'data', 'ai-pdf-ingestion')
  const outputRoot = path.resolve(cwd, configuredOutputRoot)
  const renderDpi = positiveInteger(optionValue(args, '--render-dpi') || DEFAULT_RENDER_DPI, '--render-dpi')
  if (renderDpi < 72 || renderDpi > 300) throw new RangeError('--render-dpi must be between 72 and 300.')
  return Object.freeze({
    libraryRoot,
    outputRoot,
    renderDpi,
    retry: args.includes('--retry'),
    dryRun: args.includes('--dry-run'),
  })
}

/**
 * Select only the five-year 9702 A2 theory component. The selector excludes
 * P5 by construction and pairs every QP with its exact same-session MS.
 */
export function buildA2P4FiveYearJobs({ libraryRoot, outputRoot, renderDpi = DEFAULT_RENDER_DPI, retry = false, dryRun = false } = {}) {
  const resolvedLibraryRoot = requiredDirectory(libraryRoot, 'libraryRoot')
  const subjectRoot = requiredDirectory(path.join(resolvedLibraryRoot, SUBJECT), `${SUBJECT} source library`)
  const resolvedOutputRoot = path.resolve(String(outputRoot || ''))
  if (!resolvedOutputRoot) throw new RangeError('outputRoot is required.')
  const dpi = positiveInteger(renderDpi, 'renderDpi')
  if (dpi < 72 || dpi > 300) throw new RangeError('renderDpi must be between 72 and 300.')
  const files = fs.readdirSync(subjectRoot, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name)
  const pairs = selectA2P4FiveYearPairs(files, { firstYear: FIRST_YEAR, lastYear: LAST_YEAR })
  return Object.freeze(pairs.map((pair) => Object.freeze({
    ...pair,
    subject: SUBJECT,
    component: 4,
    coordinateOnly: true,
    pageWindowed: true,
    maxAttempts: PAGE_WINDOW_MAX_ATTEMPTS,
    timeoutMs: PAGE_WINDOW_TIMEOUT_MS,
    paperTimeoutMs: PAGE_WINDOW_PAPER_TIMEOUT_MS,
    questionPdf: path.join(subjectRoot, pair.questionFile),
    markSchemePdf: path.join(subjectRoot, pair.markSchemeFile),
    outputRoot: resolvedOutputRoot,
    stage: 'A2',
    renderDpi: dpi,
    retry: retry === true,
    dryRun: dryRun === true,
  })))
}

async function runOneIngestion(job, { cwd, env }) {
  const argv = [
    '--paper-id', job.paperId,
    '--question-pdf', job.questionPdf,
    '--mark-scheme-pdf', job.markSchemePdf,
    '--subject', SUBJECT,
    '--stage', job.stage,
    '--output-root', job.outputRoot,
    '--render-dpi', String(job.renderDpi),
    '--max-attempts', String(job.maxAttempts),
    '--timeout-ms', String(job.timeoutMs),
    '--paper-timeout-ms', String(job.paperTimeoutMs),
    '--coordinate-only',
    '--page-windowed',
  ]
  if (job.retry) argv.push('--retry')
  if (job.dryRun) argv.push('--dry-run')
  const options = parseIngestionArgs(argv, { cwd, env })
  return runIngestionCli(options, { env })
}

function outcomeFor(job, result) {
  const status = String(result?.status || (job.dryRun ? 'dry-run' : 'failed'))
  return Object.freeze({
    paperId: job.paperId,
    questionFile: job.questionFile,
    markSchemeFile: job.markSchemeFile,
    year: job.year,
    component: job.component,
    stage: job.stage,
    storageMode: String(result?.storageMode || (job.coordinateOnly ? 'coordinate-only' : 'unknown')),
    status,
    reasonCodes: Array.isArray(result?.reasonCodes) ? result.reasonCodes.filter((code) => typeof code === 'string').sort() : [],
  })
}

export async function runA2P4FiveYearIngestion(options = {}, {
  cwd = process.cwd(),
  env = process.env,
  runIngestion = (job) => runOneIngestion(job, { cwd, env }),
} = {}) {
  const jobs = buildA2P4FiveYearJobs(options)
  const outcomes = []
  for (const job of jobs) {
    try {
      outcomes.push(outcomeFor(job, await runIngestion(job)))
    } catch {
      outcomes.push(Object.freeze({
        paperId: job.paperId,
        questionFile: job.questionFile,
        markSchemeFile: job.markSchemeFile,
        year: job.year,
        component: job.component,
        stage: job.stage,
        storageMode: 'coordinate-only',
        status: 'failed',
        reasonCodes: ['INGESTION_FAILED'],
      }))
    }
  }
  const verified = outcomes.filter((outcome) => outcome.status === 'ai-verified').length
  const quarantined = outcomes.filter((outcome) => outcome.status === 'auto-quarantined').length
  const failed = outcomes.filter((outcome) => outcome.status === 'failed').length
  return Object.freeze({
    scope: Object.freeze({ subject: SUBJECT, component: 4, firstYear: FIRST_YEAR, lastYear: LAST_YEAR, storageMode: 'coordinate-only' }),
    total: outcomes.length,
    verified,
    quarantined,
    failed,
    outcomes: Object.freeze(outcomes),
  })
}

function isDirectExecution() {
  if (!process.argv[1]) return false
  const modulePath = fileURLToPath(import.meta.url)
  try {
    return fs.realpathSync(modulePath) === fs.realpathSync(path.resolve(process.argv[1]))
  } catch {
    return path.resolve(modulePath) === path.resolve(process.argv[1])
  }
}

if (isDirectExecution()) {
  const options = parseA2P4FiveYearArgs()
  const summary = await runA2P4FiveYearIngestion(options)
  process.stdout.write(`${JSON.stringify(summary)}\n`)
  if (!options.dryRun) process.exitCode = summary.failed ? 1 : summary.quarantined ? 2 : 0
}
