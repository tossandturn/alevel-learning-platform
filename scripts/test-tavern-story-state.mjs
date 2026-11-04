import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initialStoryState, advanceStoryState, storySceneId } from '../server/tavernStoryState.js'
import { TAVERN_STORIES, tavernStorySystemPrompt } from '../server/tavernStoryBible.js'
import { createTavernConversationStore } from '../server/tavernConversationStore.js'
import { loadTavernMediaCatalog, selectTavernMediaCandidates } from '../server/tavernMedia.js'

const persona = 'horror-guide'
let state = initialStoryState(persona)
assert.equal(state.stage, 'idle')
state = advanceStoryState(persona, state, '开始雨夜故事')
assert.equal(state.stage, 'opening')
assert.equal(storySceneId(persona, state), 'story-horror-opening')
assert.deepEqual(advanceStoryState(persona, state, '不要检查呼叫铃；如果我翻值班簿会怎样？').clues, [])
state = advanceStoryState(persona, state, '我检查呼叫铃')
assert.deepEqual(state.clues, ['bell'])
assert.equal(state.stage, 'investigation')
assert.equal(advanceStoryState(persona, state, '现在告诉我真相').revealed, false)
assert.ok(!tavernStorySystemPrompt(persona, { state }).includes(TAVERN_STORIES[persona].truth.text))
state = advanceStoryState(persona, state, '先不碰录音机，我翻开值班簿')
assert.deepEqual(state.clues, ['bell', 'logbook'])
const paused = advanceStoryState(persona, state, '暂停一下，聊点别的')
assert.equal(paused.stage, 'paused')
assert.deepEqual(advanceStoryState(persona, paused, '继续刚才的故事').clues, state.clues)
state = advanceStoryState(persona, state, '解释真相')
assert.equal(state.revealed, true)
assert.ok(tavernStorySystemPrompt(persona, { state }).includes(TAVERN_STORIES[persona].truth.text))
assert.equal(storySceneId(persona, state), 'story-horror-resolution')
assert.deepEqual(advanceStoryState(persona, state, '重新开始这个故事').clues, [])
const catalog=loadTavernMediaCatalog()
assert.equal(catalog.items.filter(item=>item.id.startsWith('story-')).length,12)
assert.equal(selectTavernMediaCandidates(catalog,{persona,storyState:state})[0].id,'story-horror-resolution')
assert.deepEqual(selectTavernMediaCandidates(catalog,{persona,storyState:state,recentIds:['story-horror-resolution']}),[])
assert.ok(!selectTavernMediaCandidates(catalog,{persona:'keeper',message:'看点图片'}).some(item=>item.id.startsWith('story-')),'script clues cannot leak into the general library rotation')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-story-state-'))
let store = createTavernConversationStore({ root })
try {
 const ownerId = 'ielts:88001'
 const conversation = store.resumeConversation({ ownerId, persona })
 const binding = { ownerId, persona, conversationId: conversation.id }
 const one = advanceStoryState(persona, initialStoryState(persona), '检查呼叫铃')
 const pending = store.beginTurn({ ...binding, clientTurnId: 'story-turn-0001', expectedRevision: conversation.revision, message: '检查呼叫铃', requestHash: 'story-hash-0001' })
 assert.deepEqual(store.storyStateForContext(binding).clues, [], 'pending response does not commit progress')
 store.completeTurn({ ...binding, clientTurnId: 'story-turn-0001', leaseId: pending.leaseId, assistantContent: '【旁白】铃舌上有潮盐。', memory: { storyState: one } })
 store.close()
 store = createTavernConversationStore({ root })
 assert.deepEqual(store.storyStateForContext(binding).clues, ['bell'], 'progress survives process restart')
 assert.equal(store.storyStateForContext(binding).delivery,'scene','delivery context survives the same history boundary')
 const current = store.resumeConversation(binding)
 const failed = store.beginTurn({ ...binding, clientTurnId: 'story-turn-0002', expectedRevision: current.revision, message: '检查录音机', requestHash: 'story-hash-0002' })
 store.failTurn({ ...binding, clientTurnId: 'story-turn-0002', leaseId: failed.leaseId, status: 'unavailable', memory: { storyState: advanceStoryState(persona, one, '检查录音机') } })
 assert.deepEqual(store.storyStateForContext(binding).clues, ['bell'], 'failed generation never advances the plot')
 assert.throws(() => store.storyStateForContext({ ...binding, ownerId: 'ielts:88002' }))
 assert.throws(() => store.storyStateForContext({ ...binding, persona: 'xianxia-guide' }))
 store.deleteConversation(binding)
 assert.throws(() => store.storyStateForContext(binding))
} finally { store.close(); fs.rmSync(root, { recursive: true, force: true }) }
console.log('PASS story progress: explicit action, negation, reveal gate, pause/resume, durable successful turns and owner isolation')
