import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {createScriptRoomApi} from './helpers/historical-script-fixture.mjs'
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/romance-api-'))
let calls=0,seq=0
const api=createScriptRoomApi({root,authenticate:req=>req.headers['x-owner'],sendJson:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))},readBody:async req=>{let body='';for await(const piece of req)body+=piece;return JSON.parse(body)},generate:async()=>{
 calls++
 return JSON.stringify({segments:[{kind:'speech',text:calls===1?'广播室门口那碗冷面，你吃之前总把香菜一根根挑出来，后来我才知道你不吃。':'新裙子那次，机器其实早修完了，我躲在后间。'}],attitude:'信任'})
}})
const server=http.createServer((req,res)=>api.handle(req,res,new URL(req.url,'http://local')).then(handled=>{if(!handled){res.statusCode=404;res.end()}}))
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base=`http://127.0.0.1:${server.address().port}/api/ai/script-rooms`
async function request(tail,body){const response=await fetch(base+tail+'?clientVersion=2',{method:body?'POST':'GET',headers:{'x-owner':'ielts:91000501','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.status,200);return response.json()}
const latestReply=r=>{const last=r.messages.findLast(m=>m.actor==='repair'&&m.target==='letter');return{text:last.sourceMessageId?r.messages.filter(m=>m.sourceMessageId===last.sourceMessageId).map(m=>m.text).join('\n'):last.text}}
try{
 let r=await request('',{scriptId:'before-rain',scriptVersion:2,requestId:'guard-create-001'})
 const act=async(type,extra={})=>{r=await request('/'+r.id+'/actions',{type,revision:r.revision,requestId:'guard-api-'+(++seq),...extra});return r}
 await act('ready');await act('start')
 await act('chat',{target:'repair',text:'讲一件以前相处的小事'})
 await api.drain();r=await request('/'+r.id)
 let reply=latestReply(r)
 assert.match(reply.text,/不吃香菜的是我/);assert.doesNotMatch(reply.text,/你吃之前总把香菜/)
 assert.equal(calls,1,'the authored response guard adds no provider latency')
 await act('chat',{target:'repair',text:'新裙子那次到底为什么让我等？'})
 await api.drain();r=await request('/'+r.id);reply=latestReply(r)
 assert.match(reply.text,/不是提前修好以后故意躲/);assert.equal(calls,2)
 assert.equal(r.stage,0);assert.equal(r.publicClues.length,0)
 assert.ok(r.jobs.every(j=>j.status==='done'))
 console.log('PASS romance API: contradictory past motive and actor/player preference reversal never reach saved dialogue; no extra model call or game-state change')
}finally{await api.drain();api.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true})}
