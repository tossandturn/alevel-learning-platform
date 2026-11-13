import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createScriptRoomStore} from './helpers/historical-script-fixture.mjs'
import {newScriptGame} from './helpers/historical-script-fixture.mjs'
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/shared-moments-')),store=createScriptRoomStore({root});let seq=0
const host='ielts:91851101',peer='ielts:91851102',nonce=()=>`moments-${++seq}`
const act=(who,id,type,extra={})=>store.act(who,id,{type,...extra,revision:store.get(who,id).revision,requestId:nonce()})
try{
 const game=newScriptGame('last-elective',2)
 let room=store.create(host,{scriptId:game.id,scriptVersion:2,requestId:nonce()})
 store.join(peer,{inviteCode:room.inviteCode,requestId:nonce()});act(host,room.id,'ready');act(peer,room.id,'ready');room=act(host,room.id,'start')
 assert.ok(!room.messages.some(m=>m.sharedMoment),'do not reveal failed drawing before puzzle unlock')
 for(const who of [host,peer]){const v=store.get(who,room.id);act(who,room.id,'inspect',{clueId:v.searchOptions[0].id});act(who,room.id,'share',{clueId:v.searchOptions[0].id})}
 room=act(host,room.id,'solve',{answer:'6,3'})
 assert.equal(room.messages.filter(m=>m.sharedMoment).length,1)
 assert.match(room.messages.find(m=>m.sharedMoment).text,/丑猫/)
 room=act(host,room.id,'solve',{answer:'6,3'});assert.equal(room.messages.filter(m=>m.sharedMoment).length,1,'retries do not repeat a scene prompt')
 room=act(host,room.id,'choose',{missionId:'songmi-0',optionId:'hold'})
 const reflection=room.messages.find(m=>m.choiceReflection)
 assert.ok(reflection?.selfOnly);assert.match(reflection.text,/^私人笔记/);assert.doesNotMatch(reflection.text,/尚未替你|仅自己可见/)
 assert.ok(!store.get(peer,room.id).messages.some(m=>m.id===reflection.id),'private intentions are never broadcast')
 act(peer,room.id,'choose',{missionId:'peixu-0',optionId:'open'});act(host,room.id,'advance');room=act(peer,room.id,'advance');assert.equal(room.stage,1,'optional scene does not create a compulsory conversation gate')
 console.log('PASS shared moments: unlock timing, replay/idempotency, optional progression and private choice reflection')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
