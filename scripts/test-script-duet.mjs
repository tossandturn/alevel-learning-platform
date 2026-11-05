import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {SCRIPT_GAMES,publicScriptCatalog,newScriptGame,scriptGame} from '../server/scriptGameCatalog.js'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const catalog=publicScriptCatalog(),duet=catalog.find(g=>g.id==='one-more-stop')
assert.ok(duet,'a fifth, separate two-role romance must be present')
assert.equal(catalog.length,5)
assert.equal(hash(catalog.filter(g=>!['one-more-stop','before-rain'].includes(g.id)).map(g=>({...g,cover:SCRIPT_GAMES.find(s=>s.id===g.id).acts[0].image}))),'b7596958c797f2f1c1769a6223f2348877bfae50b993996b219829c4c8d33deb','unrelated catalog metadata stays unchanged apart from the independently versioned art layer')
assert.equal(hash(SCRIPT_GAMES),'da32207fa29d8bdba4dcd2fb08344d85d2d4fcbbfbd76dd87951c64ec2157397','old room definitions stay byte-equivalent')
assert.equal(hash(scriptGame('before-rain',3)),'5de8f36ea960acec65253a3620b4329990880cc026cd80314bc9405a8d1bd4de')
assert.equal(duet.roles.length,2);assert.equal(duet.players,'1–2 人 · AI 补位')
const game=newScriptGame(duet.id,2)
assert.ok(game);assert.equal(newScriptGame(duet.id,1),null)
assert.equal(scriptGame(duet.id,game.version,game.contentEdition),game)
assert.equal(scriptGame(duet.id,game.version,'unknown-edition'),null)
assert.equal(game.acts.length,3);assert.equal(game.clues.length,6)
for(const role of game.roles){
 assert.ok(role.entryBook.length>=1000,`${role.id} needs a full identity book`)
 assert.equal(role.missions.length,3);assert.equal(role.card.beats.length,3)
 assert.ok(role.card.pastEventAnchors.length>=3)
 assert.ok(game.roles.some(other=>other.id===role.card.romance.partnerId&&other.id!==role.id))
}
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/duet-'))
const store=createScriptRoomStore({root});let serial=0
const uid=i=>`ielts:9100062${i}`,nonce=()=>`duet-test-${++serial}`
const action=(who,r,type,extra={})=>store.act(who,r.id,{type,...extra,requestId:nonce(),revision:store.get(who,r.id).revision})
try{
 for(const humans of [1,2])for(const finalChoices of [['open','open'],['open','hold'],['hold','open'],['hold','hold']]){
  const host=uid(1),guest=uid(2)
  let r=store.create(host,{scriptId:duet.id,scriptVersion:2,requestId:nonce()})
  if(humans===2){store.join(guest,{inviteCode:r.inviteCode,requestId:nonce()});assert.throws(()=>store.join(uid(3),{inviteCode:r.inviteCode,requestId:nonce()}),e=>e.code==='script_role_taken');action(guest,r,'ready')}
  r=action(host,r,'ready');r=action(host,r,'start');assert.equal(r.seats.length,2);assert.equal(r.act.total,2)
  for(let stage=0;stage<3;stage++){
   assert.equal(r.stage,stage);assert.equal(r.act.total,2)
   assert.throws(()=>action(host,r,'advance'),e=>e.code==='script_objective_pending')
   for(let i=0;i<2;i++){
    const role=game.roles[i],clue=game.clues.find(c=>c.stage===stage&&c.roleId===role.id)
    if(i===0||humans===2){const who=i===0?host:guest;r=action(who,r,'inspect',{clueId:clue.id});r=action(who,r,'share',{clueId:clue.id});r=action(who,r,'choose',{missionId:`${role.id}-${stage}`,optionId:stage===2?finalChoices[i]:'open'})}
    else r=action(host,r,'requestEvidence',{roleId:role.id})
   }
   assert.equal(r.act.shared,2)
   r=action(host,r,'advance');if(humans===2){assert.equal(r.phase,'play');r=action(guest,r,'advance')}
  }
  assert.equal(r.phase,'vote');r=action(host,r,'vote',{choiceId:game.botVote});if(humans===2)r=action(guest,r,'vote',{choiceId:game.botVote})
  assert.equal(r.phase,'ended')
  const mutual=finalChoices[0]==='open'&&(humans===1||finalChoices[1]==='open')
  assert.equal(r.ending.text.includes('共同确认：尝试六个月异地'),mutual,'relationship requires both final personal decisions, not a majority vote')
  action(host,r,'leave');if(humans===2)action(guest,r,'leave')
 }
 // The v2-installed client can request images with its capability, not internal edition.
 let r=store.create(uid(1),{scriptId:duet.id,scriptVersion:2,requestId:nonce()});r=action(uid(1),r,'ready');r=action(uid(1),r,'start')
 r=action(uid(1),r,'chat',{target:'public',text:'江远，你想先聊什么？'})
 const job=store.leaseJob(r.id);assert.equal(job.context.actor.id,'jiangyuan');assert.equal(job.context.sender.id,'sutang')
 store.completeJob(r.id,job.job.id,job.job.leaseId,{segments:[{kind:'speech',text:'先聊这次出差，好吗？'}]})
 r=action(uid(1),r,'image',{target:'public',text:'画出候车室窗边的暖灯'})
 const image=store.leaseJob(r.id,'image');assert.equal(image.imageInput.scriptScene.version,2)
 assert.equal(image.imageInput.scriptScene.id,duet.id)
 console.log('PASS duet: separate fifth script, pinned four-book preservation, full identity books, 1/2-human three-act journeys, 2-clue gates, consent outcomes, capacity and image capability')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
