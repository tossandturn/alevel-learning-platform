import assert from 'node:assert/strict'

import { callOpenAiStructured } from './ai-pdf-ingestion/openai-structured.mjs'
import { callStructuredWithFallback } from './ai-pdf-ingestion/provider-fallback.mjs'

let signalAborted = false
const result = await Promise.race([
  callStructuredWithFallback({
    providers: [{ name: 'openai', apiKey: 'test', model: 'gpt-5.6' }],
    request: {
      schemaName: 'fixture',
      schema: { type: 'object' },
      input: [],
      timeoutMs: 10,
      deadlineAt: Date.now() + 1000,
    },
    callOpenAi: async ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        signalAborted = true
        reject(new Error('provider observed abort'))
      }, { once: true })
    }),
  }).then(() => null, (error) => error),
  new Promise((resolve) => setTimeout(() => resolve(new Error('TEST_DEADLINE')), 100)),
])
assert.equal(result?.code, 'OPENAI_TIMEOUT')
assert.equal(signalAborted, true)

let fetchSignalAborted = false
const fetchResult = await Promise.race([
  callOpenAiStructured({
    apiKey: 'test',
    model: 'gpt-5.6',
    schemaName: 'fixture',
    schema: { type: 'object' },
    input: [],
    timeoutMs: 1000,
    maxAttempts: 1,
    signal: AbortSignal.timeout(10),
    fetchImpl: async (_endpoint, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        fetchSignalAborted = true
        reject(new Error('fetch observed abort'))
      }, { once: true })
    }),
  }).then(() => null, (error) => error),
  new Promise((resolve) => setTimeout(() => resolve(new Error('TEST_FETCH_DEADLINE')), 100)),
])
assert.equal(fetchResult?.code, 'OPENAI_TIMEOUT')
assert.equal(fetchSignalAborted, true)

const openAiAbortController = new AbortController()
let openAiAbortAttempts = 0
let openAiAbortSleeps = 0
const openAiAbortResult = callOpenAiStructured({
  apiKey: 'test',
  model: 'gpt-5.6',
  schemaName: 'fixture',
  schema: { type: 'object' },
  input: [],
  timeoutMs: 1000,
  maxAttempts: 3,
  signal: openAiAbortController.signal,
  sleep: async () => { openAiAbortSleeps += 1 },
  fetchImpl: async (_endpoint, { signal }) => {
    openAiAbortAttempts += 1
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new Error('fetch observed abort'))
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    })
  },
}).then(() => null, (error) => error)
setTimeout(() => openAiAbortController.abort(), 10)
const openAiAbortSettled = await Promise.race([
  openAiAbortResult,
  new Promise((resolve) => setTimeout(() => resolve(new Error('TEST_OPENAI_ABORT')), 100)),
])
assert.equal(openAiAbortSettled?.code, 'OPENAI_TIMEOUT')
assert.equal(openAiAbortAttempts, 1)
assert.equal(openAiAbortSleeps, 0)

console.log(JSON.stringify({ status: 'passed', checks: 7 }))
