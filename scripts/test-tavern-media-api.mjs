import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import {createAiApi} from '../server/aiApi.js'
import {compileTavernMediaCatalog} from '../server/tavernMedia.js'
const key='synthetic-media-test-signing-key'
const owner='ielts:9979',now=Math.floor(Date.now()/1000)
const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({iss:'ieltsist.com',aud:'stem.ieltsist.com',sub:owner,iat:now,exp:now+600})).toString('base64url')
const token=header+'.'+body+'.'+crypto.createHmac('sha256',key).update(header+'.'+body).digest('base64url')
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)))
const stop=server=>{server.closeAllConnections?.();return new Promise(resolve=>server.close(resolve))}
const scratch=path.resolve('.tmp-test');fs.mkdirSync(scratch,{recursive:true});const root=fs.mkdtempSync(path.join(scratch,'tavern-media-api-'))
const bytes=Buffer.from('synthetic-public-image-fixture'),sha256=crypto.createHash('sha256').update(bytes).digest('hex'),file='fixture-'+sha256.slice(0,16)+'.jpg';fs.writeFileSync(path.join(root,file),bytes)
const catalog=compileTavernMediaCatalog({schemaVersion:'tavern-media.v1',revision:'test',items:[{id:'comfort-hug',kind:'sticker',caption:'抱抱',alt:'小猫张开手臂',tags:['安慰','抱抱'],file,sha256,width:960,height:720,frame:{columns:4,rows:3,column:1,row:2}}]})
let calls=0,sawContract=false
const provider=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks));calls++;sawContract=JSON.stringify(input.messages).includes('Media-enabled reply contract');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:sawContract?JSON.stringify({text:'给你一个抱抱。',media:['comfort-hug','untrusted-id']}):'纯文字回复。'},finish_reason:'stop'}]}))})
const providerBase=await listen(provider)
const api=createAiApi({env:{AI_PROVIDER:'openai',STEM_INTERNAL_AUTH_KEY:key,OPENAI_API_KEY:'synthetic-media-provider-key',OPENAI_CHAT_BASE_URL:providerBase,OPENAI_API_PROTOCOL:'chat-completions',OPENAI_COACH_MODEL:'fixture-chat'},libraryRoot:root,allowedSubjects:new Set(),tavernMemoryRoot:path.join(root,'memory'),tavernMediaCatalog:catalog,tavernMediaRoot:root})
const server=http.createServer((req,res)=>Promise.resolve(api(req,res,()=>{res.statusCode=404;res.end()})).catch(()=>{res.statusCode=500;res.end()}))
const base=await listen(server)
const call=async(url,payload,method='POST')=>{const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(payload?{body:JSON.stringify(payload)}:{})});return{status:response.status,json:await response.json()}}
try{
 const opened=await call('/api/ai/tavern/conversations/resume',{persona:'keeper'})
 const request={feature:'tavern',persona:'keeper',message:'今天有些难过，抱抱我吧',conversationId:opened.json.conversation.id,clientTurnId:'test-media-api-turn-01',expectedRevision:opened.json.conversation.revision,mediaVersion:'tavern-media.v1'}
 const reply=await call('/api/ai/coach',request)
 assert.equal(reply.status,200);assert.equal(reply.json.mode,'ai');assert.equal(sawContract,true,'media-capable client must receive the model selection contract')
 assert.equal(reply.json.answer,'给你一个抱抱。');assert.equal(reply.json.turns[1].media[0].id,'comfort-hug')
 const replay=await call('/api/ai/coach',request);assert.equal(calls,1,'media replay cannot generate or choose a new picture');assert.deepEqual(replay.json.turns,reply.json.turns)
 const history=await call('/api/ai/tavern/conversations/'+request.conversationId+'/messages?persona=keeper',null,'GET');assert.deepEqual(history.json.messages[1].media,reply.json.turns[1].media)
 const image=await fetch(base+reply.json.turns[1].media[0].src);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes)
 const traversal=await fetch(base+'/api/ai/tavern/media/v1/not-cataloged.jpg');assert.equal(traversal.status,404)
 const invalid=await call('/api/ai/coach',{...request,mediaVersion:'unsupported'});assert.equal(invalid.status,400)
 const old=await call('/api/ai/coach',{...request,mediaVersion:undefined,clientTurnId:'test-media-api-turn-02',expectedRevision:reply.json.conversation.revision,message:'旧版兼容'});assert.equal(old.json.answer,'纯文字回复。');assert.equal(sawContract,false)
 console.log('Tavern media HTTP: AI-selected reply, atomic replay/history, public immutable image, invalid capability and text-only compatibility passed.')
}finally{api.close();await stop(server);await stop(provider)}
