import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {createScriptRoomApi} from '../server/scriptRoomApi.js'
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/case-guidance-'));let calls=0,seq=0
const api=createScriptRoomApi({root,authenticate:req=>req.headers['x-owner'],sendJson:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))},readBody:async req=>{let b='';for await(const c of req)b+=c;return JSON.parse(b)},generate:async()=>{calls++;return JSON.stringify({segments:[{kind:'narration',text:'可以先区分不同事件的时间，不把自己的猜测当成已经核实的事实。'}]})}})
const server=http.createServer((req,res)=>api.handle(req,res,new URL(req.url,'http://local')))
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/ai/script-rooms`
async function req(tail,body){const res=await fetch(base+tail+'?clientVersion=2',{method:body?'POST':'GET',headers:{'x-owner':'ielts:91000910','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(res.status,200);return res.json()}
try{
 let r=await req('',{scriptId:'before-rain',scriptVersion:2,requestId:'case-guidance-create'})
 const act=async(type,extra={})=>{r=await req('/'+r.id+'/actions',{type,...extra,revision:r.revision,requestId:'case-guide-'+(++seq)});return r}
 await act('ready');await act('start');await act('chat',{target:'public',text:'主持人，这局共同要查什么，现在怎么推进？'})
 await api.drain();r=await req('/'+r.id)
 assert.equal(calls,0,'operational guidance comes from authoritative rules, not a model guessing controls')
 const m=r.messages.findLast(m=>m.actor==='dm');assert.match(m.text,/本幕任务/);assert.match(m.text,/我的搜证位置/);assert.doesNotMatch(m.text,/核验答案|本幕决定/,'first-time help gives the next step, not the entire future checklist');assert.equal(m.kind,'system');assert.equal(m.uiGuidance,true);assert.doesNotMatch(m.text,/结论.{0,10}写进.{0,4}我的身份/)
 assert.equal(r.phase,'play');assert.equal(r.publicClues.length,0)
 await act('chat',{target:'dm',text:'怎样区分六年前的选择与八年前的感情？'})
 await api.drain();assert.equal(calls,1,'interpretation questions still use the character/DM generator')
 console.log('PASS case operational guidance: canonical controls, no state side effect or provider latency; interpretation remains AI-driven')
}finally{await api.drain();api.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true})}
