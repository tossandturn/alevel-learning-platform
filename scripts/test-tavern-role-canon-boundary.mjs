import assert from 'node:assert/strict'
import {tavernCharacterPrompt,tavernCharacterCard} from '../server/tavernPersonas.js'
import {tavernStorySystemPrompt,TAVERN_STORIES} from '../server/tavernStoryBible.js'
const opening=tavernCharacterPrompt('mystery-guide')+'\n'+tavernStorySystemPrompt('mystery-guide',{state:{stage:'opening',clues:[],revealed:false}})
assert.doesNotMatch(opening,/罗桥的投影演示/,'a generic persona scenario must not bypass the server reveal gate')
for(const id of ['mystery-guide','horror-guide','xianxia-guide','story-traveler']){
 const card=tavernCharacterCard(id)
 assert.ok(card.examples.some(e=>e.user.includes('以前')||e.user.includes('害怕')||e.user.includes('别人')),'life-history examples should give a natural voice')
 const prompt=tavernCharacterPrompt(id)+'\n'+tavernStorySystemPrompt(id,{state:{stage:'idle',clues:[],revealed:false}})
 assert.ok(!prompt.includes(TAVERN_STORIES[id].truth.text))
 assert.match(prompt,/不能替用户/)
}
console.log('PASS: ordinary story personas retain voice without preloading hidden plot conclusions')
