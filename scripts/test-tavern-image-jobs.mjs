import assert from 'node:assert/strict'
import {createTavernImageJobs} from '../server/tavernImageJobs.js'
import {createTavernImageGenerator} from '../server/tavernImageGeneration.js'
let resolve,calls=0,time=1000
const jobs=createTavernImageJobs({now:()=>time,generator:{generate(input){calls++;assert.equal(input.longJob,true);return new Promise(r=>{resolve=r})}}})
const input={ownerId:'ielts:3',persona:'horror-guide',prompt:'画窗',requestId:'image-job-test-01'}
assert.equal(jobs.submit(input).status,'processing');assert.equal(jobs.submit(input).status,'processing');assert.equal(calls,1)
assert.throws(()=>jobs.status('ielts:4',input.requestId),e=>e.statusCode===404)
assert.throws(()=>jobs.submit({...input,prompt:'换图'}),e=>e.statusCode===409)
resolve({bytes:Buffer.from('image'),mimeType:'image/png'});await jobs.drain()
assert.equal(jobs.status(input.ownerId,input.requestId).status,'completed');assert.equal(jobs.result(input.ownerId,input.requestId).bytes.toString(),'image')
time+=600001;assert.throws(()=>jobs.status(input.ownerId,input.requestId),e=>e.statusCode===404)
const png=Buffer.from([137,80,78,71,13,10,26,10]),env={TAVERN_IMAGE_API_KEY:'fixture-only',TAVERN_IMAGE_BASE_URL:'https://fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'}
const gen=createTavernImageGenerator({env,fetchImpl:async url=>url.endsWith('/images/generations')?{ok:true,json:async()=>({data:[{url:'https://dashscope-463f.oss-accelerate.aliyuncs.com/image.png'}]})}:{ok:true,headers:{get:k=>k==='content-type'?'image/png':String(png.length)},arrayBuffer:async()=>png}})
assert.deepEqual((await gen.generate(input)).bytes,png)
console.log('PASS async image jobs: replay, owner fence, expiry, long-job budget and verified provider OSS delivery host')
