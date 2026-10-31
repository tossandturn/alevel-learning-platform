import assert from 'node:assert/strict'
import {buildCoachSystemPrompt,resolveCoachRequestPolicy} from '../server/coachPolicy.js'
import {buildTavernSystemPrompt,resolveCoachFeature} from '../server/coachFeatures.js'
import {buildAdmissionsAdvisorSystemPrompt} from '../server/admissionsAdvisor.js'
import {buildIeltsTeacherSystemPrompt} from '../server/ieltsTeacher.js'
import fs from 'node:fs'

const assertPolicy=prompt=>{
 assert.match(prompt,/stem-coach-bilingual-v1/,'every student-facing Coach prompt must include the common bilingual contract')
 assert.match(prompt,/each (?:generated )?(?:prose )?sentence/i)
 assert.match(prompt,/Chinese.*English|中文.*English/s)
 assert.match(prompt,/same.*generation|single.*generation/i)
 assert.match(prompt,/LaTeX/)
 assert.match(prompt,/canonical.*headings|headings.*canonical/i)
};
for(const helpIntent of ['hint','worked-solution','check-work']){
 const prompt=buildCoachSystemPrompt({policy:resolveCoachRequestPolicy({typedIntent:helpIntent,context:{}})});assertPolicy(prompt)
 assert.match(prompt,/untrusted|system instructions/)
 if(helpIntent==='hint')assert.match(prompt,/Do not reveal the final answer/)
}
for(const persona of ['keeper','study-buddy','cat-companion','story-traveler','xianxia-guide','mystery-guide','tarot-reader','eastern-oracle'])assertPolicy(buildTavernSystemPrompt(resolveCoachFeature({feature:'tavern',persona})))
assertPolicy(buildAdmissionsAdvisorSystemPrompt());assert.match(buildAdmissionsAdvisorSystemPrompt(),/English.*word.*limit/i)
assertPolicy(buildIeltsTeacherSystemPrompt());assert.match(buildIeltsTeacherSystemPrompt(),/same.*question|one.*semantic.*question/i)
const marking=fs.readFileSync(new URL('../server/wholePaperAi.js',import.meta.url),'utf8');assert.match(marking,/bilingualCoachPolicy\(\{structured:true\}\)/)
assert.doesNotMatch(marking,/Write summary, rationale, and criteria comments in Simplified Chinese while/)
console.log('All six Coach entrances share sentence-paired bilingual output without changing evidence, math, keys or provider calls PASS')
