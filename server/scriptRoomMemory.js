// Derived from the durable room transcript; no AI summary, new database, or
// cross-user search. Visibility is applied BEFORE retrieval and ranking.
export const SCRIPT_MEMORY_LIMITS=Object.freeze({recentMessages:35,anchors:12,quoteCharacters:700,totalCharacters:6000})
const speechText=m=>String(m?.text||'')
const clip=(text,max)=>Array.from(String(text||'')).slice(0,max).join('')
export function scriptMessageVisible(message,job){
 return message.target==='public'||job.target!=='public'&&((message.actor===job.actor&&message.target===job.target)||(message.actor===job.target&&message.target===job.actor))
}
function stagedMessages(room,game){
 let stage=0
 return (room.messages||[]).map((message,index)=>{
  // Legacy snapshots have no stage field. Only a server-authored opening can
  // advance inference; a player quoting an opening cannot move the boundary.
  if(message.actor==='dm'&&message.kind==='narration'){
   const found=game.acts.findIndex(act=>message.image===act.image&&message.text===act.opening)
   if(found>=0)stage=found
  }
  const labelled=Number.isInteger(message.stage)&&message.stage>=0&&message.stage<game.acts.length?message.stage:stage
  return {...message,stage:labelled,index}
 })
}
const stop=new Set(['我们','你们','记得','什么','那个','这个','一下','之前','现在','当时','上一','一幕','哪里','怎样','怎么','是不是','还记','得吗'])
function queryTerms(text){
 const terms=new Set()
 for(const word of String(text||'').normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]+/gu)||[]){
  if(/^[a-z0-9]+$/.test(word)){if(word.length>=3)terms.add(word);continue}
  const chars=Array.from(word)
  for(let i=0;i<chars.length-1;i++){const term=chars.slice(i,i+2).join('');if(!stop.has(term))terms.add(term)}
 }
 return [...terms].slice(0,100)
}
function excerpt(text,terms,max){
 const points=Array.from(text)
 if(points.length<=max)return{text,truncated:false}
 const positions=terms.map(term=>text.toLowerCase().indexOf(term)).filter(i=>i>=0)
 const pointOffset=positions.length?Array.from(text.slice(0,Math.min(...positions))).length:0
 const start=Math.max(0,Math.min(pointOffset-100,points.length-max))
 return{text:points.slice(start,start+max).join(''),truncated:true}
}
function ownDecisions(room,game,roleId){
 const role=game.roles.find(role=>role.id===roleId)
 return (role?.missions||[]).filter(m=>m.stage<room.stage).flatMap(m=>{
  const choice=m.options.find(option=>option.id===room.missionChoices?.[roleId]?.[m.id])
  return choice?[{roleId,stage:m.stage,missionId:m.id,title:m.title,choice:choice.label,consequence:choice.consequence}]:[]
 })
}
export function scriptRoomContinuity(room,game,job){
 const roles=new Map(game.roles.map(role=>[role.id,role.name]));roles.set('dm','主持人')
 if(!roles.has(job.actor)||job.target!=='public'&&!roles.has(job.target))throw Error('Invalid script memory scope')
 const all=stagedMessages(room,game)
 const visible=all.filter(m=>m.stage<=room.stage&&roles.has(m.actor)&&scriptMessageVisible(m,job))
 const recent=visible.slice(-SCRIPT_MEMORY_LIMITS.recentMessages),recentIds=new Set(recent.map(m=>m.id))
 const candidates=visible.filter(m=>!recentIds.has(m.id)&&speechText(m)&&m.kind!=='evidence'&&m.kind!=='system'&&!(m.actor==='dm'&&m.target==='public'&&m.kind==='narration'))
 const query=room.messages.find(m=>m.id===job.trigger)?.text||'',terms=queryTerms(query)
 const peer=job.target==='public'?room.messages.find(m=>m.id===job.trigger)?.actor:job.target
 const selected=new Set(),byId=new Map(candidates.map(m=>[m.id,m]))
 const select=m=>{if(m&&selected.size<SCRIPT_MEMORY_LIMITS.anchors)selected.add(m.id)}
 const pairWithReply=m=>{
  select(m)
  const reply=candidates.find(next=>next.replyTo===m?.id)
   ||candidates.find(next=>next.index>m?.index&&next.stage===m.stage&&next.actor===job.actor&&next.kind==='dialogue')
  // This selects both quotes, but does not claim a legacy adjacency proves a
  // completed agreement. The model sees separate speakers and exact wording.
  select(reply)
 }
 for(let stage=0;stage<room.stage;stage++){
  const peerTurns=candidates.filter(m=>m.stage===stage&&m.actor===peer&&m.kind==='dialogue')
  if(peerTurns.length){pairWithReply(peerTurns[0]);if(peerTurns.length>1)pairWithReply(peerTurns.at(-1))}
 }
 function score(m){
  const text=speechText(m),lower=text.toLowerCase()
  return terms.reduce((sum,t)=>sum+(lower.includes(t)?12:0),0)
   +(/约(?:定|在|好)|答应|承诺|记住|下次|以后|喜欢|不想|拒绝|同意|愿意|决定|别忘/.test(text)?9:0)
   +(/改成|改为|取消|更正|说错|不是.+而是|不再/.test(text)?12:0)
   +(m.actor===peer?3:0)+m.index/Math.max(all.length,1)
 }
 const ranked=candidates.map(m=>({m,score:score(m)})).sort((a,b)=>b.score-a.score)
 for(const {m}of ranked)select(m)
 let remaining=SCRIPT_MEMORY_LIMITS.totalCharacters
 const dialogueAnchors=[...selected].map(id=>byId.get(id)).sort((a,b)=>a.index-b.index).flatMap(m=>{
  if(remaining<=0)return[]
  const quoted=excerpt(speechText(m),terms,Math.min(remaining,SCRIPT_MEMORY_LIMITS.quoteCharacters));remaining-=Array.from(quoted.text).length
  return [{messageId:m.id,stage:m.stage,act:game.acts[m.stage]?.title||'',speaker:{id:m.actor,name:roles.get(m.actor)},kind:m.kind||'dialogue',channel:m.target==='public'?'public':'this-private-conversation',source:'saved-dialogue-excerpt',...quoted}]
 })
 const visibleById=new Map(visible.map(m=>[m.id,m]))
 const unanswered=(room.jobs||[]).filter(j=>j.kind!=='image'&&j.actor===job.actor&&j.stage<room.stage&&j.status!=='done'&&visibleById.has(j.trigger)).slice(-3).map(j=>{
  const message=visibleById.get(j.trigger)
  return{stage:j.stage,messageId:message.id,speaker:{id:message.actor,name:roles.get(message.actor)},text:clip(message.text,300),status:'no-committed-reply'}
 })
 const knownEvidence=game.clues.filter(c=>c.stage<=room.stage&&((room.publicClues||[]).includes(c.id)||(room.known?.[job.actor]||[]).includes(c.id))).map(c=>({id:c.id,stage:c.stage,title:c.title,text:c.text,source:(room.publicClues||[]).includes(c.id)?'public-evidence':'actor-own-evidence'}))
 return{
  recentMessages:recent.map(({index,...message})=>message),
  continuity:{schemaVersion:'script-continuity-v1',currentAct:{stage:room.stage,title:game.acts[room.stage].title},
   completedActs:game.acts.slice(0,room.stage).map((act,stage)=>({stage,title:act.title,publicEvidenceIds:knownEvidence.filter(c=>c.stage===stage&&c.source==='public-evidence').map(c=>c.id)})),
   alreadyKnownEvidence:knownEvidence,actorDecisions:ownDecisions(room,game,job.actor),
   ...(job.actor==='dm'&&job.target!=='public'?{requesterDecisions:ownDecisions(room,game,job.target)}:{}),
   dialogueAnchors,unanswered,hasAdditionalHistory:candidates.length>dialogueAnchors.length,
  },
 }
}
