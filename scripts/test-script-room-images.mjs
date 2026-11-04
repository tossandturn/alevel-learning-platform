import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'script-images-'))
let time=1800000000000,store=createScriptRoomStore({root,now:()=>time}),seq=0
let r=store.create('ielts:1',{scriptId:'thirteenth-curtain',scriptVersion:2,requestId:'image-create-one'})
store.join('ielts:2',{inviteCode:r.inviteCode,roleId:'reporter',requestId:'image-join-two'})
const act=(who,type,more={})=>r=store.act(who,r.id,{type,requestId:`image-action-${++seq}`,revision:store.get(who,r.id).revision,...more})
const png={bytes:Buffer.from([137,80,78,71,13,10,26,10,0,1,2,3]),mimeType:'image/png'}
try{
 act('ielts:1','ready');act('ielts:2','ready');act('ielts:1','start')
 assert.doesNotThrow(()=>act('ielts:1','image',{text:'画一下我看到的剧院舞台',target:'dm'}),'explicit room image action must exist')
 let job=store.leaseJob(r.id)
 assert.equal(job.job.kind,'image');assert.equal(job.imageInput.persona,'script-room')
 assert.ok(!JSON.stringify(job.imageInput).includes('21:02'))
 assert.ok(!JSON.stringify(job.imageInput).includes('secret'))
 assert.equal(store.completeImage(r.id,job.job.id,job.job.leaseId,png),true)
 r=store.get('ielts:1',r.id);let message=r.messages.find(m=>m.imageId)
 assert.ok(message);assert.equal(message.target,'dm')
 assert.deepEqual(Buffer.from(store.image('ielts:1',r.id,message.imageId).bytes),png.bytes)
 assert.throws(()=>store.image('ielts:2',r.id,message.imageId),e=>e.statusCode===404)
 assert.ok(!JSON.stringify(store.get('ielts:2',r.id)).includes(message.imageId))
 store.close();store=createScriptRoomStore({root,now:()=>time})
 assert.deepEqual(Buffer.from(store.image('ielts:1',r.id,message.imageId).bytes),png.bytes)
 act('ielts:1','image',{text:'给大家画一张旧剧院',target:'public'})
 job=store.leaseJob(r.id);store.completeImage(r.id,job.job.id,job.job.leaseId,png)
 const publicImage=store.get('ielts:2',r.id).messages.find(m=>m.imageId)
 assert.ok(publicImage);assert.ok(store.image('ielts:2',r.id,publicImage.imageId).bytes.length)
 assert.throws(()=>store.image('ielts:999',r.id,publicImage.imageId),e=>e.statusCode===404)
 act('ielts:1','image',{text:'画一个后台角落',target:'public'});job=store.leaseJob(r.id)
 store.close();time+=310000;store=createScriptRoomStore({root,now:()=>time})
 assert.equal(store.leaseJob(r.id),null,'uncertain in-flight image must not be auto regenerated after restart')
 assert.equal(store.get('ielts:1',r.id).jobs.find(j=>j.id===job.job.id).status,'failed')
 act('ielts:1','retry',{jobId:job.job.id});job=store.leaseJob(r.id)
 assert.equal(store.completeImage(r.id,job.job.id,job.job.leaseId,{...png,bytes:Buffer.alloc(3*1024*1024)}),false)
 assert.equal(store.get('ielts:1',r.id).phase,'play','image failure does not end or advance game')
 time+=73*3600000;assert.throws(()=>store.image('ielts:1',r.id,publicImage.imageId),e=>e.statusCode===410)
 console.log('PASS: room images are private, stage-bounded, durable, channel-scoped, size-limited and not auto-regenerated after uncertainty')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
