import assert from 'node:assert/strict'
import fs from 'node:fs'
const raw=fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'),scripts=JSON.parse(raw).scripts
assert.equal((raw.match(/"pretest"\s*:/g)||[]).length,1,'duplicate pretest keys silently disable earlier release checks')
for(const name of ['admissions-curriculum','whole-paper-marking','catalog-compression','native-paper-context','objective-answers','remediation-contracts','remediation-runtime','coach-help-intents','coach-language'])assert.ok(scripts.pretest.includes('test:'+name),`retain existing ${name} release check`)
assert.match(scripts.pretest,/test-admissions-directory-identity/)
assert.match(scripts['test:coach-stream-protocol'],/test-ai-provider-sse-framing/)
console.log('PASS AI verification entry retains previous release gates and uses one pretest hook')
