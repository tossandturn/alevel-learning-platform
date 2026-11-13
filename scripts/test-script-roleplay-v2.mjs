import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {SCRIPT_GAMES,scriptGame} from './helpers/historical-script-fixture.mjs'
import {createScriptRoomStore} from './helpers/historical-script-fixture.mjs'
import {pinTestRoomEdition} from './helpers/pin-test-room-edition.mjs'
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/roleplay-v2-'))
let store=createScriptRoomStore({root}),seq=0
const nonce=()=>`roleplay-test-${++seq}`
const act=(who,r,type,extra={})=>store.act(who,r.id,{type,revision:store.get(who,r.id).revision,requestId:nonce(),...extra})
try{
 assert.ok(SCRIPT_GAMES.every(g=>g.version===2),'new games must use v2 while retaining immutable v1')
 for(const game of SCRIPT_GAMES){
  assert.equal(scriptGame(game.id,1).version,1)
  assert.equal(game.roles.length,4)
  for(const role of game.roles){
   assert.ok(role.card?.habit&&role.card?.desire&&role.card?.contradiction)
   assert.equal(role.card.beats.length,3);assert.equal(role.missions.length,3)
   assert.ok(role.card.examples.length>=2)
   assert.equal(new Set(role.missions.map(m=>m.id)).size,3)
  }
  for(const selected of game.roles){
   const who=`ielts:${2000+seq}`
   let r=store.create(who,{scriptId:game.id,scriptVersion:2,requestId:nonce()})
   pinTestRoomEdition(root,r.id,game);r=store.get(who,r.id)
   if(selected.id!==r.myRoleId)r=act(who,r,'claim',{roleId:selected.id})
   r=act(who,r,'ready');r=act(who,r,'start')
   assert.equal(r.publicClues.length,0,'AI does not dump evidence at the start')
   assert.equal(r.myMissions.length,1,'future decisions stay hidden')
   assert.ok(!JSON.stringify(r.myRole).includes(selected.card.beats[2].memory),'future lore omitted from identity view')
   assert.throws(()=>act(who,r,'choose',{missionId:selected.missions[2].id,optionId:selected.missions[2].options[0].id}),e=>e.code==='script_mission_locked')
   const clue=game.clues.find(c=>c.stage===0&&c.roleId===selected.id)
   assert.throws(()=>act(who,r,'choose',{missionId:selected.missions[0].id,optionId:selected.missions[0].options[0].id}),e=>e.code==='script_mission_evidence')
   r=act(who,r,'inspect',{clueId:clue.id});r=act(who,r,'share',{clueId:clue.id})
   for(const seat of r.seats.filter(s=>s.control==='ai'))r=act(who,r,'requestEvidence',{roleId:seat.id})
   assert.equal(r.publicClues.length,4)
   if(game.acts[0].puzzle)r=act(who,r,'solve',{answer:game.acts[0].puzzle.answers[0]})
   assert.throws(()=>act(who,r,'advance'),e=>e.code==='script_mission_pending')
   const m=r.myMissions[0],p={type:'choose',missionId:m.id,optionId:m.options[1].id,requestId:nonce(),revision:r.revision}
   r=store.act(who,r.id,p);assert.equal(r.myMissions[0].choiceId,m.options[1].id)
   assert.equal(store.act(who,r.id,p).revision,r.revision,'choice retry is idempotent')
   r=act(who,r,'advance');assert.equal(r.stage,1)
   r=act(who,r,'chat',{target:'dm',text:'我当前还要完成什么？'})
   const job=store.leaseJob(r.id)
   assert.ok(!JSON.stringify(job.context).includes(selected.card.beats[2].memory))
   store.completeJob(r.id,job.job.id,job.job.leaseId,{text:'看看你的任务卡，再核对已公开的证据。'})
   store.close();store=createScriptRoomStore({root})
   r=store.get(who,r.id);assert.equal(r.myMissions[0].choiceId,m.options[1].id)
   act(who,r,'leave')
  }
 }
 // An already-running v1 snapshot must always load its pinned story, not the latest catalog.
 let r=store.create('ielts:2',{scriptId:'before-rain',requestId:nonce()})
 const db=new DatabaseSync(path.join(root,'script-rooms.sqlite'))
 const snapshot=JSON.parse(db.prepare('SELECT snapshot FROM script_rooms WHERE id=?').get(r.id).snapshot)
 snapshot.scriptVersion=1;db.prepare('UPDATE script_rooms SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot),r.id);db.close()
 r=act('ielts:2',r,'ready');r=act('ielts:2',r,'start')
 assert.equal(r.scriptVersion,1);assert.equal(r.publicClues.length,3);assert.deepEqual(r.myMissions,[])
 console.log('PASS: 16 role cards, private staged missions, evidence conversations, idempotency/restart and pinned v1 compatibility')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
