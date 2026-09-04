import assert from 'node:assert/strict'
import { freshReloadUrl, isBootFailure } from '../src/lib/bootRecovery.js'

assert.equal(
  isBootFailure(new TypeError('Unexpected token < in module script')),
  true,
  'module parse errors must enter the boot recovery shell',
)
assert.equal(
  isBootFailure({ reason: 'The requested module failed during evaluation' }),
  true,
  'generic module evaluation failures must enter the boot recovery shell',
)
assert.equal(
  isBootFailure(new Error('API request failed'), { appReady: true }),
  false,
  'post-boot API failures must not trigger a document reload',
)
assert.equal(
  freshReloadUrl('https://stem.example.test/today?routeId=physics#practice', 123),
  'https://stem.example.test/today?routeId=physics&_stem_reload=123#practice',
  'fresh reload must preserve route and hash while adding a cache-busting marker',
)

console.log('boot recovery checks passed')
