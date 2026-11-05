import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { scriptGame, newScriptGame, publicScriptCatalog } from './scriptGameCatalog.js'
import {npcRomanceDecision,romanceReplyActor,romanceOutcomes} from './scriptRomance.js'
import {duetNpcDecision,duetReplyActor,duetOutcomes} from './scriptDuetRomance.js'
import {caseNpcDecision,caseReplyActor,casePublicContext,caseStageResolution,caseEnding,caseRelationshipOutcomes,caseActorContext} from './scriptRomanceCase.js'
import {visibleScriptRole} from './scriptRoleCards.js'
import {normalizeScriptDialogue} from './scriptDialogue.js'
import {scriptRoomContinuity} from './scriptRoomMemory.js'

const TTL=72*60*60*1000, MAX_MESSAGES=600, MAX_ACTIONS=1000
const fail=(statusCode,code,message)=>{throw Object.assign(Error(message),{statusCode,code})}
const owner=v=>{if(typeof v!=='string'||!/^ielts:\d{1,16}$/.test(v))fail(401,'auth_required','请登录后进入剧本房间。');return v}
const scalar=(v,max=100)=>typeof v==='string'&&v.length<=max?v.trim():''
const token=v=>/^[a-zA-Z0-9_-]{8,100}$/.test(scalar(v))?v:fail(400,'script_invalid_request','请求标识无效。')
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex')
const answer=v=>scalar(v,200).normalize('NFKC').replace(/[\s，,。.!！?？、：:;；-]/g,'').toLowerCase()
const publicRole=role=>({id:role.id,name:role.name,tagline:role.tagline})
const clone=v=>JSON.parse(JSON.stringify(v))
const text=v=>{const s=scalar(v,2400).replace(/\u0000/g,'');if(!s)fail(400,'script_text_required','请输入内容（最多2400字）。');return s}
const fields={ready:[],start:[],claim:['roleId'],inspect:['clueId'],share:['clueId'],requestEvidence:['roleId'],choose:['missionId','optionId'],solve:['answer'],advance:[],vote:['choiceId'],chat:['text','target'],image:['text','target'],retry:['jobId'],leave:[],close:[]}
const gameFor=r=>scriptGame(r.scriptId,r.scriptVersion,r.contentEdition)

export function createScriptRoomStore({root,now=Date.now}={}){
 if(!root||!path.isAbsolute(root))throw Error('script room root must be absolute')
 fs.mkdirSync(root,{recursive:true,mode:0o700})
 const file=path.join(root,'script-rooms.sqlite'),db=new DatabaseSync(file)
 if(process.platform!=='win32')fs.chmodSync(file,0o600)
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS script_rooms(id TEXT PRIMARY KEY,invite_code TEXT UNIQUE NOT NULL,snapshot TEXT NOT NULL,expires_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS script_receipts(owner TEXT NOT NULL,request_id TEXT NOT NULL,body_hash TEXT NOT NULL,room_id TEXT NOT NULL,PRIMARY KEY(owner,request_id));
 CREATE TABLE IF NOT EXISTS script_events(room_id TEXT NOT NULL,seq INTEGER NOT NULL,kind TEXT NOT NULL,actor TEXT NOT NULL,data TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(room_id,seq));
 CREATE TABLE IF NOT EXISTS script_presence(room_id TEXT NOT NULL,owner TEXT NOT NULL,seen INTEGER NOT NULL,PRIMARY KEY(room_id,owner));
 CREATE TABLE IF NOT EXISTS script_images(room_id TEXT NOT NULL,id TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(room_id,id));`)
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(e){try{db.exec('ROLLBACK')}catch{}throw e}}
 function load(id,{expired=false}={}){
  const row=db.prepare('SELECT snapshot FROM script_rooms WHERE id=?').get(scalar(id))
  if(!row)fail(404,'script_room_missing','房间不存在，或你没有加入此房间。')
  const r=JSON.parse(row.snapshot)
  if(!gameFor(r))fail(409,'script_version_unavailable','本局剧本版本暂不可用，原进度仍保留，不会换成其他剧本。')
  if(!expired&&r.expiresAt<=now())fail(410,'script_room_expired','房间已过期，请创建新房间。')
  return r
 }
 function member(r,who){const seat=r.seats.find(s=>s.owner===who);if(!seat)fail(404,'script_room_missing','房间不存在，或你没有加入此房间。');return seat}
 function event(r,kind,actor,data={}){r.eventSeq++;db.prepare('INSERT INTO script_events VALUES(?,?,?,?,?,?)').run(r.id,r.eventSeq,kind,actor,JSON.stringify(data),now())}
 function message(r,actor,body,{target='public',kind='dialogue',image=''}={}){
  if(r.messages.length>=MAX_MESSAGES)fail(409,'script_message_limit','本房间消息已达上限，请保留复盘并另开一局。')
  const m={id:crypto.randomUUID(),actor,target,kind,text:body,at:now(),stage:r.stage,...(image?{image}:{} )}
  r.messages.push(m);return m
 }
 function save(r){r.updatedAt=now();db.prepare('UPDATE script_rooms SET snapshot=?,updated_at=? WHERE id=?').run(JSON.stringify(r),r.updatedAt,r.id)}
 function existing(who,req,body){token(req);const hit=db.prepare('SELECT * FROM script_receipts WHERE owner=? AND request_id=?').get(who,req);if(!hit)return null;if(hit.body_hash!==digest(body))fail(409,'script_request_reused','重复请求标识不能用于另一操作。');return load(hit.room_id)}
 function receipt(who,req,body,r){db.prepare('INSERT INTO script_receipts VALUES(?,?,?,?)').run(who,req,digest(body),r.id)}
 function heartbeat(r,who){db.prepare('INSERT INTO script_presence VALUES(?,?,?) ON CONFLICT(room_id,owner) DO UPDATE SET seen=excluded.seen').run(r.id,who,now())}
 function view(r,who){
  const me=member(r,who),game=gameFor(r),running=r.phase!=='lobby'
  const own=game.roles.find(x=>x.id===me.roleId),visible=m=>m.target==='public'||m.actor===me.roleId||m.target===me.roleId
  const seen=new Map(db.prepare('SELECT owner,seen FROM script_presence WHERE room_id=?').all(r.id).map(x=>[x.owner,x.seen]))
  const act=game.acts[r.stage],publicClues=game.clues.filter(c=>r.publicClues.includes(c.id))
  const currentClues=game.clues.filter(c=>c.stage===r.stage)
  return {id:r.id,scriptId:r.scriptId,scriptVersion:game.clientVersion||r.scriptVersion,title:game.title,genre:game.genre,warning:game.warning,revision:r.revision,phase:r.phase,stage:r.stage,
   inviteCode:r.phase==='lobby'?r.inviteCode:'',expiresAt:r.expiresAt,isHost:r.host===who,myRoleId:me.roleId,
   seats:r.seats.map(s=>({...publicRole(game.roles.find(x=>x.id===s.roleId)),control:s.control,isMe:s.owner===who,ready:s.ready,advanced:r.advanced.includes(s.roleId),online:s.control==='ai'||now()-(seen.get(s.owner)||0)<45000})),
   myRole:running?visibleScriptRole(own,r.stage,game.id):publicRole(own),myClues:running?game.clues.filter(c=>(r.known[me.roleId]||[]).includes(c.id)).map(c=>({...c,shared:r.publicClues.includes(c.id)})):[],publicClues,
   myMissions:running?(own.missions||[]).filter(m=>m.stage<=r.stage).map(m=>({...m,choiceId:r.missionChoices?.[me.roleId]?.[m.id]||'',consequence:m.options.find(o=>o.id===r.missionChoices?.[me.roleId]?.[m.id])?.consequence||'',options:m.options.map(({id,label})=>({id,label}))})):[],
   evidenceRequests:r.phase==='play'&&game.version>=2?currentClues.filter(c=>!r.publicClues.includes(c.id)&&r.seats.some(s=>s.roleId===c.roleId&&s.control==='ai')).map(c=>({roleId:c.roleId,name:game.roles.find(s=>s.id===c.roleId).name})):[],
   searchOptions:r.phase==='play'?currentClues.filter(c=>c.roleId===me.roleId).map(c=>({id:c.id,title:c.title,found:(r.known[me.roleId]||[]).includes(c.id)})):[],
   act:r.phase==='play'?{title:act.title,objective:act.objective,image:act.image,shared:currentClues.filter(c=>r.publicClues.includes(c.id)).length,total:currentClues.length,puzzle:act.puzzle?{question:act.puzzle.question,solved:r.solved.includes(r.stage),attempts:r.attempts[r.stage]||0,hint:(r.attempts[r.stage]||0)>=2?act.puzzle.hint:''}:null}:null,
   messages:r.messages.filter(visible).slice(-200).map(m=>{const copy=clone(m),j=m.imageJobId?r.jobs.find(j=>j.id===m.imageJobId):null;return {...copy,...(j?{imageStatus:j.status,imageError:j.status==='failed'?'配图未完成，可重试；故事进度不受影响。':'',canRetry:j.owner===who}:{} )}}),
   jobs:r.jobs.filter(j=>j.target==='public'||j.target===me.roleId||j.kind==='image'&&j.actor===me.roleId).map(({id,actor,target,status,kind,owner:requester})=>({id,actor,target,status,kind:kind||'text',canRetry:kind!=='image'||requester===who})),
   ballot:['vote','ended'].includes(r.phase)?{...game.ballot,voted:Object.keys(r.votes),myVote:r.votes[me.roleId]||''}:null,
   ending:r.phase==='ended'?{...r.ending,myJourney:(own.missions||[]).map(m=>({title:m.title,choice:m.options.find(o=>o.id===r.missionChoices?.[me.roleId]?.[m.id])?.label||'未选择',text:m.options.find(o=>o.id===r.missionChoices?.[me.roleId]?.[m.id])?.consequence||''}))}:null,relationship:r.relations[me.roleId]||{},
  }
 }
 function quota(who){
  const stats=fs.statfsSync(root);if(Number(stats.bavail)*Number(stats.bsize)<256*1024*1024)fail(503,'script_storage_full','暂时无法创建房间，已有记录仍保留。')
  const live=db.prepare('SELECT snapshot FROM script_rooms WHERE expires_at>?').all(now()).map(row=>JSON.parse(row.snapshot))
  if(live.length>=2000)fail(429,'script_capacity','房间较多，请稍后再创建。')
  const active=live.filter(r=>!['closed','ended'].includes(r.phase))
  if(active.length>=500||active.filter(r=>r.seats.some(s=>s.owner===who)).length>=3)fail(429,'script_room_limit','最多保留3间进行中的房间，请先结束或退出旧房间。')
 }
 function prune(){
  const expired=db.prepare('SELECT id FROM script_rooms WHERE expires_at<? LIMIT 25').all(now()-24*60*60*1000)
  for(const {id}of expired){for(const table of ['script_events','script_receipts','script_presence','script_images'])db.prepare(`DELETE FROM ${table} WHERE room_id=?`).run(id);db.prepare('DELETE FROM script_rooms WHERE id=?').run(id)}
 }
 function create(who,payload){owner(who);const {scriptId,scriptVersion,requestId}=payload||{};return transaction(()=>{
  const body={kind:'create',scriptId,...(scriptVersion===undefined?{}:{scriptVersion})},previous=existing(who,requestId,body);if(previous)return view(previous,who)
  const game=newScriptGame(scriptId,scriptVersion??1);if(!game)fail(400,'script_invalid_script','请选择已有剧本。')
  prune();quota(who)
  const r={id:crypto.randomUUID(),inviteCode:crypto.randomBytes(8).toString('hex').toUpperCase(),scriptId,scriptVersion:game.version,...(game.contentEdition?{contentEdition:game.contentEdition}:{}),host:who,phase:'lobby',stage:0,revision:1,eventSeq:0,createdAt:now(),updatedAt:now(),expiresAt:now()+TTL,
   seats:game.roles.map((role,i)=>({roleId:role.id,owner:i===0?who:null,control:i===0?'human':'open',ready:false})),known:{},publicClues:[],solved:[],attempts:{},advanced:[],votes:{},messages:[],jobs:[],npcMemory:{},relations:{},missionChoices:{},ending:null}
  db.prepare('INSERT INTO script_rooms VALUES(?,?,?,?,?)').run(r.id,r.inviteCode,JSON.stringify(r),r.expiresAt,now());event(r,'created',r.seats[0].roleId);save(r);receipt(who,requestId,body,r);heartbeat(r,who);return view(r,who)
 })}
 function join(who,payload,{clientVersion=Infinity}={}){owner(who);const {inviteCode,roleId,requestId}=payload||{};return transaction(()=>{
  const code=scalar(inviteCode,32).toUpperCase(),body={kind:'join',code,roleId},previous=existing(who,requestId,body);if(previous)return view(previous,who)
  if(!/^[A-F0-9]{16}$/.test(code))fail(404,'script_invite_invalid','邀请码无效或已过期。')
  const row=db.prepare('SELECT id FROM script_rooms WHERE invite_code=?').get(code);if(!row)fail(404,'script_invite_invalid','邀请码无效或已过期。')
  const r=load(row.id),already=r.seats.find(s=>s.owner===who)
  if((gameFor(r).clientVersion||r.scriptVersion)>clientVersion)fail(409,'script_client_update','此房间需要新版剧本玩法，请更新小程序后加入；尚未占用角色。')
  if(already){receipt(who,requestId,body,r);return view(r,who)}
  if(r.phase!=='lobby')fail(409,'script_already_started','游戏已开始，不能中途领取别人身份。')
  quota(who)
  const seat=roleId?r.seats.find(s=>s.roleId===roleId&&!s.owner):r.seats.find(s=>!s.owner)
  if(!seat)fail(409,'script_role_taken','角色已被选择，或房间已满。')
  seat.owner=who;seat.control='human';r.revision++;event(r,'joined',seat.roleId);save(r);receipt(who,requestId,body,r);heartbeat(r,who);return view(r,who)
 })}
 function stageStart(r){
  const game=gameFor(r),a=game.acts[r.stage]
  for(const j of r.jobs)if(j.kind!=='image'&&j.stage!==r.stage&&!['done','superseded'].includes(j.status))j.status='superseded'
  r.advanced=[];message(r,'dm',a.opening,{kind:'narration',image:a.image})
  // Bots obey the same stage/ownership rule; their discoveries are fixed evidence, not model inventions.
  for(const seat of r.seats.filter(s=>s.control==='ai')){
   const decision=npcRomanceDecision(game,seat.roleId,r.stage)||duetNpcDecision(game,seat.roleId,r.stage)||caseNpcDecision(game,seat.roleId,r.stage)
   if(decision){r.missionChoices||={};r.missionChoices[seat.roleId]||={};r.missionChoices[seat.roleId][decision.missionId]||=decision.optionId}
   const c=game.clues.find(c=>c.stage===r.stage&&c.roleId===seat.roleId)
   r.known[seat.roleId]=[...(r.known[seat.roleId]||[]),c.id]
   if(game.version>=2){event(r,'bot_discovered',seat.roleId,{clueId:c.id});message(r,seat.roleId,game.roles.find(x=>x.id===seat.roleId).card.beats[r.stage].entrance)}
   else {r.publicClues.push(c.id);event(r,'bot_discovered_and_shared',seat.roleId,{clueId:c.id});message(r,seat.roleId,`我在「${c.title}」里找到这一点：${c.text}`,{kind:'evidence'})}
  }
 }
 function revealStage(r){
  const body=caseStageResolution(gameFor(r),r.stage)
  if(!body||(r.revealedStages||[]).includes(r.stage))return
  r.revealedStages||=[];r.revealedStages.push(r.stage)
  message(r,'dm',body,{kind:'narration'});event(r,'case_reveal','dm',{stage:r.stage})
 }
 function queue(r,actor,target,trigger){
  if(r.jobs.filter(j=>['pending','running'].includes(j.status)).length>=6)fail(429,'script_ai_busy','房内仍有回复处理中，请稍后再发。')
  if(r.jobs.length>=150)fail(429,'script_ai_limit','本房间AI对话已达上限，仍可继续搜证、讨论和投票。')
  r.jobs.push({id:crypto.randomUUID(),actor,target,trigger,stage:r.stage,status:'pending',attempts:0,lease:0})
 }
 function finish(r){
  // AI recommendations never outvote the sole human in a solo game.
  const game=gameFor(r),counts={},aiVotes={};for(const seat of r.seats){const choice=r.votes[seat.roleId];if(seat.control==='human')counts[choice]=(counts[choice]||0)+1;else aiVotes[seat.roleId]=choice}
  if(!Object.keys(counts).length){r.phase='closed';return}
  const max=Math.max(...Object.values(counts)),winners=Object.keys(counts).filter(k=>counts[k]===max),tie=winners.length>1
  const selected=tie?'tie':winners[0]
  for(const j of r.jobs)if(j.kind!=='image'&&j.status!=='done')j.status='superseded'
  r.phase='ended';r.ending={choiceId:selected,tie,counts,aiVotes,truth:game.truth,text:tie?'票数相同，团队没有形成一致结论。各人的选择被保留；以下复盘不把任何人擅自算作同意。':game.endings[selected]||game.endings.other,
   roles:game.roles.map(({id,name,secret,goal})=>({id,name,secret,goal})),clues:game.clues}
  r.ending.text=caseEnding(game,r)||r.ending.text
  const relationships=[...romanceOutcomes(game,r),...duetOutcomes(game,r),...caseRelationshipOutcomes(game,r)]
  if(relationships.length)r.ending.text+='\n\n【各自的感情结局】\n'+relationships.map(item=>item.text).join('\n\n')
  message(r,'dm',r.ending.text,{kind:'narration'});event(r,'ended','dm',{choiceId:selected})
 }
 function act(who,id,payload){owner(who);return transaction(()=>{
  const p=payload||{},allowed=fields[p.type];if(!allowed||Object.keys(p).some(k=>!['type','requestId','revision',...allowed].includes(k)))fail(400,'script_invalid_action','操作不受支持。')
  const body={roomId:id,...p};delete body.requestId
  const previous=existing(who,p.requestId,body);if(previous)return previous.seats.some(s=>s.owner===who)?view(previous,who):{left:true,id:previous.id}
  const r=load(id),me=member(r,who),game=gameFor(r)
  if(!Number.isSafeInteger(p.revision)||p.revision!==r.revision)fail(409,'script_revision_conflict','房间已有新进展，已为你刷新，请再操作一次。')
  if(r.eventSeq>=MAX_ACTIONS&&!['leave','close'].includes(p.type))fail(409,'script_action_limit','本局操作已达上限，请另开一局。')
  const host=()=>{if(r.host!==who)fail(403,'script_host_required','此操作需要房主执行。')}
  const phase=name=>{if(r.phase!==name)fail(409,'script_wrong_phase','当前阶段不能执行此操作。')}
  if(p.type==='ready'){phase('lobby');me.ready=!me.ready}
  if(p.type==='claim'){phase('lobby');const to=r.seats.find(s=>s.roleId===p.roleId&&!s.owner);if(!to)fail(409,'script_role_taken','角色已被选择。');to.owner=who;to.control='human';to.ready=false;me.owner=null;me.control='open';me.ready=false}
  if(p.type==='start'){host();phase('lobby');if(r.seats.some(s=>s.control==='human'&&!s.ready))fail(409,'script_not_ready','请等待所有真人点击准备。');for(const seat of r.seats)if(!seat.owner)seat.control='ai';r.phase='play';stageStart(r)}
  if(p.type==='inspect'){
   phase('play');const c=game.clues.find(c=>c.id===p.clueId)
   if(!c||c.stage!==r.stage||c.roleId!==me.roleId)fail(403,'script_clue_locked','该线索不属于你，或尚未解锁。')
   r.known[me.roleId]||=[];if(!r.known[me.roleId].includes(c.id))r.known[me.roleId].push(c.id)
  }
  if(p.type==='share'){
   phase('play');const c=game.clues.find(c=>c.id===p.clueId)
   if(!c||c.roleId!==me.roleId||!(r.known[me.roleId]||[]).includes(c.id))fail(403,'script_clue_unknown','请先搜集自己的线索。')
   if(!r.publicClues.includes(c.id)){r.publicClues.push(c.id);message(r,me.roleId,`公开线索「${c.title}」：${c.text}`,{kind:'evidence'})}
  }
  if(p.type==='requestEvidence'){
   phase('play');const seat=r.seats.find(s=>s.roleId===p.roleId&&s.control==='ai'),role=game.roles.find(s=>s.id===p.roleId)
   const c=game.clues.find(c=>c.stage===r.stage&&c.roleId===p.roleId)
   if(game.version<2||!seat||!c||!(r.known[p.roleId]||[]).includes(c.id))fail(403,'script_evidence_unavailable','只能询问本幕 AI 角色已发现的线索。')
   if(!r.publicClues.includes(c.id)){message(r,me.roleId,`${role.name}，可以说说你本幕的发现吗？`);message(r,seat.roleId,role.card.beats[r.stage].discovery);r.publicClues.push(c.id);message(r,seat.roleId,`公开线索「${c.title}」：${c.text}`,{kind:'evidence'})}
  }
  if(p.type==='choose'){
   phase('play');const m=game.roles.find(s=>s.id===me.roleId).missions?.find(m=>m.id===p.missionId&&m.stage===r.stage)
   if(!m)fail(403,'script_mission_locked','只能完成自己当前幕的个人任务。')
   const clue=game.clues.find(c=>c.roleId===me.roleId&&c.stage===r.stage)
   if(!(r.known[me.roleId]||[]).includes(clue.id))fail(409,'script_mission_evidence','请先查看自己的本幕线索，再决定。')
   if(!m.options.some(o=>o.id===p.optionId))fail(400,'script_mission_choice','请选择任务卡上的决定。')
   r.missionChoices||={};r.missionChoices[me.roleId]||={}
   if(r.missionChoices[me.roleId][m.id])fail(409,'script_mission_decided','这个决定已经保存，不会被重复请求改写。')
   r.missionChoices[me.roleId][m.id]=p.optionId
  }
  if(p.type==='solve'){
   phase('play');const a=game.acts[r.stage];if(!a.puzzle)fail(400,'script_no_puzzle','本幕无需输入密码。')
   if(game.clues.some(c=>c.stage===r.stage&&!r.publicClues.includes(c.id)))fail(409,'script_need_evidence','请先公开本幕全部线索，再提交结论。')
   if((r.attempts[r.stage]||0)>=20)fail(429,'script_puzzle_limit','本幕尝试次数已达上限，请重新阅读线索后另开一局。')
   r.attempts[r.stage]=(r.attempts[r.stage]||0)+1
   const solved=a.puzzle.answers.some(v=>answer(v)===answer(p.answer))
   if(solved&&!r.solved.includes(r.stage)){r.solved.push(r.stage);revealStage(r)}
   message(r,'dm',solved?'答案通过。请各位确认后进入下一幕。':'尚不符合全部线索。请核对题目条件；尝试两次后任务面板会显示提示。',{kind:'system'})
  }
  if(p.type==='advance'){
   phase('play');const a=game.acts[r.stage]
   if(game.clues.some(c=>c.stage===r.stage&&!r.publicClues.includes(c.id))||(a.puzzle&&!r.solved.includes(r.stage)))fail(409,'script_objective_pending','先完成本幕搜证和共同目标。')
   const mission=game.roles.find(s=>s.id===me.roleId).missions?.find(m=>m.stage===r.stage)
   if(mission&&!r.missionChoices?.[me.roleId]?.[mission.id])fail(409,'script_mission_pending','请先到“我的身份”完成本幕个人决定；保留或暂不公开也是有效选择。')
   if(!r.advanced.includes(me.roleId))r.advanced.push(me.roleId)
   if(r.seats.filter(s=>s.control==='human').every(s=>r.advanced.includes(s.roleId))){
    revealStage(r)
    if(r.stage<2){r.stage++;stageStart(r)}else{r.phase='vote';message(r,'dm',game.ballot.question,{kind:'system'});for(const seat of r.seats.filter(s=>s.control==='ai'))r.votes[seat.roleId]=game.botVote}
   }
  }
  if(p.type==='vote'){
   phase('vote');if(!game.ballot.options.some(o=>o.id===p.choiceId))fail(400,'script_invalid_vote','请选择本剧本的选项。')
   if(r.votes[me.roleId])fail(409,'script_already_voted','你的投票已提交，不能重复投票。')
   r.votes[me.roleId]=p.choiceId
   if(r.seats.every(s=>r.votes[s.roleId]))finish(r)
  }
  if(p.type==='chat'||p.type==='image'){
   if(r.messages.length>=500)fail(429,'script_chat_limit','本局聊天已达上限，仍可继续搜证、完成任务和投票。')
   if(!['play','vote'].includes(r.phase))fail(409,'script_wrong_phase','开始游戏后才能聊天。')
   const target=p.target||'public',seat=r.seats.find(s=>s.roleId===target)
   if(!['public','dm'].includes(target)&&(!seat||target===me.roleId))fail(400,'script_invalid_target','请选择公共聊天、主持人或其他角色。')
   const m=message(r,me.roleId,text(p.text),{target})
   if(p.type==='image'){
    if(game.version<2||!game.visualCanon)fail(409,'script_image_version','此旧房间不支持即时配图，请在新房间使用。')
    if(m.text.length>500)fail(400,'script_image_prompt','画面描述请控制在500字以内。')
    if(/(?:凶手|真凶|谜底|密码|未解锁|幕后真相|隐藏答案|其他角色的秘密)/i.test(m.text))fail(400,'script_image_spoiler','配图只描绘已知场景，不用于获取隐藏答案。请描述当前想看的画面。')
    if(r.jobs.filter(j=>j.kind==='image').length>=8)fail(429,'script_image_limit','本房间最多生成8张即时配图；预制场景图仍可查看。')
    if(r.jobs.some(j=>j.kind==='image'&&['pending','running'].includes(j.status)))fail(429,'script_image_busy','本房间已有配图生成中，可以继续聊天。')
    const free=fs.statfsSync(root),stored=db.prepare('SELECT COALESCE(SUM(LENGTH(bytes)),0) size FROM script_images').get().size
    if(stored+2*1024*1024>256*1024*1024||Number(free.bavail)*Number(free.bsize)<512*1024*1024)fail(503,'script_image_storage','配图空间暂不足，文字与搜证仍可继续。')
    const job={id:crypto.randomUUID(),kind:'image',actor:me.roleId,target,trigger:m.id,stage:r.stage,status:'pending',attempts:0,lease:0,owner:who}
    m.imageJobId=job.id;r.jobs.push(job)
   }
   else if(target==='dm')queue(r,'dm',me.roleId,m.id)
   else if(seat?.control==='ai')queue(r,seat.roleId,me.roleId,m.id)
   else if(target==='public'){
    const reply=romanceReplyActor(game,me.roleId,m.text,r.seats)??duetReplyActor(game,me.roleId,m.text,r.seats)??caseReplyActor(game,me.roleId,m.text,r.seats)
    if(reply)queue(r,reply,'public',m.id)
    else if(reply===undefined){const bots=r.seats.filter(s=>s.control==='ai');if(bots.length)queue(r,bots[r.jobs.length%bots.length].roleId,'public',m.id)}
   }
   if(seat){r.relations[me.roleId]||={};r.relations[me.roleId][target]||={exchanges:0,attitude:'尚在了解'};r.relations[me.roleId][target].exchanges++}
  }
  if(p.type==='retry'){
   const job=r.jobs.find(j=>j.id===p.jobId&&j.status==='failed'&&(j.target==='public'||j.target===me.roleId||j.kind==='image'&&j.actor===me.roleId))
   if(!job||job.attempts>=3||job.kind==='image'&&job.owner!==who)fail(409,'script_retry_unavailable','此回复无法继续重试；配图仅可由发起者重试。')
   if(job.kind!=='image'&&(job.stage!==r.stage||!['play','vote'].includes(r.phase))||job.kind==='image'&&r.phase==='closed')fail(409,'script_wrong_phase','剧情已经进入新阶段，不再重试旧回复。')
   job.status='pending';job.lease=0
  }
  if(p.type==='leave'||p.type==='close'){
   if(p.type==='close'){host();r.phase='closed'}
   else {me.owner=null;me.control=r.phase==='lobby'?'open':'ai';me.ready=false
    if(r.phase==='play')for(const c of game.clues.filter(c=>c.roleId===me.roleId&&c.stage<=r.stage)){r.known[me.roleId]||=[];if(!r.known[me.roleId].includes(c.id))r.known[me.roleId].push(c.id);if(!r.publicClues.includes(c.id))r.publicClues.push(c.id)}
    if(r.phase==='vote'){r.votes[me.roleId]||=game.botVote;if(r.seats.every(s=>r.votes[s.roleId]))finish(r)}
    const next=r.seats.find(s=>s.owner);if(!next)r.phase='closed';else if(r.host===who)r.host=next.owner
   }
  }
  r.revision++;event(r,p.type,me.roleId,{...(p.clueId?{clueId:p.clueId}:{}),...(p.type==='vote'?{choiceId:p.choiceId}:{})});save(r);receipt(who,p.requestId,body,r)
  return p.type==='leave'?{left:true,id:r.id}:view(r,who)
 })}
 function get(who,id){owner(who);const r=load(id);member(r,who);heartbeat(r,who);return view(r,who)}
 function list(who){owner(who);return db.prepare('SELECT snapshot FROM script_rooms WHERE expires_at>? ORDER BY updated_at DESC LIMIT 500').all(now()).map(row=>JSON.parse(row.snapshot)).filter(r=>r.seats.some(s=>s.owner===who)).map(r=>({id:r.id,title:gameFor(r)?.title||'剧本房间',phase:r.phase,stage:r.stage,updatedAt:r.updatedAt})).slice(0,20)}
 function leaseJob(id,kind){return transaction(()=>{
  const r=load(id);if(!['play','vote','ended'].includes(r.phase))return null
  for(const j of r.jobs)if(j.status==='running'&&(j.kind==='image'?j.lease<now()-300000:j.lease<now()-90000&&j.attempts>=3))j.status='failed'
  const job=r.jobs.find(j=>(!kind||(j.kind||'text')===kind)&&(j.status==='pending'||j.kind!=='image'&&j.status==='running'&&j.lease<now()-90000)&&(j.kind==='image'||j.stage===r.stage&&r.phase!=='ended')&&j.attempts<3)
  if(!job){save(r);return null}
  job.status='running';job.lease=now();job.attempts++;job.leaseId=crypto.randomUUID();save(r)
  const game=gameFor(r),role=game.roles.find(x=>x.id===job.actor)
  if(job.kind==='image')return {id:r.id,job:clone(job),imageInput:{ownerId:job.owner,requestId:`room-${r.id}-${job.id}-${job.attempts}`,persona:'script-room',prompt:r.messages.find(m=>m.id===job.trigger)?.text||'',longJob:true,scriptScene:{id:game.id,version:game.clientVersion||game.version,title:game.title,visualCanon:game.visualCanon,act:game.acts[job.stage].title,setting:game.acts[job.stage].opening}}}
  const continuity=scriptRoomContinuity(r,game,job)
  const disclosed=game.clues.filter(c=>r.publicClues.includes(c.id)||(r.known[job.actor]||[]).includes(c.id))
  // Never include the full game, other identities, future clues, or answer/ending fields.
  const context={title:game.title,phase:r.phase,act:game.acts[r.stage].title,objective:game.acts[r.stage].objective,
   actor:role?caseActorContext(game,r,role,visibleScriptRole(role,r.stage,game.id)):{id:'dm',name:'主持人',voice:'只帮助理解当前目标，不代替玩家发言'},
   participants:game.roles.map(publicRole),evidence:disclosed,messages:continuity.recentMessages,continuity:continuity.continuity,
   memory:(r.npcMemory[job.actor]||[]).filter(m=>m.target==='public'||m.target===job.target).slice(-16),
   relationship:job.target==='public'?{}:r.relations[job.target]?.[job.actor]||{},
   target:job.target,sender:publicRole(game.roles.find(s=>s.id===r.messages.find(m=>m.id===job.trigger)?.actor)||{id:'unknown',name:'玩家'}),trigger:r.messages.find(m=>m.id===job.trigger)?.text||''}
  const story=casePublicContext(game,r);if(story)context.story=story
  if(role?.card?.romance){
   const mission=role.missions.find(m=>m.stage===r.stage),chosen=r.missionChoices?.[role.id]?.[mission?.id]
   context.actorDecision=mission?.options.find(o=>o.id===chosen)?.label||''
  }
  if(job.actor==='dm'&&job.target!=='public'){
   const humanRole=game.roles.find(s=>s.id===job.target)
   context.requester={id:humanRole.id,name:humanRole.name,goal:humanRole.goal,currentMission:humanRole.missions?.find(m=>m.stage===r.stage)?.prompt||'',decisionSaved:Boolean(r.missionChoices?.[job.target]?.[`${job.target}-${r.stage}`])}
  }
  return {id:r.id,job:clone(job),context}
 })}
 function completeJob(id,jobId,leaseId,proposal,{failed=false}={}){return transaction(()=>{
  const r=load(id),j=r.jobs.find(j=>j.id===jobId)
  if(!j||j.status!=='running'||j.leaseId!==leaseId)return false
  if(j.stage!==r.stage||!['play','vote'].includes(r.phase)){j.status='superseded';save(r);return false}
  if(failed){j.status='failed';save(r);return false}
  const game=gameFor(r),normalized=normalizeScriptDialogue(proposal,{actor:j.actor,name:game.roles.find(s=>s.id===j.actor)?.name||'主持人',target:j.target,evidence:game.clues.filter(c=>(r.known[j.actor]||[]).includes(c.id)&&c.stage<=r.stage)})
  if(!normalized){j.status='failed';save(r);return false}
  proposal=normalized
  const clue=proposal.shareClueId?game.clues.find(c=>c.id===proposal.shareClueId):null
  if(proposal.shareClueId&&(!clue||clue.roleId!==j.actor||clue.stage>r.stage||!(r.known[j.actor]||[]).includes(clue.id)||j.target!=='public')){j.status='failed';save(r);return false}
  const reply=message(r,j.actor,proposal.text.trim(),{target:j.target,kind:j.actor==='dm'?'narration':'dialogue'});reply.parts=proposal.parts;reply.replyTo=j.trigger
  if(clue&&!r.publicClues.includes(clue.id)){r.publicClues.push(clue.id);message(r,j.actor,`公开线索「${clue.title}」：${clue.text}`,{kind:'evidence'})}
  r.npcMemory[j.actor]||=[];r.npcMemory[j.actor].push({target:j.target,trigger:j.trigger,text:proposal.text.slice(0,700)});r.npcMemory[j.actor]=r.npcMemory[j.actor].slice(-40)
  if(j.target!=='public'&&['谨慎','信任','怀疑','尚在了解'].includes(proposal.attitude)){r.relations[j.target]||={};r.relations[j.target][j.actor]||={exchanges:0};r.relations[j.target][j.actor].attitude=proposal.attitude}
  j.status='done';r.revision++;event(r,'ai_reply',j.actor,{jobId:j.id,target:j.target});save(r);return true
 })}
 function completeImage(id,jobId,leaseId,result){return transaction(()=>{
  const r=load(id),j=r.jobs.find(j=>j.id===jobId&&j.kind==='image')
  if(!j||j.status!=='running'||j.leaseId!==leaseId)return false
  if(r.phase==='closed'){j.status='superseded';save(r);return false}
  const bytes=result?.bytes?Buffer.from(result.bytes):null,mime=result?.mimeType
  const valid=bytes&&bytes.length>0&&bytes.length<=2*1024*1024&&(mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/webp'&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')
  const available=fs.statfsSync(root),stored=db.prepare('SELECT COALESCE(SUM(LENGTH(bytes)),0) size FROM script_images').get().size
  if(!valid||stored+(bytes?.length||0)>256*1024*1024||Number(available.bavail)*Number(available.bsize)<512*1024*1024){j.status='failed';save(r);return false}
  const m=r.messages.find(m=>m.id===j.trigger);if(!m){j.status='failed';save(r);return false}
  db.prepare('INSERT INTO script_images VALUES(?,?,?,?)').run(r.id,j.id,mime,bytes)
  m.imageId=j.id;j.status='done';r.revision++;event(r,'image_ready',j.actor,{imageId:j.id,target:j.target});save(r);return true
 })}
 function image(who,id,imageId){owner(who);const r=load(id),me=member(r,who)
  if(!r.messages.some(m=>m.imageId===imageId&&(m.target==='public'||m.actor===me.roleId||m.target===me.roleId)))fail(404,'script_image_missing','配图不存在或无权查看。')
  const row=db.prepare('SELECT mime,bytes FROM script_images WHERE room_id=? AND id=?').get(r.id,scalar(imageId))
  if(!row)fail(404,'script_image_missing','配图暂不可用。')
  return {bytes:Buffer.from(row.bytes),mimeType:row.mime}
 }
 return {create,join,act,get,list,leaseJob,completeJob,completeImage,image,catalog:publicScriptCatalog,close(){db.close()}}
}
