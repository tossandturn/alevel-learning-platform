import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'
import {newScriptGame} from '../server/scriptGameCatalog.js'
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/director-test-')),store=createScriptRoomStore({root})
const who='ielts:91841001',peer='ielts:91841002';let seq=0
const nonce=()=>`director-${++seq}`,act=(owner,id,type,extra={})=>store.act(owner,id,{type,...extra,revision:store.get(owner,id).revision,requestId:nonce()})
try{
 const game=newScriptGame('one-more-stop',2)
 let r=store.create(who,{scriptId:game.id,scriptVersion:2,requestId:nonce()});act(who,r.id,'ready');r=act(who,r.id,'start')
 const guide=r.messages.find(m=>m.kind==='system'&&m.directorGuide)
 assert.ok(guide,'DM should proactively explain entry points when a scene starts')
 assert.equal(r.messages.at(-1).directorGuide,'opening','onboarding should remain visible after the cast entrance')
 assert.match(guide.text,/右上角.*本局/);assert.match(guide.text,/我的身份/)
 const count=r.messages.length;assert.equal(store.get(who,r.id).messages.length,count,'GET does not create reminders')
 act(who,r.id,'chat',{target:'jiangyuan',text:'嗯，你说吧'});let job=store.leaseJob(r.id)
 assert.ok(!job.context.messages.some(m=>m.directorGuide),'actors must not read UI instructions as dialogue')
 store.completeJob(r.id,job.job.id,job.job.leaseId,{segments:[{kind:'speech',text:'你想坐窗边，还是院子里？'}]})
 r=act(who,r.id,'inspect',{clueId:r.searchOptions[0].id});assert.match(r.messages.at(-1).text,/公开给所有人/);assert.equal(r.messages.at(-1).target,'public');assert.equal(r.messages.at(-1).selfOnly,true)
 r=act(who,r.id,'share',{clueId:r.searchOptions[0].id});r=act(who,r.id,'requestEvidence',{roleId:'jiangyuan'});assert.match(r.messages.at(-1).text,/共同结论/)
 r=act(who,r.id,'solve',{answer:'BAC'});assert.match(r.messages.at(-1).text,/本幕决定/)
 r=act(who,r.id,'choose',{missionId:r.myRoleId+'-0',optionId:'open'});assert.match(r.messages.at(-1).text,/完成本幕/)
 const before=JSON.stringify(r.messages);store.get(who,r.id);assert.equal(JSON.stringify(store.get(who,r.id).messages),before)
 r=act(who,r.id,'advance');assert.equal(r.stage,1);assert.ok(r.messages.some(m=>m.stage===1&&m.directorGuide))
 act(who,r.id,'chat',{target:'dm',text:'人物故事在哪里看？'});job=store.leaseJob(r.id);assert.equal(job.context.actor.id,'dm')
 const {scriptProgressGuidance}=await import('../server/scriptPerformance.js');const help=scriptProgressGuidance(job.context);assert.ok(help);assert.match(help.segments[0].text,/人物与目标/)
 store.completeJob(r.id,job.job.id,job.job.leaseId,help)
 act(who,r.id,'chat',{target:'jiangyuan',text:'你刚才想说什么？'});job=store.leaseJob(r.id);assert.ok(!JSON.stringify(job.context.messages).includes('人物与目标'))
 store.completeJob(r.id,job.job.id,job.job.leaseId,{segments:[{kind:'speech',text:'我刚才有点饿，想问你要不要先吃一口。'}]});act(who,r.id,'leave')
 // A progress reminder is visible only to the requesting player, not their partner.
 r=store.create(who,{scriptId:game.id,scriptVersion:2,requestId:nonce()});store.join(peer,{inviteCode:r.inviteCode,requestId:nonce()});act(peer,r.id,'ready');act(who,r.id,'ready');r=act(who,r.id,'start')
 r=act(who,r.id,'inspect',{clueId:r.searchOptions[0].id});const privateGuide=r.messages.at(-1);assert.equal(privateGuide.selfOnly,true);assert.ok(!store.get(peer,r.id).messages.some(m=>m.id===privateGuide.id))
 console.log('PASS proactive DM onboarding/milestones, truthful entry points, no GET spam, private guidance and actor memory separation')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
