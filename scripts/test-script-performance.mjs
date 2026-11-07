import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {publicScriptCatalog,newScriptGame} from '../server/scriptGameCatalog.js'
import {visibleScriptRole} from '../server/scriptRoleCards.js'
import {scriptActorMessages} from '../server/scriptRoomApi.js'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'
import {personalDialogueBeat} from '../server/roleVoices.js'

const game=newScriptGame('thirteenth-curtain',2),role=game.roles.find(r=>r.id==='restorer')
const visible=visibleScriptRole(role,0,game.id),original=JSON.stringify(visible)
const context={scriptId:game.id,actor:visible,trigger:'先不谈案情，你刚才看着很累。',actorDecision:'公开真正可检验的证据',messages:[],evidence:[],target:'actor',sender:{id:'actor',name:'沈照'}}
const projected=JSON.parse(scriptActorMessages(context)[1].content)
assert.ok(!projected.actor.biography.includes('【你可以从这里开始】'),'player instructions must not become actor memories')
assert.equal(projected.actorDecision,undefined,'personal dialogue must not be steered by a gameplay decision label')
assert.equal(JSON.stringify(visible),original,'the player still receives the complete unchanged role book')
assert.ok(projected.actor.biography.includes('错误鉴定'),'factual life experience must survive')
assert.equal(projected.actor.secret,visible.secret)
for(const text of ['聊点别的吧。','你喜欢吃什么？','别讲大道理，我只是问你在想什么。','我想见你。'])assert.equal(personalDialogueBeat(text),true,text)
assert.equal(personalDialogueBeat('你喜欢我，还是想让我替凶手隐瞒证据？'),false)

const {scriptProgressGuidance,isScriptProgressRequest}=await import('../server/scriptPerformance.js')
assert.equal(isScriptProgressRequest('下一幕你还会记得我们的约定吗？'),false,'a continuity concern remains character dialogue')
assert.equal(isScriptProgressRequest('这道题卡住了，给一点解题提示。'),false,'a puzzle hint is not an operation tutorial')
const base=path.resolve(import.meta.dirname,'../../qa'),root=fs.mkdtempSync(path.join(base,'script-performance-'))
assert.ok(root.startsWith(base+path.sep))
const store=createScriptRoomStore({root}),who='ielts:91830001';let seq=0,checked=0
const nonce=()=>`performance-qa-${++seq}`
const act=(id,type,extra={})=>store.act(who,id,{type,...extra,revision:store.get(who,id).revision,requestId:nonce()})
try{
 for(const card of publicScriptCatalog()){
  const script=newScriptGame(card.id,2)
  let room=store.create(who,{scriptId:card.id,scriptVersion:2,requestId:nonce()});act(room.id,'ready');room=act(room.id,'start')
  act(room.id,'chat',{target:'public',text:'现在怎么进入下一幕？'})
  let job=store.leaseJob(room.id)
  assert.equal(job.context.actor.id,'dm','public operational questions route to the host, not a character')
  assert.ok(job.context.progress,'host receives current state, not generic narrative guessing')
  assert.equal(job.context.progress.shared,0);assert.equal(job.context.progress.total,script.roles.length)
  const help=scriptProgressGuidance(job.context)
  assert.ok(help);const text=help.segments[0].text
  assert.match(text,/本幕任务/);assert.match(text,/搜证/);assert.ok(text.includes('0/'+script.roles.length))
  assert.ok(!text.includes(script.truth));assert.ok(!JSON.stringify(job.context.progress).includes('secret'))
  store.completeJob(room.id,job.job.id,job.job.leaseId,help)
  const own=room.searchOptions[0];act(room.id,'inspect',{clueId:own.id});act(room.id,'share',{clueId:own.id})
  for(const seat of room.seats.filter(s=>s.control==='ai'))act(room.id,'requestEvidence',{roleId:seat.id})
  if(script.acts[0].puzzle)act(room.id,'solve',{answer:script.acts[0].puzzle.answers[0]})
  act(room.id,'chat',{target:'dm',text:'都做完了吗，下一步怎么继续？'});job=store.leaseJob(room.id)
  const after=scriptProgressGuidance(job.context)
  assert.ok(after);assert.match(after.segments[0].text,/我的身份/)
  assert.ok(!/请先搜证/.test(after.segments[0].text),'do not send completed players back to searching')
  store.completeJob(room.id,job.job.id,job.job.leaseId,after)
  act(room.id,'leave');checked++
 }
 assert.equal(checked,7)
 assert.equal(scriptProgressGuidance({...context,actor:{id:'restorer'},progress:{}}),null,'characters do not become the UI guide')
 assert.equal(scriptProgressGuidance({...context,actor:{id:'dm'},trigger:'你觉得她是不是喜欢我？',progress:{}}),null)
 const finalHelp=scriptProgressGuidance({actor:{id:'dm'},trigger:'接下来怎么推进？',phase:'play',progress:{shared:2,total:2,puzzleRequired:false,ownFound:true,ownShared:true,ownDecisionSaved:false,pendingHumanNames:[]}})
 assert.ok(!/核验答案|输入.*结论/.test(finalHelp.segments[0].text),'non-puzzle scenes do not receive a fake password step')
 console.log('PASS all seven current books: actor/player instructions separated, immutable role books, personal focus and state-aware host help')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
