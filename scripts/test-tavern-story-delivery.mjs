import assert from 'node:assert/strict'
import {initialStoryState,advanceStoryState,normalizeStoryState,storySceneId} from '../server/tavernStoryState.js'
import {TAVERN_STORIES,tavernStorySystemPrompt} from '../server/tavernStoryBible.js'
import {tavernCharacterPrompt} from '../server/tavernPersonas.js'
const id='xianxia-guide'
assert.equal(advanceStoryState(id,null,'讲一个江湖里遇到的小故事').delivery,'memory')
let memory=advanceStoryState(id,null,'讲讲你以前护送药箱的经历')
assert.equal(memory.delivery,'memory','telling a personal story is not short chat or a forced new adventure')
assert.equal(memory.started,false)
memory=advanceStoryState(id,normalizeStoryState(id,memory),'继续讲')
assert.equal(memory.delivery,'memory');assert.equal(memory.started,false)
const repair=advanceStoryState(id,memory,'你的故事怎么这么无聊，描述的')
assert.equal(repair.delivery,'repair');assert.deepEqual(repair.clues,[]);assert.equal(repair.started,false)
assert.equal(storySceneId(id,memory),'','an anecdote does not automatically attach main-plot art')
assert.equal(advanceStoryState(id,null,'明天开始上班，真烦').started,false)
assert.equal(advanceStoryState(id,null,'不要开始剧情，先聊聊天').started,false)
assert.equal(advanceStoryState(id,memory,'先不讲故事，今天上班很累，别问我问题').delivery,'chat')
let scene=advanceStoryState(id,null,'进入《白汀渡的旧灯》')
assert.equal(scene.delivery,'scene');assert.equal(scene.stage,'opening')
const feedback=advanceStoryState(id,scene,'你写的检查旧伞柄那段太无聊，重写一下')
assert.equal(feedback.delivery,'repair');assert.deepEqual(feedback.clues,[],'style feedback is not a player inspect action')
assert.deepEqual(advanceStoryState(id,scene,'故事有点无聊，我检查旧伞柄').clues,['bell-mark'],'a separate explicit action still works alongside feedback')
scene=advanceStoryState(id,scene,'我检查旧伞柄')
assert.deepEqual(scene.clues,['bell-mark']);assert.equal(scene.delivery,'scene')
const paused=advanceStoryState(id,scene,'先暂停，聊点日常')
assert.equal(paused.delivery,'chat');assert.equal(paused.paused,true)
assert.equal(advanceStoryState(id,paused,'不要继续剧情').paused,true)
assert.equal(advanceStoryState(id,paused,'继续刚才的剧情').paused,false)
for(const persona of ['xianxia-guide','mystery-guide','horror-guide','story-traveler']){
 const state=advanceStoryState(persona,initialStoryState(persona),'你的故事很无聊，情节写具体些')
 const prompt=tavernStorySystemPrompt(persona,{state})
 assert.match(prompt,/叙事修复/);assert.match(prompt,/阻力/);assert.match(prompt,/因果/)
 assert.match(prompt,/不能替玩家/);assert.ok(!prompt.includes(TAVERN_STORIES[persona].truth.text))
 assert.match(tavernCharacterPrompt(persona),/叙事回合不受/,'short-chat style must not override an actual story request')
}
console.log('PASS explicit chat/memory/scene/repair delivery, persistent continuation, no accidental start or clue reward and canon boundaries')
