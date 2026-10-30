import assert from 'node:assert/strict'
import {callCompatibleAi,callCompatibleAiStream} from '../server/aiApi.js'
import {withCoachEffort,coachEffortOutputLimit} from '../server/coachEffort.js'
const original=globalThis.fetch,requests=[]
globalThis.fetch=async(url,options)=>{
 const body=JSON.parse(options.body);requests.push(body)
 if(body.stream)return new Response('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'PRIVATE_TEST_REASONING'}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{content:'Answer 4'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})
 return new Response(JSON.stringify({choices:[{message:{content:'Answer 4'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}})
}
try{
 const base={name:'deepseek',model:'deepseek-flash',protocol:'chat-completions',baseUrl:'http://127.0.0.1:1/v1',apiKey:'test-fixture-only',thinkingMode:'enabled',reasoningEffort:'low'}
 for(const effort of ['low','high','max']){
  const provider=withCoachEffort(base,effort),options={messages:[{role:'user',content:'2+2'}],outputTokenLimit:coachEffortOutputLimit(effort,2048),timeoutMs:1000}
  await callCompatibleAi(provider,options);const body=requests.at(-1);assert.equal(body.reasoning_effort,effort);assert.deepEqual(body.thinking,{type:'enabled'});assert.equal(body.max_tokens,options.outputTokenLimit,'selected effort must retain bounded space for thinking and final content')
  let received='';await callCompatibleAiStream(provider,{...options,onDelta:text=>{received+=text}});assert.equal(requests.at(-1).reasoning_effort,effort);assert.equal(requests.at(-1).max_tokens,options.outputTokenLimit);assert.equal(received,'Answer 4','hidden reasoning must never become student output')
 }
 await callCompatibleAi(base,{messages:[{role:'user',content:'test'}],outputTokenLimit:99999,timeoutMs:1000});assert.equal(requests.at(-1).max_tokens,8192,'legacy output bound stays unchanged')
 assert.equal(base.reasoningEffort,'low')
 console.log('Coach effort transport: JSON/SSE exact settings, bounded output allowance and no reasoning disclosure PASS.')
}finally{globalThis.fetch=original}
