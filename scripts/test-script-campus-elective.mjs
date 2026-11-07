import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'
import {visibleScriptRole} from '../server/scriptRoleCards.js'
import {campusOutcomes} from '../server/scriptCampusElective.js'
import {scriptActorMessages} from '../server/scriptRoomApi.js'
import {scriptVoiceIssues,personalDialogueBeat} from '../server/roleVoices.js'
import {hasUnsupportedRecollectionQuote} from '../server/scriptRoomMemory.js'
import {newScriptGame,publicScriptCatalog,SCRIPT_GAMES,scriptGame} from '../server/scriptGameCatalog.js'
const game=newScriptGame('last-elective',2)
assert.ok(game,'one new complete campus duet must exist')
assert.equal(game.roles.length,2)
assert.equal(game.contentEdition,'campus-elective-20261107')
assert.equal(game.acts.length,3)
assert.equal(game.clues.length,6)
assert.equal(publicScriptCatalog().filter(g=>g.id==='last-elective').length,1)
assert.equal(scriptGame('last-elective',1),null)
assert.equal(scriptGame('last-elective',2,'unknown-edition'),null)
assert.ok(game.roles.every(r=>r.entryBook.includes('昨天下午')&&!r.entryBook.includes('上周')),'the misprinted cover happened yesterday, not both yesterday and last week')
assert.equal(campusOutcomes(game,{missionChoices:{}})[0].status,'unconfirmed','missing or departed choice is not fabricated consent')
for(const role of game.roles){assert.ok(role.entryBook.length>=1800);assert.equal(role.missions.length,3);assert.equal(role.chapters.length,3);assert.ok(role.card.pastEventAnchors.length>=4)}
for(const stage of game.acts){assert.ok(stage.puzzle?.answers?.length);assert.ok(stage.puzzle.hint.length>10)}
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex')
assert.equal(hash(SCRIPT_GAMES),'da32207fa29d8bdba4dcd2fb08344d85d2d4fcbbfbd76dd87951c64ec2157397')
assert.equal(hash(scriptGame('before-rain',3)),'5de8f36ea960acec65253a3620b4329990880cc026cd80314bc9405a8d1bd4de')
console.log('PASS campus content identity, full role books and pinned existing scripts')

// Independent solution checks: no ambiguous coordinate or accidental ordering.
const coordinates=[]
for(let r=1;r<=6;r++)for(let c=1;c<=6;c++)if(r+c===9&&r-c===3)coordinates.push(`${r},${c}`)
assert.deepEqual(coordinates,['6,3']);assert.ok(game.acts[0].puzzle.answers.includes(coordinates[0]))
const permutations=a=>a.length?a.flatMap((item,i)=>permutations(a.filter((_,j)=>j!==i)).map(p=>[item,...p])):[[]]
const orders=permutations(['黄','蓝','白','绿']).filter(a=>a.indexOf('黄')<a.indexOf('蓝')&&a.indexOf('绿')>a.indexOf('白')&&a.indexOf('白')===a.indexOf('蓝')+1).map(a=>a.join(''))
assert.deepEqual(orders,['黄蓝白绿']);assert.ok(game.acts[1].puzzle.answers.includes(orders[0]))
const matrix=['周展去吗','看六一晚','想起下午'],route=[[1,1],[2,2],[3,3],[3,4],[2,3],[3,2],[2,1],[1,2],[1,4]]
assert.equal(route.map(([r,c])=>matrix[r-1][c-1]).join(''),game.acts[2].puzzle.answers[0])
assert.ok(!JSON.stringify(publicScriptCatalog()).includes('停交附言是裴叙'))
for(const role of game.roles){const v=visibleScriptRole(role,0,game.id);assert.ok(!v.biography.includes('第三幕私章'));assert.equal(v.card.beats.length,1)}

const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/campus-test-')),store=createScriptRoomStore({root});let seq=0
const nonce=()=>`campus-test-${++seq}`,who='ielts:91810001',peer='ielts:91810002',third='ielts:91810003'
function action(owner,id,type,extra={}){const r=store.get(owner,id);return store.act(owner,id,{type,...extra,revision:r.revision,requestId:nonce()})}
function start(humanRole,dual=false){
 let r=store.create(who,{scriptId:game.id,scriptVersion:2,requestId:nonce()})
 if(r.myRoleId!==humanRole)r=action(who,r.id,'claim',{roleId:humanRole})
 if(dual){store.join(peer,{inviteCode:r.inviteCode,requestId:nonce()});assert.throws(()=>store.join(third,{inviteCode:r.inviteCode,requestId:nonce()}),e=>e.code==='script_role_taken');action(peer,r.id,'ready')}
 action(who,r.id,'ready');return action(who,r.id,'start')
}
function disclose(r,owners){
 for(const owner of owners){let v=store.get(owner,r.id);const clue=v.searchOptions[0];action(owner,r.id,'inspect',{clueId:clue.id});action(owner,r.id,'share',{clueId:clue.id})}
 r=store.get(owners[0],r.id);for(const seat of r.seats.filter(s=>s.control==='ai'))action(owners[0],r.id,'requestEvidence',{roleId:seat.id})
 return store.get(owners[0],r.id)
}
function solve(r,owner){return action(owner,r.id,'solve',{answer:game.acts[r.stage].puzzle.answers[0]})}
function close(r,owners){for(const owner of owners)action(owner,r.id,'leave')}
try{
 for(const role of game.roles){
  let r=start(role.id);assert.equal(r.seats.filter(s=>s.control==='ai').length,1)
  assert.ok(!r.messages.some(m=>m.actor===role.id),'human receives no fabricated lines')
  assert.throws(()=>action(who,r.id,'solve',{answer:'6,3'}),e=>e.code==='script_need_evidence')
  assert.throws(()=>action(who,r.id,'advance'),e=>e.code==='script_objective_pending')
  assert.throws(()=>action(who,r.id,'inspect',{clueId:'e5'}),e=>e.statusCode===403)
  for(let stage=0;stage<3;stage++){
   assert.equal(r.stage,stage);r=disclose(r,[who])
   if(stage===2){assert.equal(r.myMissions.find(m=>m.stage===2).options.length,0,'final choices are not exposed as clickable options before the letter opens');assert.throws(()=>action(who,r.id,'choose',{missionId:`${role.id}-2`,optionId:'date'}),e=>e.code==='script_confession_locked')}
   const beforeReveal=r.messages.filter(m=>m.kind==='narration'&&m.text.startsWith('【返还页')).length
   r=action(who,r.id,'solve',{answer:'错误答案'});assert.equal(r.act.puzzle.solved,false)
   assert.equal(r.messages.filter(m=>m.text.startsWith('【返还页')).length,beforeReveal)
   r=solve(r,who);assert.equal(r.act.puzzle.solved,true)
   if(stage===2)assert.equal(r.myMissions.find(m=>m.stage===2).options.length,3)
   assert.equal(r.messages.filter(m=>m.text.startsWith('【返还页')).length,beforeReveal+1,'correct solution unlocks exactly one authored page')
   r=solve(r,who);assert.equal(r.messages.filter(m=>m.text.startsWith('【返还页')).length,beforeReveal+1)
   const reopened=createScriptRoomStore({root});assert.equal(JSON.stringify(reopened.get(who,r.id).messages),JSON.stringify(r.messages));reopened.close()
   r=action(who,r.id,'choose',{missionId:`${role.id}-${stage}`,optionId:stage===2?'date':'open'})
   const count=r.messages.filter(m=>m.text.startsWith('【返还页')).length;r=action(who,r.id,'advance');assert.equal(r.messages.filter(m=>m.text.startsWith('【返还页')).length,count)
  }
  assert.equal(r.phase,'vote');r=action(who,r.id,'vote',{choiceId:'canteen'});assert.equal(r.phase,'ended');assert.match(r.ending.text,/第一次约会/)
  close(r,[who])
 }
 for(const first of ['date','slow','friends'])for(const second of ['date','slow','friends']){
  let r=start('songmi',true)
  assert.ok(r.messages.every(m=>m.actor==='dm'),'all-human rooms never auto-speak for either actor')
  for(let stage=0;stage<3;stage++){
   r=disclose(r,[who,peer]);r=solve(r,who)
   action(who,r.id,'choose',{missionId:`songmi-${stage}`,optionId:stage===2?first:'open'});action(peer,r.id,'choose',{missionId:`peixu-${stage}`,optionId:stage===2?second:'open'})
   r=action(who,r.id,'advance');assert.equal(r.stage,stage,'one hand up cannot advance the other person');r=action(peer,r.id,'advance')
  }
  action(who,r.id,'vote',{choiceId:'photo'});r=action(peer,r.id,'vote',{choiceId:'walk'});assert.equal(r.phase,'ended');assert.equal(r.ending.tie,true)
  if(first==='date'&&second==='date')assert.match(r.ending.text,/两个人都选择/)
  else if([first,second].includes('friends')){assert.match(r.ending.text,/保留同学/);assert.ok(!r.ending.text.includes('两个人都选择'))}
  else assert.match(r.ending.text,/尚未确认约会或恋爱/)
  close(r,[who,peer])
 }
 // The AI gets its own current materials and public unlocked pages, never future sealed pages.
 let r=start('songmi'),ai='peixu'
 r=action(who,r.id,'chat',{target:ai,text:'解完这道题会拿到什么？'});let job=store.leaseJob(r.id)
 assert.ok(job);assert.ok(!JSON.stringify(job.context).includes('纸背夹着一张只印了'));assert.ok(!JSON.stringify(job.context).includes('两张纸放在同一页了'))
 assert.equal(job.context.story?.campus,true);assert.deepEqual(job.context.story.publicReveals,[])
 const performance=JSON.parse(scriptActorMessages({...job.context,trigger:'先不聊题。我提议整理完在图书馆东门等。'})[1].content)
 assert.equal(performance.dialogueFocus,'personal')
 assert.equal(performance.actorDecision,undefined,'saved game choice is not an order to repeat a speech every turn')
 assert.ok(!scriptActorMessages(job.context)[0].content.includes('本局有共同命案'),'campus performance has its own compact policy, not a crime-DM prompt')
 assert.ok(scriptActorMessages(job.context)[0].content.includes('校园对白'))
 assert.ok(!performance.actor.biography.includes('【第一幕私章'))
 assert.ok(performance.actor.biography.includes('纸桥'),'factual character history survives the performance projection')
 assert.ok(!performance.actor.goal.includes('整理'))
 assert.deepEqual(performance.evidence,[])
 for(const text of ['先不聊题。我提议整理完在图书馆东门等。','你今天带两块橡皮，真这么怕我？','我们刚才说整理完在哪儿等来着？'])assert.equal(personalDialogueBeat(text),true)
 assert.ok(scriptVoiceIssues({text:'东门记住了。先对一下版本单吧。'},{...job.context,trigger:'我们刚才说整理完在哪儿等来着？'}).includes('unsolicited-clue-detour'))
 assert.ok(scriptVoiceIssues({text:'才隔了一幕就考我记性？'},{...job.context,trigger:'刚才说在哪儿等？'}).includes('scene-meta'))
 assert.ok(scriptVoiceIssues({text:'那之前说的东门见面就当没提过。'},{...job.context,trigger:'只做同学，不想约会，别再劝了。'}).includes('unasked-plan-cancellation'))
 assert.equal(scriptVoiceIssues({text:'好，先把题放下。东门我记住了。'},{...job.context,trigger:'先不聊题，图书馆东门等。'}).length,0)
 assert.ok(scriptVoiceIssues({text:'记住了，×年×月×日。'},{...job.context,trigger:'图书馆东门等。'}).includes('template-residue'))
 assert.equal(hasUnsupportedRecollectionQuote({text:'还记得那张纸吗？上面写着“这里慢一点，图比我讲三分钟管用”。'},{actor:{card:{romance:{},pastEventAnchors:[]}},trigger:'你记得那页批注吗？',story:{campus:true,stage:2,publicReveals:[{stage:0,text:'这里慢一点，图比我讲三分钟管用'}]}}),false,'old officially unlocked pages stay valid quote sources after long dialogue')
 store.completeJob(r.id,job.job.id,job.job.leaseId,{text:'得先把两张条件放到一起。你那张写了什么？'})
 r=disclose(store.get(who,r.id),[who]);r=solve(r,who)
 r=action(who,r.id,'chat',{target:ai,text:'那张失败稿现在能看了吗？'});job=store.leaseJob(r.id)
 assert.equal(job.context.story.publicReveals.length,1);assert.match(job.context.story.publicReveals[0].text,/返还页一/);assert.ok(!JSON.stringify(job.context).includes('返还页三'))
 store.completeJob(r.id,job.job.id,job.job.leaseId,{text:'能。那只猫还是很丑，你添的眼镜倒挺合适。'})
 close(r,[who])
 console.log('PASS both solo perspectives, 9 two-person endings, fair puzzles, earned reveals, private stages, restart, old canon and AI information boundaries')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
