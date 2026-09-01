import assert from 'node:assert/strict'
import fs from 'node:fs'

import { requestTopicPdf, SharedAccountError } from '../src/lib/sharedAccount.js'

const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
assert.match(
  appSource,
  /window\.open\('about:blank', '_blank'\)[\s\S]{0,180}popup\.opener = null[\s\S]{0,500}await requestTopicPdf/,
  'Topic PDF rendering must reserve a usable tab during the click and sever its opener before the async render',
)
assert.doesNotMatch(
  appSource,
  /window\.open\('about:blank', '_blank', 'noopener,noreferrer'\)/,
  'noopener window features may return null and lose the reserved Topic PDF tab',
)

const originalFetch = globalThis.fetch
const calls = []

try {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(Buffer.from('%PDF-1.4 topic fixture', 'ascii'), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'X-STEM-Topic-PDF-Authority': 'ai-provisional',
        'X-STEM-Topic-PDF-Student-Study-Eligible': 'true',
        'X-STEM-Topic-PDF-Formal-Progress-Eligible': 'false',
      },
    })
  }
  const blob = await requestTopicPdf('short-lived-test-token', {
    routeId: 'cie-9702-a2-physics',
    topicId: 'physics-9702-topic-13',
  })
  assert.equal(await blob.text(), '%PDF-1.4 topic fixture')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/stem/topic-pdfs')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer short-lived-test-token')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    routeId: 'cie-9702-a2-physics',
    topicId: 'physics-9702-topic-13',
  })

  globalThis.fetch = async () => new Response(Buffer.from('%PDF-1.4 missing provenance', 'ascii'), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf' },
  })
  await assert.rejects(
    () => requestTopicPdf('short-lived-test-token', { routeId: 'cie-9702-a2-physics', topicId: 'physics-9702-topic-13' }),
    (error) => error instanceof SharedAccountError && error.code === 'topic_pdf_provenance_missing',
    'a topic PDF without explicit provisional metadata must not be opened in the student UI',
  )

  globalThis.fetch = async () => new Response(JSON.stringify({
    code: 'topic_pdf_empty',
    error: 'No released questions',
  }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  await assert.rejects(
    () => requestTopicPdf('short-lived-test-token', { routeId: 'cie-9702-a2-physics', topicId: 'physics-9702-topic-12' }),
    (error) => error instanceof SharedAccountError
      && error.code === 'topic_pdf_empty'
      && error.statusCode === 404,
  )

  globalThis.fetch = async () => new Response('not a pdf', {
    status: 200,
    headers: {
      'X-STEM-Topic-PDF-Authority': 'ai-provisional',
      'X-STEM-Topic-PDF-Student-Study-Eligible': 'true',
      'X-STEM-Topic-PDF-Formal-Progress-Eligible': 'false',
    },
  })
  await assert.rejects(
    () => requestTopicPdf('short-lived-test-token', { routeId: 'cie-9702-a2-physics', topicId: 'physics-9702-topic-13' }),
    (error) => error instanceof SharedAccountError && error.code === 'topic_pdf_invalid_output',
  )
} finally {
  globalThis.fetch = originalFetch
}

console.log('Topic PDF client contract passed.')
