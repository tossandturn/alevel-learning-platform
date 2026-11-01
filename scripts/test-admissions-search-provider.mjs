import assert from 'node:assert/strict'
import { createAdmissionsSearchProvider, DEEPSEEK_SEARCH_ENDPOINT, DEEPSEEK_FETCH_ENDPOINT } from '../server/admissionsSearchProvider.js'

const calls = []
const privateReads = []
const provider = createAdmissionsSearchProvider({
  env: {},
  readOfficialKey(file, maxBytes) {
    privateReads.push({ file, maxBytes })
    return 'synthetic-official-key'
  },
  fetchImpl: async (url, options) => {
    calls.push({ url, options })
    if (url === DEEPSEEK_SEARCH_ENDPOINT) return new Response(JSON.stringify({ results: [{ title: 'Engineering', url: 'https://www.undergraduate.study.cam.ac.uk/courses/engineering', applicableYears: ['2099'] }] }))
    return new Response(JSON.stringify({ title: 'Engineering', content: '# Engineering\n2027 entry\nA level: A*A*A.' }))
  },
})
assert.equal(provider.status.configured, true)
assert.match(privateReads[0].file, /[\\/]\.config[\\/]stemist[\\/]deepseek\.key$/)
assert.equal(privateReads[0].maxBytes, 512)
const results = await provider.search({ query: 'Cambridge Engineering 2027 entry requirements site:cam.ac.uk', limit: 5 })
assert.equal(results.length, 1)
assert.deepEqual(JSON.parse(calls[0].options.body), { query: 'Cambridge Engineering 2027 entry requirements site:cam.ac.uk', count: 5, need_content: false })
assert.equal(calls[0].options.redirect, 'error')
assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-official-key')
await provider.fetchPage('https://www.undergraduate.study.cam.ac.uk/courses/engineering')
assert.equal(calls[1].url, 'https://api.deepseek.com/v1/tools/fetch')
assert.equal(calls[1].url, DEEPSEEK_FETCH_ENDPOINT)
assert.deepEqual(JSON.parse(calls[1].options.body), { url: 'https://www.undergraduate.study.cam.ac.uk/courses/engineering' })
assert.doesNotMatch(JSON.stringify(provider.status), /synthetic-official-key/)
for (const unsafe of ['http://127.0.0.1/', 'https://[::ffff:7f00:1]/', 'https://name:password@www.ox.ac.uk/', 'https://www.ox.ac.uk/?token=private']) {
  await assert.rejects(provider.fetchPage(unsafe), error => error?.code === 'ADMISSIONS_SOURCE_URL_BLOCKED')
}
assert.equal(calls.length, 2, 'unsafe targets never reach the official Fetch API')

let unconfiguredCalls = 0
const unavailable = createAdmissionsSearchProvider({
  env: { STEM_ACADEMIC_DEEPSEEK_API_KEY: 'synthetic-bailian-key', DEEPSEEK_API_KEY: 'synthetic-bailian-key', DEEPSEEK_BASE_URL: 'https://example.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1' },
  readOfficialKey() { throw Object.assign(Error('missing'), { code: 'ENOENT' }) },
  fetchImpl() { unconfiguredCalls += 1; throw Error('must not call') },
})
assert.equal(unavailable.status.configured, false)
await assert.rejects(unavailable.search({ query: 'Cambridge Engineering' }), error => error?.code === 'ADMISSIONS_SEARCH_NOT_CONFIGURED')
assert.equal(unconfiguredCalls, 0)

for (const statusCode of [401, 402, 403, 429, 503]) {
  const failed = createAdmissionsSearchProvider({
    env: { STEM_ADMISSIONS_RESEARCH_PROVIDER: 'deepseek', STEM_ADMISSIONS_DEEPSEEK_API_KEY: 'synthetic-test-key' },
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'must not surface provider body' } }), { status: statusCode }),
  })
  await assert.rejects(failed.search({ query: 'Cambridge Engineering' }), error => error?.code === `ADMISSIONS_SEARCH_HTTP_${statusCode}` && !error.message.includes('surface'))
}
console.log('Admissions fixed official search/fetch endpoints, credential isolation and provider failures passed.')
