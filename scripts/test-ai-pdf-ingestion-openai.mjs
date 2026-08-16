import assert from 'node:assert/strict'
import { callOpenAiStructured } from './ai-pdf-ingestion/openai-structured.mjs'

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['questionNumber'],
  properties: {
    questionNumber: { type: 'string' },
  },
}

const request = {
  apiKey: 'fake-secret-do-not-log',
  model: 'gpt-5.6',
  schemaName: 'question_extraction',
  schema,
  input: [{ role: 'user', content: 'Extract question 7.' }],
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

const requests = []
const parsed = await callOpenAiStructured({
  ...request,
  fetchImpl: async (url, init) => {
    requests.push({ url, init })
    return jsonResponse(200, { status: 'completed', output_text: '{"questionNumber":"7"}' })
  },
})
assert.deepEqual(parsed, { questionNumber: '7' })
assert.equal(requests.length, 1)
assert.equal(requests[0].url, 'https://api.openai.com/v1/responses')
assert.equal(requests[0].init.method, 'POST')
assert.equal(requests[0].init.headers.Authorization, 'Bearer fake-secret-do-not-log')
assert.equal(requests[0].init.headers['Content-Type'], 'application/json')
assert.ok(requests[0].init.signal instanceof AbortSignal)
const requestBody = JSON.parse(requests[0].init.body)
assert.deepEqual(Object.keys(requestBody).sort(), ['input', 'model', 'store', 'text'])
assert.deepEqual(requestBody, {
  model: 'gpt-5.6',
  store: false,
  input: request.input,
  text: {
    format: {
      type: 'json_schema',
      name: 'question_extraction',
      strict: true,
      schema,
    },
  },
})

const contentParsed = await callOpenAiStructured({
  ...request,
  fetchImpl: async () => jsonResponse(200, {
    status: 'completed',
    output: [{ content: [{ type: 'output_text', text: '{"questionNumber":"8"}' }] }],
  }),
})
assert.deepEqual(contentParsed, { questionNumber: '8' })

let retryAttempts = 0
const retrySleeps = []
const retryParsed = await callOpenAiStructured({
  ...request,
  sleep: async (delayMs) => retrySleeps.push(delayMs),
  fetchImpl: async () => {
    retryAttempts += 1
    if (retryAttempts === 1) {
      return jsonResponse(429, { error: { message: 'fake-secret-do-not-log' } })
    }
    return jsonResponse(200, { status: 'completed', output_text: '{"questionNumber":"9"}' })
  },
})
assert.deepEqual(retryParsed, { questionNumber: '9' })
assert.equal(retryAttempts, 2)
assert.equal(retrySleeps.length, 1)
assert.ok(retrySleeps[0] >= 0)

let backoffAttempts = 0
const backoffSleeps = []
let randomCalls = 0
const backoffParsed = await callOpenAiStructured({
  ...request,
  sleep: async (delayMs) => backoffSleeps.push(delayMs),
  randomImpl: () => {
    randomCalls += 1
    return 0.5
  },
  fetchImpl: async () => {
    backoffAttempts += 1
    if (backoffAttempts < 3) {
      return jsonResponse(503, { error: { message: 'fake-secret-do-not-log' } })
    }
    return jsonResponse(200, { status: 'completed', output_text: '{"questionNumber":"11"}' })
  },
})
assert.deepEqual(backoffParsed, { questionNumber: '11' })
assert.equal(backoffAttempts, 3)
assert.equal(randomCalls, 2)
assert.equal(backoffSleeps.length, 2)
assert.ok(backoffSleeps[0] >= 125 && backoffSleeps[0] <= 250)
assert.ok(backoffSleeps[1] >= 250 && backoffSleeps[1] <= 500)

let networkAttempts = 0
const networkParsed = await callOpenAiStructured({
  ...request,
  sleep: async () => {},
  fetchImpl: async () => {
    networkAttempts += 1
    if (networkAttempts === 1) {
      throw new Error('fake-secret-do-not-log')
    }
    return jsonResponse(200, { status: 'completed', output_text: '{"questionNumber":"10"}' })
  },
})
assert.deepEqual(networkParsed, { questionNumber: '10' })
assert.equal(networkAttempts, 2)

let clientErrorAttempts = 0
await assert.rejects(
  () => callOpenAiStructured({
    ...request,
    fetchImpl: async () => {
      clientErrorAttempts += 1
      return jsonResponse(400, { error: { message: 'fake-secret-do-not-log' } })
    },
  }),
  (error) => {
    assert.equal(error.code, 'OPENAI_HTTP_400')
    assert.doesNotMatch(error.message, /fake-secret-do-not-log/)
    return true
  },
)
assert.equal(clientErrorAttempts, 1)

for (const status of [401, 403]) {
  let attempts = 0
  await assert.rejects(
    () => callOpenAiStructured({
      ...request,
      fetchImpl: async () => {
        attempts += 1
        return jsonResponse(status, { error: { message: 'fake-secret-do-not-log' } })
      },
    }),
    (error) => {
      assert.equal(error.code, `OPENAI_HTTP_${status}`)
      assert.doesNotMatch(error.message, /fake-secret-do-not-log/)
      return true
    },
  )
  assert.equal(attempts, 1)
}

let malformedAttempts = 0
await assert.rejects(
  () => callOpenAiStructured({
    ...request,
    fetchImpl: async () => {
      malformedAttempts += 1
      return jsonResponse(200, { status: 'completed', output_text: '{not-json}' })
    },
  }),
  (error) => {
    assert.equal(error.code, 'OPENAI_RESPONSE_JSON_INVALID')
    assert.doesNotMatch(error.message, /fake-secret-do-not-log/)
    return true
  },
)
assert.equal(malformedAttempts, 1)

await assert.rejects(
  () => callOpenAiStructured({
    ...request,
    fetchImpl: async () => jsonResponse(200, {
      status: 'incomplete',
      output_text: '{"questionNumber":"12"}',
      incomplete_details: { reason: 'max_output_tokens' },
    }),
  }),
  (error) => {
    assert.equal(error.code, 'OPENAI_RESPONSE_INCOMPLETE')
    assert.equal(error.message, 'OpenAI response was not completed.')
    assert.doesNotMatch(error.message, /fake-secret-do-not-log/)
    return true
  },
)

await assert.rejects(
  () => callOpenAiStructured({
    ...request,
    fetchImpl: async () => jsonResponse(200, {
      status: 'completed',
      output: [{ content: [{ type: 'refusal', refusal: 'fake-secret-do-not-log' }] }],
    }),
  }),
  (error) => {
    assert.equal(error.code, 'OPENAI_RESPONSE_REFUSAL')
    assert.equal(error.message, 'OpenAI response contained a refusal.')
    assert.doesNotMatch(error.message, /fake-secret-do-not-log/)
    return true
  },
)

let pendingJsonAttempts = 0
const pendingJsonSignals = []
const pendingJsonSleeps = []
await assert.rejects(
  () => callOpenAiStructured({
    ...request,
    maxAttempts: 2,
    timeoutMs: 1,
    sleep: async (delayMs) => pendingJsonSleeps.push(delayMs),
    fetchImpl: async (_url, init) => {
      pendingJsonAttempts += 1
      pendingJsonSignals.push(init.signal)
      return {
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('fake-secret-do-not-log')), { once: true })
        }),
      }
    },
  }),
  (error) => {
    assert.equal(error.code, 'OPENAI_TIMEOUT')
    assert.equal(error.message, 'OpenAI request timed out.')
    assert.doesNotMatch(error.message, /fake-secret-do-not-log/)
    return true
  },
)
assert.equal(pendingJsonAttempts, 2)
assert.equal(pendingJsonSleeps.length, 1)
assert.ok(pendingJsonSignals.every((signal) => signal.aborted))

let timeoutSignal
await assert.rejects(
  () => callOpenAiStructured({
    ...request,
    maxAttempts: 1,
    timeoutMs: 1,
    fetchImpl: async (_url, init) => {
      timeoutSignal = init.signal
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('fake-secret-do-not-log')), { once: true })
      })
    },
  }),
  (error) => {
    assert.equal(error.code, 'OPENAI_TIMEOUT')
    assert.equal(error.message, 'OpenAI request timed out.')
    assert.doesNotMatch(error.message, /fake-secret-do-not-log/)
    return true
  },
)
assert.ok(timeoutSignal.aborted)

console.log(JSON.stringify({ status: 'passed', checks: 58 }))
