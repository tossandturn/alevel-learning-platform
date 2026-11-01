import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createAiApi } from '../server/aiApi.js'
import { createTavernConversationStore } from '../server/tavernConversationStore.js'

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'admissions-research-flow-'))
const signingKey = 'synthetic-research-flow-key'
const store = createTavernConversationStore({ root: fixtureRoot, databaseFilename: 'admissions.sqlite', allowedPersonas: ['admissions-advisor'], generatedResultReceipts: true, rejectDeleteWhilePending: true })
const catalog = [{ id: 'oxford', title: 'Oxford undergraduate courses', url: 'https://www.ox.ac.uk/admissions/undergraduate', aliases: ['Oxford', 'University of Oxford'] }]
const queries = []
const readUrls = []
let modelCalls = 0
let emptySearch = false
const api = createAiApi({
  env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_ACADEMIC_PROVIDER: 'deepseek', STEM_ACADEMIC_DEEPSEEK_API_KEY: 'synthetic-model-key' },
  libraryRoot: fixtureRoot, allowedSubjects: new Set(),
  admissionsConversationStore: store,
  admissionsResearchOptions: {
    sourceCatalog: catalog,
    resolveAddresses: async () => [{ address: '8.8.8.8', family: 4 }],
    searchPublicSources: async ({ query }) => {
      queries.push(query)
      if (emptySearch) return []
      const slug = query.includes('Mechanical Engineering') ? 'mechanical-engineering' : 'physics'
      return [{ title: 'Untrusted result metadata', url: `https://www.ox.ac.uk/courses/${slug}`, applicableYears: ['2099'] }]
    },
    readPublicPage: async url => {
      readUrls.push(url)
      const course = url.includes('mechanical-engineering') ? 'Mechanical Engineering' : 'Physics'
      return { url, title: `${course} - Oxford`, text: `# ${course}\n2027 entry\nA-level entry requirements: A*AA including Mathematics and Physics.` }
    },
  },
  admissionsCallCompatibleAiStream: async (_provider, options) => {
    modelCalls += 1
    const envelope = options.messages.find(item => item.role === 'system' && item.content.startsWith('Server-owned admissions research envelope.'))
    assert.ok(envelope)
    const evidence = JSON.parse(envelope.content.split('\n').at(-1))
    const id = evidence.sources[0]?.id
    const answer = options.messages.at(-1).content.includes('EDIT_LINK') ? 'My portfolio: https://example.org/my-portfolio.'
      : id ? `Official evidence [${id}]. Untrusted [S1] [S99] https://evil.example/fake.`
      : evidence.status === 'needs_clarification' ? 'Which university and course should I check?' : 'Edited paragraph.'
    for (let index = 0; index < answer.length; index += 3) await options.onDelta(answer.slice(index, index + 3))
    return { answer }
  },
})
const server = http.createServer((request, response) => api(request, response, () => { response.statusCode = 404; response.end() }))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
function token(owner = 9911) {
  const at = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({ iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: `ielts:${owner}`, iat: at, exp: at + 600 })).toString('base64url')
  return `${header}.${claims}.${crypto.createHmac('sha256', signingKey).update(`${header}.${claims}`).digest('base64url')}`
}
async function call(route, body, owner) {
  const response = await fetch(`${base}/api/ai/admissions/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${token(owner)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const text = await response.text()
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return { status: response.status, data: JSON.parse(text), events: [] }
  const events = text.split('\n\n').flatMap(block => {
    const event = block.match(/^event: (\w+)/)?.[1]
    const data = block.match(/\ndata: (.+)/)?.[1]
    return event && data ? [{ event, data: JSON.parse(data) }] : []
  })
  return { status: response.status, data: events.find(event => event.event === 'done')?.data, events }
}
let sequence = 0
async function ask(conversation, message, owner = 9911) {
  const body = { conversationId: conversation.id, expectedRevision: conversation.revision, clientTurnId: `research-flow-${++sequence}`, message }
  return { result: await call('stream', body, owner), body }
}
try {
  let conversation = (await call('conversations/resume', {})).data.conversation
  const first = await ask(conversation, '核实牛津物理2027年入学要求。姓名张三，alice@example.com，预测AAB，PS内容 PRIVATE_STUDENT_ESSAY。')
  assert.ok(first.result.data.research, JSON.stringify({ status: first.result.status, mode: first.result.data.mode, code: first.result.data.code }))
  assert.equal(first.result.data.research.status, 'complete')
  assert.deepEqual(first.result.data.research.sources[0].applicableYears, ['2027'])
  assert.doesNotMatch(queries[0], /张三|alice|AAB|PRIVATE|ESSAY|example/)
  assert.match(queries[0], /Oxford Physics 2027/)
  assert.deepEqual(first.result.events.filter(event => event.data.providerStatus === 'researching').map(event => event.data.researchPhase), ['search', 'fetch'])
  const deltas = first.result.events.filter(event => event.event === 'delta').map(event => event.data.text).join('')
  assert.doesNotMatch(deltas, /\[S1\]|\[S99\]|evil\.example/)
  const replay = await call('stream', first.body)
  assert.equal(replay.data.replayed, true)
  assert.deepEqual(replay.data.research, first.result.data.research)
  assert.equal(queries.length, 1)
  assert.equal(readUrls.length, 1)
  assert.equal(modelCalls, 1)
  conversation = first.result.data.conversation

  const followup = await ask(conversation, '机械工程呢？')
  assert.equal(followup.result.data.research.status, 'complete')
  assert.match(queries.at(-1), /Oxford Mechanical Engineering 2027/)
  conversation = followup.result.data.conversation
  const edit = await ask(conversation, 'EDIT_LINK Shorten this email preserving https://example.org/my-portfolio.')
  assert.equal(edit.result.data.research.status, 'not_requested')
  assert.equal(queries.length, 2)
  assert.ok(!edit.result.events.some(event => event.data.providerStatus === 'researching'))
  assert.equal(edit.result.data.answer, 'My portfolio: https://example.org/my-portfolio.')
  assert.ok(edit.result.events.filter(event => event.event === 'delta').length > 1, 'pure editing keeps normal incremental SSE output')

  const other = (await call('conversations/resume', {}, 9912)).data.conversation
  const beforeMissing = modelCalls
  const missing = await ask(other, 'Oxford Physics entry requirements?', 9912)
  assert.equal(missing.result.data.mode, 'ai')
  assert.equal(missing.result.data.research.status, 'complete')
  assert.equal(missing.result.data.research.scope.entryYear, null)
  assert.equal(modelCalls, beforeMissing + 1, 'missing target year does not block research or real model analysis')
  const year = await ask(missing.result.data.conversation, '2027', 9912)
  assert.equal(year.result.data.research.status, 'complete', 'a scope answer resumes the pending factual request')
  assert.match(queries.at(-1), /Oxford Physics 2027/)

  const planning = await ask(year.result.data.conversation, '成绩AAA，想学机械工程，帮我选校。', 9912)
  assert.equal(planning.result.data.mode, 'ai')
  assert.equal(planning.result.data.research.status, 'not_requested', 'school selection advice must not demand a preselected institution')
  const fresh = (await call('conversations/resume', {}, 9913)).data.conversation
  const beforeClarify = modelCalls
  const clarify = await ask(fresh, '几个A*？', 9913)
  assert.equal(clarify.result.data.mode, 'ai')
  assert.equal(clarify.result.data.providerStatus, 'connected')
  assert.deepEqual(clarify.result.data.research.missingFields, ['institution'])
  assert.equal(modelCalls, beforeClarify + 1, 'necessary clarification remains a real AI completion for legacy clients')

  const beforeFailure = modelCalls
  emptySearch = true
  const failed = await ask(planning.result.data.conversation, '几个A*？', 9912)
  assert.equal(failed.result.data.mode, 'unavailable')
  assert.equal(failed.result.data.research.sourceCount, 0)
  assert.equal(modelCalls, beforeFailure, 'empty official search must never request memory-based current requirements')
  emptySearch = false
  const retry = await call('stream', failed.body, 9912)
  assert.equal(retry.data.research.status, 'complete')
  const beforeForeign = queries.length
  const foreign = await ask(conversation, '几个A*？', 9912)
  assert.equal(foreign.status || foreign.result.status, 404)
  assert.equal(queries.length, beforeForeign)
  console.log('Admissions real research pipeline: private query minimization, follow-ups, scope clarification, phases, citation chunks, replay, failure retry and account isolation passed.')
} finally {
  await api.close()
  server.closeAllConnections?.()
  await new Promise(resolve => server.close(resolve))
  const relative = path.relative(os.tmpdir(), fixtureRoot)
  if (!relative.startsWith('..') && /^admissions-research-flow-[^/\\]+$/.test(relative)) fs.rmSync(fixtureRoot, { recursive: true })
}
