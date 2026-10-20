import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import * as ai from '../server/aiApi.js'
import {createWholePaperAiRunner} from '../server/wholePaperAi.js'
import {loadStemAcademicProvider} from '../server/stemAcademicProvider.js'

assert.equal(typeof ai.studentProviderConfig,'function','student-only academic provider configuration must exist')
const signing='synthetic-stem-deepseek-signing',now=Math.floor(Date.now()/1000)
const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),b=Buffer.from(JSON.stringify({iss:'ieltsist.com',aud:'stem.ieltsist.com',sub:'ielts:9982',iat:now,exp:now+600})).toString('base64url')
const token=h+'.'+b+'.'+crypto.createHmac('sha256',signing).update(h+'.'+b).digest('base64url')
fs.mkdirSync(path.resolve('.tmp-test'),{recursive:true});const root=fs.mkdtempSync(path.resolve('.tmp-test/stem-deepseek-'))
const env={AI_PROVIDER:'openai',OPENAI_API_KEY:'synthetic-old-provider',OPENAI_CHAT_BASE_URL:'https://old.invalid/v1',OPENAI_API_PROTOCOL:'chat-completions',OPENAI_COACH_MODEL:'old-text',OPENAI_VISION_MODEL:'old-vision',STEM_INTERNAL_AUTH_KEY:signing,STEM_ACADEMIC_PROVIDER:'deepseek',STEM_ACADEMIC_DEEPSEEK_API_KEY:'synthetic-academic-key',STEM_TAVERN_PROVIDER:'deepseek',STEM_TAVERN_DEEPSEEK_API_KEY:'synthetic-tavern-key'}
const generic=ai.providerConfig(env),calls=[],realFetch=globalThis.fetch
const settingsPath=path.join(root,'academic-provider.json'),keyFile=path.join(root,'deepseek.key')
assert.equal(loadStemAcademicProvider({env:{},settingsPath}),null)
assert.equal(loadStemAcademicProvider({env:{DEEPSEEK_KEY:'synthetic-unused'},settingsPath}),null)
fs.writeFileSync(keyFile,'synthetic-file-key',{mode:0o600})
const settings={schemaVersion:'stem-academic-provider.v1',provider:'deepseek',model:'deepseek-flash',apiKeyFile:'deepseek.key',reasoningEffort:'low'}
fs.writeFileSync(settingsPath,JSON.stringify(settings),{mode:0o600})
assert.equal(loadStemAcademicProvider({env:{},settingsPath}).apiKey,'synthetic-file-key')
assert.equal(loadStemAcademicProvider({env:{},settingsPath}).thinkingMode,'enabled')
fs.writeFileSync(settingsPath,JSON.stringify({...settings,apiKeyFile:'../wrong.key'}));assert.equal(loadStemAcademicProvider({env:{},settingsPath}).apiKey,'')
fs.writeFileSync(settingsPath,JSON.stringify({...settings,enabled:false}));assert.equal(loadStemAcademicProvider({env:{},settingsPath}),null)
fs.writeFileSync(settingsPath,'{invalid');assert.equal(loadStemAcademicProvider({env:{},settingsPath}).apiKey,'')
let fail=false
const scored={summary:'示例评分。',provisionalScore:1,maxScore:2,reviewRequired:false,missingPages:[],missingQuestions:[],questionResults:[{questionLabel:'Q1',provisionalScore:1,maxScore:2,confidence:0.9,reviewRequired:false,rationale:'方法正确，算术错误。',evidence:['Student answer page 1'],criteria:[{label:'Method',awarded:1,maxScore:1,comment:'正确移项。'},{label:'Accuracy',awarded:0,maxScore:1,comment:'结果错误。'}]}]}
globalThis.fetch=async(url,options)=>{
 const address=String(url)
 if(address==='https://api.deepseek.com/v1/chat/completions'||address==='https://old.invalid/v1/chat/completions'){
  const body=JSON.parse(options.body);calls.push({url:address,body})
  if(fail)return new Response('private-upstream-error-fixture',{status:503})
  const paper=JSON.stringify(body.messages).includes('stem-paper-marking-visual-request-v1')
  const answer=paper?JSON.stringify(scored):'合成测试答案。'
  if(body.stream)return new Response('data: '+JSON.stringify({choices:[{delta:{content:answer},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})
  return new Response(JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}})
 }
 if(address.startsWith('http://127.0.0.1:'))return realFetch(url,options)
 throw Error('Unexpected network request in isolated test')
}
const api=ai.createAiApi({env,libraryRoot:root,allowedSubjects:new Set(),telemetry:()=>{}})
const server=http.createServer((req,res)=>api(req,res,()=>{res.statusCode=404;res.end()}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base='http://127.0.0.1:'+server.address().port
const request=async(body,route='/api/ai/coach')=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});return{status:r.status,json:await r.json()}}
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlYV5sAAAAASUVORK5CYII='
try{
 const text=await request({feature:'answers',message:'请完整解答 2+2',context:{view:'practice'},provider:'untrusted',thinking:{type:'disabled'}})
 assert.equal(text.json.provider,'deepseek');assert.deepEqual(calls.at(-1).body.thinking,{type:'enabled'});assert.equal(calls.at(-1).body.reasoning_effort,'low')
 const photo=await request({feature:'answers',message:'请检查图片中的题目',imageDataUrls:[image],context:{view:'practice'}})
 assert.equal(photo.json.provider,'deepseek');assert.ok(calls.at(-1).body.messages.at(-1).content.some(part=>part.type==='image_url'))
 const tavern=await request({feature:'tavern',persona:'keeper',message:'你好'})
 assert.equal(tavern.json.provider,'deepseek');assert.deepEqual(calls.at(-1).body.thinking,{type:'disabled'})
 const stream=await fetch(base+'/api/ai/coach/stream',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({feature:'answers',message:'请完整解答 3+3',context:{view:'practice'}})})
 assert.match(await stream.text(),/event: done/);assert.deepEqual(calls.at(-1).body.thinking,{type:'enabled'})
 const runner=createWholePaperAiRunner({env,telemetry:()=>{}})
 const result=await runner({job:{id:'synthetic-stem-01'},answerPages:[{page:1,dataUrl:image}],questionPaperPages:[{page:1,dataUrl:image}],markSchemePages:[{page:1,dataUrl:image}]})
 assert.equal(result.provider,'deepseek');assert.equal(result.provisionalScore,1);assert.equal(result.maxScore,2)
 assert.deepEqual(calls.at(-1).body.response_format,{type:'json_object'});assert.deepEqual(calls.at(-1).body.thinking,{type:'enabled'})
 assert.deepEqual(ai.providerConfig(env),generic,'background/generic provider configuration must not change')
 const disabled=ai.studentProviderConfig({...env,STEM_ACADEMIC_PROVIDER:'legacy'});assert.equal(disabled.coach.model,'old-text')
 const missing=ai.studentProviderConfig({...env,STEM_ACADEMIC_DEEPSEEK_API_KEY:''});assert.equal(ai.providerCandidates(missing.coach).length,0)
 fail=true;const before=calls.length,failed=await request({feature:'answers',message:'保留此输入',context:{view:'practice'}})
 assert.notEqual(failed.json.mode,'ai');assert.equal(calls.length,before+1);assert.ok(!JSON.stringify(failed.json).includes('private-upstream-error'))
 console.log('PASS_STEM_DEEPSEEK text/photo/stream/paper/thinking/tavern-isolation/background-unchanged/fail-closed')
}finally{api.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));globalThis.fetch=realFetch}
