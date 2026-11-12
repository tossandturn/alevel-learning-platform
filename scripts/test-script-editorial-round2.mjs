import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'
import {newScriptGame,scriptGame} from '../server/scriptGameCatalog.js'
import {duetOutcomes} from '../server/scriptDuetRomance.js'
import {campusOutcomes} from '../server/scriptCampusElective.js'
import {editorialPacket} from './helpers/script-editorial-review.mjs'
import {pinTestRoomEdition} from './helpers/pin-test-room-edition.mjs'
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/editorial-round2-')),store=createScriptRoomStore({root});let seq=0
const nonce=()=>`round2-${++seq}`,act=(who,id,type,data={})=>store.act(who,id,{type,...data,revision:store.get(who,id).revision,requestId:nonce()})
try{
 for(const id of ['before-rain','thirteenth-curtain']){
  const game=newScriptGame(id,2),owners=game.roles.map((_,i)=>`ielts:${91861000+seq+i}`)
  let room=store.create(owners[0],{scriptId:id,scriptVersion:2,requestId:nonce()})
  for(let i=1;i<4;i++)store.join(owners[i],{inviteCode:room.inviteCode,roleId:game.roles[i].id,requestId:nonce()})
  for(const who of owners)act(who,room.id,'ready');room=act(owners[0],room.id,'start')
  for(let stage=0;stage<3;stage++){
   const required=game.clues.filter(c=>c.stage===stage&&c.required!==false)
   assert.ok(required.every(c=>c.access==='public-investigation'),'new case evidence must be explicitly public investigation records')
   assert.ok(required.every(c=>room.searchOptions.some(s=>s.id===c.id&&/公共调查材料/.test(s.title))),'any player can see neutral evidence access points')
   const foreign=required.find(c=>c.roleId!==game.roles[0].id)
   assert.throws(()=>act(owners[0],room.id,'share',{clueId:foreign.id}),e=>e.code==='script_clue_unknown','public access still requires the sender to inspect the record')
   const future=game.clues.find(c=>c.stage>stage);if(future)assert.throws(()=>act(owners[0],room.id,'inspect',{clueId:future.id}),e=>e.code==='script_clue_locked')
   for(const c of required){act(owners[0],room.id,'inspect',{clueId:c.id});room=act(owners[0],room.id,'share',{clueId:c.id})}
   for(let i=0;i<4;i++){const own=required.find(c=>c.roleId===game.roles[i].id);act(owners[i],room.id,'inspect',{clueId:own.id});act(owners[i],room.id,'choose',{missionId:`${game.roles[i].id}-${stage}`,optionId:'hold'})}
   if(game.acts[stage].puzzle)act(owners[0],room.id,'solve',{answer:game.acts[stage].puzzle.answers[0]})
   for(const who of owners)room=act(who,room.id,'advance')
   assert.equal(room.stage,Math.min(stage+1,2));assert.equal(room.phase,stage===2?'vote':'play')
  }
  assert.ok(!room.messages.some(m=>m.text===game.roles[1].secret),'investigation publication never publishes a private role secret')
  act(owners[0],room.id,'close')
  const old=scriptGame(id,id==='before-rain'?4:2)
  let previous=store.create(owners[0],{scriptId:id,scriptVersion:2,requestId:nonce()});pinTestRoomEdition(root,previous.id,old);act(owners[0],previous.id,'ready');previous=act(owners[0],previous.id,'start')
  assert.throws(()=>act(owners[0],previous.id,'inspect',{clueId:old.clues.find(c=>c.stage===0&&c.roleId!==old.roles[0].id).id}),e=>e.code==='script_clue_locked','published old edition does not acquire new shared evidence permissions')
  act(owners[0],previous.id,'close')
 }
 const ice=newScriptGame('one-more-stop',2)
 assert.ok(ice.roles.every(r=>r.missions[2].options.some(o=>o.id==='consider')),'new Iceland edition needs a real third relationship choice')
 for(const a of ['open','consider','hold'])for(const b of ['open','consider','hold']){
  const outcome=duetOutcomes(ice,{missionChoices:{sutang:{'sutang-2':a},jiangyuan:{'jiangyuan-2':b}}})[0]
  assert.deepEqual(outcome.choices,{sutang:a,jiangyuan:b})
  assert.equal(outcome.status,a==='open'&&b==='open'?'mutual':[a,b].includes('hold')?'not-mutual':'considering')
 }
 assert.equal(duetOutcomes(ice,{missionChoices:{}})[0].status,'unconfirmed')
 assert.equal(scriptGame('one-more-stop',3).roles[0].missions[2].options.length,2,'published old edition remains binary')
 for(const a of ['open','consider','hold'])for(const b of ['open','consider','hold']){
  const owners=['ielts:91861901','ielts:91861902'];let room=store.create(owners[0],{scriptId:ice.id,scriptVersion:2,requestId:nonce()})
  store.join(owners[1],{inviteCode:room.inviteCode,roleId:'jiangyuan',requestId:nonce()});for(const who of owners)act(who,room.id,'ready');room=act(owners[0],room.id,'start')
  for(let stage=0;stage<3;stage++){
   for(const [index,who]of owners.entries()){const role=ice.roles[index],clue=ice.clues.find(c=>c.roleId===role.id&&c.stage===stage);act(who,room.id,'inspect',{clueId:clue.id});act(who,room.id,'share',{clueId:clue.id});act(who,room.id,'choose',{missionId:`${role.id}-${stage}`,optionId:stage===2?[a,b][index]:'open'})}
   if(ice.acts[stage].puzzle)act(owners[0],room.id,'solve',{answer:ice.acts[stage].puzzle.answers[0]})
   for(const who of owners)room=act(who,room.id,'advance')
  }
  for(const who of owners)room=act(who,room.id,'vote',{choiceId:ice.botVote})
  assert.equal(room.phase,'ended');assert.match(room.ending.text,new RegExp(a==='consider'?'苏棠仍想继续相爱':a==='hold'?'苏棠这次不再继续恋爱':'苏棠愿意尝试六个月异地'))
  if([a,b].includes('hold'))assert.doesNotMatch(room.ending.text,/双方共同确认：尝试/)
 }
 // Reversing the exterior four-node cycle from spring 2 is uniquely 2413.
 const exteriorNext={2:3,3:1,1:4,4:2},insideNext=Object.fromEntries(Object.entries(exteriorNext).map(([from,to])=>[to,Number(from)]));let cursor=2,code=''
 for(let i=0;i<4;i++){code+=cursor;cursor=insideNext[cursor]}assert.equal(code,'2413');assert.equal(cursor,2)
 const campus=newScriptGame('last-elective',2)
 for(const [a,b]of [['date','slow'],['slow','date']]){const out=campusOutcomes(campus,{missionChoices:{songmi:{'songmi-2':a},peixu:{'peixu-2':b}}})[0];assert.deepEqual(out.choices,{songmi:a,peixu:b});assert.match(out.text,a==='date'?/宋弥愿意.{0,20}约会/:/宋弥希望先慢慢了解/);assert.match(out.text,b==='date'?/裴叙愿意.{0,20}约会/:/裴叙希望先慢慢了解/)}
 assert.equal(editorialPacket(ice).book.relationshipResults.length,9)
 assert.equal(editorialPacket(newScriptGame('before-rain',2)).book.relationshipResults.length,16)
 for(const id of ['before-rain','thirteenth-curtain','last-midnight','inverted-observatory','one-more-stop','last-elective','venice-blue-hour']){
  const game=newScriptGame(id,2)
  for(const role of game.roles){assert.doesNotMatch(role.entryBook,/这里的玩法|游戏外|AI也不会|不需要玩家/);for(const mission of role.missions){assert.doesNotMatch(mission.prompt,/这里保存|聊天亲自说/);for(const option of mission.options){assert.ok(option.followup?.length>8);assert.equal(option.consequence,undefined)}assert.equal(new Set(mission.options.map(o=>o.followup)).size,mission.options.length)}}
 }
 console.log('PASS editorial round 2: public case investigation without coerced disclosure, private intent callbacks, asymmetric choices and complete outcome tables')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
