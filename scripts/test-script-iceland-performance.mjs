import assert from 'node:assert/strict'
import * as story from '../server/scriptIcelandRomance.js'
import {scriptActorMessages} from './helpers/historical-script-fixture.mjs'
import {createScriptRoomApi} from './helpers/historical-script-fixture.mjs'
import fs from 'node:fs'
import path from 'node:path'
import {Readable} from 'node:stream'
assert.equal(typeof story.icelandPerformanceContext,'function','Iceland personal dialogue needs its own performance projection')
assert.equal(typeof story.icelandPerformanceIssues,'function')
const context={scriptId:'one-more-stop',story:{iceland:true,stage:0,place:'玻璃温室'},actor:structuredClone(story.ICELAND_GAME.roles[0]),trigger:'收工以后在庭院喝薄荷茶，不加糖，好吗？',target:'jiangyuan',sender:{id:'jiangyuan',name:'江远'},objective:'公开调灯单',evidence:[{id:'i1',text:'fixture'}],messages:[],continuity:{},actorDecision:'先试灯'}
context.actor.biography=context.actor.entryBook
const projected=story.icelandPerformanceContext(context)
assert.equal(projected.dialogueFocus,'personal');assert.equal(projected.evidence.length,0);assert.equal(projected.actorDecision,undefined)
assert.ok(projected.actor.biography.length<300,'small-talk actor projection must not keep the full task-heavy player book')
assert.equal(context.evidence.length,1,'projection does not mutate canonical context')
const payload=JSON.parse(scriptActorMessages(context).at(-1).content);assert.equal(payload.dialogueFocus,'personal');assert.equal(payload.evidence.length,0)
const proposal=text=>({segments:[{kind:'speech',text}]})
assert.ok(story.icelandPerformanceIssues(proposal('上次那杯薄荷茶凉得我舌头发麻。'),context).includes('unsupported-shared-tea-memory'))
assert.equal(story.icelandPerformanceIssues(proposal('薄荷别放太多，我想喝清淡一点。'),context).length,0)
assert.equal(story.icelandPerformanceIssues(proposal('上次那杯薄荷茶很浓。'),{...context,messages:[{actor:'jiangyuan',text:'上次那杯薄荷茶确实很浓。'}]}).length,0,'real visible recollection remains usable')
assert.ok(story.icelandPerformanceIssues(proposal('你那份录音目录就在旁边，可上面缺对应的字母。'),context).includes('recording-index-fact-reversal'))
assert.equal(story.icelandPerformanceIssues(proposal('调灯单没有声音字母，需要对照你的目录。'),context).length,0)
assert.ok(story.icelandPerformanceIssues({...proposal('好呀。'),shareClueId:'i1'},context).includes('personal-dialogue-evidence-push'))
assert.deepEqual(story.icelandPerformanceIssues(proposal('上次那杯茶很香。'),{...context,story:undefined}),[],'other books unchanged')
assert.ok(story.icelandPerformanceIssues(proposal('水纹和门灯还没过我这关。'),{...context,story:{iceland:true,stage:1}}).includes('completed-stage-regression'))
assert.deepEqual(story.icelandPerformanceIssues(proposal('水纹和门灯还没过我这关。'),{...context,story:{iceland:true,stage:0},trigger:'灯光核对了吗'}),[])
assert.ok(story.icelandPerformanceIssues(proposal('不过得先把这顺序调顺，别光安排收工以后的事。'),context).includes('personal-dialogue-task-push'))
assert.ok(story.icelandPerformanceIssues(proposal('先别急着收工，这块板还等着你呢。'),context).includes('personal-dialogue-task-push'))
assert.equal(story.icelandPerformanceIssues(proposal('好啊，热一点。我也想在那张长桌坐会儿。'),context).length,0)
console.log('PASS Iceland personal projection, visible recollection provenance and precise recording-index fact fence')
const base=path.resolve(import.meta.dirname,'../../qa'),root=fs.mkdtempSync(path.join(base,'iceland-performance-'))
let calls=0,seq=0,alwaysBad=false
const api=createScriptRoomApi({root,authenticate:()=> 'ielts:91830101',sendJson:(res,status,value)=>{res.status=status;res.value=value},readBody:async req=>{let body='';for await(const p of req)body+=p;return JSON.parse(body)},generate:async()=>{calls++;return JSON.stringify(proposal(alwaysBad||calls===1?'上次那杯薄荷茶很浓。':'好，不加糖。收工后我也想坐一会儿。'))}})
const req=async(tail='',body)=>{const request=Readable.from(body?[JSON.stringify(body)]:[]);request.method=body?'POST':'GET';request.headers={};const response={setHeader(){}};await api.handle(request,response,new URL('https://fixture/api/ai/script-rooms'+tail+'?clientVersion=2'));assert.equal(response.status,200,JSON.stringify(response.value?.error));return response.value}
try{
 let r=await req('',{scriptId:'one-more-stop',scriptVersion:2,requestId:'iceland-api-create'})
 const act=async(type,extra={})=>{r=await req('/'+r.id);r=await req('/'+r.id+'/actions',{type,...extra,requestId:'iceland-api-'+(++seq),revision:r.revision});return r}
 await act('claim',{roleId:'jiangyuan'});await act('ready');await act('start');await act('chat',{target:'sutang',text:context.trigger});await api.drain();r=await req('/'+r.id)
 assert.equal(calls,2);assert.equal(r.jobs.at(-1).status,'done');assert.ok(!r.messages.some(m=>m.text.includes('上次那杯薄荷茶')));assert.ok(r.messages.some(m=>m.text.includes('好，不加糖')))
 alwaysBad=true;await act('chat',{target:'sutang',text:'我们在庭院喝茶吧'});await api.drain();r=await req('/'+r.id)
 assert.equal(calls,4);assert.equal(r.jobs.at(-1).status,'failed');assert.ok(!r.messages.some(m=>m.text.includes('上次那杯薄荷茶')))
 console.log('PASS API repairs observed unsupported recollection once; repeat invalid output is not persisted')
}finally{await api.drain();api.close();if(!root.startsWith(base+path.sep))throw Error('Invalid cleanup');fs.rmSync(root,{recursive:true,force:true})}
