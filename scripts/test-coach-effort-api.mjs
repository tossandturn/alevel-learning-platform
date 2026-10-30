import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {createAiApi} from '../server/aiApi.js'
import {createTavernConversationStore} from '../server/tavernConversationStore.js'
fs.mkdirSync('.tmp-test',{recursive:true});const root=fs.mkdtempSync(path.resolve('.tmp-test/coach-effort-api-'))
const signing='synthetic-effort-signing-key',at=Math.floor(Date.now()/1000)
const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),claims=Buffer.from(JSON.stringify({iss:'ieltsist.com',aud:'stem.ieltsist.com',sub:'ielts:8813',iat:at,exp:at+3600})).toString('base64url'),token=header+'.'+claims+'.'+crypto.createHmac('sha256',signing).update(header+'.'+claims).digest('base64url')
const stores=['keeper','admissions-advisor','ielts-teacher'].map(persona=>createTavernConversationStore({root:path.join(root,persona),allowedPersonas:[persona],generatedResultReceipts:persona!=='keeper',rejectDeleteWhilePending:persona!=='keeper'}))
const requests=[],realFetch=globalThis.fetch
globalThis.fetch=async(url,options)=>{if(!String(url).startsWith('https://api.deepseek.com/'))return realFetch(url,options);const body=JSON.parse(options.body);requests.push(body);return body.stream?new Response('data: '+JSON.stringify({choices:[{delta:{content:'4'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}):new Response(JSON.stringify({choices:[{message:{content:'4'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}})}
const api=createAiApi({env:{STEM_INTERNAL_AUTH_KEY:signing,STEM_ACADEMIC_PROVIDER:'deepseek',STEM_ACADEMIC_DEEPSEEK_API_KEY:'synthetic-effort-key',STEM_TAVERN_PROVIDER:'deepseek',STEM_TAVERN_DEEPSEEK_API_KEY:'synthetic-effort-key'},libraryRoot:root,allowedSubjects:new Set(['9702']),tavernConversationStore:stores[0],admissionsConversationStore:stores[1],ieltsTeacherConversationStore:stores[2],authorizeCoachRequest:async()=>({coachAccess:{assessmentState:'ordinary-practice',solutionAllowed:true}}),telemetry:()=>{}})
const server=http.createServer((req,res)=>api(req,res,()=>{res.statusCode=404;res.end('{}')}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port
async function post(url,body){const r=await realFetch(base+url,{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});const raw=await r.text();let value;try{value=JSON.parse(raw)}catch{value=raw.split('\n\n').filter(x=>x.includes('event: done')).map(x=>JSON.parse(x.split('\n').find(y=>y.startsWith('data: ')).slice(6))).at(-1)}return{status:r.status,value}}
try{
 for(const endpoint of ['/api/ai/coach','/api/ai/coach/stream'])for(const level of ['low','high','max']){const r=await post(endpoint,{feature:'answers',message:'Solve 2+2.',reasoningEffort:level});assert.equal(r.status,200);assert.equal(r.value.mode,'ai');assert.equal(requests.at(-1).reasoning_effort,level,'academic endpoint dropped the student choice')}
 const before=requests.length;assert.equal((await post('/api/ai/coach',{feature:'answers',message:'2+2',reasoningEffort:'medium'})).status,400);assert.equal(requests.length,before)
 for(const [prefix,persona]of [['admissions','admissions-advisor'],['ielts-teacher','ielts-teacher'],['tavern','keeper']]){
  const resumed=await post('/api/ai/'+prefix+'/conversations/resume',prefix==='tavern'?{persona}:{});assert.equal(resumed.status,200);let revision=resumed.value.conversation.revision;const conversationId=resumed.value.conversation.id
  for(const level of ['low','high','max']){const endpoint=prefix==='tavern'?'/api/ai/coach':'/api/ai/'+prefix+'/stream',body={conversationId,clientTurnId:'effort-'+prefix+'-'+level,expectedRevision:revision,message:'Hello',reasoningEffort:level,...(prefix==='tavern'?{feature:'tavern',persona}:{})};const r=await post(endpoint,body);assert.equal(r.status,200,prefix);assert.equal(r.value.mode,'ai',prefix);assert.equal(requests.at(-1).reasoning_effort,level,prefix+' dropped effort');assert.deepEqual(requests.at(-1).thinking,{type:'enabled'});const calls=requests.length;assert.equal((await post(endpoint,body)).status,200);assert.equal(requests.length,calls,'completed replay generated twice');const conflict=await post(endpoint,{...body,reasoningEffort:level==='max'?'low':'max'});assert.equal(conflict.status,409,'same turn ID cannot replay another effort');assert.equal(requests.length,calls);revision=r.value.conversation.revision}
 }
 console.log('Coach effort API: academic JSON/SSE, both advisers, Tavern, validation and effort-bound replay PASS.')
}finally{globalThis.fetch=realFetch;server.closeAllConnections();await new Promise(r=>server.close(r));for(const store of stores)store.close?.();assert.equal(path.dirname(root),path.resolve('.tmp-test'));fs.rmSync(root,{recursive:true,force:true})}
