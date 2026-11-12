// Regression from an actual synthetic Venice acceptance reply; no real user data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {Readable} from 'node:stream'
import {scriptVoiceIssues,SCRIPT_VOICES,TAVERN_VOICES} from '../server/roleVoices.js'
import {scriptActorMessages,createScriptRoomApi} from '../server/scriptRoomApi.js'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'
import {newScriptGame} from '../server/scriptGameCatalog.js'
const question='先不谈工作。今天有没有哪件小事让你笑出来？',observed='有。你拿那两片切歪的样纸比了比，笑到肩膀抖，我在旁边也跟着笑了。',say=text=>({segments:[{kind:'speech',text}]})
const context={scriptId:'venice-blue-hour',actor:{id:'luxi',name:'陆晞'},sender:{id:'xuying',name:'许映'},target:'xuying',trigger:question,messages:[],continuity:{dialogueAnchors:[]}}
const issue=(reply,c=context)=>scriptVoiceIssues(say(reply),c).includes('unsupported-player-behavior')
assert.ok(issue(observed),'the actual invented player action must not pass')
for(const text of ['你刚才笑到肩膀抖。','许映拿了样纸比了比。','你正在拿起样纸比来比去。','我看见你拿了样纸比了比。','我看着你拿了纸，笑了。'])assert.ok(issue(text),text)
for(const text of ['你刚才把样纸切歪了，笑得肩膀一抖一抖的。','你将样纸剪坏了。','你拿反了那张样纸。','你刚才把杯子摆倒了。'])assert.ok(issue(text),'asserted physical result: '+text)
for(const text of ['你把我的意思想歪了。','你刚才没有把样纸切歪。','如果你把样纸切歪了，再拿张新的。','等你把样纸剪好了，再叫我。','你把样纸切歪了吗？','我刚才把样纸切歪了，自己都想笑。'])assert.equal(issue(text),false,'mental interpretation, uncertainty, invitation or own action is not a player physical assertion: '+text)
const reportedResult='我刚才把那张样纸切歪了，自己笑得停不下来。你有没有也想笑？'
assert.equal(issue('你切歪那一下，我也差点笑出声。样纸还在，慢慢来。',{...context,trigger:reportedResult}),false,'actual immediate sender action permits a natural short reference; do not force word-for-word repetition')
assert.equal(issue('你刚才把那张样纸切歪了。',{...context,messages:[{actor:'xuying',text:reportedResult}]}),false,'the actual stored sender can ground the same physical result')
for(const source of [{messages:[{actor:'luxi',text:observed}]},{messages:[{actor:'other',text:'许映拿了样纸比了比，笑到肩膀抖。'}]},{continuity:{dialogueAnchors:[{speaker:{id:'luxi',name:'陆晞'},text:observed}]}},{actor:{id:'luxi',name:'陆晞',biography:'你拿那两片切歪的样纸比了比，笑到肩膀抖。'}},{actor:{id:'luxi',name:'陆晞',card:{pastEventAnchors:['你拿那两片切歪的样纸比了比，笑到肩膀抖。']}}}])assert.ok(issue(observed,{...context,...source}),'another speaker or actor-biography second person is not the player')
const self='我拿那两片切歪的样纸比了比，笑到肩膀抖。'
for(const source of [{trigger:self},{messages:[{actor:'xuying',text:self}]},{continuity:{dialogueAnchors:[{speaker:{id:'xuying',name:'许映'},text:self}]}},{actor:{id:'luxi',name:'陆晞',biography:'许映拿那两片切歪的样纸比了比，笑到肩膀抖。'}},{actor:{id:'luxi',name:'陆晞',card:{pastEventAnchors:['许映拿那两片切歪的样纸比了比，笑到肩膀抖。']}}},{evidence:[{id:'reviewed-canon',text:'许映拿那两片切歪的样纸比了比，笑到肩膀抖。'}]}])assert.equal(issue(observed,{...context,...source}),false,'real self-report or explicit canonical named fact remains usable')
assert.ok(issue(observed,{...context,messages:[{actor:'xuying',text:'我明天想拿那两片切歪的样纸比了比，笑到肩膀抖。'}]}),'future plan cannot establish a completed event')
assert.ok(issue(observed,{...context,messages:[{actor:'xuying',text:'我没有拿那两片切歪的样纸比了比，更没有笑到肩膀抖。'}]}),'denial is not positive action evidence')
assert.ok(issue('你拿了纸样，笑到肩膀抖。',{...context,messages:[{actor:'xuying',text:'我拿了纸样。'}]}),'a real first action does not ground an added reaction')
assert.ok(issue(observed,{...context,actor:{id:'luxi',name:'陆晞',biography:'你以为许映拿那两片切歪的样纸比了比，笑到肩膀抖。'}}),'NPC belief is not a confirmed player event')
assert.ok(issue('我们拿了样纸比了比。',{...context,actor:{id:'luxi',name:'陆晞',biography:'我们拿了样纸比了比。'}}),'unspecified we in an NPC biography does not name the player as a participant')
assert.equal(issue('我们拿了样纸比了比。',{...context,actor:{id:'luxi',name:'陆晞',biography:'陆晞和许映拿了样纸比了比。'}}),false,'explicit canonical names can establish a shared action')
assert.equal(issue('你拿了样纸比了比。',{...context,actor:{id:'luxi',name:'陆晞',biography:'陆晞和许映拿了样纸比了比。'}}),false,'explicit joint canon also grounds the named player doing that same action')
assert.ok(issue('我们拿了样纸比了比。',{...context,messages:[{actor:'xuying',text:'我拿了样纸比了比。'}]}),'one player action does not establish the NPC taking part')
assert.equal(issue('你把那两片样纸摊开了。',{...context,actor:{id:'luxi',name:'陆晞',biography:'许映把两片样纸摊开。'}}),false,'ordinary demonstrative/aspect variation preserves explicit canon')
assert.ok(issue('你把那两片剪坏的样纸摊开了。',{...context,actor:{id:'luxi',name:'陆晞',biography:'许映把两片样纸摊开。'}}),'object modifiers before the verb cannot be discarded')
for(const text of ['你要不要拿两片样纸比一比？','如果你拿了样纸，想给我看看吗？','你刚才拿样纸了吗？','你没有答应过，我知道。','我刚才把样纸拿反了，自己看着都想笑。','我记得那支旧手电。','你笑起来很好看。','你这问题问得我有点想笑。','我把样纸递到你面前。','下次一起去喝咖啡，好吗？','你比我更了解这里。','你以前很亲切。','你刚才这句话真好笑。','你拿手的本事，我还没学完。','你放心了不少。'])assert.equal(issue(text),false,text)
for(const text of ['明天你拿了样纸再来找我。','等你拿了样纸，再一起看看。','我没有看见你拿了样纸。','我猜许映拿了样纸。','我好像看到你拿了样纸。','我没有看着你拿了纸。','我猜自己看着你拿了纸。'])assert.equal(issue(text),false,'hypothetical/future/uncertain observation: '+text)
// Other five replies from the same synthetic live acceptance are not new
// physical-action violations. Preserve those raw replies; don't cherry-pick
// only the single failure or make harmless recall obey this physical parser.
for(const text of ['能去。青色便签我认得，就放门边的告示板上。你说等会儿再商量，那就等。你先说个大概时候，我好知道在不在。还有，你说等会儿——是还没决定要不要去，还是不知道怎么跟我开口？','你说稍后在门边见，带青色便签。','门边可以。青色便签我这儿有，先揣着。去不去等会儿再说，别这会儿定死。','门边。你带青色便签。去不去，还没定。','紧张。手电刚才差点没拿稳。不过这会儿有个能说话的站过来，好一点。'])assert.equal(issue(text),false,'preserve other actual synthetic reply')
const qa=path.resolve(import.meta.dirname,'../../qa'),root=fs.mkdtempSync(path.join(qa,'player-behavior-')),store=createScriptRoomStore({root:path.join(root,'store')}),hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'),voicesBefore=hash([SCRIPT_VOICES,TAVERN_VOICES]);let seq=0
try{
 for(const [index,id,target]of [[0,'before-rain','repair'],[1,'last-elective','peixu'],[2,'venice-blue-hour','luxi']]){
  const owner='ielts:'+(91844001+index),game=newScriptGame(id,2);let room=store.create(owner,{scriptId:id,scriptVersion:2,requestId:'behavior-source-'+id})
  const act=(type,extra={})=>room=store.act(owner,room.id,{type,...extra,revision:store.get(owner,room.id).revision,requestId:'behavior-source-'+(++seq)})
  act('ready');act('start');act('chat',{target,text:question});const leased=store.leaseJob(room.id,'text');assert.ok(leased)
  const messages=scriptActorMessages(leased.context),system=messages[0].content,projected=JSON.parse(messages[1].content)
  assert.equal((system.match(/【后台约束与人物表演分开】/g)||[]).length,1,id+' must get one shared voice block')
  assert.equal((system.match(/【玩家行为来源】/g)||[]).length,1,id+' must get one shared behavior-source block')
  assert.match(system,/actor\.biography/);assert.match(system,/sender/);assert.equal(projected.actor.voiceProfile.name,game.roles.find(r=>r.id===target).name)
  assert.ok(store.completeJob(room.id,leased.job.id,leased.job.leaseId,say('我想先坐一会儿。')))
  const agreement='好，那我们明天下午在门边见，带青色便签。';act('chat',{target,text:agreement});const agreed=store.leaseJob(room.id,'text');assert.ok(agreed);assert.ok(store.completeJob(room.id,agreed.job.id,agreed.job.leaseId,say('好，明天下午门边见。')))
  for(const clue of game.clues.filter(c=>c.stage===0&&c.required!==false)){if(clue.roleId===room.myRoleId||clue.access==='public-investigation'){act('inspect',{clueId:clue.id});act('share',{clueId:clue.id})}else act('requestEvidence',{roleId:clue.roleId})}
  if(game.acts[0].puzzle)act('solve',{answer:game.acts[0].puzzle.answers[0]})
  const mission=store.get(owner,room.id).myMissions.find(m=>m.stage===0);act('choose',{missionId:mission.id,optionId:mission.options[0].id});act('advance');act('chat',{target,text:'你还记得我们约好什么时候见吗？'});const recall=store.leaseJob(room.id,'text');assert.equal(recall.context.continuity.currentAct.stage,1);assert.ok(recall.context.messages.some(m=>m.actor===room.myRoleId&&m.text===agreement));assert.equal(issue('你答应了明天下午在门边见。青色便签别忘了。',recall.context),false,'the physical-action guard cannot veto an actual stored future agreement')
 }
 let samples=[],calls=0;const api=createScriptRoomApi({root:path.join(root,'api'),authenticate:()=> 'ielts:91844010',sendJson:(res,status,value)=>{res.status=status;res.value=value},readBody:async req=>{let b='';for await(const c of req)b+=c;return JSON.parse(b)},generate:async()=>{calls++;assert.ok(samples.length,'only one bounded repair');return JSON.stringify(samples.shift())}})
 const req=async(tail='',body)=>{const r=Readable.from(body?[JSON.stringify(body)]:[]);r.method=body?'POST':'GET';r.headers={};const out={setHeader(){}};await api.handle(r,out,new URL('https://fixture/api/ai/script-rooms'+tail+'?clientVersion=2'));assert.equal(out.status,200,JSON.stringify(out.value?.error));return out.value}
 try{
  let room=await req('',{scriptId:'venice-blue-hour',scriptVersion:2,requestId:'behavior-api-create'});const act=async(type,extra={})=>{room=await req('/'+room.id);return room=await req('/'+room.id+'/actions',{type,...extra,revision:room.revision,requestId:'behavior-api-'+(++seq)})}
  await act('ready');await act('start');samples=[say(observed),say('我刚才差点把纸夹反。自己看着都想笑。')];await act('chat',{target:'luxi',text:question});await api.drain();room=await req('/'+room.id);assert.equal(calls,2);assert.equal(room.jobs.at(-1).status,'done');assert.ok(!room.messages.some(m=>m.actor==='luxi'&&m.text===observed))
  samples=[say(observed)];const before=calls;await act('chat',{target:'luxi',text:self});await api.drain();room=await req('/'+room.id);assert.equal(calls-before,1);assert.equal(room.jobs.at(-1).status,'done','actual sender action needs no forced repair')
  samples=[say('你要不要明天拿两片样纸比一比？')];await act('chat',{target:'luxi',text:'下次想一起试试这种印法吗？'});await api.drain();room=await req('/'+room.id);assert.equal(room.jobs.at(-1).status,'done');assert.equal(room.stage,0);assert.equal(room.publicClues.length,0)
  const resultativeBad='你刚才把样纸切歪了，笑得肩膀一抖一抖的。';samples=[say(resultativeBad),say('我刚才把纸夹反了，自己看着都想笑。')];const beforeResult=calls;await act('chat',{target:'luxi',text:question});await api.drain();room=await req('/'+room.id);assert.equal(calls-beforeResult,2);assert.equal(room.jobs.at(-1).status,'done');assert.ok(!room.messages.some(m=>m.actor==='luxi'&&m.text===resultativeBad))
  samples=[say('你切歪那一下，我也差点笑出声。样纸还在，慢慢来。')];const beforeSelfResult=calls;await act('chat',{target:'luxi',text:reportedResult});await api.drain();room=await req('/'+room.id);assert.equal(calls-beforeSelfResult,1);assert.equal(room.jobs.at(-1).status,'done','natural short reference to this actual stored sender message is preserved')
  samples=[say('你刚才把一杯茶递给了我。'),say('你刚才点了点头。')];const beforeFailure=calls;await act('chat',{target:'luxi',text:'先不谈工作。现在想聊点什么？'});await api.drain();room=await req('/'+room.id);assert.equal(calls-beforeFailure,2,'exactly the existing one repair, not repeated generation until success');assert.equal(room.jobs.at(-1).status,'failed');assert.ok(!room.messages.some(m=>m.actor==='luxi'&&/你刚才把一杯茶|你刚才点了点头/.test(m.text)));assert.equal(room.stage,0);assert.equal(room.publicClues.length,0)
 }finally{await api.drain();api.close()}
 assert.equal(hash([SCRIPT_VOICES,TAVERN_VOICES]),voicesBefore,'fixed personality and static entrances remain unchanged')
 console.log('PASS player-action source grounding, sender-vs-actor perspective, invitations/negations/NPC autonomy, and one shared voice+fact block in three actual leased branches')
}finally{store.close();assert.equal(path.dirname(root),qa);fs.rmSync(root,{recursive:true})}
