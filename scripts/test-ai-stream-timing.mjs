import assert from 'node:assert/strict'
import {createAiTiming,safeAiTiming} from '../server/aiTiming.js'
import {callCompatibleAiStream} from '../server/aiApi.js'
let now=100
const t=createAiTiming(()=>now)
now=120;t.mark('responseHeadersMs');now=140;t.mark('firstReasoningMs')
now=180;t.mark('firstAnswerMs');now=190;t.mark('firstAnswerMs')
now=250;t.mark('streamCompleteMs');now=255
t.mark('privateText');t.usage({usage:{prompt_tokens:300,prompt_cache_hit_tokens:128,completion_tokens:40,completion_tokens_details:{reasoning_tokens:12},secret:'never'}})
assert.deepEqual(t.snapshot(),{responseHeadersMs:20,firstReasoningMs:40,firstAnswerMs:80,streamCompleteMs:150,outputMs:70,totalMs:155,inputTokens:300,cachedInputTokens:128,outputTokens:40,reasoningTokens:12})
assert.deepEqual(safeAiTiming({firstAnswerMs:null,totalMs:Infinity,inputTokens:'secret',outputMs:-1,prompt:'secret',cachedInputTokens:1e10}),{})
const realFetch=globalThis.fetch,encoder=new TextEncoder(),events=[]
const provider={name:'deepseek',model:'test',protocol:'chat-completions',baseUrl:'http://synthetic.invalid',apiKey:'synthetic'}
try{
 globalThis.fetch=async()=>new Response(new ReadableStream({start(c){
  c.enqueue(encoder.encode(': heartbeat\n\ndata: {"choices":[{"delta":{}}]}\n\n'))
  setTimeout(()=>c.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"never-persist-this"}}]}\n\n')),20)
  setTimeout(()=>c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"x = 4"}}]}\n\n')),70)
  setTimeout(()=>{c.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":128,"completion_tokens":8}}\n\ndata: [DONE]\n\n'))},100)
 }}),{headers:{'content-type':'text/event-stream'}})
 const deltas=[]
 const result=await callCompatibleAiStream(provider,{messages:[],onDelta:s=>deltas.push(s),onTiming(){throw Error('diagnostics failure')},telemetry:e=>events.push(e),timeoutMs:1000})
 assert.equal(result.answer,'x = 4');assert.deepEqual(deltas,['x = 4'])
 const metric=events[0].timing
 assert.ok(metric.firstChunkMs>=15,'heartbeat and empty choice are not a substantive chunk')
 assert.ok(metric.firstAnswerMs>=metric.firstReasoningMs+30)
 assert.ok(metric.streamCompleteMs>=metric.firstAnswerMs+10)
 assert.ok(metric.totalMs<900,'DONE finishes without waiting for HTTP EOF')
 assert.equal(metric.inputTokens,128);assert.doesNotMatch(JSON.stringify(events),/never-persist-this|synthetic-private|apiKey/)
 globalThis.fetch=async()=>{throw new Error('synthetic unavailable')}
 await assert.rejects(callCompatibleAiStream(provider,{messages:[],telemetry:e=>events.push(e)}))
 assert.equal(events.at(-1).finalState,'error');assert.ok(events.at(-1).timing.totalMs>=0)
 assert.equal(events.at(-1).timing.firstAnswerMs,undefined,'missing output is unknown, not zero')
 console.log('PASS stream timing: monotonic offsets, numeric allowlist, reasoning/content separation, semantic completion, usage and failure.')
}finally{globalThis.fetch=realFetch}
