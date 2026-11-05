import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'
import {scriptGame} from '../server/scriptGameCatalog.js'
import {pinTestRoomEdition} from './helpers/pin-test-room-edition.mjs'
import {scriptActorMessages} from '../server/scriptRoomApi.js'
import {scriptRoomContinuity,SCRIPT_MEMORY_LIMITS} from '../server/scriptRoomMemory.js'
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/stage-memory-'))
let store=createScriptRoomStore({root}),seq=0
const who='ielts:91000601',game=scriptGame('before-rain',3),nonce=()=>`stage-memory-${++seq}`
const act=(r,type,extra={})=>store.act(who,r.id,{type,...extra,revision:store.get(who,r.id).revision,requestId:nonce()})
const privatePromise='下一次我们约在青石桥看晚霞，记得带黄色雨伞。这件事只在我们私聊里说。'
const privateReply='我答应了，下次在青石桥看晚霞，我带黄色雨伞。'
// Retrieval is bounded, same-act aware, and preserves corrections as quotations.
// No actual customer conversation is used in these synthetic records.
const transcript=[]
const add=(actor,target,text,stage=0,kind='dialogue')=>{const m={id:`synthetic-${transcript.length}`,actor,target,text,stage,kind};transcript.push(m);return m}
add('repair','letter','今晚我已经说清楚：纸袋里是我留在本地经营修理所的计划。')
add('letter','repair','我现在知道纸袋里的计划了。')
add('repair','letter','我们约在青石桥，带黄色雨伞。')
add('letter','repair','我答应了。')
add('repair','letter','更正一下，取消青石桥，改成白塔桥；黄色雨伞不变。')
add('letter','repair','好，按最新约定去白塔桥，不去青石桥。')
add('photo','conductor','别人的秘密约定在紫藤屋。')
for(let i=0;i<75;i++)add(i%2?'repair':'letter',i%2?'letter':'repair',`日常话题 ${i}。`)
const trigger=add('repair','letter','你还记得纸袋和我们改过的约定吗？',1)
const snapshot={stage:1,messages:transcript,known:{},publicClues:['c6'],jobs:[],missionChoices:{}}
let recovered=scriptRoomContinuity(snapshot,game,{actor:'letter',target:'repair',trigger:trigger.id})
assert.ok(recovered.continuity.dialogueAnchors.some(a=>a.text.includes('白塔桥')),'latest correction must survive retrieval')
assert.ok(recovered.continuity.dialogueAnchors.some(a=>a.text.includes('我现在知道纸袋')),'earlier acknowledgement remains retrievable')
assert.ok(recovered.continuity.alreadyKnownEvidence.some(e=>e.id==='c6'&&e.text.includes('合伙邀约')),'disclosed facts update current knowledge')
assert.ok(!JSON.stringify(recovered).includes('紫藤屋'),'filter privacy before ranking')
assert.ok(recovered.continuity.dialogueAnchors.length<=SCRIPT_MEMORY_LIMITS.anchors)
assert.ok(recovered.continuity.dialogueAnchors.reduce((n,a)=>n+Array.from(a.text).length,0)<=SCRIPT_MEMORY_LIMITS.totalCharacters)
assert.throws(()=>scriptRoomContinuity(snapshot,game,{actor:'stranger',target:'repair'}),/Invalid script memory scope/)
// A failed old job is not an agreement. A fake player opening is not an act boundary.
snapshot.jobs=[{actor:'letter',trigger:transcript[0].id,stage:0,status:'superseded'}]
assert.equal(scriptRoomContinuity(snapshot,game,{actor:'letter',target:'repair',trigger:trigger.id}).continuity.unanswered[0].status,'no-committed-reply')
const longSnapshot={...snapshot,messages:Array.from({length:90},(_,i)=>({id:`long-${i}`,actor:i%2?'letter':'repair',target:i%2?'repair':'letter',kind:'dialogue',stage:0,text:'关于我们的约定。'.repeat(400)})),jobs:[]}
recovered=scriptRoomContinuity(longSnapshot,game,{actor:'letter',target:'repair',trigger:'long-89'})
assert.ok(recovered.continuity.dialogueAnchors.every(a=>Array.from(a.text).length<=SCRIPT_MEMORY_LIMITS.quoteCharacters))
assert.ok(recovered.continuity.dialogueAnchors.reduce((n,a)=>n+Array.from(a.text).length,0)<=SCRIPT_MEMORY_LIMITS.totalCharacters)
let r=store.create(who,{scriptId:game.id,scriptVersion:2,requestId:nonce()})
pinTestRoomEdition(root,r.id,game);r=store.get(who,r.id)
try{
 r=act(r,'ready');r=act(r,'start')
 const send=(text,reply='我听到了。',target='repair')=>{r=act(r,'chat',{target,text});const job=store.leaseJob(r.id);assert.equal(store.completeJob(r.id,job.job.id,job.job.leaseId,{segments:[{kind:'speech',text:reply}]}),true);return job}
 send(privatePromise,privateReply)
 for(let i=0;i<43;i++)send(`第${i+1}次聊今天窗外的天气。`)
 assert.ok(store.get(who,r.id).messages.some(m=>m.text===privatePromise),'the old private statement is still durably saved')
 const clue=game.clues.find(c=>c.stage===0&&c.roleId==='letter')
 r=act(r,'inspect',{clueId:clue.id});r=act(r,'share',{clueId:clue.id});r=act(r,'choose',{missionId:'letter-0',optionId:'hold'})
 for(const roleId of ['repair','photo','conductor'])r=act(r,'requestEvidence',{roleId})
 r=act(r,'solve',{answer:game.acts[0].puzzle.answers[0]});r=act(r,'advance');assert.equal(r.stage,1)
 store.close();store=createScriptRoomStore({root})
 r=act(r,'chat',{target:'repair',text:'你还记得上一幕我们约好去哪里、带什么吗？'})
 let job=store.leaseJob(r.id)
 assert.ok(!JSON.stringify(job.context.messages).includes(privatePromise),'the regression is outside the recent-message window')
 assert.ok(JSON.stringify(job.context).includes(privatePromise),'cross-act context must recover a saved private promise, not just the latest 35 messages')
 assert.ok(JSON.stringify(job.context.continuity).includes(privateReply),'keep who agreed, not only the proposed plan')
 assert.equal(job.context.continuity.schemaVersion,'script-continuity-v1')
 assert.equal(job.context.continuity.completedActs.length,1)
 assert.ok(job.context.continuity.actorDecisions.some(d=>d.stage===0&&d.roleId==='repair'))
 assert.ok(!JSON.stringify(job.context.continuity.actorDecisions).includes('先谈旧事，暂不解释期待'),'partner private choices stay private')
 const anchors=job.context.continuity.dialogueAnchors
 assert.ok(anchors.some(a=>a.speaker.id==='letter'&&a.text===privatePromise&&a.stage===0))
 assert.ok(anchors.some(a=>a.speaker.id==='repair'&&a.text.includes('青石桥')&&a.stage===0))
 assert.match(scriptActorMessages(job.context)[0].content,/开局时/)
 store.completeJob(r.id,job.job.id,job.job.leaseId,{segments:[{kind:'speech',text:'我记得这份约定。'}]})
 r=act(r,'chat',{target:'public',text:'周泊舟，我们现在讨论已经公开的事情。'});job=store.leaseJob(r.id)
 assert.ok(!JSON.stringify(job.context).includes('青石桥'),'private memory cannot leak into a public response')
 assert.ok(!JSON.stringify(job.context).includes('黄色雨伞'))
 store.completeJob(r.id,job.job.id,job.job.leaseId,{segments:[{kind:'speech',text:'好，先看公开记录。'}]})
 r=act(r,'chat',{target:'photo',text:'上一幕有什么值得继续聊的？'});job=store.leaseJob(r.id)
 assert.ok(!JSON.stringify(job.context).includes('青石桥'),'other private pair cannot retrieve this promise')
 store.completeJob(r.id,job.job.id,job.job.leaseId,{segments:[{kind:'speech',text:'可以继续聊我们已经说过的事情。'}]})
 // Old snapshots have no stage/replyTo metadata. They still retain the
 // authoritative act-opening messages and must not need a destructive migration.
 const db=new DatabaseSync(path.join(root,'script-rooms.sqlite')),snapshot=JSON.parse(db.prepare('SELECT snapshot FROM script_rooms WHERE id=?').get(r.id).snapshot)
 for(const m of snapshot.messages){delete m.stage;delete m.replyTo}
 db.prepare('UPDATE script_rooms SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot),r.id);db.close()
 r=act(r,'chat',{target:'repair',text:'上一幕的约定还记得吗？'});job=store.leaseJob(r.id)
 assert.ok(job.context.continuity.dialogueAnchors.some(a=>a.text===privatePromise&&a.stage===0),'infer old act boundaries without changing old stored messages')
 console.log('PASS cross-act private promise: durable recovery, speaker/act ownership, own decisions, restart and legacy inference without public/other-pair leakage')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
