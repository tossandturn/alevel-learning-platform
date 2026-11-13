import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {createScriptRoomApi} from './helpers/historical-script-fixture.mjs'
import {newScriptGame} from './helpers/historical-script-fixture.mjs'
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/voice-api-'));let calls=0,seq=0
const bad='我不会替你做决定，选择权始终在你手里。',good='我想见你。这件事，我很认真。',denial='不是我拿的，你再看看桌上。'
const detour='还没有。不过墙上那只钟停在20:58，不能把钟声当报时证据。',careReply='好多了。陪我说会儿话就行。'
const api=createScriptRoomApi({root,authenticate:req=>req.headers['x-owner'],sendJson:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))},readBody:async req=>{let body='';for await(const piece of req)body+=piece;return JSON.parse(body)},generate:async messages=>{
 calls++;const context=JSON.parse(messages[1].content)
 assert.equal(context.actor.voiceProfile.name,'江远')
 if(calls===2)assert.match(messages.at(-1).content,/人物此刻|台词/)
 if(calls===6)return JSON.stringify({text:good,shareClueId:newScriptGame('one-more-stop',2).clues.find(c=>c.roleId==='jiangyuan'&&c.stage===0).id})
 if(calls===7)return JSON.stringify({text:good})
 if(calls===8){assert.equal(context.dialogueFocus,'personal');return JSON.stringify({text:detour})}
 if(calls===9)return JSON.stringify({text:careReply})
 if(calls===10)return JSON.stringify({text:detour})
 return JSON.stringify({text:calls===2?good:calls===3?denial:bad,attitude:'谨慎'})
}})
const server=http.createServer((req,res)=>api.handle(req,res,new URL(req.url,'http://local')).then(done=>{if(!done){res.statusCode=404;res.end()}}))
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base=`http://127.0.0.1:${server.address().port}/api/ai/script-rooms`
async function req(tail,body){const res=await fetch(base+tail+'?clientVersion=2',{method:body?'POST':'GET',headers:{'x-owner':'ielts:91001081','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(res.status,200);return res.json()}
try{
 let r=await req('',{scriptId:'one-more-stop',scriptVersion:2,requestId:'voice-create-00001'})
 const act=async(type,extra={})=>r=await req('/'+r.id+'/actions',{type,...extra,revision:r.revision,requestId:'voice-api-'+(++seq)})
 await act('ready');await act('start');await act('chat',{target:'jiangyuan',text:'我想听你自己想要什么。'})
 await api.drain();r=await req('/'+r.id);assert.equal(calls,2);assert.equal(r.jobs.at(-1).status,'done')
 assert.ok(r.messages.some(m=>m.text===good));assert.ok(!r.messages.some(m=>m.text===bad))
 await act('chat',{target:'jiangyuan',text:'你拿走纸了吗？'});await api.drain();r=await req('/'+r.id)
 assert.equal(calls,3,'ordinary denial costs no additional generation');assert.equal(r.messages.at(-1).text,denial)
 await act('chat',{target:'jiangyuan',text:'继续聊聊。'});await api.drain();r=await req('/'+r.id)
 assert.equal(calls,5,'at most one repair, never an unbounded quality loop');assert.equal(r.jobs.at(-1).status,'failed')
 assert.ok(!r.messages.some(m=>m.text===bad));assert.equal(r.stage,0);assert.equal(r.publicClues.length,0)
 await act('chat',{target:'public',text:'江远，先不聊任务。我想听你自己的愿望。'});await api.drain();r=await req('/'+r.id)
 assert.equal(calls,7,'personal chat must not silently publish a clue');assert.equal(r.publicClues.length,0)
 await act('chat',{target:'jiangyuan',text:'现在缓过来一点了吗？'});await api.drain();r=await req('/'+r.id)
 assert.equal(calls,9,'a care question that turns into evidence exposition gets one repair');assert.equal(r.messages.at(-1).text,careReply);assert.ok(!r.messages.some(m=>m.text===detour))
 await act('chat',{target:'jiangyuan',text:'墙钟停在20:58是什么证据？'});await api.drain();r=await req('/'+r.id)
 assert.equal(calls,10,'an actual evidence question is not suppressed by the care guard');assert.equal(r.messages.at(-1).text,detour)
 console.log('PASS director-language repaired once before persistence, natural denial unchanged, repeated failure not stored')
}finally{await api.drain();api.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true})}
