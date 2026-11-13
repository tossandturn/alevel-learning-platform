import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {createAiApi} from '../server/aiApi.js'

const workspace=path.resolve('.tmp-test');fs.mkdirSync(workspace,{recursive:true})
const root=fs.mkdtempSync(path.join(workspace,'diagram-consent-')),key='synthetic-diagram-consent-key'
const now=Math.floor(Date.now()/1000),head=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),body=Buffer.from(JSON.stringify({iss:'ieltsist.com',aud:'stem.ieltsist.com',sub:'ielts:7002',iat:now,exp:now+600})).toString('base64url'),token=head+'.'+body+'.'+crypto.createHmac('sha256',key).update(head+'.'+body).digest('base64url')
const question='需要我补一张受力图说明吗？',calls=[],image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlpeR0AAAAASUVORK5CYII='
const recipe={version:'stem-force-v1',title:'Falling object',body:'ball',description:'Air resistance is ignored.',axes:'horizontal',forces:[{kind:'weight',label:'mg',source:'Earth gravity in the stated setup'}]}
const answer='重力竖直向下。\n\n```stem-diagram\n'+JSON.stringify(recipe)+'\n```\n\n'+question
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r('http://127.0.0.1:'+s.address().port)))
let failure=false,exam=false
const upstream=http.createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);const b=JSON.parse(Buffer.concat(chunks));calls.push(b)
 if(failure){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"synthetic unavailable"}');return}
 if(b.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});for(let i=0;i<answer.length;i+=5)res.write('data: '+JSON.stringify({choices:[{delta:{content:answer.slice(i,i+5)}}]})+'\n\n');res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')}
 else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}))}
})
const provider=await listen(upstream),options={env:{AI_PROVIDER:'qwen',STEM_INTERNAL_AUTH_KEY:key,COACH_AI_API_KEY:'synthetic',COACH_AI_BASE_URL:provider,COACH_AI_MODEL:'fixture',VISION_AI_API_KEY:'synthetic',VISION_AI_BASE_URL:provider,VISION_AI_MODEL:'fixture'},libraryRoot:root,coachJobsRoot:root,allowedSubjects:new Set(['9702']),authorizeCoachRequest:()=>exam?{coachAccess:{binding:'authoritative-attempt',assessmentState:'active-exam',solutionAllowed:false}}:null}
let api=createAiApi(options)
const server=http.createServer((req,res)=>api(req,res,()=>{res.statusCode=404;res.end()})),origin=await listen(server)
const base={feature:'answers',helpIntent:'worked-solution',message:'Explain the forces on this falling ball. Ignore air resistance.',diagramFormat:'stem-diagram-v1',context:{view:'coach-photo',subject:{code:'9702',name:'Physics'},stage:'AS'}}
async function request(url,payload,method='POST'){
 const response=await fetch(origin+url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})}),text=await response.text();let data;try{data=JSON.parse(text)}catch{};return{status:response.status,text,data}
}
function events(text){return text.split(/\r?\n\r?\n/).flatMap(block=>{const type=block.match(/^event: (.+)$/m)?.[1],data=block.match(/^data: (.+)$/m)?.[1];return type&&data?[{type,...JSON.parse(data)}]:[]})}
function noDiagram(text){assert.doesNotMatch(text,/stem-diagram|stem-force-v1|"forces"|"elements"/)}
function hasDiagram(text){assert.match(text,/```stem-diagram/);assert.doesNotMatch(text,/stem-force-v1|"source"/)}
try{
 const first=await request('/api/ai/coach',base)
 assert.equal(first.status,200,JSON.stringify(first.data));noDiagram(first.data.answer);assert.equal(calls.length,1,'one initial model call, no separate diagram assessment')
 assert.deepEqual(first.data.diagramOffer,{type:'force',question})
 assert.equal(first.data.diagramFormat,'stem-diagram-v1','response metadata preserves renderer capability without authorizing drawing')
 assert.doesNotMatch(calls.at(-1).messages[0].content,/stem-force-v1|Element schemas/)
 const firstSse=await request('/api/ai/coach/stream',{...base,imageDataUrls:[image]});const firstEvents=events(firstSse.text),done=firstEvents.find(e=>e.type==='done')
 assert.equal(firstSse.status,200);noDiagram(firstEvents.map(e=>e.text||e.answer||'').join(''));assert.deepEqual(done.diagramOffer,{type:'force',question});assert.ok(firstEvents.some(e=>e.type==='delta'&&e.text.includes('重力')))
 assert.match(JSON.stringify(calls.at(-1).messages),/image_url/,'the original photo remains evidence in the first text response')
 const draw=await request('/api/ai/coach',{...base,message:'请补受力图说明，不重复整篇答案。',diagramIntent:'draw',history:[{role:'user',content:base.message},{role:'assistant',content:first.data.answer}]})
 hasDiagram(draw.data.answer);assert.equal(draw.data.diagramOffer,undefined);assert.doesNotMatch(draw.data.answer,/需要我补一张受力图/);assert.match(calls.at(-1).messages[0].content,/supplement/)
 const declined=await request('/api/ai/coach/stream',{...base,diagramIntent:'decline'})
 noDiagram(events(declined.text).map(e=>e.text||e.answer||'').join(''));assert.doesNotMatch(declined.text,/需要我补一张受力图/);assert.equal(events(declined.text).find(e=>e.type==='done').diagramOffer,undefined)
 const direct=await request('/api/ai/coach',{...base,message:'Please draw a free-body diagram.'});hasDiagram(direct.data.answer)
 const quoted=await request('/api/ai/coach',{...base,message:'题干是“Draw a free-body diagram”，先解释要求。'});noDiagram(quoted.data.answer)
 const old=await request('/api/ai/coach',{...base,diagramFormat:undefined});noDiagram(old.data.answer);assert.equal(old.data.diagramOffer,undefined)
 const count=calls.length
 assert.equal((await request('/api/ai/coach',{...base,diagramIntent:'unknown'})).status,400);assert.equal(calls.length,count)
 assert.equal((await request('/api/ai/coach/jobs/cj-diagraminvalid12345678',{...base,diagramIntent:'unknown'})).status,400,'invalid intent is rejected before reserving a durable job');assert.equal(calls.length,count)
 const jobId='cj-diagramconsent12345678',created=await request('/api/ai/coach/jobs/'+jobId,base);assert.equal(created.status,202)
 let job;for(let i=0;i<50;i++){job=await request('/api/ai/coach/jobs/'+jobId,null,'GET');if(['succeeded','failed'].includes(job.data.status))break;await new Promise(r=>setTimeout(r,20))}
 assert.equal(job.data.status,'succeeded');noDiagram(job.data.result.answer);assert.deepEqual(job.data.result.diagramOffer,{type:'force',question})
 const finishedCalls=calls.length;await request('/api/ai/coach/jobs/'+jobId,base);assert.equal(calls.length,finishedCalls)
 assert.equal((await request('/api/ai/coach/jobs/'+jobId,{...base,diagramIntent:'draw'})).status,409,'consent cannot silently reuse a different request receipt')
 await api.close();api=createAiApi(options)
 const restored=await request('/api/ai/coach/jobs/'+jobId,null,'GET');assert.deepEqual(restored.data.result.diagramOffer,job.data.result.diagramOffer);assert.equal(calls.length,finishedCalls)
 exam=true;assert.equal((await request('/api/ai/coach',{...base,diagramIntent:'draw'})).status,403);assert.equal(calls.length,finishedCalls)
 exam=false;failure=true;const unavailable=await request('/api/ai/coach',base);assert.equal(unavailable.data.diagramOffer,undefined,'provider failure is never a completed invitation')
 console.log(JSON.stringify({status:'PASS',cases:['default-json','default-photo-sse','one-call-first-answer','confirmed-supplement','refusal-sse','explicit-request','quoted-source','legacy-client','invalid-intent','durable-offer','idempotency','changed-receipt-conflict','restart','exam','provider-failure'],syntheticProviderCalls:calls.length}))
}finally{
 await api.close();server.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>upstream.close(r))])
 assert.equal(path.dirname(root),workspace);assert.match(path.basename(root),/^diagram-consent-/);fs.rmSync(root,{recursive:true})
}
