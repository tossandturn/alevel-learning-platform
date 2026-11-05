import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {createScriptRoomApi} from '../server/scriptRoomApi.js'
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/recollection-api-'))
let calls=0,seq=0
const invented='不算错，是我先看见演员动了'
const api=createScriptRoomApi({root,authenticate:req=>req.headers['x-owner'],sendJson:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))},readBody:async req=>{let body='';for await(const piece of req)body+=piece;return JSON.parse(body)},generate:async messages=>{
 calls++
 if(calls===2)assert.match(messages.at(-1).content,/引语/,'bounded repair must explain unsupported recollection, not only JSON formatting')
 return JSON.stringify({segments:[{kind:'speech',text:calls===1||calls>=4?`以前你皱眉说：“${invented}。”`:calls===2?'我记得那次彩排，你把灯提前亮了，我们后来一起重新对准了提示点。': '你刚才说过“周六桥边见面”，这句话我听到了。'}]})
}})
const server=http.createServer((req,res)=>api.handle(req,res,new URL(req.url,'http://local')).then(done=>{if(!done){res.statusCode=404;res.end()}}))
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base=`http://127.0.0.1:${server.address().port}/api/ai/script-rooms`
async function req(tail,body){const res=await fetch(base+tail+'?clientVersion=2',{method:body?'POST':'GET',headers:{'x-owner':'ielts:91000681','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(res.status,200);return res.json()}
try{
 let r=await req('',{scriptId:'one-more-stop',scriptVersion:2,requestId:'recollection-create-01'})
 const act=async(type,extra={})=>{r=await req('/'+r.id+'/actions',{type,...extra,revision:r.revision,requestId:'recollection-'+(++seq)});return r}
 await act('ready');await act('start');await act('chat',{target:'jiangyuan',text:'我们以前有哪件小事让你想起来会笑？'})
 await api.drain();r=await req('/'+r.id)
 assert.equal(calls,2,'unsupported invented past quote requires a bounded repair')
 assert.equal(r.jobs.at(-1).status,'done');assert.ok(!r.messages.some(m=>m.actor==='jiangyuan'&&m.text.includes(invented)))
 await act('chat',{target:'jiangyuan',text:'我刚才说过“周六桥边见面”，你记住了吗？'})
 await api.drain();r=await req('/'+r.id);assert.equal(calls,3,'a supported quote adds no model call');assert.equal(r.jobs.at(-1).status,'done')
 await act('chat',{target:'jiangyuan',text:'以前那次彩排，我当时说过什么？'})
 await api.drain();r=await req('/'+r.id);assert.equal(calls,5);assert.equal(r.jobs.at(-1).status,'failed','two unsupported generations are never stored as memories')
 assert.ok(!r.messages.some(m=>m.actor==='jiangyuan'&&m.text.includes(invented)))
 assert.equal(r.stage,0);assert.equal(r.publicClues.length,0)
 console.log('PASS recollection provenance: unsupported past quote repaired once, supported quote unchanged, repeated fabrication never committed')
}finally{await api.drain();api.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true})}
