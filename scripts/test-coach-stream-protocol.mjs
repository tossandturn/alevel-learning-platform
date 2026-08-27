import assert from 'node:assert/strict'
import fs from 'node:fs'

import { createCoachStreamParser, parseCoachStreamEvent } from '../src/lib/coachStream.js'

assert.deepEqual(
  parseCoachStreamEvent('event: delta\ndata: {"text":"first step"}'),
  { eventName: 'delta', payload: { text: 'first step' } },
  'a valid Coach delta must be parsed without changing its content',
)
assert.equal(parseCoachStreamEvent(': keep-alive'), null, 'SSE heartbeat comments must remain ignorable')

assert.throws(
  () => parseCoachStreamEvent('event: delta\ndata: {not-json}'),
  (error) => error?.code === 'coach_stream_protocol_invalid',
  'malformed Coach JSON must fail the stream protocol instead of being ignored',
)
assert.throws(
  () => parseCoachStreamEvent('event: delta\ndata: {"text":42}'),
  (error) => error?.code === 'coach_stream_protocol_invalid',
  'a delta with an invalid schema must fail closed',
)

let completed = false
assert.throws(
  () => {
    for (const rawEvent of [
      'event: delta\ndata: {not-json}',
      'event: done\ndata: {"mode":"ai","providerStatus":"connected","answer":"must not recover"}',
    ]) {
      const event = parseCoachStreamEvent(rawEvent)
      if (event?.eventName === 'done') completed = true
    }
  },
  (error) => error?.code === 'coach_stream_protocol_invalid',
  'a later valid done frame must not recover a stream after a malformed frame',
)
assert.equal(completed, false, 'a corrupt Coach stream must never become completed')

const parseStreamEvent = createCoachStreamParser()
assert.equal(
  parseStreamEvent('event: done\ndata: {"mode":"ai","providerStatus":"connected","answer":"complete"}').eventName,
  'done',
  'the stateful stream parser must accept one terminal done frame',
)
assert.throws(
  () => parseStreamEvent('event: reset\ndata: {"provider":"qwen"}'),
  (error) => error?.code === 'coach_stream_protocol_invalid',
  'no Coach event may mutate the response after the terminal done frame',
)

const coachSource = fs.readFileSync(new URL('../src/components/AiCoach.jsx', import.meta.url), 'utf8')
assert.match(coachSource, /createCoachStreamParser\(\)/, 'the browser Coach stream must use the stateful protocol parser')
assert.doesNotMatch(coachSource, /JSON\.parse\(dataLine[\s\S]{0,80}catch\s*\{\s*return/, 'the browser must not silently ignore malformed Coach frames')

console.log('Coach client stream protocol regression passed.')
