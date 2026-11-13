import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {newScriptGame,scriptGame,publicScriptCatalog} from './helpers/historical-script-fixture.mjs'
import {createScriptRoomStore} from './helpers/historical-script-fixture.mjs'
import {scriptActorMessages} from './helpers/historical-script-fixture.mjs'
import {scriptStageScene} from '../server/scriptSceneBeats.js'
import {SCRIPT_ANIME_ASSETS} from '../server/scriptArtSpec.js'
import {scriptImagePlan,scriptArtReferenceUrls} from '../server/scriptArt.js'
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex')
const old=scriptGame('one-more-stop',2,'duet-one-more-stop-20261106')
assert.equal(digest(old),'9f86769055be05b012989ae856b8f743df0655ec8a691362d64404ac8c23f39a','old saved rooms remain byte-equivalent')
const game=newScriptGame('one-more-stop',2)
assert.equal(game.contentEdition,'one-more-stop-editorial-20261112','new rooms need the reviewed location-specific edition')
assert.equal(game.sourceContentEdition,'duet-iceland-20261108')
assert.equal(game.version,4);assert.equal(game.clientVersion,2)
assert.equal(scriptGame(game.id,4,game.contentEdition),game)
assert.equal(scriptGame(game.id,3,'unknown'),null)
assert.equal(scriptGame(game.id,2,'duet-iceland-20261108'),null)
assert.equal(scriptGame(game.id,2),old)
assert.equal(newScriptGame(game.id,1),null)
assert.equal(publicScriptCatalog().length,7)
assert.equal(publicScriptCatalog().find(g=>g.id===game.id).title,'白夜还亮着')
assert.deepEqual(game.acts.map(a=>a.place),['玻璃温室','录音工作间','白夜庭院'])
assert.deepEqual(game.acts.slice(0,2).map(a=>a.puzzle.answers),[['BAC'],['R2']])
assert.ok(!game.acts[2].puzzle)
for(const r of game.roles){assert.ok(r.entryBook.length>=1600);assert.equal(r.missions.length,3);assert.ok(r.card.pastEventAnchors.length>=4)}
assert.equal(game.clues.length,6)
assert.ok(game.acts.every(a=>!/(?:车站|候车室|列车|登机|午夜极光)/.test(a.opening)))
assert.ok(!JSON.stringify(game.roles[0].card).includes('江远已接受国内六个月'))
for(let stage=0;stage<3;stage++){
 const scene=scriptStageScene(game,stage,game.roles.map(r=>r.id));assert.ok(scene,'remaster needs edition-specific authored performance')
 assert.equal(scene.lines.length,2);assert.match(scene.narration,new RegExp(game.acts[stage].place.slice(0,2)))
 assert.ok(!/候车室|车还没来/.test(JSON.stringify(scene)))
 assert.match(scriptStageScene(old,stage,old.roles.map(r=>r.id)).narration,/候车室|工作安排|站外/)
}
const currentAssets=SCRIPT_ANIME_ASSETS.filter(a=>a.contentEdition===game.sourceContentEdition)
assert.equal(currentAssets.length,8)
assert.equal(SCRIPT_ANIME_ASSETS.filter(a=>a.contentEdition===old.contentEdition).length,8)
assert.ok(scriptImagePlan(game,0,'画出白夜庭院').blocked,'future current-edition scene remains private')
assert.ok(!scriptImagePlan(game,0,'画出温室窗边').blocked)
const references=['scriptanime-iceland-scene-0','scriptanime-iceland-scene-2','scriptanime-duet-scene-0']
const fakeCatalog={byId:new Map(references.map(id=>[id,{id,src:'/api/ai/tavern/media/v1/'+id+'.webp'}]))}
assert.deepEqual(scriptArtReferenceUrls({id:game.id,contentEdition:game.contentEdition,sourceContentEdition:game.sourceContentEdition,stage:0,referenceIds:references},fakeCatalog),['https://stem.ieltsist.com/api/ai/tavern/media/v1/scriptanime-iceland-scene-0.webp'])
console.log('PASS Iceland remaster: pinned old edition, current catalog, complete role books, specific settings and fixed puzzles')
const base=path.resolve(import.meta.dirname,'../../qa'),root=fs.mkdtempSync(path.join(base,'iceland-test-'))
let store=createScriptRoomStore({root}),seq=0
const who='ielts:91830001',peer='ielts:91830002',third='ielts:91830003',nonce=()=>`iceland-test-${++seq}`
const act=(owner,id,type,extra={})=>store.act(owner,id,{type,...extra,requestId:nonce(),revision:store.get(owner,id).revision})
const started=(role='sutang',dual=false,oldEdition=false)=>{
 let r=store.create(who,{scriptId:game.id,scriptVersion:2,requestId:nonce()})
 if(oldEdition){const db=new DatabaseSync(path.join(root,'script-rooms.sqlite'));const raw=JSON.parse(db.prepare('SELECT snapshot FROM script_rooms WHERE id=?').get(r.id).snapshot);assert.equal(raw.phase,'lobby');raw.scriptVersion=2;raw.contentEdition=old.contentEdition;db.prepare('UPDATE script_rooms SET snapshot=? WHERE id=?').run(JSON.stringify(raw),r.id);db.close()}
 if(r.myRoleId!==role)act(who,r.id,'claim',{roleId:role})
 if(dual){store.join(peer,{inviteCode:r.inviteCode,requestId:nonce()});assert.throws(()=>store.join(third,{inviteCode:r.inviteCode,requestId:nonce()}),e=>e.code==='script_role_taken');act(peer,r.id,'ready')}
 act(who,r.id,'ready');return act(who,r.id,'start')
}
try{
 let journeys=0
 for(const oldEdition of [false,true])for(const role of ['sutang','jiangyuan'])for(const dual of [false,true])for(const choice of dual?[['open','open'],['open','hold'],['hold','open'],['hold','hold']]:[['open','open'],['hold','open']]){
  const active=oldEdition?old:game;let r=started(role,dual,oldEdition);const owners=dual?[who,peer]:[who]
  assert.equal(r.title,active.title);assert.equal(r.scriptVersion,2)
  const pattern=oldEdition?/scriptanime-duet-/:/scriptanime-iceland-/
  assert.match(r.act.image,pattern)
  assert.ok(!r.messages.some(m=>m.actor===role),'human dialogue not auto-written')
  for(let stage=0;stage<3;stage++){
   assert.equal(r.stage,stage);assert.throws(()=>act(who,r.id,'advance'),e=>e.code==='script_objective_pending')
   assert.ok(!JSON.stringify(r).includes(active.truth))
   const next=active.clues.filter(c=>c.stage>stage);for(const c of next)assert.ok(!r.myClues.some(x=>x.id===c.id))
   for(let n=0;n<owners.length;n++){
    const owner=owners[n],v=store.get(owner,r.id),clue=v.searchOptions[0]
    act(owner,r.id,'inspect',{clueId:clue.id});act(owner,r.id,'share',{clueId:clue.id})
    act(owner,r.id,'choose',{missionId:`${v.myRoleId}-${stage}`,optionId:stage===2?choice[n]:'open'})
   }
   for(const seat of r.seats.filter(s=>s.control==='ai'))act(who,r.id,'requestEvidence',{roleId:seat.id})
   r=store.get(who,r.id)
   if(active.acts[stage].puzzle){
    assert.throws(()=>act(who,r.id,'advance'),e=>e.code==='script_objective_pending')
    r=act(who,r.id,'solve',{answer:'错误答案'});assert.equal(r.act.puzzle.solved,false)
    r=act(who,r.id,'solve',{answer:active.acts[stage].puzzle.answers[0]});assert.equal(r.act.puzzle.solved,true)
   }
   const before=JSON.stringify(r);store.close();store=createScriptRoomStore({root});assert.equal(JSON.stringify(store.get(who,r.id)),before,'resume does not rebase edition or lose messages')
   for(const owner of owners)r=act(owner,r.id,'advance')
  }
  assert.equal(r.phase,'vote');for(const owner of owners)r=act(owner,r.id,'vote',{choiceId:active.botVote})
  assert.equal(r.phase,'ended');assert.equal(r.ending.text.includes('共同确认：尝试六个月异地'),choice.every(c=>c==='open'))
  for(const owner of owners)act(owner,r.id,'leave');journeys++
 }
 // An actor's private recollections persist between acts but do not move into public replies.
 let r=started('jiangyuan'),target='sutang',promise='这局说好收工以后在庭院喝薄荷茶，别加糖'
 r=act(who,r.id,'chat',{target,text:promise});let lease=store.leaseJob(r.id)
 assert.equal(lease.context.story.place,'玻璃温室')
 const projected=scriptActorMessages(lease.context);assert.match(projected[0].content,/冰岛/)
 assert.ok(!JSON.stringify(lease.context.actor).includes('江远已接受国内六个月'))
 store.completeJob(r.id,lease.job.id,lease.job.leaseId,{segments:[{kind:'speech',text:'好，薄荷茶不加糖。我也想坐下歇一会儿。'}]})
 for(const c of game.clues.filter(c=>c.stage===0))if(c.roleId==='jiangyuan'){act(who,r.id,'inspect',{clueId:c.id});act(who,r.id,'share',{clueId:c.id})}else act(who,r.id,'requestEvidence',{roleId:c.roleId})
 act(who,r.id,'choose',{missionId:'jiangyuan-0',optionId:'open'});act(who,r.id,'solve',{answer:'BAC'});act(who,r.id,'advance')
 act(who,r.id,'chat',{target,text:'上一幕我们说好喝什么？'});lease=store.leaseJob(r.id);assert.ok(JSON.stringify(lease.context).includes(promise));assert.equal(lease.context.story.place,'录音工作间')
 store.completeJob(r.id,lease.job.id,lease.job.leaseId,{segments:[{kind:'speech',text:'薄荷茶，不加糖。我记着呢。'}]})
 act(who,r.id,'chat',{target:'public',text:'这里天怎么还亮着？'});lease=store.leaseJob(r.id);assert.ok(!JSON.stringify(lease.context).includes(promise),'private pair agreement does not become public memory')
 store.completeJob(r.id,lease.job.id,lease.job.leaseId,{segments:[{kind:'speech',text:'六月的白夜，天黑得慢。我们先把这份录音看完。'}]})
 r=act(who,r.id,'image',{target:'public',text:'看看苏棠的立绘'});assert.match(r.messages.at(-1).image,/scriptanime-iceland-role-sutang-/)
 act(who,r.id,'image',{target:'public',text:'重新画苏棠在录音工作间喝茶'});lease=store.leaseJob(r.id,'image');assert.equal(lease.imageInput.scriptScene.contentEdition,game.contentEdition);assert.ok(lease.imageInput.scriptScene.referenceIds.every(id=>id.startsWith('scriptanime-iceland-')))
 assert.equal(scriptImagePlan(old,0,'看看当前场景').asset.id,'scriptanime-duet-scene-0')
 assert.equal(scriptImagePlan(game,0,'看看当前场景').asset.id,'scriptanime-iceland-scene-0')
 console.log(`PASS ${journeys} complete old/new edition journeys, both solo roles, four two-person outcomes, resume, wrong answers, privacy and cross-act promises`)
}finally{store.close();if(!root.startsWith(base+path.sep))throw Error('Invalid cleanup');fs.rmSync(root,{recursive:true,force:true})}
