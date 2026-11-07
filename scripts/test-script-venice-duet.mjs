import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {newScriptGame,publicScriptCatalog,scriptGame} from '../server/scriptGameCatalog.js'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'
import {scriptActorMessages} from '../server/scriptRoomApi.js'
import {veniceOutcomes} from '../server/scriptVeniceRomance.js'

const game=newScriptGame('venice-blue-hour',2)
assert.ok(game,'a complete original Venice duet must be available')
assert.equal(game.contentEdition,'venice-blue-hour-20261107')
assert.equal(game.roles.length,2)
assert.equal(game.acts.length,3)
assert.equal(game.clues.length,6)
assert.equal(scriptGame(game.id,1),null)
assert.equal(scriptGame(game.id,2,'unknown-edition'),null)
assert.equal(publicScriptCatalog().filter(g=>g.id===game.id).length,1)
for(const role of game.roles){assert.ok(role.entryBook.length>=1800,role.id+' needs a full personal story');assert.equal(role.chapters.length,3);assert.equal(role.missions.length,3)}
assert.ok(game.acts.slice(0,2).every(a=>a.puzzle?.answers?.length))
assert.equal(game.acts[2].puzzle,undefined,'the final relationship scene is not another password quiz')
assert.ok(!/候车室|广播室|末班车|车站|站台/.test(JSON.stringify(game)),'Venice must not reuse the station setting')
console.log('PASS Venice identity, role books and three distinct locations')
export const canonicalHash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const previous={
 'before-rain':'5cc8799e9c498293258c44507e3004a5d42bfb83ec2d40d255e7370c8804ba10',
 'thirteenth-curtain':'0fb725baaf0a758b9349adf643fab8961ba69f1bd84c937ae45fbaf22e7e08fd',
 'last-midnight':'18cda2d1a8e9153601d7e9948c91bcee27b3ddb993fb66f0aee5a04a632cdecd',
 'inverted-observatory':'a4dde2236e1ee3b2d3ea8b819789b39d20e65c8c65566522dd229aea6541cfda',
 'one-more-stop':'9f86769055be05b012989ae856b8f743df0655ec8a691362d64404ac8c23f39a',
 'last-elective':'5ead48b7d1bf8ff8149ac9b95563c5414eb8ae03c3add11d4bc57652593d7254',
}
for(const [id,hash] of Object.entries(previous))assert.equal(canonicalHash(newScriptGame(id,2)),hash,id+' canon must remain pinned')
const permutation=a=>a.length?a.flatMap((v,i)=>permutation(a.filter((_,j)=>i!==j)).map(rest=>[v,...rest])):[[]]
const orders=permutation(['窗','桥','鹭','灯']).filter(a=>a[0]==='窗'&&a.indexOf('桥')===a.indexOf('鹭')+1&&a.indexOf('灯')>a.indexOf('桥')).map(a=>a.join(''))
assert.deepEqual(orders,['窗鹭桥灯']);assert.ok(game.acts[1].puzzle.answers.includes(orders[0]))
const candidates=[['A12','棉纸',4],['B17','棉纸',3],['C24','木浆纸',3],['D09','棉纸',2]]
assert.deepEqual(candidates.filter(([,paper,folds])=>paper==='棉纸'&&folds===3).map(([id])=>id),['B17'])
assert.equal(veniceOutcomes(game,{missionChoices:{}})[0].status,'unconfirmed')
const qaBase=path.resolve(import.meta.dirname,'../../qa'),root=fs.mkdtempSync(path.join(qaBase,'venice-test-'))
assert.ok(root.startsWith(qaBase+path.sep))
const store=createScriptRoomStore({root}),who='ielts:91820001',peer='ielts:91820002',third='ielts:91820003';let seq=0
const nonce=()=>`venice-qa-${++seq}`
const action=(owner,id,type,extra={})=>store.act(owner,id,{type,...extra,revision:store.get(owner,id).revision,requestId:nonce()})
function start(role,dual=false){
 let r=store.create(who,{scriptId:game.id,scriptVersion:2,requestId:nonce()})
 if(r.myRoleId!==role)r=action(who,r.id,'claim',{roleId:role})
 if(dual){store.join(peer,{inviteCode:r.inviteCode,requestId:nonce()});assert.throws(()=>store.join(third,{inviteCode:r.inviteCode,requestId:nonce()}),e=>e.code==='script_role_taken');action(peer,r.id,'ready')}
 action(who,r.id,'ready');return action(who,r.id,'start')
}
function disclose(r,owners){
 for(const owner of owners){const clue=store.get(owner,r.id).searchOptions[0];action(owner,r.id,'inspect',{clueId:clue.id});action(owner,r.id,'share',{clueId:clue.id})}
 for(const seat of store.get(owners[0],r.id).seats.filter(s=>s.control==='ai'))action(owners[0],r.id,'requestEvidence',{roleId:seat.id})
 return store.get(owners[0],r.id)
}
const pageCount=r=>r.messages.filter(m=>m.kind==='narration'&&m.text.startsWith('【蓝色档案')).length
const close=(r,owners)=>owners.forEach(owner=>action(owner,r.id,'leave'))
function completeStage(r,owners,choices={}){
 const stage=r.stage
 assert.equal(r.myMissions.find(m=>m.stage===stage).options.length,0,'unread story cannot be treated as a final choice')
 r=disclose(r,owners)
 if(stage<2){
  const before=pageCount(r);r=action(owners[0],r.id,'solve',{answer:'错误'});assert.equal(pageCount(r),before)
  r=action(owners[0],r.id,'solve',{answer:game.acts[stage].puzzle.answers[0]});assert.equal(pageCount(r),before+1)
  r=action(owners[0],r.id,'solve',{answer:game.acts[stage].puzzle.answers[0]});assert.equal(pageCount(r),before+1)
 }else assert.equal(pageCount(r),3,'both shared plans unlock the final scene without a password')
 for(const owner of owners){const role=store.get(owner,r.id).myRoleId;action(owner,r.id,'choose',{missionId:`${role}-${stage}`,optionId:stage===2?choices[role]||'date':'open'})}
 for(const owner of owners)r=action(owner,r.id,'advance')
 return r
}
try{
 for(const role of game.roles){
  let r=start(role.id);assert.ok(!r.messages.some(m=>m.actor===role.id),'do not author the human role')
  assert.throws(()=>action(who,r.id,'inspect',{clueId:'v5'}),e=>e.code==='script_clue_locked')
  assert.throws(()=>action(who,r.id,'advance'),e=>e.code==='script_objective_pending')
  for(let stage=0;stage<3;stage++){
   assert.equal(r.stage,stage)
   const reopened=createScriptRoomStore({root});assert.deepEqual(reopened.get(who,r.id).messages,r.messages);reopened.close()
   r=completeStage(r,[who])
  }
  assert.equal(r.phase,'vote');r=action(who,r.id,'vote',{choiceId:'supper'});assert.equal(r.phase,'ended');assert.match(r.ending.text,/都愿意.*约会/)
  close(r,[who])
 }
 for(const first of ['date','slow','friends'])for(const second of ['date','slow','friends']){
  let r=start('xuying',true);assert.ok(r.messages.every(m=>m.actor==='dm'))
  for(let stage=0;stage<3;stage++)r=completeStage(r,[who,peer],{xuying:first,luxi:second})
  action(who,r.id,'vote',{choiceId:'supper'});r=action(peer,r.id,'vote',{choiceId:'sketch'});assert.equal(r.ending.tie,true)
  if(first==='date'&&second==='date')assert.match(r.ending.text,/都愿意.*约会/)
  else if([first,second].includes('friends'))assert.match(r.ending.text,/没有形成约会/)
  else assert.match(r.ending.text,/尚未确认约会或恋爱/)
  close(r,[who,peer])
 }
 let r=start('xuying')
 r=action(who,r.id,'chat',{target:'luxi',text:'先不聊题，收工后在蓝门书店门口等我。'});let job=store.leaseJob(r.id)
 assert.equal(job.context.story?.venice,true);assert.deepEqual(job.context.story.publicReveals,[])
 let projected=JSON.parse(scriptActorMessages(job.context)[1].content)
 assert.equal(projected.dialogueFocus,'personal');assert.ok(!projected.actor.biography.includes('【走进今晚】'))
 assert.ok(!JSON.stringify(projected).includes('归档授权页保留了对应本名'))
 assert.ok(!JSON.stringify(projected).includes('窗鹭桥灯'))
 assert.ok(!scriptActorMessages(job.context)[0].content.includes('本局有共同命案'))
 store.completeJob(r.id,job.job.id,job.job.leaseId,{text:'好，收工后蓝门书店门口见。'})
 for(let i=0;i<22;i++){action(who,r.id,'chat',{target:'luxi',text:`我们再聊一会儿今天的日常，话题${i}。`});job=store.leaseJob(r.id);store.completeJob(r.id,job.job.id,job.job.leaseId,{text:'我今天忙得差点忘了吃午饭。'})}
 r=completeStage(store.get(who,r.id),[who])
 action(who,r.id,'chat',{target:'luxi',text:'我们刚才约好了在哪里等来着？'});job=store.leaseJob(r.id)
 assert.ok(JSON.stringify(job.context.continuity).includes('蓝门书店门口'),'private appointment survives scene change and long conversation')
 store.completeJob(r.id,job.job.id,job.job.leaseId,{text:'收工后蓝门书店门口，我记着呢。'})
 action(who,r.id,'chat',{target:'public',text:'请给大家介绍一下当前材料。'});job=store.leaseJob(r.id)
 assert.ok(!JSON.stringify(job.context).includes('蓝门书店门口'),'private agreement is not leaked to public')
 store.completeJob(r.id,job.job.id,job.job.leaseId,{text:'这边先看已经放上桌的交接记录。'})
 close(store.get(who,r.id),[who])
 console.log('PASS Venice both solo roles, 9 endings, unlock/ownership boundaries, private memory, restart and six old canon hashes')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
