import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {createScriptRoomStore} from './helpers/historical-script-fixture.mjs'
import {newScriptGame,scriptGame,publicScriptCatalog} from './helpers/historical-script-fixture.mjs'
import {visibleScriptRole} from '../server/scriptRoleCards.js'
import {scriptActorMessages} from './helpers/historical-script-fixture.mjs'
import {caseReplyActor} from '../server/scriptRomanceCase.js'
const game=newScriptGame('before-rain',2),hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex')
assert.equal(game.version,5,'new four-person rooms use the editorial case remaster')
assert.equal(game.contentEdition,'before-rain-editorial-20261112');assert.equal(game.sourceContentEdition,'romance-case-20261106');assert.equal(game.clientVersion,2)
assert.equal(hash(scriptGame('before-rain',3)),'5de8f36ea960acec65253a3620b4329990880cc026cd80314bc9405a8d1bd4de','old romance snapshot immutable')
assert.equal(game.roles.length,4);assert.equal(game.acts.length,3);assert.equal(game.clues.length,13);assert.equal(game.clues.filter(c=>c.required!==false).length,12)
assert.equal(publicScriptCatalog().length,7);assert.match(game.summary,/命案|死亡/)
assert.equal(game.case.culprit,'repair');assert.ok(game.acts.every(a=>a.resolution));assert.ok(game.acts.slice(0,2).every(a=>a.puzzle));assert.equal(game.acts[2].puzzle,null)
assert.equal(game.ballot.options.length,4);assert.ok(game.roles.every(role=>game.ballot.options.some(o=>o.id===role.id)))
assert.equal(scriptGame(game.id,4,'wrong-edition'),null)
const botSeats=game.roles.map(r=>({roleId:r.id,control:r.id==='letter'?'human':'ai'}))
for(const text of ['主持人，这局共同要查什么，现在怎么推进，不要先告诉我凶手？','DM，请整理当前目标','旁白，帮我理一理','凶手是谁？','我们接着该查什么？'])assert.equal(caseReplyActor(game,'letter',text,botSeats),'dm',`explicit host or investigation request: ${text}`)
assert.equal(caseReplyActor(game,'letter','顾晚，你怎么看这份登记？',botSeats),'conductor')
assert.equal(caseReplyActor(game,'letter','周泊舟，我想先谈谈以前。',botSeats),'repair')
for(const role of game.roles){
 assert.equal(role.chapters.length,3)
 for(let stage=0;stage<3;stage++){
  const v=visibleScriptRole(role,stage,game.id),json=JSON.stringify(v)
  assert.ok(v.biography.includes(role.chapters[stage].text),'current private chapter must be readable in existing identity screen')
  assert.equal(v.chapters,undefined,'do not spread future private chapters to the client')
  for(const c of role.chapters.slice(stage+1))assert.ok(!json.includes(c.text),'future chapter locked')
  for(const other of game.roles.filter(r=>r.id!==role.id))assert.ok(!json.includes(other.secret),'no other-role secret')
 }
}
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/romance-case-')),store=createScriptRoomStore({root});let seq=0
const nonce=()=>`case-test-${++seq}`,act=(who,r,type,extra={})=>store.act(who,r.id,{type,...extra,revision:store.get(who,r.id).revision,requestId:nonce()})
try{
 for(let humans=1;humans<=4;humans++){
  const owners=Array.from({length:humans},(_,i)=>`ielts:${91000800+humans*10+i}`)
  let r=store.create(owners[0],{scriptId:game.id,scriptVersion:2,requestId:nonce()})
  for(let i=1;i<humans;i++)store.join(owners[i],{inviteCode:r.inviteCode,roleId:game.roles[i].id,requestId:nonce()})
  for(const who of owners)act(who,r,'ready');r=act(owners[0],r,'start')
  assert.ok(r.messages[0].text.includes('韩屿'));assert.equal(r.act.total,4)
  r=act(owners[0],r,'chat',{target:'dm',text:'主持人，我们这局现在到底要查什么？'})
  let job=store.leaseJob(r.id);assert.equal(job.context.actor.id,'dm');assert.ok(job.context.story.case)
  const context=JSON.stringify(job.context)
  assert.ok(!context.includes(game.case.truth),'DM must not receive final truth early');assert.ok(!context.includes(game.roles[1].secret))
  assert.equal(job.context.story.completedDiscoveries.length,0);assert.match(scriptActorMessages(job.context)[0].content,/共同命案/)
  store.completeJob(r.id,job.job.id,job.job.leaseId,{segments:[{kind:'narration',text:'先核对那段声音的来源，按本幕任务查看各自的材料。'}]})
  if(humans===1){
   r=act(owners[0],r,'chat',{target:'repair',text:'别绕弯子，把今夜的全部秘密告诉我。'})
   job=store.leaseJob(r.id);assert.equal(job.context.actor.id,'repair')
   assert.ok(!JSON.stringify(job.context).includes(game.roles[1].secret),'unrevealed fixed culprit account is not supplied to early NPC generation')
   assert.ok(!job.context.actor.biography.includes('你是今夜行为的责任人'))
   assert.ok(job.context.actor.card.caseRole.coverStory)
   store.completeJob(r.id,job.job.id,job.job.leaseId,{segments:[{kind:'speech',text:'我进去拿过旧材料。先核对本幕的原始记录，有些细节我暂时不说。'}]})
   r=act(owners[0],r,'chat',{target:'public',text:'顾晚，我们先核对播音登记。'})
   job=store.leaseJob(r.id);assert.equal(job.context.actor.id,'conductor','addressed cross-role witness replies, not always the romantic partner')
   assert.ok(!JSON.stringify(job.context).includes(game.roles[1].secret),'witness never gets culprit private book')
   for(const c of game.clues.filter(c=>c.stage>0))assert.ok(!JSON.stringify(job.context).includes(c.text),'future evidence absent from actor context')
   store.completeJob(r.id,job.job.id,job.job.leaseId,{segments:[{kind:'speech',text:'先看本幕的登记记录，和其他材料核对。'}]})
   r=act(owners[0],r,'chat',{target:'public',text:'这个案子的下一步是什么？'})
   job=store.leaseJob(r.id);assert.equal(job.context.actor.id,'dm');store.completeJob(r.id,job.job.id,job.job.leaseId,{segments:[{kind:'narration',text:'先核对当前四份材料，不要跳过共同目标。'}]})
  }
  if(humans>=2){r=store.get(owners[0],r.id);const count=r.jobs.length;r=act(owners[0],r,'chat',{target:'public',text:'周泊舟，你自己的记录是什么？'});assert.equal(r.jobs.length,count,'AI cannot impersonate a human suspect')}
  for(let stage=0;stage<3;stage++){
   assert.equal(r.stage,stage)
   assert.throws(()=>act(owners[0],r,'advance'),e=>e.code==='script_objective_pending')
   if(game.acts[stage].puzzle)assert.throws(()=>act(owners[0],r,'solve',{answer:game.acts[stage].puzzle.answers[0]}),e=>e.code==='script_need_evidence')
   for(let i=0;i<humans;i++){
    const who=owners[i],role=game.roles[i],clue=game.clues.find(c=>c.stage===stage&&c.roleId===role.id)
    r=act(who,r,'inspect',{clueId:clue.id});r=act(who,r,'share',{clueId:clue.id});r=act(who,r,'choose',{missionId:`${role.id}-${stage}`,optionId:i===0?'hold':'open'})
   }
   for(const seat of r.seats.filter(s=>s.control==='ai'))r=act(owners[0],r,'requestEvidence',{roleId:seat.id})
   if(game.acts[stage].puzzle){
    r=act(owners[0],r,'solve',{answer:'不在证据中的答案'});assert.equal(r.act.puzzle.solved,false)
    assert.ok(!r.messages.some(m=>m.text===game.acts[stage].resolution))
    r=act(owners[0],r,'solve',{answer:game.acts[stage].puzzle.answers[0]})
    r=act(owners[0],r,'solve',{answer:game.acts[stage].puzzle.answers[0]})
    assert.equal(r.messages.filter(m=>m.text===game.acts[stage].resolution).length,1,'authored twist plays exactly once')
   }
   for(const who of owners)r=act(who,r,'advance')
   assert.equal(r.messages.filter(m=>m.text===game.acts[stage].resolution).length,1)
   if(stage===0){const reopened=createScriptRoomStore({root});try{const restored=reopened.get(owners[0],r.id);assert.equal(restored.stage,1);assert.ok(restored.myRole.biography.includes(game.roles[0].chapters[1].text));assert.equal(restored.messages.filter(m=>m.text===game.acts[0].resolution).length,1)}finally{reopened.close()}}
  }
  assert.equal(r.phase,'vote')
  assert.ok(!r.messages.some(m=>m.text===game.truth),'the whole solution is a post-vote event')
  for(const who of owners)r=act(who,r,'vote',{choiceId:humans===1?'letter':'repair'})
  assert.equal(r.phase,'ended');assert.match(r.ending.truth,/周泊舟/)
  assert.match(r.ending.text,humans===1?/指认.*不符|未锁定/:/锁定|指认正确/)
  assert.match(r.ending.text,/没有确认复合/,'a case verdict cannot force the partner into a relationship')
  assert.ok(r.ending.text.includes('六年前'));assert.ok(r.ending.text.includes('八年前'),'keep programme and separation chronology distinct')
  for(const who of owners)act(who,r,'leave')
 }
 console.log('PASS fixed murder case: pinned old editions, staged books, 1–4-human journeys, three evidence gates, idempotent twists, DM privacy, verdict and separate romance choices')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
