import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createScriptRoomStore} from './helpers/historical-script-fixture.mjs'
import {currentEditorialBooks} from './helpers/historical-script-fixture.mjs'
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/editorial-ties-')),store=createScriptRoomStore({root});let seq=0
const owners=['ielts:91874101','ielts:91874102'],nonce=()=>`editorial-ties-${++seq}`,act=(who,id,type,p={})=>store.act(who,id,{type,...p,revision:store.get(who,id).revision,requestId:nonce()})
try{
 for(const game of currentEditorialBooks()){
  let room=store.create(owners[0],{scriptId:game.id,scriptVersion:2,requestId:nonce()})
  store.join(owners[1],{inviteCode:room.inviteCode,roleId:game.roles[1].id,requestId:nonce()})
  for(const who of owners)act(who,room.id,'ready');room=act(owners[0],room.id,'start')
  for(let stage=0;stage<3;stage++){
   for(const [i,who]of owners.entries()){const c=game.clues.find(c=>c.stage===stage&&c.roleId===game.roles[i].id&&c.required!==false);act(who,room.id,'inspect',{clueId:c.id});room=act(who,room.id,'share',{clueId:c.id})}
   for(const seat of room.seats.filter(s=>s.control==='ai'))act(owners[0],room.id,'requestEvidence',{roleId:seat.id})
   if(game.acts[stage].puzzle)act(owners[0],room.id,'solve',{answer:game.acts[stage].puzzle.answers[0]})
   for(const [i,who]of owners.entries()){const m=game.roles[i].missions.find(m=>m.stage===stage);act(who,room.id,'choose',{missionId:m.id,optionId:m.options[0].id})}
   for(const who of owners)room=act(who,room.id,'advance')
  }
  act(owners[0],room.id,'vote',{choiceId:game.ballot.options[0].id});room=act(owners[1],room.id,'vote',{choiceId:game.ballot.options[1].id})
  assert.equal(room.phase,'ended');assert.equal(room.ending.tie,true);assert.equal(room.ending.choiceId,'tie');assert.ok(room.ending.text.includes(game.tieEnding),game.id+' must use its neutral scene in actual store settlement')
  assert.equal(room.ending.counts[game.ballot.options[0].id],1);assert.equal(room.ending.counts[game.ballot.options[1].id],1)
 }
 console.log('PASS seven real-store 1:1 tie endings: original votes, story-specific neutral scene, fixed truth and independent relationship results')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
