import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { courseRoutes } from '../src/data/routeRegistry.js'
import { studyQuestionBank } from '../src/data/questionBank.js'
import { SOURCE_INDEX_SHA256 } from '../src/data/sourceContentIdentity.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.join(root, 'public', 'data', 'study-question-index')

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

fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(outputRoot, { recursive: true })

const routes = []
for (const routeId of [...questionsByRoute.keys()].toSorted()) {
  const questions = questionsByRoute.get(routeId).toSorted(sortQuestions)
  const file = `${routeId}.json`
  fs.writeFileSync(path.join(outputRoot, file), `${JSON.stringify({
    schemaVersion: 'study-question-fragment-v1',
    routeId,
    sourceIndexSha256: SOURCE_INDEX_SHA256,
    questions,
  })}\n`, 'utf8')
  routes.push({ routeId, file, questionCount: questions.length })
}

fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify({
  schemaVersion: 'study-question-fragment-manifest-v1',
  sourceIndexSha256: SOURCE_INDEX_SHA256,
  routes,
})}\n`, 'utf8')

console.log(JSON.stringify({
  status: 'generated',
  routeCount: routes.length,
  questionCount: routes.reduce((sum, route) => sum + route.questionCount, 0),
  output: path.relative(root, outputRoot).replaceAll('\\', '/'),
}))
