import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { courseRoutes } from '../src/data/routeRegistry.js'
import { studyQuestionBank } from '../src/data/questionBank.js'
import { SOURCE_INDEX_SHA256 } from '../src/data/sourceContentIdentity.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.join(root, 'server', 'data', 'study-question-index')
const publicManifestRoot = path.join(root, 'public', 'data', 'study-question-index')
let temporarySequence = 0

function atomicWriteJson(target, value) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${temporarySequence += 1}.tmp`)
  let descriptor
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o644)
    fs.writeFileSync(descriptor, `${JSON.stringify(value)}\n`, 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.renameSync(temporary, target)
  } catch (error) {
    if (descriptor !== undefined) try { fs.closeSync(descriptor) } catch { /* already closed */ }
    try { fs.unlinkSync(temporary) } catch { /* no temporary file to remove */ }
    throw error
  }
}

function sortQuestions(left, right) {
  return (
    (Number(right.sourceRef?.year) || 0) - (Number(left.sourceRef?.year) || 0)
    || String(left.sourceRef?.paper).localeCompare(String(right.sourceRef?.paper))
    || String(left.sourceRef?.question).localeCompare(String(right.sourceRef?.question), undefined, { numeric: true })
  )
}

const routeIds = [...new Set([
  ...courseRoutes.map((route) => route.routeId),
  ...studyQuestionBank.map((question) => question.routeId).filter(Boolean),
])].toSorted()
const questionsByRoute = new Map(routeIds.map((routeId) => [routeId, []]))
for (const question of studyQuestionBank) {
  if (!questionsByRoute.has(question.routeId)) questionsByRoute.set(question.routeId, [])
  questionsByRoute.get(question.routeId).push(question)
}

fs.mkdirSync(outputRoot, { recursive: true })
fs.mkdirSync(publicManifestRoot, { recursive: true })

const routes = []
for (const routeId of [...questionsByRoute.keys()].toSorted()) {
  const questions = questionsByRoute.get(routeId).toSorted(sortQuestions)
  const file = `${routeId}.json`
  atomicWriteJson(path.join(outputRoot, file), {
    schemaVersion: 'study-question-fragment-v1',
    routeId,
    sourceIndexSha256: SOURCE_INDEX_SHA256,
    questions,
  })
  routes.push({ routeId, file, questionCount: questions.length })
}

atomicWriteJson(path.join(publicManifestRoot, 'manifest.json'), {
  schemaVersion: 'study-question-fragment-manifest-v1',
  sourceIndexSha256: SOURCE_INDEX_SHA256,
  routes,
})

console.log(JSON.stringify({
  status: 'generated',
  routeCount: routes.length,
  questionCount: routes.reduce((sum, route) => sum + route.questionCount, 0),
  output: path.relative(root, outputRoot).replaceAll('\\', '/'),
  publicManifest: path.relative(root, path.join(publicManifestRoot, 'manifest.json')).replaceAll('\\', '/'),
}))
