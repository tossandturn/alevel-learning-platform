import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createAiApi } from '../server/aiApi.js'
import { createTavernImageGenerator, TAVERN_GENERATED_IMAGE_MAX_BYTES } from '../server/tavernImageGeneration.js'

const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4])
const env={TAVERN_IMAGE_API_KEY:'fixture-only',TAVERN_IMAGE_BASE_URL:'https://fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'}
let now=1_800_000_000_000,providerCalls=0,lastBody=null
const fetchImpl=async(url,options)=>{
 providerCalls++
 if(String(url).endsWith('/images/generations')){
  lastBody=JSON.parse(options.body)
  return{ok:true,json:async()=>({data:[{url:'https://dashscope-result-fixture.oss-cn-shenzhen.aliyuncs.com/result.png?sig=fixture'}]})}
 }
 return{ok:true,headers:{get(name){return name==='content-type'?'image/png':String(png.length)}},arrayBuffer:async()=>png.buffer.slice(png.byteOffset,png.byteOffset+png.byteLength)}
}
const generator=createTavernImageGenerator({env,fetchImpl,now:()=>now})
const result=await generator.generate({ownerId:'ielts:55',persona:'horror-guide',prompt:'画一盏雾里的河灯'})
assert.deepEqual(result.bytes,png)
assert.equal(result.mimeType,'image/png')
assert.equal(lastBody.model,'qwen-image-3.0')
assert.equal(lastBody.n,1)
assert.match(lastBody.prompt,/雨窗茶室·00:17/)
assert.match(lastBody.prompt,/雾里的河灯/)
assert.match(lastBody.prompt,/No sexual content/)
await assert.rejects(()=>generator.generate({ownerId:'ielts:55',persona:'horror-guide',prompt:'再画一张'}),error=>error.statusCode===429&&error.code==='tavern_image_rate_limited')
assert.equal(providerCalls,2,'rate limits prevent a second provider charge during cooldown')
let cachedCalls=0
const cachedGenerator=createTavernImageGenerator({env,fetchImpl:async(...args)=>{cachedCalls++;return fetchImpl(...args)}})
const sameRequest={ownerId:'ielts:5501',persona:'horror-guide',prompt:'画一盏河灯',requestId:'image-idempotency-01'}
const cachedResults=await Promise.all([cachedGenerator.generate(sameRequest),cachedGenerator.generate(sameRequest)])
assert.deepEqual(cachedResults[0].bytes,cachedResults[1].bytes)
assert.equal(cachedCalls,2,'same image retry shares one provider request and one image download')
await cachedGenerator.generate(sameRequest)
assert.equal(cachedCalls,2,'completed retry reuses the bounded cached image')
await assert.rejects(()=>cachedGenerator.generate({...sameRequest,prompt:'换一个画面'}),error=>error.statusCode===409)
now+=31_000
await generator.generate({ownerId:'ielts:55',persona:'horror-guide',prompt:'画一盏河灯'})
for(let index=0;index<4;index++){now+=31_000;await generator.generate({ownerId:'ielts:55',persona:'horror-guide',prompt:'画雨夜茶室'})}
now+=31_000
await assert.rejects(()=>generator.generate({ownerId:'ielts:55',persona:'horror-guide',prompt:'再画一张'}),error=>error.statusCode===429&&error.code==='tavern_image_daily_limit')
await assert.rejects(()=>generator.generate({ownerId:'guest',persona:'horror-guide',prompt:'画一只猫'}),error=>error.statusCode===401)
await assert.rejects(()=>generator.generate({ownerId:'ielts:55',persona:'keeper',prompt:'画一个房间'}),error=>error.statusCode===400)
const callsBeforeBlocked=providerCalls
await assert.rejects(()=>generator.generate({ownerId:'ielts:55',persona:'horror-guide',prompt:'画血腥内脏'}),error=>error.statusCode===400&&error.code==='tavern_image_content_blocked')
assert.equal(providerCalls,callsBeforeBlocked,'unsafe image prompts are rejected before contacting the paid provider')
await assert.rejects(()=>createTavernImageGenerator({env:{},fetchImpl}).generate({ownerId:'ielts:56',persona:'horror-guide',prompt:'画一盏灯'}),error=>error.statusCode===503&&error.code==='tavern_image_not_configured')
await assert.rejects(()=>createTavernImageGenerator({env:{...env,TAVERN_IMAGE_BASE_URL:'https://evil.invalid/compatible-mode/v1'},fetchImpl}).generate({ownerId:'ielts:57',persona:'horror-guide',prompt:'画一盏灯'}),error=>error.statusCode===503&&error.code==='tavern_image_config_invalid')
const unsafeGenerator=createTavernImageGenerator({env,fetchImpl:async url=>String(url).endsWith('/images/generations')?{ok:true,json:async()=>({data:[{url:'https://attacker.invalid/steal'}]})}:assert.fail('untrusted image URL must never be fetched')})
await assert.rejects(()=>unsafeGenerator.generate({ownerId:'ielts:58',persona:'horror-guide',prompt:'画一盏灯'}),error=>error.statusCode===502&&error.code==='tavern_image_output_invalid')
const oversizedGenerator=createTavernImageGenerator({env,fetchImpl:async url=>String(url).endsWith('/images/generations')?{ok:true,json:async()=>({data:[{url:'https://dashscope-result-fixture.oss-cn-shenzhen.aliyuncs.com/result.png'}]})}:{ok:true,headers:{get:name=>name==='content-type'?'image/png':String(TAVERN_GENERATED_IMAGE_MAX_BYTES+1)},arrayBuffer:async()=>new ArrayBuffer(TAVERN_GENERATED_IMAGE_MAX_BYTES+1)}})
await assert.rejects(()=>oversizedGenerator.generate({ownerId:'ielts:59',persona:'horror-guide',prompt:'画一盏灯'}),error=>error.statusCode===502&&error.code==='tavern_image_output_invalid')

const key='tavern-image-route-test-key',owner='ielts:9951',issued=Math.floor(Date.now()/1000)
const jwtHeader=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),jwtPayload=Buffer.from(JSON.stringify({iss:'ieltsist.com',aud:'stem.ieltsist.com',sub:owner,iat:issued,exp:issued+600})).toString('base64url')
const token=jwtHeader+'.'+jwtPayload+'.'+crypto.createHmac('sha256',key).update(jwtHeader+'.'+jwtPayload).digest('base64url')
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'tavern-image-api-'))
let apiCalls=0
const api=createAiApi({env:{STEM_INTERNAL_AUTH_KEY:key},libraryRoot:scratch,allowedSubjects:new Set(),tavernMemoryRoot:path.join(scratch,'memory'),tavernImageGenerator:{async generate(input){apiCalls++;assert.equal(input.ownerId,owner);assert.equal(input.persona,'mystery-guide');return{bytes:png,mimeType:'image/png'}}}})
const server=http.createServer((req,res)=>Promise.resolve(api(req,res,()=>{res.statusCode=404;res.end()})).catch(()=>{res.statusCode=500;res.end()}))
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)))
try{
 const unauthorized=await fetch(base+'/api/ai/tavern/image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({persona:'mystery-guide',prompt:'画一张河岸夜景'})})
 assert.equal(unauthorized.status,401);assert.equal(apiCalls,0)
 const response=await fetch(base+'/api/ai/tavern/image',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({persona:'mystery-guide',prompt:'画一张河岸夜景'})})
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);assert.equal(apiCalls,1)
 const invalid=await fetch(base+'/api/ai/tavern/image',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({persona:'mystery-guide',prompt:'画图',apiKey:'must-not-accept'})})
 assert.equal(invalid.status,400);assert.equal(apiCalls,1)
 const jobPath=base+'/api/ai/tavern/image-jobs/image-http-test-01',jobHeaders={'Content-Type':'application/json',Authorization:'Bearer '+token}
 const job=await fetch(jobPath,{method:'PUT',headers:jobHeaders,body:JSON.stringify({persona:'mystery-guide',prompt:'画河岸',retry:true})})
 assert.equal(job.status,202)
 await new Promise(resolve=>setTimeout(resolve,5))
 const status=await fetch(jobPath,{headers:jobHeaders});assert.equal((await status.json()).status,'completed')
 const delivered=await fetch(jobPath+'/result',{headers:jobHeaders});assert.equal(delivered.status,200);assert.deepEqual(Buffer.from(await delivered.arrayBuffer()),png)
 const replay=await fetch(jobPath,{method:'PUT',headers:jobHeaders,body:JSON.stringify({persona:'mystery-guide',prompt:'画河岸',retry:true})});assert.equal(replay.status,202);assert.equal(apiCalls,2)
 const privateResult=await fetch(jobPath+'/result');assert.equal(privateResult.status,401)
 console.log('Tavern image generation: Singapore-only endpoint validation, explicit request, auth, output bounds, rate limits and binary response PASS')
}finally{api.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));fs.rmSync(scratch,{recursive:true,force:true})}
