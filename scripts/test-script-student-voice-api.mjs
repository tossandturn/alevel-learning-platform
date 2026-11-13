import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {Readable} from 'node:stream'
import {createScriptRoomApi} from '../server/scriptRoomApi.js'
import {publicScriptCatalog,newScriptGame} from '../server/scriptGameCatalog.js'
import {dialogueVoiceIssues,scriptVoice} from '../server/roleVoices.js'
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/student-voice-api-')),seen=new Set()
let calls=0,seq=0,pending=[],projected=[]
const api=createScriptRoomApi({root,authenticate:()=> 'ielts:91881001',readBody:async req=>{let value='';for await(const piece of req)value+=piece;return JSON.parse(value)},sendJson:(res,status,value)=>{res.status=status;res.value=value},generate:async messages=>{calls++;projected.push(JSON.parse(messages[1].content));assert.ok(pending.length,'repair bounded to supplied responses');return JSON.stringify({segments:[{kind:'speech',text:pending.shift()}]})}})
const nonce=()=>`student-voice-${++seq}`
async function req(tail='',body){const r=Readable.from(body?[JSON.stringify(body)]:[]);r.method=body?'POST':'GET';r.headers={};const res={setHeader(){}};await api.handle(r,res,new URL('https://fixture/api/ai/script-rooms'+tail+'?clientVersion=2'));assert.equal(res.status,200,JSON.stringify(res.value?.error));return res.value}
const act=async(id,type,data={})=>req('/'+id+'/actions',{type,...data,revision:(await req('/'+id)).revision,requestId:nonce()})
try{
 assert.equal((await req('/catalog')).scripts.length,3)
 for(const {id} of publicScriptCatalog())for(const role of newScriptGame(id,2).roles){
  const game=newScriptGame(id,2),human=game.roles.find(r=>r.id!==role.id),voice=scriptVoice(id,role)
  seen.add(voice.cadence);assert.equal(voice.name,role.name);assert.ok(voice.examples.every(e=>!dialogueVoiceIssues(e.reply).length))
  let room=await req('',{scriptId:id,scriptVersion:2,requestId:nonce()})
  if(room.myRoleId!==human.id)await act(room.id,'claim',{roleId:human.id})
  await act(room.id,'ready');await act(room.id,'start')
  const before=calls;pending=['这句话我记下了。','好啊，先歇一会儿。我也有点累了。'];projected=[]
  await act(room.id,'chat',{target:role.id,text:'先不聊任务，我想歇一会儿。'});await api.drain();room=await req('/'+room.id)
  assert.equal(calls-before,2);assert.equal(room.jobs.at(-1).status,'done');assert.equal(projected[0].actor.voiceProfile.name,role.name)
  assert.equal(projected[0].contentEdition,game.contentEdition)
  if(role.card.student){assert.match(projected[0].actor.voiceProfile.gender,/18岁/);assert.doesNotMatch(JSON.stringify(projected[0].actor),/大二|大三|工业设计系|应用数学系|成年大学生|二十六岁|三十二岁|村口老钟/)}
  assert.ok(!room.messages.some(m=>m.text==='这句话我记下了。'))
  assert.ok(room.messages.some(m=>m.actor===role.id&&m.text.includes('先歇一会儿')))
  assert.equal(room.publicClues.length,0);assert.equal(room.stage,0)
  await act(room.id,'leave')
 }
 assert.equal(seen.size,10,'ten currently offered voices, not the 22 archived profiles')
}finally{await api.drain();api.close()}
console.log('PASS real default API for all 10 current actors: typed canon, one bounded repair, no canned reply, no fact/state mutation or retired fixture injection')
