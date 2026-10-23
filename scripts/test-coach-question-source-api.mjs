import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import {createAiApi} from '../server/aiApi.js'
import {studyQuestionBank} from '../src/data/questionBank.js'
const question=studyQuestionBank.find(q=>q.sourceRef?.paper==='9702_m24_qp_22.pdf'&&q.sourceRef.question==='Q2')
const key='source-fixture-signing-key',now=Math.floor(Date.now()/1000),head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({iss:'ieltsist.com',aud:'stem.ieltsist.com',sub:'ielts:7201',iat:now,exp:now+600})).toString('base64url'),token=head+'.'+body+'.'+crypto.createHmac('sha256',key).update(head+'.'+body).digest('base64url')
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlpeR0AAAAASUVORK5CYII='
const teaching='## 答案\n这是合成接口测试答案。\n\n## 解题步骤\n保留公式 \\(v^2=u^2+2as\\)。'
let reply=teaching,fail=false,calls=0,lastBody=null
const listen=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+s.address().port))),close=s=>new Promise(resolve=>{s.closeAllConnections?.();s.close(resolve)})
const provider=http.createServer(async(req,res)=>{const buffers=[];for await(const b of req)buffers.push(b);lastBody=JSON.parse(Buffer.concat(buffers));calls++;if(fail){res.writeHead(503,{'Content-Type':'application/json'});return res.end('{"error":{"message":"synthetic outage"}}')}
 if(lastBody.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});for(const c of reply)res.write('data: '+JSON.stringify({choices:[{delta:{content:c}}]})+'\n\n');res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')}
 else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:reply},finish_reason:'stop'}]}))}})
const url=await listen(provider),api=createAiApi({env:{AI_PROVIDER:'qwen',STEM_ACADEMIC_PROVIDER:'legacy',STEM_INTERNAL_AUTH_KEY:key,COACH_AI_API_KEY:'synthetic-source-key',COACH_AI_BASE_URL:url,COACH_AI_MODEL:'synthetic-coach',VISION_AI_API_KEY:'synthetic-source-key',VISION_AI_BASE_URL:url,VISION_AI_MODEL:'synthetic-vision'},libraryRoot:process.cwd(),allowedSubjects:new Set(['9702']),questionBankProvider:()=>[question]})
const app=http.createServer((req,res)=>Promise.resolve(api(req,res,()=>{res.statusCode=404;res.end()})).catch(()=>{res.statusCode=500;res.end()})),base=await listen(app)
async function post(stream,payload){const r=await fetch(base+'/api/ai/coach'+(stream?'/stream':''),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(payload)});assert.equal(r.status,200);const raw=await r.text();if(!stream)return{value:JSON.parse(raw),raw};const events=raw.split(/\r?\n\r?\n/).filter(x=>x.startsWith('event:')).map(x=>({name:x.split('\n')[0].slice(7),data:JSON.parse(x.split('\n').find(l=>l.startsWith('data: ')).slice(6))}));return{value:events.findLast(x=>x.name==='done')?.data,visible:events.filter(x=>x.name==='delta').map(x=>x.data.text).join(''),raw}}
try{
 for(const stream of [false,true]){
  reply=teaching;const before=calls,result=await post(stream,{feature:'answers',message:question.prompt});assert.equal(result.value.questionSource?.status,'matched','Successful academic responses require a server-resolved source');assert.equal(result.value.questionSource.questionNumber,2);assert.match(result.value.answer,/2024 年 2–3月/);assert.match(result.value.answer,/9702\/22/);assert.equal(calls,before+1,'Source lookup must not call the model again');assert.match(JSON.stringify(lastBody.messages),/Never guess or assert/);if(stream)assert.equal(result.visible,result.value.answer)
  reply=teaching+'\n<question_lookup>'+JSON.stringify({text:question.prompt})+'</question_lookup>';const photo=await post(stream,{feature:'answers',message:'请解答图片里的题目',imageDataUrls:[image]});assert.equal(photo.value.questionSource.method,'recognized-text-match');assert.match(photo.value.answer,/核对题干与数值/);assert.doesNotMatch(photo.raw,/question_lookup|Olympic diver/);assert.match(JSON.stringify(lastBody.messages),/question_lookup/);if(stream)assert.equal(photo.visible,photo.value.answer)
  reply=teaching;const unknown=await post(stream,{feature:'answers',message:'Calculate two plus two.',context:{paper:{year:2026,questionFile:'9702_s26_qp_12.pdf'},question:{id:question.bankId}}});assert.equal(unknown.value.questionSource.status,'unconfirmed');assert.match(unknown.value.answer,/未确认/);assert.doesNotMatch(unknown.value.answer,/2026/)
  reply=teaching+'\n## 题目出处\n编造的 2099 年真题第 99 题';const hallucinated=await post(stream,{feature:'answers',message:'Calculate two plus two.'});assert.doesNotMatch(hallucinated.value.answer,/2099|99 题/);if(stream)assert.doesNotMatch(hallucinated.visible,/2099|99 题/)
 }
 fail=true;const unavailable=await post(true,{feature:'answers',message:question.prompt});assert.notEqual(unavailable.value.answerStatus,'complete');assert.equal(unavailable.value.questionSource,undefined);assert.doesNotMatch(unavailable.value.answer||'',/题目出处/)
 console.log('Coach source API: JSON/SSE, hidden photo hints, first-answer streaming, one provider request, forged sources and outage handling PASS')
}finally{await close(app);await close(provider)}
