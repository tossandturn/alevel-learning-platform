import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {createAiApi} from '../server/aiApi.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'script-api-')),key='synthetic-script-signing-key'
const contexts=[]
let finishImage,imageCalls=0,imageInput
const imageWait=new Promise(resolve=>{finishImage=resolve})
const png=Buffer.from([137,80,78,71,13,10,26,10,0,1,2,3])
const middleware=createAiApi({env:{STEM_INTERNAL_AUTH_KEY:key},tavernMemoryRoot:root,tavernImageGenerator:{async generate(input){imageCalls++;imageInput=input;await imageWait;return{bytes:png,mimeType:'image/png'}}},scriptRoomOptions:{generate:async(messages)=>{contexts.push(JSON.parse(messages[1].content));return JSON.stringify(contexts.length===1?{text:'你已经获胜。',phase:'ended'}:{text:'先把各自看到的时间公开，我们再核对。',attitude:'谨慎'})}}})
const server=http.createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end()}))
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/ai/script-rooms`
const jwt=who=>{const now=Math.floor(Date.now()/1000),a=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),b=Buffer.from(JSON.stringify({iss:'ieltsist.com',aud:'stem.ieltsist.com',sub:`ielts:${who}`,iat:now,exp:now+600})).toString('base64url');return a+'.'+b+'.'+crypto.createHmac('sha256',key).update(a+'.'+b).digest('base64url')}
async function request(who,tail='',body){const response=await fetch(base+tail+'?clientVersion=2',{method:body?'POST':'GET',headers:{'content-type':'application/json',...(who?{authorization:'Bearer '+jwt(who)}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json()}}
try{
 assert.equal((await request(null,'/catalog')).data.scripts.length,6)
 assert.equal((await request(null,'',{scriptId:'before-rain',requestId:'create-noauth'})).status,401)
 const creation={scriptId:'thirteenth-curtain',scriptVersion:2,requestId:'api-create-0001'}
 let r=(await request(1,'',creation)).data
 const legacy=await fetch(base,{method:'POST',headers:{authorization:'Bearer '+jwt(9),'content-type':'application/json'},body:JSON.stringify({scriptId:'before-rain',requestId:'legacy-client-create'})})
 assert.equal((await legacy.json()).scriptVersion,1,'old clients create compatible rooms')
 const romanceCreation={scriptId:'before-rain',scriptVersion:2,requestId:'api-romance-create-01'}
 let romance=(await request(11,'',romanceCreation)).data
 assert.equal(romance.scriptVersion,2,'the new content edition uses the existing native capability')
 assert.equal(romance.genre,'爱情悬疑 · 四人命案')
 assert.equal(romance.contentEdition,undefined,'content binding is server-owned, not a client command')
 assert.equal((await request(11,'',{...romanceCreation,requestId:'api-romance-forged-01',contentEdition:'legacy'})).status,400)
 const romanceLegacyJoin=await fetch(base+'/join',{method:'POST',headers:{authorization:'Bearer '+jwt(12),'content-type':'application/json'},body:JSON.stringify({inviteCode:romance.inviteCode,requestId:'api-romance-legacy-join'})})
 assert.equal(romanceLegacyJoin.status,409,'unsupported old interaction capability cannot claim a romance seat')
 romance=(await request(12,'/join',{inviteCode:romance.inviteCode,requestId:'api-romance-join-01',roleId:'repair'})).data
 assert.equal(romance.scriptVersion,2);assert.equal(romance.seats.filter(s=>s.control==='human').length,2)
 for(const who of [11,12])romance=(await request(who,'/'+romance.id+'/actions',{type:'ready',revision:romance.revision,requestId:'api-romance-ready-'+who})).data
 romance=(await request(11,'/'+romance.id+'/actions',{type:'start',revision:romance.revision,requestId:'api-romance-start-01'})).data
 assert.ok(romance.myRole.biography.length>1000);assert.equal(romance.myRole.card.romance.partnerId,'repair')
 assert.ok(romance.seats.every(s=>!s.secret&&!s.biography),'new cast retains private identity boundaries')
 const legacyGet=await fetch(base+'/'+r.id,{headers:{authorization:'Bearer '+jwt(1)}})
 assert.equal(legacyGet.status,409);assert.equal((await legacyGet.json()).error.code,'script_client_update')
 const legacyJoin=await fetch(base+'/join',{method:'POST',headers:{authorization:'Bearer '+jwt(2),'content-type':'application/json'},body:JSON.stringify({inviteCode:r.inviteCode,requestId:'legacy-join-v2'})})
 assert.equal(legacyJoin.status,409);assert.equal((await request(1,'/'+r.id)).data.seats.filter(s=>s.control==='human').length,1,'unsupported join does not claim a role')
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
 const picture={type:'image',target:'dm',text:'画一张旧剧院舞台',revision:r.revision,requestId:'api-image-0001'}
 r=(await request(1,'/'+r.id+'/actions',picture)).data
 const imageJob=r.jobs.find(j=>j.kind==='image');assert.ok(imageJob)
 // Text workers must not wait behind the much slower image provider.
 r=(await request(1,'/'+r.id+'/actions',{type:'chat',target:'public',text:'配图时继续讨论',revision:r.revision,requestId:'api-image-chat-01'})).data
 for(let i=0;i<20;i++){r=(await request(1,'/'+r.id)).data;if(contexts.length===3)break;await new Promise(resolve=>setTimeout(resolve,10))}
 assert.equal(contexts.length,3);assert.equal(imageCalls,1)
 assert.ok(!JSON.stringify(imageInput).includes('secret'));assert.equal(imageInput.persona,'script-room')
 finishImage()
 for(let i=0;i<20;i++){r=(await request(1,'/'+r.id)).data;if(r.messages.some(m=>m.imageId))break;await new Promise(resolve=>setTimeout(resolve,10))}
 const imageId=r.messages.find(m=>m.imageId).imageId,route=base+'/'+r.id+'/images/'+imageId
 const binary=await fetch(route,{headers:{authorization:'Bearer '+jwt(1)}});assert.equal(binary.status,200);assert.deepEqual(Buffer.from(await binary.arrayBuffer()),png)
 assert.equal((await fetch(route,{headers:{authorization:'Bearer '+jwt(2)}})).status,404)
 assert.equal((await fetch(route)).status,401)
 await request(1,'/'+r.id+'/actions',picture);assert.equal(imageCalls,1)
 console.log('PASS: signed account API, public catalog, join privacy, idempotent AI queue and forbidden fields')
}finally{finishImage();await middleware.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true})}
