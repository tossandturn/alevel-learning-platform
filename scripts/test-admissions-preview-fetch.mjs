import assert from 'node:assert/strict'
import { createAdmissionsPreviewResourceFetcher, createAdmissionsStaticPageBundle } from '../server/admissionsPreviewFetch.js'

const sourceUrl = 'https://www.example.edu/courses/mechanical-engineering'
const fetched = []
const resources = new Map([
  [sourceUrl, { url: sourceUrl, contentType: 'text/html', body: Buffer.from(`<!doctype html><html><head>
    <script>fetch('https://evil.example')</script><link rel="stylesheet" href="/assets/course.css"><link rel="stylesheet" href="https://cdn.evil.example/x.css">
    </head><body onload="steal()"><main><h1>Mechanical Engineering</h1><h2>Entry requirements</h2><img src="/assets/lab.png"><img src="https://evil.example/tracker.png"><iframe src="https://evil.example"></iframe></main></body></html>`) }],
  ['https://www.example.edu/assets/course.css', { url: 'https://www.example.edu/assets/course.css', contentType: 'text/css', body: Buffer.from('body{color:#111;background:url(https://evil.example/bg.png)} @import "https://evil.example/x.css";') }],
  ['https://www.example.edu/assets/lab.png', { url: 'https://www.example.edu/assets/lab.png', contentType: 'image/png', body: Buffer.from('png-image') }],
])
const bundle = await createAdmissionsStaticPageBundle(sourceUrl, {
  fetchResource: async (url, options) => { fetched.push({ url, options }); const result = resources.get(url); if (!result) throw Error(`unexpected resource ${url}`); return result },
  deadlineAt: Date.now() + 5_000,
})
assert.deepEqual(fetched.map(item => item.url), [sourceUrl, 'https://www.example.edu/assets/course.css', 'https://www.example.edu/assets/lab.png'])
assert.doesNotMatch(bundle.html, /<script|<iframe|onload|evil\.example|@import/iu)
assert.match(bundle.html, /data:image\/png;base64/)
assert.match(bundle.html, /<style[^>]*>body\{color:#111/)
assert.match(bundle.html, /data-admissions-preview-focus="true"/)
assert.equal(bundle.sourceUrl, sourceUrl)
assert.ok(Buffer.byteLength(bundle.html) < 2 * 1024 * 1024)
await assert.rejects(createAdmissionsStaticPageBundle(sourceUrl, {
  fetchResource: async () => ({ url: sourceUrl, contentType: 'text/html', body: Buffer.alloc(600 * 1024) }), deadlineAt: Date.now() + 100,
}), error => error?.code === 'ADMISSIONS_PREVIEW_HTML_TOO_LARGE')
await assert.rejects(createAdmissionsStaticPageBundle(sourceUrl, {
  fetchResource: () => new Promise(() => {}), deadlineAt: Date.now() + 20,
}), error => error?.code === 'ADMISSIONS_PREVIEW_FETCH_TIMEOUT')
let unsafeRequests = 0
const privateFetcher = createAdmissionsPreviewResourceFetcher({
  resolveAddresses: async () => [{ address: '127.0.0.1', family: 4 }],
  requestResource: async () => { unsafeRequests += 1 },
})
await assert.rejects(privateFetcher(sourceUrl), error => error?.code === 'ADMISSIONS_SOURCE_PRIVATE_ADDRESS')
assert.equal(unsafeRequests, 0)
const redirectFetcher = createAdmissionsPreviewResourceFetcher({
  resolveAddresses: async () => [{ address: '8.8.8.8', family: 4 }],
  requestResource: async () => ({ statusCode: 302, headers: { location: 'https://evil.example/source' }, body: Buffer.alloc(0) }),
})
await assert.rejects(redirectFetcher(sourceUrl), error => error?.code === 'ADMISSIONS_PREVIEW_REDIRECT_BLOCKED')
console.log('Admissions static preview fetch: same-domain bounded HTML/CSS/image prefetch, script/network stripping, size and timeout passed.')
