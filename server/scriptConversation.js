import {normalizeScriptDialogue} from './scriptDialogue.js'
const length=value=>Array.from(String(value||'')).length
export function scriptConversationContract(context={}){
 const trigger=String(context.trigger||'').trim(),pause=/先别说|不要再问|别再问|让我安静|暂停聊天|先不聊|别说了|安静一会|stop talking|leave me alone/i.test(trigger)
 const detail=/详细|展开说|完整解释|逐条|来龙去脉|讲讲.{0,8}(?:经历|背景|故事)|tell me (?:more|your story)|explain in detail/i.test(trigger)
 const lead=!pause&&/^(?:[嗯哦噢唔好啊呀吧呢哈，,。.!！\s]{1,12}|你说(?:吧|呢)?[。？！?!]?|继续(?:说|聊)?[。？！?!]?|不知道(?:说|聊)(?:什么|啥)[。？！?!]?|随便(?:聊|说)?[。？！?!]?)$/.test(trigger)
 return {mode:detail?'detail':'chat',pause,lead,maxCharacters:detail?720:200,maxSpeechCharacters:detail?180:70,maxSpeechParts:detail?5:4,maxNarrationCharacters:detail?100:50}
}
function partsOf(value){return typeof value?.text==='string'?[{kind:'speech',text:value.text}]:Array.isArray(value?.segments)?value.segments:Array.isArray(value?.parts)?value.parts:[]}
export function scriptConversationIssues(value,context={}){
 if(context.actor?.id==='dm')return []
 const policy=scriptConversationContract(context),parts=partsOf(value),speech=parts.filter(p=>p.kind==='speech'),text=speech.map(p=>p.text||'').join('\n'),issues=[]
 if(/(?:这句话|这句|这话|你的话|你说的话|你说的)[，,\s]*(?:我(?:已经|会|都|也)?)?(?:记下|记住|记着)(?:了|啦|的)?|我(?:已经|会|都)?(?:记下|记住)(?:了)?(?:你说的话|你的话)|(?:^|[。！？!\n])(?:好[的啊]?[，,。]?|嗯[，,。]?|行[，,。]?)?\s*我(?:已经|会|都)?(?:记住|记下|记着)(?:了|的|啦)?(?=[，,。！？!\n]|$)/u.test(text))issues.push('canned-memory-ack')
 if(length(parts.map(p=>p.text||'').join(''))>policy.maxCharacters)issues.push('reply-too-long')
 if(speech.length>policy.maxSpeechParts||speech.some(p=>length(p.text)>policy.maxSpeechCharacters))issues.push('speech-chunk-too-long')
 if(parts.filter(p=>p.kind==='narration').length>1||parts.some(p=>p.kind==='narration'&&length(p.text)>policy.maxNarrationCharacters))issues.push('narration-too-long')
 if(policy.pause&&/[？?]/.test(text))issues.push('ignored-conversation-pause')
 if(policy.lead&&(!/[？?]|要不要|不如|来看看|陪我|给我看看|帮我挑|一起.{0,6}(?:看|坐|听|聊)/.test(text)||/(?:^|[。！？!\n])(?:好的|好啊|嗯|行|明白了|收到)[。！!]?\s*(?:你想聊什么|你想说什么|还有什么(?:想说|需要)|你觉得呢|你怎么看|然后呢)[？?]/.test(text)||/^\s*(?:你想聊什么|你想说什么|你觉得呢|你怎么看|然后呢)[？?]\s*$/.test(text)))issues.push('empty-topic-lead')
 return [...new Set(issues)]
}
function bubbleParts(text,max){
 const result=[]
 for(const paragraph of text.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean)){
  if(length(paragraph)<=max){result.push(paragraph);continue}
  const sentences=paragraph.match(/[^。！？!?]+[。！？!?]+[”’」』"]*|[^。！？!?]+$/gu)||[paragraph]
  if(sentences.join('')!==paragraph){result.push(paragraph);continue}
  let current='';for(const sentence of sentences){if(current&&length(current+sentence)>max){result.push(current);current=''}current+=sentence}if(current)result.push(current)
 }
 return result
}
export function scriptConversationReply(value,context={}){
 const normalized=normalizeScriptDialogue(value,{actor:context.actor?.id||'dm',name:context.actor?.name||'',target:context.target||'public',evidence:context.evidence||[]})
 if(!normalized)return null
 if(context.actor?.id==='dm')return value
 const policy=scriptConversationContract(context),segments=normalized.parts.flatMap(p=>p.kind==='speech'?bubbleParts(p.text,policy.maxSpeechCharacters).map(text=>({kind:'speech',text})):[p])
 return {segments,...(value.attitude?{attitude:value.attitude}:{}),...(value.shareClueId?{shareClueId:value.shareClueId}:{})}
}
export function scriptConversationMessages(messages,context={}){
 if(context.actor?.id==='dm')return messages
 const policy=scriptConversationContract(context)
 const prompt=[
  '【本轮聊天节奏】像即时聊天，默认一到三条短消息，每条通常一两句。一个具体回应就可以结束，不总结人生意义，不复述玩家整句话。',
  `本轮${policy.mode==='detail'?'需要展开，但仍分成清楚短段':'是短聊'}：总计最多${policy.maxCharacters}字，每条speech最多${policy.maxSpeechCharacters}字，最多${policy.maxSpeechParts}条speech。旁白最多一句、${policy.maxNarrationCharacters}字；没有必要动作就不要旁白。用segments分别发出短消息，不合成一篇小作文。`,
  '记忆直接体现在内容里。不要说“这句话我记下了”“你的话我记住了”等确认记忆的套话。例：对方提议在院子喝不加糖的茶，可以直接说“院子见。要带点面包吗？”示例只是节奏，不是本局已发生事实。',
  '可以主动提出自己的小问题、邀请或看法，取自当前可见场景和稳定人格。每次最多接出一个话头；不是每句都反问，也不问笼统的“你想聊什么”。对方聊日常时不要附带先做任务的条件。',
  ...(policy.lead?['玩家这句很短，轮到你带一个具体话题。先给一点自己的内容，再留一个容易接的小问题或邀请；不要只答“嗯”“好的”，不要让玩家再次负责找话题。']:[]),
  ...(policy.pause?['玩家明确要暂停。简短回应并停下，不追问、不转新话题、不主动续发。']:[]),
  '输出仍是一个顶层JSON对象，不是数组。只用segments以及原协议允许的可选字段；每段仅有kind和text，kind为speech或narration。不加姓名标签、Markdown包裹或额外说明。',
 ].join('\n')
 return messages.map((m,i)=>i===0&&m.role==='system'?{...m,content:m.content+'\n'+prompt}:m)
}
export const SCRIPT_CONVERSATION_REPAIR=' 本次回复使用一到三条短speech，每条一两句。删去确认记忆的套话，直接回应具体内容；不要背操作指引。玩家只回嗯、你说吧等时，给一个有具体对象的新话头。若玩家要暂停则停下。不能以短句为由截断事实或改写过去；按原来的JSON格式返回。'
