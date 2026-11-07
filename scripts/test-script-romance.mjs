import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import * as catalog from '../server/scriptGameCatalog.js'
import { visibleScriptRole } from '../server/scriptRoleCards.js'
import { createScriptRoomStore } from '../server/scriptRoomStore.js'
import { scriptActorMessages } from '../server/scriptRoomApi.js'
import {pinTestRoomEdition} from './helpers/pin-test-room-edition.mjs'

assert.equal(typeof catalog.newScriptGame,'function','new rooms need a separately pinned romance edition, not rewritten legacy content')
const { romanceOutcomes, guardRomanceRecollection } = await import('../server/scriptRomance.js')
const game=catalog.scriptGame('before-rain',3),hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex')
assert.equal(game.contentEdition,'romance-20261105');assert.equal(game.version,3);assert.equal(game.clientVersion,2,'content version is independent of installed native capability')
assert.match(game.genre,/爱情/);assert.match(game.summary,/许知夏.*周泊舟/);assert.match(game.summary,/林序.*顾晚/)
assert.equal(game.roles.length,4);assert.equal(game.acts.length,3);assert.equal(game.clues.length,12)
assert.equal(catalog.publicScriptCatalog().length,6,'duets are separate added books, not replacements')
assert.deepEqual(catalog.publicScriptCatalog()[0].roles.map(x=>x.id),game.roles.map(x=>x.id))
const legacy=[['b0a441a60f132319aafc32335b77587b35aa07489ee9b1ad19a6abaf590bfc4a','ca93c588904e7d590466dda36b23d2358cd533690e869fee327c5bcf5efcb384'],['6cec936e6bd1e232c957c685808985acd04131fdc15f73db781bd95de0c22f03','54680e4962ff822ac7abf4817965364a724376e4dabeb4fac2bcad43de10fd80']]
for(const v of [1,2]){const old=catalog.scriptGame('before-rain',v);assert.equal(hash(old),legacy[v-1][0]);assert.equal(hash(old.roles.map(r=>visibleScriptRole(r,0,old.id))),legacy[v-1][1])}
assert.equal(hash(catalog.SCRIPT_GAMES.filter(g=>g.id!=='before-rain')),'89ef794299fb1455cd305bf0c54eca6c42a0eefe7fb66cc8c307d5480a72d3d6')
assert.equal(catalog.scriptGame('before-rain',2,'unknown-edition'),null)
assert.equal(catalog.scriptGame('thirteenth-curtain',2,game.contentEdition),null)
assert.equal(catalog.scriptGame('before-rain',1,game.contentEdition),null)
assert.equal(catalog.scriptGame('before-rain',3,game.contentEdition),game)
assert.equal(typeof guardRomanceRecollection,'function','known actor/player fact reversals need a final response guard')
const repairContext={actor:game.roles[1],sender:game.roles[0],trigger:'讲一件以前相处的小事'}
const reversed={segments:[{kind:'speech',text:'广播室门口那碗冷面，你吃之前总把香菜一根根挑出来，后来我才知道你不吃。'}]}
assert.match(guardRomanceRecollection(reversed,repairContext).segments[0].text,/不吃香菜的是我/)
const falseMotive={segments:[{kind:'speech',text:'新裙子那次，机器其实早修完了，我躲在后间。'}]}
assert.match(guardRomanceRecollection(falseMotive,repairContext).segments[0].text,/不是提前修好以后故意躲/)
for(const text of ['我不吃香菜，知夏一直记得。','那次我没有躲在后间，不是提前修好后让她等。','不是你不值得被叫住，是我没有把自己的事说清楚。']){
 const value={segments:[{kind:'speech',text}]};assert.equal(guardRomanceRecollection(value,repairContext),value,'do not replace valid memories, denials or ordinary dialogue')
}
const current={segments:[{kind:'speech',text:'你不吃香菜，那今天就不加。'}]};assert.equal(guardRomanceRecollection(current,{...repairContext,trigger:'今天这碗面别加香菜'}),current,'a current request is not an invented past memory')
assert.equal(guardRomanceRecollection(reversed,{actor:catalog.scriptGame('before-rain',2).roles[1],trigger:'以前'}),reversed,'legacy games are unchanged')
for(const role of game.roles){
 const view=visibleScriptRole(role,0,game.id),body=view.biography
 assert.ok(body.length>=1000&&body.length<=2600,`${role.name}: complete but bounded background (${body.length})`)
 assert.match(body,/【此刻的你】/);assert.match(body,/【走进这一夜】/)
  assert.ok(role.card.romance?.partnerId&&role.card.romance?.partnerName)
  assert.ok(role.card.pastEventAnchors?.length>=2,'romantic recollection needs concise immutable event anchors, not only a long biography')
 assert.ok(role.age>=18);assert.ok(['男','女'].includes(role.gender))
 assert.equal(view.card.beats.length,1);assert.ok(!Object.hasOwn(view,'entryBook'))
 for(const other of game.roles.filter(x=>x.id!==role.id))assert.ok(!JSON.stringify(view).includes(other.secret),'no other role private secret')
 for(const clue of game.clues.filter(c=>c.stage>0))assert.ok(!body.includes(clue.text),'future physical evidence stays locked')
 assert.ok(!JSON.stringify(catalog.publicScriptCatalog()).includes(body.slice(0,100)),'public preview never contains a private book')
 assert.equal(role.missions.length,3);assert.ok(role.missions.every(m=>m.options.some(o=>o.id==='hold')))
}
for(let mask=0;mask<16;mask++){
 const missionChoices=Object.fromEntries(game.roles.map((role,i)=>[role.id,{[`${role.id}-2`]:mask&(1<<i)?'open':'hold'}]))
 const endings=romanceOutcomes(game,{missionChoices})
 assert.equal(endings.length,2)
 assert.equal(endings[0].status,(mask&3)===3?'mutual':'not-mutual')
 assert.equal(endings[1].status,(mask&12)===12?'mutual':'not-mutual')
}
assert.deepEqual(romanceOutcomes(catalog.scriptGame('before-rain',2),{missionChoices:{}}),[])
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/script-romance-'))
let store=createScriptRoomStore({root}),seq=0
const createPinned=(who,payload)=>{const r=store.create(who,payload);pinTestRoomEdition(root,r.id,game);return store.get(who,r.id)}
const nonce=()=>`romance-test-${++seq}`,act=(who,r,type,extra={})=>store.act(who,r.id,{type,revision:store.get(who,r.id).revision,requestId:nonce(),...extra})
try{
 for(let humans=1;humans<=4;humans++){
  const owners=Array.from({length:humans},(_,i)=>`ielts:${91000100+humans*10+i}`)
  let r=createPinned(owners[0],{scriptId:game.id,scriptVersion:2,requestId:nonce()})
  for(let i=1;i<humans;i++)r=store.join(owners[i],{inviteCode:r.inviteCode,roleId:game.roles[i].id,requestId:nonce()},{clientVersion:2})
  for(const who of owners)r=act(who,r,'ready')
  r=act(owners[0],r,'start');assert.match(r.myRole.biography,/周泊舟/);assert.match(r.genre,/爱情/)
  assert.equal(r.publicClues.length,0)
  if(humans===1){
   r=act(owners[0],r,'chat',{target:'repair',text:'你当年为什么没有叫住我？'})
   const job=store.leaseJob(r.id),context=job.context,prompt=scriptActorMessages(context)
   assert.equal(context.actor.id,'repair');assert.ok(context.actor.biography.length>1000)
   assert.equal(context.actor.card.romance.partnerId,'letter')
   assert.ok(context.actorDecision);assert.equal(context.actor.card.beats.length,1)
   assert.match(prompt[0].content,/男女爱情向情感本/)
   assert.match(prompt[0].content,/不能为了加强戏剧性/)
   assert.match(prompt[0].content,/旧回复.*与.*角色本.*冲突/)
   assert.ok(context.actor.card.pastEventAnchors.some(f=>f.includes('检修拖延')&&f.includes('不是提前修好后躲起来')))
   assert.ok(!JSON.stringify(context).includes(game.roles[0].secret),'the partner private secret never enters this actor context')
   assert.ok(!JSON.stringify(context).includes(game.roles[1].card.beats[2].memory),'future personal beats remain locked')
   assert.equal(context.missionChoices,undefined)
   assert.equal(store.completeJob(r.id,job.job.id,job.job.leaseId,{segments:[{kind:'speech',text:'因为我当时也有想留下的生活，却不敢和你完整商量。不是你不值得被叫住。'}]}),true)
   r=act(owners[0],r,'chat',{target:'public',text:'周泊舟，我还想听你把刚才的话说完。'})
   assert.equal(r.jobs.at(-1).actor,'repair','romance public replies go to the addressed partner, not the next arbitrary bot')
   const followup=store.leaseJob(r.id)
   assert.equal(followup.context.actor.id,'repair');store.completeJob(r.id,followup.job.id,followup.job.leaseId,{segments:[{kind:'speech',text:'好，这次我把话说完。'}]})
   r=act(owners[0],r,'image',{target:'public',text:'画出当前广播室的雨夜氛围'})
   const picture=store.leaseJob(r.id,'image')
   assert.equal(picture.imageInput.scriptScene.version,2,'the image provider also consumes capability 2, not private content version 3')
   assert.equal(picture.imageInput.scriptScene.visualCanon,game.visualCanon)
   assert.equal(picture.imageInput.scriptScene.setting,game.acts[0].opening)
   store.completeImage(r.id,picture.job.id,picture.job.leaseId,{bytes:Buffer.from([137,80,78,71,13,10,26,10]),mimeType:'image/png'})
  }
  if(humans>=2){const jobs=r.jobs.length;r=act(owners[0],r,'chat',{target:'public',text:'周泊舟，我想听你自己的答案。'});assert.equal(r.jobs.length,jobs,'AI must not answer a line addressed to a human-controlled partner')}
  for(let stage=0;stage<3;stage++){
   for(let i=0;i<humans;i++){
    const who=owners[i],role=game.roles[i],clue=game.clues.find(c=>c.stage===stage&&c.roleId===role.id)
    r=act(who,r,'inspect',{clueId:clue.id});r=act(who,r,'share',{clueId:clue.id})
    r=act(who,r,'choose',{missionId:`${role.id}-${stage}`,optionId:stage===2&&i===0?'hold':'open'})
   }
   for(const seat of r.seats.filter(s=>s.control==='ai'))r=act(owners[0],r,'requestEvidence',{roleId:seat.id})
   if(game.acts[stage].puzzle)r=act(owners[0],r,'solve',{answer:game.acts[stage].puzzle.answers[0]})
   for(const who of owners)r=act(who,r,'advance')
  }
  assert.equal(r.phase,'vote')
  for(const who of owners)r=act(who,r,'vote',{choiceId:game.botVote})
  assert.equal(r.phase,'ended');assert.match(r.ending.text,/没有确认复合/,'a human refusal is not overwritten by a bot or group vote')
  store.close();store=createScriptRoomStore({root});assert.equal(store.get(owners[0],r.id).ending.text,r.ending.text)
 }
 // An already-stored v2 room has no contentEdition. Retry/restart must not adopt
 // newly published love histories. Only synthetic local fixtures are edited.
 const who='ielts:91000200',requestId=nonce(),created=createPinned(who,{scriptId:game.id,scriptVersion:2,requestId})
 const db=new DatabaseSync(path.join(root,'script-rooms.sqlite')),row=db.prepare('SELECT snapshot FROM script_rooms WHERE id=?').get(created.id),old=JSON.parse(row.snapshot)
 assert.equal(old.contentEdition,game.contentEdition);assert.equal(old.scriptVersion,3);delete old.contentEdition;old.scriptVersion=2
 db.prepare('UPDATE script_rooms SET snapshot=? WHERE id=?').run(JSON.stringify(old),created.id);db.close()
 let r=store.create(who,{scriptId:game.id,scriptVersion:2,requestId});assert.equal(r.genre,'情感本')
 r=act(who,r,'ready');r=act(who,r,'start');assert.equal(r.myRole.biography,visibleScriptRole(catalog.scriptGame(game.id,2).roles[0],0,game.id).biography)
 assert.doesNotMatch(r.myRole.biography,/八年前.*恋人/)
 const edited=new DatabaseSync(path.join(root,'script-rooms.sqlite')),stored=JSON.parse(edited.prepare('SELECT snapshot FROM script_rooms WHERE id=?').get(r.id).snapshot)
 stored.contentEdition='unavailable-edition';edited.prepare('UPDATE script_rooms SET snapshot=? WHERE id=?').run(JSON.stringify(stored),r.id);edited.close()
 assert.throws(()=>store.get(who,r.id),e=>e.code==='script_version_unavailable','an unknown content edition fails closed instead of silently changing the story')
 console.log('PASS romance edition: four adult roles, two reciprocal love lines, 16 final-choice combinations, 1–4-player complete journeys and byte-pinned old rooms')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
