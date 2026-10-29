import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import {createAiApi,providerConfig} from '../server/aiApi.js'
import {compileTavernMediaCatalog} from '../server/tavernMedia.js'
import {tavernModelContextWindow,createTavernConversationStore} from '../server/tavernConversationStore.js'

const signing='synthetic-deepseek-route-test',now=Math.floor(Date.now()/1000)
const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')
const b=Buffer.from(JSON.stringify({iss:'ieltsist.com',aud:'stem.ieltsist.com',sub:'ielts:9981',iat:now,exp:now+600})).toString('base64url')
const token=h+'.'+b+'.'+crypto.createHmac('sha256',signing).update(h+'.'+b).digest('base64url')
fs.mkdirSync(path.resolve('.tmp-test'),{recursive:true})
const root=fs.mkdtempSync(path.resolve('.tmp-test/tavern-deepseek-'))
const env={AI_PROVIDER:'openai',OPENAI_API_KEY:'synthetic-academic-key',OPENAI_CHAT_BASE_URL:'https://academic.invalid/v1',OPENAI_API_PROTOCOL:'chat-completions',OPENAI_COACH_MODEL:'academic-text-fixture',OPENAI_VISION_MODEL:'academic-vision-fixture',STEM_INTERNAL_AUTH_KEY:signing,STEM_TAVERN_PROVIDER:'deepseek',STEM_TAVERN_DEEPSEEK_API_KEY:'synthetic-tavern-key'}
const sharedBefore=providerConfig(env),calls=[]
const content=Buffer.from('test-image'),sha256=crypto.createHash('sha256').update(content).digest('hex')
const catalog=compileTavernMediaCatalog({schemaVersion:'tavern-media.v1',revision:'test',items:[0,1].map(column=>({id:column?'test-wave':'test-hug',kind:'sticker',caption:column?'挥手':'抱抱',alt:column?'原创猫挥手':'原创猫抱抱',tags:['抱抱'],file:'test-'+sha256.slice(0,16)+'.jpg',sha256,width:960,height:720,frame:{columns:4,rows:3,column,row:0}}))})
const realFetch=globalThis.fetch;let failing=false,jsonEmptyOnce=false,alwaysEmpty=false
globalThis.fetch=async(url,options)=>{
 const address=String(url)
 if(address==='https://api.deepseek.com/v1/chat/completions'||address==='https://academic.invalid/v1/chat/completions'){
  const body=JSON.parse(options.body),deepseek=address.includes('api.deepseek.com')
  calls.push({deepseek,body})
  if(deepseek&&failing)return new Response('private-provider-body-must-not-leak',{status:503})
  if(deepseek&&(alwaysEmpty||jsonEmptyOnce&&body.response_format)){
   jsonEmptyOnce=false;return new Response(JSON.stringify({choices:[{message:{content:''},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}})
  }
  if(body.stream)return new Response('data: '+JSON.stringify({choices:[{delta:{content:'流式回复'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})
  const media=JSON.stringify(body.messages).includes('Media-enabled reply contract')
  const answer=deepseek?(media?JSON.stringify({text:'给你抱抱。',media:['test-hug']}):'旧客户端纯文字。'):'学科回复。'
  return new Response(JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}})
 }
 if(address.startsWith('http://127.0.0.1:'))return realFetch(url,options)
 throw Error('Unexpected external request in isolated test')
}
const api=createAiApi({env,libraryRoot:root,allowedSubjects:new Set(),tavernMemoryRoot:path.join(root,'memory'),tavernMediaCatalog:catalog,telemetry:()=>{}})
const server=http.createServer((req,res)=>api(req,res,()=>{res.statusCode=404;res.end()}))
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base='http://127.0.0.1:'+server.address().port
const request=async(route,body,method='POST')=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,json:await r.json()}}
try{
 const old=await request('/api/ai/coach',{feature:'tavern',persona:'keeper',message:'你好',provider:'openai',model:'untrusted-client-model',thinking:{type:'enabled'}})
 assert.equal(old.json.provider,'deepseek','only Tavern must use the dedicated DeepSeek route')
 assert.equal(old.json.answer,'旧客户端纯文字。')
 assert.deepEqual(calls[0].body.thinking,{type:'disabled'})
 assert.equal(calls[0].body.enable_thinking,undefined)
 assert.equal(calls[0].body.model,'deepseek-flash')
 assert.equal(calls[0].body.temperature,0.8,'Tavern has its own conversational sampling; the client cannot select it')
 assert.ok(calls[0].body.messages[0].content.includes('示例不是聊天历史'))
 const opened=await request('/api/ai/tavern/conversations/resume',{persona:'keeper'})
 const turn={feature:'tavern',persona:'keeper',message:'抱抱我',mediaVersion:'tavern-media.v1',conversationId:opened.json.conversation.id,clientTurnId:'deepseek-fixture-turn-01',expectedRevision:opened.json.conversation.revision}
 const reply=await request('/api/ai/coach',turn)
 assert.equal(reply.json.provider,'deepseek');assert.equal(reply.json.turns[1].media[0].id,'test-hug')
 assert.deepEqual(calls.at(-1).body.response_format,{type:'json_object'})
 const count=calls.length,replay=await request('/api/ai/coach',turn)
 assert.equal(calls.length,count);assert.deepEqual(replay.json.turns,reply.json.turns)
 const history=await request('/api/ai/tavern/conversations/'+turn.conversationId+'/messages?persona=keeper',null,'GET')
 assert.deepEqual(history.json.messages,reply.json.turns)
 const academic=await request('/api/ai/coach',{feature:'answers',message:'请给我完整解答 2+2',context:{view:'practice'}})
 assert.equal(academic.json.provider,'openai');assert.equal(calls.at(-1).body.model,'academic-text-fixture')
 assert.equal(calls.at(-1).body.thinking,undefined)
 assert.equal(calls.at(-1).body.temperature,0.2,'academic sampling is unchanged')
 assert.deepEqual(providerConfig(env),sharedBefore,'shared Coach and vision configuration must remain identical')
 const stream=await fetch(base+'/api/ai/coach/stream',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({feature:'tavern',persona:'keeper',message:'流式测试'})})
 const sse=await stream.text();assert.match(sse,/event: delta/);assert.match(sse,/event: done/);assert.match(sse,/"provider":"deepseek"/)
 assert.deepEqual(calls.at(-1).body.thinking,{type:'disabled'});assert.equal(calls.at(-1).body.stream,true)
 assert.equal(calls.at(-1).body.temperature,0.8,'SSE uses the same Tavern sampling as JSON')
 const retryTurn={...turn,message:'失败后重试',clientTurnId:'deepseek-fixture-turn-02',expectedRevision:reply.json.conversation.revision}
 const beforeFailure=calls.length;failing=true
 const failed=await request('/api/ai/coach',retryTurn)
 assert.notEqual(failed.json.mode,'ai');assert.equal(calls.length,beforeFailure+1,'no unrelated fallback provider may receive Tavern text')
 assert.ok(!JSON.stringify(failed.json).includes('private-provider-body'))
 const reopenedAfterFailure=await request('/api/ai/tavern/conversations/resume',{persona:'keeper'})
 assert.ok(reopenedAfterFailure.json.messages.every(item=>item.status==='complete'&&item.content.trim()),'failed empty assistant records must never break native history normalization')
 assert.deepEqual(reopenedAfterFailure.json.messages,reply.json.turns,'resume exposes complete pairs while preserving failed records for logical retry')
 const pageAfterFailure=await request('/api/ai/tavern/conversations/'+turn.conversationId+'/messages?persona=keeper',null,'GET')
 assert.deepEqual(pageAfterFailure.json.messages,reply.json.turns,'paginated history must use the same complete-pair contract')
 failing=false;const retried=await request('/api/ai/coach',retryTurn)
 assert.equal(retried.json.mode,'ai');assert.equal(retried.json.conversation.turnCount,4)
 const emptyTurn={...turn,message:'只回忆刚才的话题',clientTurnId:'deepseek-fixture-turn-empty',expectedRevision:retried.json.conversation.revision}
 const beforeEmpty=calls.length;jsonEmptyOnce=true
 const rescued=await request('/api/ai/coach',emptyTurn)
 assert.equal(rescued.json.mode,'ai','a stopped but empty DeepSeek JSON response gets one same-provider text-format recovery')
 assert.equal(calls.length,beforeEmpty+2);assert.equal(calls.at(-1).body.response_format,undefined)
 assert.deepEqual(calls.at(-1).body.messages,calls.at(-2).body.messages,'retry preserves exact trusted persona/history/draw')
 const rescueReplay=await request('/api/ai/coach',emptyTurn)
 assert.equal(calls.length,beforeEmpty+2);assert.deepEqual(rescueReplay.json.turns,rescued.json.turns)
 alwaysEmpty=true;const boundedEmptyStart=calls.length
 const bounded=await request('/api/ai/coach',{...emptyTurn,clientTurnId:'deepseek-fixture-turn-empty-limit',expectedRevision:rescued.json.conversation.revision})
 assert.notEqual(bounded.json.mode,'ai');assert.equal(calls.length,boundedEmptyStart+2,'never retry an empty response without a bound')
 alwaysEmpty=false
 assert.equal(tavernModelContextWindow('deepseek-flash').tokens,1_000_000)
 assert.equal(tavernModelContextWindow('deepseek-flash').verified,true)
 const status=await request('/api/ai/status',null,'GET')
 assert.equal(status.json.coachModel,'academic-text-fixture');assert.equal(status.json.visionModel,'academic-vision-fixture')
 assert.equal(status.json.tavernModel,'deepseek-flash');assert.equal(status.json.tavernProvider,'deepseek')
 assert.ok(!JSON.stringify(status.json).includes('synthetic-tavern-key'))
 const previousStore=createTavernConversationStore({root:path.join(root,'memory')})
 const previous=previousStore.resumeConversation({ownerId:'ielts:9981',persona:'study-buddy'})
 const pending=previousStore.beginTurn({ownerId:'ielts:9981',persona:'study-buddy',conversationId:previous.id,clientTurnId:'old-provider-turn-01',expectedRevision:previous.revision,message:'旧对话记住蓝色风筝',requestHash:'synthetic-old-provider-hash'})
 previousStore.completeTurn({ownerId:'ielts:9981',persona:'study-buddy',conversationId:previous.id,clientTurnId:'old-provider-turn-01',leaseId:pending.leaseId,assistantContent:'记住蓝色风筝了。',provider:'qwen',model:'qwen3.7-max'})
 previousStore.close()
 const resumed=await request('/api/ai/tavern/conversations/resume',{persona:'study-buddy'})
 assert.equal(resumed.json.messages.length,2)
 const continued=await request('/api/ai/coach',{feature:'tavern',persona:'study-buddy',message:'继续刚才的话题',conversationId:resumed.json.conversation.id,clientTurnId:'new-provider-turn-02',expectedRevision:resumed.json.conversation.revision})
 assert.equal(continued.json.provider,'deepseek')
 assert.ok(calls.at(-1).body.messages.some(item=>item.content==='记住蓝色风筝了。'),'previous-model history must survive provider migration')
 assert.equal(continued.json.conversation.turnCount,4)
 console.log('PASS_TAVERN_DEEPSEEK_ISOLATION media/history/replay/failure-retry/stream/academic-unchanged/context-window')
}finally{api.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));globalThis.fetch=realFetch}
