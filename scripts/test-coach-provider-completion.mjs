import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import {createAiApi} from '../server/aiApi.js'

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)))
let mode='complete',providerClosed=0
const upstream=http.createServer(async(req,res)=>{
 for await(const chunk of req){}
 res.writeHead(200,{'content-type':'text/event-stream'})
 res.write('data: {"choices":[{"delta":{"content":"## 答案\\n\\n4\\n\\n## 解题步骤\\n\\n2x = 8，所以 x = 4。"}}]}\n\n')
 res.write(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:mode==='complete'?'stop':'length'}]})}\n\n`)
 res.write('data: [DONE]\n\n')
 // A terminal SSE event, not TCP EOF, is the provider completion boundary.
 const heartbeat=setInterval(()=>res.write(': keep-alive\n\n'),40)
 res.on('close',()=>{clearInterval(heartbeat);providerClosed++})
})
const providerBase=await listen(upstream),key='synthetic-completion-test-key'
const api=createAiApi({env:{STEM_ACADEMIC_PROVIDER:'legacy',STEM_TAVERN_PROVIDER:'legacy',AI_PROVIDER:'openai',OPENAI_API_KEY:'synthetic-key',OPENAI_BASE_URL:providerBase,OPENAI_MODEL:'completion-fixture',STEM_AI_PROVIDER_TIMEOUT_MS:'250',STEM_AI_TOTAL_DEADLINE_MS:'1000',STEM_INTERNAL_AUTH_KEY:key},libraryRoot:process.cwd(),allowedSubjects:new Set()})
const server=http.createServer((req,res)=>api(req,res,()=>{res.writeHead(404);res.end()})),base=await listen(server)
const now=Math.floor(Date.now()/1000),head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({iss:'ieltsist.com',aud:'stem.ieltsist.com',sub:'ielts:42',iat:now,exp:now+300})).toString('base64url'),token=head+'.'+body+'.'+crypto.createHmac('sha256',key).update(head+'.'+body).digest('base64url')
async function request(){const start=Date.now();const response=await fetch(base+'/api/ai/coach/stream',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({feature:'answers',helpIntent:'worked-solution',message:'Solve 2x + 3 = 11.',context:{stage:'AS'}}),signal:AbortSignal.timeout(2500)});return{text:await response.text(),elapsed:Date.now()-start}}
try{
 const result=await request()
 assert.match(result.text,/"providerStatus":"connected"/,'Complete provider SSE must succeed without waiting for socket EOF')
 assert.ok(result.elapsed<700,`Provider completion waited ${result.elapsed} ms for EOF`)
 mode='length';const truncated=await request()
 assert.doesNotMatch(truncated.text,/"providerStatus":"connected"/,'A DONE event must not make token-truncated text complete')
 assert.match(truncated.text,/"partial":true/)
 await new Promise(resolve=>setTimeout(resolve,20));assert.ok(providerClosed>=2,'Release completed provider readers')
 console.log('Provider completion PASS: terminal event ends immediately, keep-alive socket released, truncated answer stays partial.')
}finally{server.closeAllConnections();upstream.closeAllConnections();await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>upstream.close(resolve))}
