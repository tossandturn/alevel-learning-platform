import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {Readable} from 'node:stream'
import {createScriptRoomApi} from '../server/scriptRoomApi.js'
const base=path.resolve(import.meta.dirname,'../../qa'),root=fs.mkdtempSync(path.join(base,'conversation-api-'))
let samples=[],calls=0,seq=0
const api=createScriptRoomApi({root,authenticate:()=> 'ielts:91842001',sendJson:(res,status,value)=>{res.status=status;res.value=value},readBody:async req=>{let s='';for await(const p of req)s+=p;return JSON.parse(s)},generate:async()=>{calls++;const value=samples.shift();assert.ok(value,'unexpected extra repair');return JSON.stringify(value)}})
const req=async(tail='',body)=>{const request=Readable.from(body?[JSON.stringify(body)]:[]);request.method=body?'POST':'GET';request.headers={};const response={setHeader(){}};await api.handle(request,response,new URL('https://fixture/api/ai/script-rooms'+tail+'?clientVersion=2'));assert.equal(response.status,200,JSON.stringify(response.value?.error));return response.value}
const say=text=>({segments:[{kind:'speech',text}]})
try{
 let r=await req('',{scriptId:'one-more-stop',scriptVersion:2,requestId:'conversation-api-create'})
 const act=async(type,extra={})=>{r=await req('/'+r.id);return r=await req('/'+r.id+'/actions',{type,...extra,revision:r.revision,requestId:'conversation-api-'+(++seq)})}
 await act('ready');await act('start')
 const cases=[
  ['收工后不加糖，喝薄荷茶。',say('这句话我记下了。'),{segments:[{kind:'speech',text:'薄荷茶，不加糖。'},{kind:'speech',text:'要带点面包吗？'}]}],
  ['说说你现在想做什么。',say('我想认真总结我们之间的关系。'.repeat(30)),say('想先坐下吃一口。你呢？')],
  ['嗯',say('嗯。你想聊什么？'),say('院子那边挺亮的。你想坐窗边，还是出去坐？')],
  ['先别说了，让我安静一会。',say('好。你想吃点什么吗？'),say('好，歇会儿。')],
 ]
 for(const [trigger,bad,good] of cases){const before=calls;samples=[bad,good];await act('chat',{target:'jiangyuan',text:trigger});await api.drain();r=await req('/'+r.id);assert.equal(calls-before,2);assert.equal(r.jobs.at(-1).status,'done');assert.ok(!r.messages.some(m=>m.text===bad.segments[0].text));if(trigger.startsWith('收工')){const bubbles=r.messages.slice(-2);assert.equal(bubbles[0].sourceMessageId,bubbles[1].sourceMessageId);assert.notEqual(bubbles[0].id,bubbles[1].id);assert.ok(bubbles.every(m=>m.parts.length===1&&!/【江远】/.test(m.text)),'plain-text clients receive distinct short bubbles')}}
 samples=[say('这句话我记下了。'),say('你的话我记住了。')];const before=calls;await act('chat',{target:'jiangyuan',text:'明天这杯茶还是不加糖。'});await api.drain();r=await req('/'+r.id);assert.equal(calls-before,2);assert.equal(r.jobs.at(-1).status,'failed');assert.ok(!r.messages.some(m=>/这句话我记下了|你的话我记住了/.test(m.text)))
 assert.equal(r.stage,0);assert.equal(r.publicClues.length,0)
 console.log('PASS API short bubbles, bounded repair, canned/verbose/passive/pause cases, no failed draft persistence or game-state changes')
}finally{await api.drain();api.close();fs.rmSync(root,{recursive:true,force:true})}
