import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = fs.readFileSync(path.join(root, 'scripts', 'configure-shared-account-env.sh'), 'utf8')

assert.match(
  script,
  /STEM_ENV="\/home\/ubuntu\/alevel-physics\/shared\/\.env"/,
  'the STEM auth key must be persisted outside the immutable release tree',
)
assert.match(script, /key="\$\{STEM_INTERNAL_AUTH_KEY:-\}"/, 'the dedicated internal key must be the canonical override')
assert.match(script, /grep '\^STEM_INTERNAL_AUTH_KEY='/, 'the shared env file must be able to provide the dedicated key')
assert.match(script, /grep '\^STEM_IDENTITY_SIGNING_KEY='/, 'legacy identity key fallback must remain supported')
assert.match(script, /print "STEM_INTERNAL_AUTH_KEY=" value/, 'the script must write the dedicated key to each server env')
assert.doesNotMatch(script, /openssl\s+rand/, 'missing configuration must fail closed instead of rotating the shared key')
assert.match(script, /refusing to generate a replacement key/, 'missing configuration must produce an explicit failure')

console.log('Shared account environment synchronization contract passed.')
