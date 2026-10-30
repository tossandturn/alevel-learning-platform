import assert from 'node:assert/strict'
import {coachEffort,withCoachEffort,coachEffortBudget,coachEffortOutputLimit} from '../server/coachEffort.js'
assert.equal(coachEffort(undefined),null)
for(const level of ['low','high','max'])assert.equal(coachEffort(level),level)
for(const value of ['',null,'medium','xhigh','MAX',' high ',{},1,true])assert.throws(()=>coachEffort(value),e=>e.statusCode===400&&e.code==='coach_effort_invalid')
const provider={name:'deepseek',model:'deepseek-flash',reasoningEffort:'low',thinkingMode:'disabled',apiKey:'fixture-only'}
assert.equal(withCoachEffort(provider,null),provider,'old client must retain provider policy')
for(const level of ['low','high','max']){const selected=withCoachEffort(provider,level);assert.equal(selected.reasoningEffort,level);assert.equal(selected.thinkingMode,'enabled');assert.equal(selected.studentEffort,level)}
assert.equal(provider.thinkingMode,'disabled');assert.equal(provider.reasoningEffort,'low','request settings must not mutate shared provider')
assert.equal(withCoachEffort({...provider,fallback:{name:'qwen',model:'qwen3.7-max'}},'max').fallback,undefined,'an explicit choice cannot silently fall back to a model that ignores it')
assert.throws(()=>withCoachEffort({name:'qwen',model:'qwen3.7-max'},'max'),e=>e.code==='coach_effort_unsupported')
const legacy={providerTimeoutMs:25000,totalDeadlineMs:50000};assert.deepEqual(coachEffortBudget(null,legacy),legacy);assert.deepEqual(coachEffortBudget('low',legacy),legacy)
for(const level of ['high','max']){const budget=coachEffortBudget(level,legacy);assert.ok(budget.providerTimeoutMs>legacy.providerTimeoutMs&&budget.providerTimeoutMs<budget.totalDeadlineMs&&budget.totalDeadlineMs<=115000);assert.ok(budget.maxTimeoutMs>=budget.providerTimeoutMs)}
assert.equal(coachEffortOutputLimit(null,2048),2048);assert.equal(coachEffortOutputLimit('low',2048),8192);assert.equal(coachEffortOutputLimit('high',2048),16384);assert.equal(coachEffortOutputLimit('max',2048),32768)
console.log('Coach effort: exact enum, provider isolation, old-client compatibility and bounded reasoning budgets PASS.')
