import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {SCRIPT_GAMES,newScriptGame,scriptGame,publicScriptCatalog} from '../server/scriptGameCatalog.js'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'
import {scriptActorMessages} from '../server/scriptRoomApi.js'
import {tavernCharacterCard,tavernCharacterPrompt} from '../server/tavernPersonas.js'
assert.ok(tavernCharacterCard('xianxia-guide').voiceProfile,'Tavern must have a fixed behavioral voice profile')
const {SCRIPT_VOICES,TAVERN_VOICES,scriptVoice,scriptEntrance,scriptEvidenceHandoff,dialogueVoiceIssues,scriptVoiceIssues,voiceActorContext}=await import('../server/roleVoices.js')
assert.equal(Object.keys(SCRIPT_VOICES).length,18);assert.equal(Object.keys(TAVERN_VOICES).length,9)
const identities=new Set()
for(const row of publicScriptCatalog()){
 const game=newScriptGame(row.id,2)
 for(const role of game.roles){
  const v=scriptVoice(game.id,role)
  assert.equal(v.name,role.name);assert.ok(v.cadence.length>15);assert.ok(v.innerNeed&&v.mask&&v.underPressure&&v.whenClose)
  assert.equal(v.examples.length,3);assert.ok(v.examples.every(e=>e.user&&e.reply&&!dialogueVoiceIssues(e.reply).length))
  identities.add(v.cadence)
  for(let stage=0;stage<3;stage++){
   const entry=scriptEntrance(game,role,stage),handoff=scriptEvidenceHandoff(game,role,stage)
   assert.ok(entry.length>5&&entry.length<160);assert.equal(dialogueVoiceIssues(entry).length,0)
   assert.equal(dialogueVoiceIssues(handoff).length,0)
   assert.ok(!/不替|决定权|服务端|玩家|角色设定/.test(entry+handoff))
  }
 }
}
assert.equal(identities.size,18,'each actor has a distinct delivery, not gender boilerplate')
assert.notEqual(scriptVoice('thirteenth-curtain',{id:'actor',name:'沈照'}).cadence,TAVERN_VOICES['xianxia-guide'].cadence,'same name is not the same persona')
assert.equal(voiceActorContext({scriptId:'before-rain',actor:{id:'photo',name:'林序',card:{romance:{},beats:[]}}}).recollectionPerspective,undefined,'a private couple recollection cannot be injected into another role')
for(const id of Object.keys(TAVERN_VOICES)){
 const card=tavernCharacterCard(id);assert.equal(card.voiceProfile.name,card.name)
 assert.ok(card.examples.every(e=>!dialogueVoiceIssues(e.reply).length),id)
 assert.match(tavernCharacterPrompt(id),/后台约束/);assert.match(tavernCharacterPrompt(id),/人物此刻/)
}
for(const s of ['我不会替你做决定，选择权始终在你手里。','行，不替你决定了。','现在我不想再替你做决定。','我也不是来替你做决定的。','不是替谁扛，也不是替谁决定。','作为这个角色，我会尊重你的边界。','不是挽留，而是理解。不是承诺，而是尊重。','系统要求我不能代替玩家表态。'])assert.ok(dialogueVoiceIssues(s).length,s)
assert.ok(scriptVoiceIssues({text:'八年前你也问过我还有没有话说。'},{scriptId:'before-rain',actor:{id:'letter'},sender:{id:'repair'}}).includes('past-speaker-reversal'))
assert.ok(scriptVoiceIssues({text:'累。不过21:12的声音得先核对完。'},{actor:{id:'conductor'},trigger:'你也累了吧？'}).includes('unsolicited-clue-detour'))
assert.equal(scriptVoiceIssues({text:'21:12的声音得先核对完。'},{actor:{id:'conductor'},trigger:'21:12的声音是怎么回事？'}).length,0)
for(const s of ['不是我拿的。你可以看门口的记录。','我不想继续了。','你不必等我，末班车快到了。','我没有进广播室。','我是 AI 扮演的虚构角色。'])assert.equal(dialogueVoiceIssues(s,{identityAsked:/AI/.test(s)}).length,0,s)
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex')
assert.equal(hash(SCRIPT_GAMES),'da32207fa29d8bdba4dcd2fb08344d85d2d4fcbbfbd76dd87951c64ec2157397')
assert.equal(hash(scriptGame('before-rain',3)),'5de8f36ea960acec65253a3620b4329990880cc026cd80314bc9405a8d1bd4de')
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/role-voice-test-')),store=createScriptRoomStore({root});let n=0
try{
 let r=store.create('ielts:91001001',{scriptId:'before-rain',scriptVersion:2,requestId:'voice-create-0001'})
 const act=(type,extra={})=>r=store.act('ielts:91001001',r.id,{type,...extra,revision:store.get('ielts:91001001',r.id).revision,requestId:`voice-action-${++n}`})
 act('ready');act('start')
 for(const m of r.messages.filter(m=>m.actor!=='dm'))assert.equal(dialogueVoiceIssues(m.text).length,0)
 act('requestEvidence',{roleId:'conductor'})
 assert.equal(r.publicClues[0].text,newScriptGame('before-rain',2).clues.find(c=>c.roleId==='conductor'&&c.stage===0).text)
 act('chat',{target:'repair',text:'别说什么不替我决定，我想听你自己想要什么。'})
 const job=store.leaseJob(r.id),messages=scriptActorMessages(job.context),projected=JSON.parse(messages[1].content)
 assert.equal(projected.actor.voiceProfile.name,'周泊舟');assert.match(messages[0].content,/后台约束/)
 assert.equal(projected.actor.card.examples.length,3)
assert.ok(projected.actor.card.beats.every(b=>!dialogueVoiceIssues(b.entrance).length))
 assert.ok(projected.actor.card.beats.every(b=>!Object.hasOwn(b,'entrance')&&!Object.hasOwn(b,'discovery')),'the model uses actually delivered scene messages, not independent stock announcements')
 assert.equal(projected.dialogueFocus,'personal');assert.deepEqual(projected.evidence,[])
 assert.match(messages[0].content.slice(-520),/顶层JSON对象/)
 assert.ok(!JSON.stringify(projected).includes(newScriptGame('before-rain',2).truth))
 console.log('PASS stable 27 voices, 108 stage lines, source leakage removed, ordinary negation and immutable canon preserved')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
