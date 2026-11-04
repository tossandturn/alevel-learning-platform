import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {createAiApi} from '../server/aiApi.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'script-api-')),key='synthetic-script-signing-key'
const contexts=[]
const middleware=createAiApi({env:{STEM_INTERNAL_AUTH_KEY:key},tavernMemoryRoot:root,scriptRoomOptions:{generate:async(messages)=>{contexts.push(JSON.parse(messages[1].content));return JSON.stringify(contexts.length===1?{text:'你已经获胜。',phase:'ended'}:{text:'先把各自看到的时间公开，我们再核对。',attitude:'谨慎'})}}})
const server=http.createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end()}))
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/ai/script-rooms`
const jwt=who=>{const now=Math.floor(Date.now()/1000),a=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),b=Buffer.from(JSON.stringify({iss:'ieltsist.com',aud:'stem.ieltsist.com',sub:`ielts:${who}`,iat:now,exp:now+600})).toString('base64url');return a+'.'+b+'.'+crypto.createHmac('sha256',key).update(a+'.'+b).digest('base64url')}
async function request(who,tail='',body){const response=await fetch(base+tail,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(who?{authorization:'Bearer '+jwt(who)}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json()}}
try{
 assert.equal((await request(null,'/catalog')).data.scripts.length,4)
 assert.equal((await request(null,'',{scriptId:'before-rain',requestId:'create-noauth'})).status,401)
 const creation={scriptId:'thirteenth-curtain',requestId:'api-create-0001'}
 let r=(await request(1,'',creation)).data
 assert.equal((await request(1,'',creation)).data.id,r.id)
 assert.equal((await request(2,'/'+r.id)).status,404)
 assert.equal((await request(1,'',{...creation,host:'ielts:2'})).status,400)
 for(const type of ['ready','start']){r=(await request(1,'/'+r.id+'/actions',{type,revision:r.revision,requestId:'api-'+type+'-0001'})).data}
 const p={type:'chat',target:'public',text:'我想先核对每个人的时间。',revision:r.revision,requestId:'api-chat-0001'}
 assert.equal((await request(1,'/'+r.id+'/actions',p)).status,200)
 for(let i=0;i<20;i++){r=(await request(1,'/'+r.id)).data;if(r.jobs.some(j=>j.status==='done'))break;await new Promise(resolve=>setTimeout(resolve,30))}
 assert.ok(r.jobs.some(j=>j.status==='done'));assert.equal(contexts.length,2)
 assert.equal(r.phase,'play');assert.ok(!r.messages.some(m=>m.text==='你已经获胜。'),'invalid state proposal never becomes an authoritative message')
 assert.equal((await request(1,'/'+r.id+'/actions',p)).status,200);assert.equal(contexts.length,2)
 assert.equal((await request(1,'/'+r.id+'/actions',{...p,requestId:'api-inject-0001',revision:r.revision,phase:'ended'})).status,400)
 assert.equal((await request(2,'/'+r.id+'/actions',{type:'close',requestId:'api-other-0001',revision:r.revision})).status,404)
 console.log('PASS: signed account API, public catalog, join privacy, idempotent AI queue and forbidden fields')
}finally{await middleware.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true})}
