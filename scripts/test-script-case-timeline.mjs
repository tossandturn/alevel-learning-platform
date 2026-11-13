import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {createScriptRoomApi} from './helpers/historical-script-fixture.mjs'
import {guardCaseFixedVisit} from '../server/scriptRomanceCase.js'
for(const text of ['我21:05进入旧广播室，21:09离开。','我21:05进入旧广播室，不是广播室旁边的材料间。','林序没有进旧广播室，我21:05进去拿材料。']){
 const value={segments:[{kind:'speech',text}]};assert.equal(guardCaseFixedVisit(value,{story:{case:true},actor:{id:'repair'}}),value,'retain correct visits and denials of invented alternate rooms')
}
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/case-timeline-'));let calls=0,n=0
const api=createScriptRoomApi({root,authenticate:req=>req.headers['x-owner'],sendJson:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))},readBody:async req=>{let b='';for await(const c of req)b+=c;return JSON.parse(b)},generate:async()=>{calls++;return JSON.stringify({segments:[{kind:'speech',text:'我21:05进广播室旁边的材料间，21:09出来，没有进旧广播室。'}]})}})
const server=http.createServer((req,res)=>api.handle(req,res,new URL(req.url,'http://local')));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base=`http://127.0.0.1:${server.address().port}/api/ai/script-rooms`
async function req(tail,body){const res=await fetch(base+tail+'?clientVersion=2',{method:body?'POST':'GET',headers:{'x-owner':'ielts:91000920','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(res.status,200);return res.json()}
try{
 let r=await req('',{scriptId:'before-rain',scriptVersion:2,requestId:'case-timeline-create'})
 const act=async(type,extra={})=>{r=await req('/'+r.id+'/actions',{type,...extra,revision:r.revision,requestId:'case-timeline-'+(++n)});return r}
 await act('ready');await act('start');await act('chat',{target:'repair',text:'今晚你进去的时间和地点是什么？'})
 await api.drain();r=await req('/'+r.id)
 const last=r.messages.findLast(m=>m.actor==='repair'&&m.target==='letter'),reply={text:last.sourceMessageId?r.messages.filter(m=>m.sourceMessageId===last.sourceMessageId).map(m=>m.text).join('\n'):last.text}
 assert.match(reply.text,/21:05进入旧广播室/,'a fixed visit cannot become a visit to an invented side room')
 assert.doesNotMatch(reply.text,/旁边的材料间|没有进旧广播室/);assert.equal(calls,1,'authored fact guard needs no second model call')
 assert.equal(r.stage,0);assert.equal(r.publicClues.length,0)
 console.log('PASS case fixed-visit guard: invented alternate location never becomes saved dialogue; no extra generation or state change')
}finally{await api.drain();api.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true})}
