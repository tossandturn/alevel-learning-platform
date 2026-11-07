import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'
import {newScriptGame,publicScriptCatalog,SCRIPT_GAMES,scriptGame} from '../server/scriptGameCatalog.js'
import {normalizeScriptDialogue} from '../server/scriptDialogue.js'
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/scene-dialogue-')),store=createScriptRoomStore({root});let seq=0
const nonce=()=>`scene-test-${++seq}`,who='ielts:91777001'
const oldLines=['门口留条路。东西先放下，咱们核一下时间。','先让光照到这边。我想把边缘看清。','我的录音还在。先把各人的时间对一下。']
try{
 let r=store.create(who,{scriptId:'thirteenth-curtain',scriptVersion:2,requestId:nonce()})
 const act=(type,extra={})=>r=store.act(who,r.id,{type,...extra,revision:store.get(who,r.id).revision,requestId:nonce()})
 act('ready');act('start')
 assert.ok(!r.messages.some(m=>oldLines.includes(m.text)),'screenshot reproduction: isolated task announcements must not be used')
 const {scriptStageScene,SCRIPT_SCENE_VERSION}=await import('../server/scriptSceneBeats.js')
 assert.equal(r.messages[0].sceneVersion,SCRIPT_SCENE_VERSION)
 assert.equal(r.messages[0].image,r.act.image,'new narration must retain the frozen-client scene matching contract')
 assert.ok(!r.messages.some(m=>m.actor==='actor'),'the selected human actor has no automatic dialogue')
 const npc=r.messages.filter(m=>m.actor!=='dm')
 assert.equal(npc.length,3);assert.deepEqual(npc.map(m=>m.actor),['manager','restorer','reporter'])
 assert.equal(npc[1].sceneReplyTo,npc[0].id);assert.equal(npc[2].sceneReplyTo,npc[1].id)
 assert.match(npc[1].text,/陈砚/)
 assert.ok(npc.every(m=>m.parts.some(p=>p.kind==='speech')))
 assert.ok(npc.every(m=>m.parts.every(p=>p.kind==='speech')&&!/【旁白】|【陈砚】/.test(m.text)),'plain-text native fallback never exposes segment markup')
 assert.ok(r.messages.some(m=>m.actor==='dm'&&m.kind==='narration'&&m.text.includes('陈砚站在门边')),'AI physical action is a narrator message, not actor speech')
 const before=JSON.stringify(r.messages),revision=r.revision,reopened=createScriptRoomStore({root})
 assert.equal(JSON.stringify(reopened.get(who,r.id).messages),before);reopened.close();assert.equal(store.get(who,r.id).revision,revision)
 assert.equal(r.publicClues.length,0,'scene dialogue cannot award evidence')
 const count=r.messages.length;act('requestEvidence',{roleId:'manager'})
 assert.equal(r.messages.length-count,2,'evidence request plus exact card, without a second empty announcement')
 assert.equal(r.messages.at(-1).kind,'evidence');assert.ok(r.messages.at(-1).text.includes(newScriptGame('thirteenth-curtain',2).clues.find(c=>c.id==='c2').text))
 let configurations=0
 for(const row of publicScriptCatalog()){
  const game=newScriptGame(row.id,2)
  for(let stage=0;stage<3;stage++)for(let humanMask=1;humanMask<(1<<game.roles.length);humanMask++){
   const ai=game.roles.filter((_,i)=>!(humanMask&(1<<i))).map(r=>r.id),scene=scriptStageScene(game,stage,ai)
   assert.ok(scene);assert.ok(scene.narration.length>25&&scene.narration.length<420)
   assert.equal(scene.lines.length,ai.length);assert.equal(new Set(scene.lines.map(l=>l.actor)).size,ai.length)
   for(const [i,line] of scene.lines.entries()){
    assert.ok(ai.includes(line.actor));assert.equal(line.respondsTo,i?scene.lines[i-1].actor:null)
    assert.ok(normalizeScriptDialogue({segments:line.parts},{actor:line.actor,name:game.roles.find(r=>r.id===line.actor).name,evidence:[]}))
    assert.ok(!/边缘看清|核一下时间|先把各人的时间|不替你决定|任务目标|当前章节|后台约束/.test(line.parts.map(p=>p.text).join('')))
   }
   assert.ok(!JSON.stringify(scene).includes(game.truth))
   configurations++
  }
 }
 assert.equal(configurations,207)
 assert.equal(scriptStageScene(scriptGame('before-rain',3),0,['repair']),null,'old romance must not become a murder scene')
 assert.equal(scriptStageScene(SCRIPT_GAMES[0],0,['repair']),null,'old family story retains its own edition')
 const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex')
 assert.equal(hash(SCRIPT_GAMES),'da32207fa29d8bdba4dcd2fb08344d85d2d4fcbbfbd76dd87951c64ec2157397')
 assert.equal(hash(scriptGame('before-rain',3)),'5de8f36ea960acec65253a3620b4329990880cc026cd80314bc9405a8d1bd4de')
 console.log('PASS screenshot reproduction and 207 staged/cast configurations, linked dialogue, human agency, exact evidence, frozen-client artwork and pinned plots')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
