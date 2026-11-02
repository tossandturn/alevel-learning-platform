import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createAdmissionsAdvisor } from '../server/admissionsAdvisor.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'admissions-target-'))
let calls=0,observedScope=null
const advisor=createAdmissionsAdvisor({
  providerCandidates:[{name:'fixture',model:'fixture-model'}],memoryRoot:root,
  authenticateRequest:request=>request.headers['x-test-owner']==='a'?'ielts:990001':request.headers['x-test-owner']==='b'?'ielts:990002':null,
  researchOptions:{sourceCatalog:[],resolveAddresses:async()=>[{address:'8.8.8.8',family:4}],searchPublicSources:async()=>[],
    readPublicPage:async url=>({url,title:'Curriculum',text:'# Curriculum\nCambridge International AS & A Level develops knowledge and skills. Learners can choose to specialise in a subject area or study a range of subjects. A Level is typically a two-year course.'})},
  callCompatibleAiStream:async(_provider,options)=>{
    calls++
    const envelope=JSON.parse(options.messages.find(message=>message.role==='system'&&message.content.startsWith('Server-owned admissions research envelope.')).content.split('\n').at(-1))
    observedScope=envelope.scope
    const answer='Synthetic complete answer for '+envelope.scope.curriculum
    await options.onDelta(answer)
    return{answer}
  },
})
const server=http.createServer((request,response)=>Promise.resolve(advisor.handle(request,response,new URL(request.url,'http://127.0.0.1'))).then(handled=>{if(!handled){response.statusCode=404;response.end()}}).catch(error=>{response.statusCode=Number(error.statusCode)||500;response.end(JSON.stringify({code:error.code||'test_error'}))}))
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
async function request(endpoint,body,owner='a'){
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/admissions/'+endpoint,{method:'POST',headers:{'content-type':'application/json','x-test-owner':owner},body:JSON.stringify(body)})
 const raw=await response.text()
 if(!response.headers.get('content-type')?.includes('text/event-stream'))return{status:response.status,data:JSON.parse(raw)}
 const events=raw.split('\n\n').flatMap(block=>{const type=block.match(/^event: (.+)/)?.[1],data=block.match(/\ndata: (.+)/)?.[1];return type&&data?[{type,data:JSON.parse(data)}]:[]})
 return{status:response.status,data:events.findLast(event=>event.type==='done')?.data}
}
try{
 const conversation=(await request('conversations/resume',{})).data.conversation
 const body={conversationId:conversation.id,clientTurnId:'typed-target-turn-001',expectedRevision:conversation.revision,message:'请查课程结构。',directoryTarget:{kind:'course',id:'alevel'}}
 const result=await request('stream',body)
 assert.equal(result.data.mode,'ai',JSON.stringify(result))
 assert.equal(result.data.providerStatus,'connected')
 assert.equal(observedScope.curriculum,'A-Level')
 assert.equal(observedScope.institution,null)
 assert.equal(calls,1)
 const replay=await request('stream',body)
 assert.equal(replay.data.replayed,true)
 assert.equal(calls,1,'typed-context replay must not call model twice')
 const conflict=await request('stream',{...body,directoryTarget:{kind:'course',id:'ib'}})
 assert.equal(conflict.status,409,'target type and identity are part of idempotency')
 const foreign=await request('stream',{...body,clientTurnId:'foreign-target-turn'},'b')
 assert.equal(foreign.status,404)
 for(const target of [{kind:'course',id:'unknown-board'},{kind:'course',id:'alevel',url:'http://127.0.0.1/'},{kind:'system',id:'alevel'}]){
   const invalid=await request('stream',{...body,clientTurnId:'invalid-target-'+Math.random().toString(36).slice(2),directoryTarget:target})
   assert.equal(invalid.status,400)
 }
 assert.equal(calls,1)
 console.log('PASS typed admissions target: validated board identity, routing, canonical completion, exact replay, context conflict, owner isolation and invalid fields')
}finally{
 advisor.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
 if(/^admissions-target-[^/\\]+$/.test(path.relative(os.tmpdir(),root)))fs.rmSync(root,{recursive:true})
}
