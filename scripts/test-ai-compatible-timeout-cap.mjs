import assert from 'node:assert/strict'

import { callCompatibleAi } from '../server/aiApi.js'

const originalFetch = globalThis.fetch
const provider = {
  name: 'qwen', label: 'Qwen', protocol: 'chat-completions', apiKey: 'synthetic',
  baseUrl: 'http://fixture.invalid/v1', model: 'fixture-model',
}

async function observedTimeout(options) {
  const events = []
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  await callCompatibleAi(provider, {
    messages: [{ role: 'user', content: 'fixture' }],
    telemetry: (event) => events.push(event),
    ...options,
  })
  return events.at(-1)?.timeoutMs
}

try {
  assert.equal(await observedTimeout({ timeoutMs: 120_000 }), 45_000, 'default provider cap must remain 45 seconds')
  assert.equal(await observedTimeout({ timeoutMs: 120_000, maxTimeoutMs: 180_000 }), 120_000)
  assert.equal(await observedTimeout({ timeoutMs: 999_999, maxTimeoutMs: 999_999 }), 180_000, 'absolute call-level cap must remain bounded')
} finally {
  globalThis.fetch = originalFetch
}

console.log(JSON.stringify({ status: 'passed', defaultCapMs: 45_000, extendedCapMs: 180_000 }))
