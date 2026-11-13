import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {Readable} from 'node:stream'
import {newScriptGame,publicScriptCatalog} from '../server/scriptGameCatalog.js'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'
import {createScriptRoomApi,scriptActorMessages} from '../server/scriptRoomApi.js'
import {scriptImagePlan} from '../server/scriptArt.js'
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/student-journeys-'))
let seq=0,checked=0,store=createScriptRoomStore({root:path.join(root,'rooms')})
const nonce=()=>`student-journey-${++seq}`
const action=(who,id,type,data={})=>store.act(who,id,{type,...data,revision:store.get(who,id).revision,requestId:nonce()})
try{
 for(const {id} of publicScriptCatalog()){
  const game=newScriptGame(id,2)
  for(let mask=1;mask<1<<game.roles.length;mask++){
   const humans=game.roles.filter((r,i)=>mask&(1<<i)),owners=humans.map((_,i)=>`ielts:${91870000+seq+i}`)
   let room=store.create(owners[0],{scriptId:id,scriptVersion:2,requestId:nonce()})
   if(room.myRoleId!==humans[0].id)action(owners[0],room.id,'claim',{roleId:humans[0].id})
   for(let i=1;i<humans.length;i++)store.join(owners[i],{inviteCode:room.inviteCode,roleId:humans[i].id,clientVersion:2,requestId:nonce()})
   for(const owner of owners)action(owner,room.id,'ready')
   room=action(owners[0],room.id,'start')
   assert.equal(room.seats.filter(s=>s.control==='ai').length,game.roles.length-humans.length)
   assert.ok(room.messages.every(m=>!humans.some(r=>r.id===m.actor)),'opening never speaks for human roles')
   if(game.id==='thirteenth-curtain')assert.equal(room.messages.filter(m=>m.directorGuide==='optional-discussion').length,1,'all-human groups also receive a voluntary role-specific discussion lead')
   assert.throws(()=>action(owners[0],room.id,'inspect',{clueId:game.clues.find(c=>c.stage===2).id}),e=>e.statusCode===403)
   const partner=game.roles.find(r=>!humans.some(h=>h.id===r.id))
   if(partner){
    action(owners[0],room.id,'chat',{target:partner.id,text:'刚才的约定改一下，结束后去花园喝无糖薄荷茶。'})
    const job=store.leaseJob(room.id)
    assert.equal(job.context.actor.id,partner.id)
    const context=JSON.parse(scriptActorMessages(job.context)[1].content)
    assert.equal(context.contentEdition,game.contentEdition)
    if(game.id!=='thirteenth-curtain')assert.doesNotMatch(JSON.stringify(context),/大学生|大二|大三|二十六岁|三十二岁|出版社退稿|村口老钟/)
    assert.equal(store.completeJob(room.id,job.job.id,job.job.leaseId,{segments:[{kind:'speech',text:'花园见，薄荷茶不加糖。'}]}),true)
    if(owners[1])assert.ok(!JSON.stringify(store.get(owners[1],room.id)).includes('无糖薄荷茶'))
   }
   for(let stage=0;stage<3;stage++){
    assert.equal(store.get(owners[0],room.id).stage,stage)
    assert.throws(()=>action(owners[0],room.id,'advance'),e=>e.code==='script_objective_pending')
    for(let i=0;i<owners.length;i++){
     const view=store.get(owners[i],room.id),own=game.clues.filter(c=>c.stage===stage&&c.roleId===humans[i].id)
     assert.ok(view.myRole.biography.length>=750)
     for(const clue of own){action(owners[i],room.id,'inspect',{clueId:clue.id});action(owners[i],room.id,'share',{clueId:clue.id})}
    }
    for(const seat of store.get(owners[0],room.id).seats.filter(s=>s.control==='ai'))action(owners[0],room.id,'requestEvidence',{roleId:seat.id})
    if(game.acts[stage].puzzle){
     action(owners[0],room.id,'solve',{answer:'not-the-answer'})
     assert.equal(store.get(owners[0],room.id).act.puzzle.solved,false)
     action(owners[0],room.id,'solve',{answer:game.acts[stage].puzzle.answers[0]})
     assert.equal(store.get(owners[0],room.id).act.puzzle.solved,true)
    }
    for(let i=0;i<owners.length;i++){
     const mission=store.get(owners[i],room.id).myMissions.find(m=>m.stage===stage)
     if(mission)action(owners[i],room.id,'choose',{missionId:mission.id,optionId:mission.options[0].id})
    }
    for(const owner of owners)action(owner,room.id,'advance')
    if(stage===0&&partner){
     store.close();store=createScriptRoomStore({root:path.join(root,'rooms')})
     action(owners[0],room.id,'chat',{target:partner.id,text:'上一幕我们改成在哪里喝什么了？'})
     const job=store.leaseJob(room.id),history=JSON.stringify(job.context)
     assert.ok(history.includes('无糖薄荷茶'));assert.ok(history.includes('花园见'))
     assert.equal(store.completeJob(room.id,job.job.id,job.job.leaseId,{segments:[{kind:'speech',text:'花园，薄荷茶不加糖。'}]}),true)
     action(owners[0],room.id,'chat',{target:'public',text:'大家想聊点什么？'})
     const publicJob=store.leaseJob(room.id)
     assert.ok(!JSON.stringify(publicJob.context).includes('无糖薄荷茶'))
     store.completeJob(room.id,publicJob.job.id,publicJob.job.leaseId,{segments:[{kind:publicJob.context.actor.id==='dm'?'narration':'speech',text:'窗边的灯还亮着。'}]})
    }
   }
   assert.equal(store.get(owners[0],room.id).phase,'vote')
   for(const owner of owners)action(owner,room.id,'vote',{choiceId:game.ballot.options[0].id})
   const ended=store.get(owners[0],room.id);assert.equal(ended.phase,'ended');assert.equal(ended.ending.truth,game.truth)
   for(const owner of owners)action(owner,room.id,'leave')
   checked++
  }
  if(game.roles[0].card.student){
   const plan=scriptImagePlan(game,0,'重新画一张当前的场景')
   assert.match(plan.artDirection,/2D anime/);assert.match(plan.artDirection,/age 18/)
   assert.doesNotMatch(plan.artDirection,/age 20|age 21|cartographer|clock mechanic|optical educator/)
  }
 }
 assert.equal(checked,33,'all nonempty human seat subsets, including each solo perspective')
}finally{store.close()}
const api=createScriptRoomApi({root:path.join(root,'api'),authenticate:()=> 'ielts:91879999',sendJson:(res,status,value)=>{res.status=status;res.value=value},readBody:async req=>{let s='';for await(const part of req)s+=part;return JSON.parse(s)},generate:async()=>{throw Error('No model calls expected in catalogue acceptance')}})
const request=async(tail='',body)=>{const req=Readable.from(body?[JSON.stringify(body)]:[]);req.method=body?'POST':'GET';req.headers={};const res={setHeader(){}};await api.handle(req,res,new URL('https://fixture/api/ai/script-rooms'+tail+'?clientVersion=2'));return res}
try{
 const catalog=await request('/catalog');assert.equal(catalog.status,200);assert.equal(catalog.value.scripts.length,3)
 assert.ok(!JSON.stringify(catalog.value).includes('secret'));assert.ok(!JSON.stringify(catalog.value).includes('answers'))
 for(const scriptId of ['before-rain','one-more-stop','last-midnight','venice-blue-hour']){
  const denied=await request('',{scriptId,scriptVersion:2,requestId:nonce()});assert.equal(denied.status,400);assert.equal(denied.value.error.code,'script_invalid_script')
 }
 for(const {id} of publicScriptCatalog()){
  const res=await request('',{scriptId:id,scriptVersion:2,requestId:nonce()});assert.equal(res.status,200);assert.equal(res.value.scriptVersion,2)
  assert.equal(res.value.contentEdition,undefined)
 }
 const forged=await request('',{scriptId:'before-rain',scriptVersion:2,requestId:nonce(),resolveNewGame:'historical',contentEdition:'before-rain-editorial-20261112'})
 assert.equal(forged.status,400,'constructor fixture injection cannot be supplied through HTTP')
}finally{await api.drain();api.close()}
console.log(`PASS ${checked} current 1–4-human journeys: all acts/endings, puzzle gates, private memory across restart, real default catalogue HTTP denial and visual canon`)
