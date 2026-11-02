import assert from 'node:assert/strict'
import http from 'node:http'
import {callCompatibleAiStream} from '../server/aiApi.js'
import {createAiSseDecoder} from '../server/aiSse.js'

const example=': ping\r\nevent: custom\r\ndata: first\r\ndata: second\r\n\r\nevent: discarded\n\ndata: last\n\n'
for(let size=1;size<=example.length;size++){
  const decoder=createAiSseDecoder(),actual=[]
  for(let i=0;i<example.length;i+=size)actual.push(...decoder.push(example.slice(i,i+size)))
  assert.deepEqual(actual,[{event:'custom',data:'first\nsecond'},{event:'',data:'last'}],`framing remains stable at chunk size ${size}`)
}
assert.deepEqual([...createAiSseDecoder().push('data: incomplete')],[],'EOF is not an event delimiter')
assert.throws(()=>[...createAiSseDecoder({maxEventChars:32}).push('data: '+ 'x'.repeat(64))],e=>e.code==='AI_RESPONSE_SCHEMA_INVALID','unbounded unterminated frames must be rejected')

let format='multiline'
const server=http.createServer(async(req,res)=>{
  for await(const part of req){}
  res.writeHead(200,{'content-type':'text/event-stream'})
  if(format==='multiline'){
    res.end(': keep-alive\n\nevent: message\nid: qa-1\ndata: {"choices": [\ndata: {"delta":{"content":"中文解释。"}}]}\n\n'+
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  }else if(format==='bare-cr'){
    res.end('data: {"choices":[{"delta":{"content":"English explanation."}}]}\r\rdata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\rdata: [DONE]\r\r')
  }else if(format==='response-multiline'){
    res.end('event: response.output_text.delta\ndata: {"delta":\ndata: "bounded explanation"}\n\nevent: response.completed\ndata: {"status":"completed"}\n\n')
  }else if(format==='response-snapshot'){
    res.end('event: response.output_text.delta\ndata: {"delta":"A clear answer.","output_index":0,"content_index":0}\n\nevent: response.output_text.done\ndata: {"text":"A clear answer.","output_index":0,"content_index":0}\n\nevent: response.completed\ndata: {"status":"completed"}\n\n')
  }else if(format==='response-reasoning'){
    res.end('event: response.reasoning_text.delta\ndata: {"delta":"INTERNAL_REASONING_SENTINEL"}\n\nevent: response.output_text.delta\ndata: {"delta":"Student answer only."}\n\nevent: response.completed\ndata: {"status":"completed"}\n\n')
  }else if(format==='response-parts'){
    const frames=[['response.output_text.delta',{delta:'First.',output_index:0,content_index:0}],['response.output_text.done',{text:'First.',output_index:0,content_index:0}],['response.output_text.done',{text:'Second.',output_index:0,content_index:1}],['response.function_call_arguments.delta',{delta:'NOT_STUDENT_TEXT'}],['response.completed',{status:'completed'}]]
    res.end(frames.map(([type,data])=>'event: '+type+'\ndata: '+JSON.stringify(data)+'\n\n').join(''))
  }else if(format==='response-conflict'){
    res.end('event: response.output_text.delta\ndata: {"delta":"First"}\n\nevent: response.output_text.done\ndata: {"text":"Different"}\n\nevent: response.completed\ndata: {"status":"completed"}\n\n')
  }else if(format==='response-nested-final'){
    res.end('event: response.completed\ndata: {"response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Recovered final text."}]}]}}\n\n')
  }else if(format==='response-nested-incomplete'){
    res.end('event: response.output_text.delta\ndata: {"delta":"Incomplete text"}\n\nevent: response.completed\ndata: {"response":{"status":"incomplete"}}\n\n')
  }else if(format==='fragmented'){
    const bytes=Buffer.from('\ufeff: heartbeat\r\nevent: message\r\ndata:{"choices":[{"delta":{"content":"公式 x = 4。"}}]}\r\n\r\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n')
    for(let i=0;i<bytes.length;i+=5){res.write(bytes.subarray(i,i+5));await new Promise(r=>setTimeout(r,1))}res.end()
  }else if(format==='truncated'){
    res.end('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n')
  }else res.end('data: {invalid-json}\n\ndata: [DONE]\n\n')
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const provider={name:'openai',baseUrl:'http://127.0.0.1:'+server.address().port,model:'synthetic-sse-framing',apiKey:'synthetic-qa-key'}
async function call(protocol){const deltas=[];const result=await callCompatibleAiStream({...provider,protocol},{messages:[{role:'user',content:'public QA fixture'}],onDelta:t=>deltas.push(t),timeoutMs:1500,totalDeadlineMs:2500,deadlineAt:Date.now()+2500});assert.equal(deltas.join(''),result.answer);return result}
try{
  if(process.argv.includes('--reasoning-only')){format='response-reasoning';assert.equal((await call('responses')).answer,'Student answer only.','private reasoning is never answer text');format='multiline'}
  assert.equal((await call('chat-completions')).answer,'中文解释。','valid multi-line SSE data must be joined before parsing JSON')
  format='bare-cr';assert.equal((await call('chat-completions')).answer,'English explanation.','SSE permits CR-only event framing')
  format='fragmented';assert.equal((await call('chat-completions')).answer,'公式 x = 4。','split CRLF and multibyte UTF-8 must remain intact')
  format='response-multiline';assert.equal((await call('responses')).answer,'bounded explanation','event names must survive until the data event is dispatched')
  format='response-snapshot';assert.equal((await call('responses')).answer,'A clear answer.','final text snapshot must not duplicate already streamed text')
  format='response-reasoning';assert.equal((await call('responses')).answer,'Student answer only.','reasoning events are progress only, never student-visible answer text')
  format='response-parts';assert.equal((await call('responses')).answer,'First.Second.','snapshots belong to their own content part, tool arguments are not answer text')
  format='response-conflict';await assert.rejects(call('responses'),e=>e.code==='AI_RESPONSE_SCHEMA_INVALID')
  format='response-nested-final';assert.equal((await call('responses')).answer,'Recovered final text.')
  format='response-nested-incomplete';await assert.rejects(call('responses'),e=>e.code==='AI_RESPONSE_SCHEMA_INVALID')
  format='truncated';await assert.rejects(call('chat-completions'),e=>e.code==='AI_RESPONSE_SCHEMA_INVALID')
  format='malformed';await assert.rejects(call('chat-completions'),e=>e.code==='AI_RESPONSE_SCHEMA_INVALID')
  console.log('PASS upstream SSE framing: multiline JSON, CR/CRLF, UTF-8 fragmentation, named Responses events and fail-closed completion')
}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
