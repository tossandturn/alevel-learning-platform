import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createAiApi} from '../server/aiApi.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'coach-job-api-'))
const key='synthetic-coach-job-test-key'
function token(owner=1){const at=Math.floor(Date.now()/1000),a=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),b=Buffer.from(JSON.stringify({iss:'ieltsist.com',aud:'stem.ieltsist.com',sub:`ielts:${owner}`,iat:at,exp:at+600})).toString('base64url');return `${a}.${b}.${crypto.createHmac('sha256',key).update(`${a}.${b}`).digest('base64url')}`}
const listen=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${s.address().port}`)))
let calls=0,exam=false
const provider=http.createServer(async(req,res)=>{
 for await(const chunk of req){} calls++
 res.writeHead(200,{'Content-Type':'text/event-stream'})
 res.write('data: {"choices":[{"delta":{"content":"先看受力图。"}}]}\n\n')
 await new Promise(resolve=>setTimeout(resolve,150))
 res.end('data: {"choices":[{"delta":{"content":"再列方程。"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
})
const p=await listen(provider)
const options={env:{AI_PROVIDER:'qwen',STEM_INTERNAL_AUTH_KEY:key,COACH_AI_API_KEY:'synthetic',COACH_AI_BASE_URL:p,COACH_AI_MODEL:'test',VISION_AI_API_KEY:'synthetic',VISION_AI_BASE_URL:p,VISION_AI_MODEL:'test'},libraryRoot:root,allowedSubjects:new Set(),coachJobsRoot:root,telemetry(){},authorizeCoachRequest:()=>exam?{coachAccess:{binding:'authoritative-attempt',assessmentState:'active-exam',solutionAllowed:false}}:null}
let api=createAiApi(options)
const server=http.createServer((req,res)=>api(req,res,()=>{res.statusCode=404;res.end()}))
const base=await listen(server),id='cj-testing1234567890123',body={feature:'steps',helpIntent:'hint',message:'请详细提示如何解题',context:{view:'coach-photo'}}
const request=async(id,{method='GET',payload,owner=1,auth=true}={})=>{
 const response=await fetch(`${base}/api/ai/coach/jobs/${id}`,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${token(owner)}`}:{})},...(payload?{body:JSON.stringify(payload)}:{})})
 return {status:response.status,body:await response.json()}
}
try{
 assert.equal((await request(id,{method:'POST',payload:body,auth:false})).status,401)
 exam=true;assert.equal((await request(id,{method:'POST',payload:body})).status,403);exam=false
 assert.equal((await request(id,{method:'POST',payload:{...body,feature:'tavern'}})).status,400)
 const first=await request(id,{method:'POST',payload:body});assert.equal(first.status,202)
 const duplicate=await request(id,{method:'POST',payload:body});assert.equal(duplicate.body.created,false)
 assert.equal((await request(id,{method:'POST',payload:{...body,message:'different'}})).status,409)
 assert.equal((await request(id,{owner:2})).status,404)
 await new Promise(resolve=>setTimeout(resolve,250))
 const completed=await request(id)
 assert.equal(completed.body.status,'succeeded')
 assert.match(completed.body.result.answer,/再列方程/)
 assert.equal(calls,1,'retry must not repeat model generation')
 exam=true;assert.equal((await request(id)).status,403,'polling rechecks current assessment authority');exam=false
 // Drop the initial response connection, then recover by client-generated id.
 const lost='cj-lostack1234567890123'
 await new Promise(resolve=>{
   const req=http.request(`${base}/api/ai/coach/jobs/${lost}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token()}`}},res=>{res.destroy();resolve()})
   req.on('error',resolve);req.end(JSON.stringify(body))
 })
 await new Promise(resolve=>setTimeout(resolve,250))
 assert.equal((await request(lost)).body.status,'succeeded')
 assert.equal(calls,2)
 await api.close();api=createAiApi(options)
 assert.equal((await request(lost)).body.result.answer,'先看受力图。再列方程。','completed results remain recoverable after worker restart')
 assert.equal(calls,2)
 console.log('PASS Coach jobs: lost connection, idempotent POST, private GET, policy recheck, restart, unchanged provider.')
}finally{
 await api.close();server.closeAllConnections();provider.closeAllConnections()
 await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>provider.close(r))])
 fs.rmSync(root,{recursive:true})
}
