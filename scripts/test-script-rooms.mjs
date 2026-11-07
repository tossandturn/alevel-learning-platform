import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { SCRIPT_GAMES, publicScriptCatalog } from '../server/scriptGameCatalog.js'
import { createScriptRoomStore } from '../server/scriptRoomStore.js'
import {pinTestRoomEdition} from './helpers/pin-test-room-edition.mjs'

const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/stem-script-test-'))
let now=1800000000000, sequence=0
const store=createScriptRoomStore({root,now:()=>now})
const id=()=>`test-action-${++sequence}`
const act=(owner,room,type,fields={})=>store.act(owner,room.id,{requestId:id(),revision:room.revision,type,...fields})
assert.equal(SCRIPT_GAMES.length,4)
assert.equal(publicScriptCatalog().length,7)
assert.ok(!JSON.stringify(publicScriptCatalog()).includes('secret'))
for(const script of SCRIPT_GAMES){
 assert.equal(script.roles.length,4);assert.equal(script.acts.length,3);assert.equal(script.clues.length,12)
 for(const humans of [1,2,3,4]){
  const owners=Array.from({length:humans},(_,i)=>`ielts:${10000+sequence+i}`)
  let room=store.create(owners[0],{scriptId:script.id,scriptVersion:2,requestId:id()})
  pinTestRoomEdition(root,room.id,script);room=store.get(owners[0],room.id)
  for(let i=1;i<humans;i++)room=store.join(owners[i],{inviteCode:room.inviteCode,roleId:script.roles[i].id,requestId:id()})
  for(const owner of owners){room=store.get(owners[0],room.id);room=act(owner,room,'ready')}
  room=act(owners[0],store.get(owners[0],room.id),'start')
  assert.equal(room.seats.filter(s=>s.control==='ai').length,4-humans)
  for(let stage=0;stage<3;stage++){
   for(let i=0;i<humans;i++){
    const clue=script.clues.find(c=>c.stage===stage&&c.roleId===script.roles[i].id)
    room=act(owners[i],store.get(owners[i],room.id),'inspect',{clueId:clue.id})
    assert.ok(room.myClues.some(c=>c.id===clue.id))
    if(humans>1)assert.ok(!JSON.stringify(store.get(owners[(i+1)%humans],room.id)).includes(clue.text))
    room=act(owners[i],store.get(owners[i],room.id),'share',{clueId:clue.id})
    if(script.version>=2){const m=room.myMissions.find(m=>m.stage===stage);room=act(owners[i],store.get(owners[i],room.id),'choose',{missionId:m.id,optionId:m.options[0].id})}
   }
   if(script.version>=2)for(const seat of room.seats.filter(s=>s.control==='ai'))room=act(owners[0],store.get(owners[0],room.id),'requestEvidence',{roleId:seat.id})
   const puzzle=script.acts[stage].puzzle
   if(puzzle)room=act(owners[0],store.get(owners[0],room.id),'solve',{answer:puzzle.answers[0]})
   for(const owner of owners)room=act(owner,store.get(owner,room.id),'advance')
  }
  assert.equal(room.phase,'vote')
  const choice=script.ballot.options[humans===1?1:0].id
  for(const owner of owners)room=act(owner,store.get(owner,room.id),'vote',{choiceId:choice})
  assert.equal(room.phase,'ended');assert.ok(room.ending?.truth)
  assert.equal(room.ending.choiceId,choice,'AI recommendations must not overrule human choices')
 }
}

let room=store.create('ielts:1',{scriptId:SCRIPT_GAMES[0].id,requestId:id()})
const initial=room
const request={requestId:id(),revision:room.revision,type:'ready'}
room=store.act('ielts:1',room.id,request)
assert.equal(store.act('ielts:1',room.id,request).revision,room.revision)
assert.throws(()=>store.act('ielts:1',room.id,{...request,type:'start'}),/重复请求/)
assert.throws(()=>act('ielts:1',initial,'start'),e=>e.statusCode===409)
assert.throws(()=>store.get('ielts:999',room.id),e=>e.statusCode===404)
assert.throws(()=>act('ielts:999',room,'ready'),e=>e.statusCode===404)
const joined=store.join('ielts:2',{inviteCode:room.inviteCode,roleId:SCRIPT_GAMES[0].roles[1].id,requestId:id()})
assert.throws(()=>act('ielts:2',joined,'start'),e=>e.statusCode===403)
room=act('ielts:2',joined,'ready');room=act('ielts:1',room,'start')
assert.throws(()=>act('ielts:1',room,'inspect',{clueId:SCRIPT_GAMES[0].clues.find(c=>c.stage===2).id}),e=>e.statusCode===403)
assert.throws(()=>act('ielts:1',room,'advance'),e=>e.statusCode===409)
room=act('ielts:1',room,'chat',{text:'只给你看的测试消息',target:SCRIPT_GAMES[0].roles[1].id})
assert.ok(store.get('ielts:2',room.id).messages.some(m=>m.text==='只给你看的测试消息'))
const reopened=createScriptRoomStore({root,now:()=>now})
assert.equal(reopened.get('ielts:1',room.id).revision,room.revision)
room=act('ielts:1',room,'leave');assert.ok(store.get('ielts:2',room.id).isHost)
assert.throws(()=>store.get('ielts:1',room.id),e=>e.statusCode===404)
now+=73*60*60*1000
assert.throws(()=>store.get('ielts:2',room.id),e=>e.statusCode===410)
reopened.close();store.close()
fs.rmSync(root,{recursive:true,force:true})
console.log('PASS: four scripts x 1–4 humans, secrets, phases, votes, idempotency, conflicts, restart, leave and expiry')
