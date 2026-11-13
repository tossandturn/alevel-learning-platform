import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {SCRIPT_GAMES,scriptGame,publicScriptCatalog} from './helpers/historical-script-fixture.mjs'
import {visibleScriptRole} from '../server/scriptRoleCards.js'
import {createScriptRoomStore} from './helpers/historical-script-fixture.mjs'
import {scriptActorMessages} from './helpers/historical-script-fixture.mjs'
assert.match(scriptActorMessages({})[0].content,/人物印象和可选开场发言不是已发生的对话/,'a role observation is not a statement spoken by the player')
const catalog=JSON.stringify(publicScriptCatalog())
let count=0
for(const latest of SCRIPT_GAMES)for(const version of [1,2]){
 const game=scriptGame(latest.id,version)
 for(const role of game.roles){
  const visible=visibleScriptRole(role,0,game.id),text=visible.biography
  assert.ok(text.length>=850,`${game.id}/${role.id}: a playable backstory, not a short bio (${text.length} chars)`)
  assert.ok(text.length<=2600,'bounded identity and actor context')
  assert.ok(text.includes(role.name));assert.ok(text.includes('【此刻的你】'));assert.ok(text.includes('【走进这一夜】'))
  for(const other of game.roles.filter(r=>r.id!==role.id)){assert.ok(text.includes(other.name),`relationships should name ${other.name}`);assert.ok(!text.includes(other.secret),'another player secret must not enter the book')}
  assert.ok(!catalog.includes(text.slice(0,90)),'public catalog must not contain private reading material')
  assert.ok(!text.includes(game.truth),'no end-of-game omniscient reveal')
  for(const clue of game.clues.filter(c=>c.stage>0))assert.ok(!text.includes(clue.text),'future physical evidence remains gated')
  if(role.card)assert.equal(visible.card.beats.length,1)
  count++
 }
}
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/script-role-books-')),store=createScriptRoomStore({root});let seq=0
const act=(who,r,type,extra={})=>store.act(who,r.id,{type,...extra,revision:store.get(who,r.id).revision,requestId:`rolebook-test-${++seq}`})
try{
 let r=store.create('ielts:90000061',{scriptId:'thirteenth-curtain',scriptVersion:2,requestId:'rolebook-create-1'})
 assert.equal(r.myRole.biography,undefined,'lobby still only exposes the existing public role preview')
 r=act('ielts:90000061',r,'ready');r=act('ielts:90000061',r,'start')
 assert.ok(r.myRole.biography.length>=850)
 assert.ok(r.seats.every(s=>!s.biography&&!s.secret),'seat cards cannot reveal others books')
 assert.throws(()=>store.get('ielts:90000062',r.id))
 r=act('ielts:90000061',r,'chat',{target:'restorer',text:'你为什么回来这里？'})
 const job=store.leaseJob(r.id)
 assert.equal(job.context.actor.name,'唐雾');assert.ok(job.context.actor.biography.length>=850)
 assert.ok(job.context.participants.every(p=>!p.biography&&!p.secret))
 assert.equal(r.stage,0);assert.equal(r.publicClues.length,0,'reading never awards clues or advances a story')
 console.log(`PASS ${count} versioned role views: full original background, own perspective, readable sections, AI context and private/public boundaries`)
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
