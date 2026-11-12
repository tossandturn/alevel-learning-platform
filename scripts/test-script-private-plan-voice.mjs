// Synthetic production failures from B acceptance; never real-user dialogue.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {Readable} from 'node:stream'
import {scriptConversationIssues,scriptConversationMessages} from '../server/scriptConversation.js'
import {personalDialogueBeat,scriptVoiceIssues,dialogueVoiceIssues,voiceActorContext} from '../server/roleVoices.js'
import {createScriptRoomApi,scriptActorMessages} from '../server/scriptRoomApi.js'
import {newScriptGame} from '../server/scriptGameCatalog.js'
const say=text=>({segments:[{kind:'speech',text}]})
const proposal='我提议稍后在门边见，带青色便签。能不能去，我们等会儿再商量。'
const recall='刚才我提议见面的地点和带的东西是什么？只说我的提议，不必替自己答应。'
const context={scriptId:'thirteenth-curtain',actor:{id:'manager',name:'陈砚'},sender:{id:'actor',name:'沈照'},target:'actor',trigger:proposal,messages:[],continuity:{dialogueAnchors:[]},story:{case:{stage:0}}}
const captured=[
 ['门边，青色便签，我记下了。九点以后我能空出来，具体时间再定。','canned-memory-ack',scriptConversationIssues,context],
 ['你问的是你的提议，我没替你应下什么。','agency-recital',scriptVoiceIssues,{...context,trigger:recall}],
 ['我就照你的提议复述，不往里添别的话。','instruction-following-recital',scriptVoiceIssues,{...context,scriptId:'before-rain',actor:{id:'repair',name:'周泊舟'},trigger:recall}],
]
for(const [text,issue,validate,ctx]of captured)assert.ok(validate(say(text),ctx).includes(issue),issue+': '+text)
for(const trigger of [proposal,recall,'稍后在门边碰面吧。','刚才约好在哪儿见，带什么？','明天21:30见面好吗？'])assert.equal(personalDialogueBeat(trigger),true,trigger)
for(const trigger of ['21:01的门禁记录说明什么？','我提议先核对证据，再决定几点见。','你害怕什么，是不是凶手？','先不谈案子，还是解释21:01的门禁记录。','先不聊题目。还是帮我核对这道题的条件。'])assert.equal(personalDialogueBeat(trigger),false,trigger)
for(const trigger of ['先不谈工作。我有点饿，你呢？','先不谈路线。我有点紧张，你呢？','先不聊题目。我有点紧张，你呢？'])assert.equal(personalDialogueBeat(trigger),true,trigger)
const projection=voiceActorContext({...context,evidence:[{text:'21:01控制台记录。'}]})
assert.equal(projection.dialogueFocus,'personal');assert.deepEqual(projection.evidence,[])
assert.ok(scriptVoiceIssues(say('门边说。21:01的控制台记录得先核对。'),context).includes('unsolicited-clue-detour'))
assert.ok(scriptVoiceIssues(say('九点以后我能空出来，具体时间再定。'),context).includes('unsupported-personal-schedule'))
assert.ok(scriptVoiceIssues(say('我今晚九点下班，到时候去找你。'),context).includes('unsupported-personal-schedule'))
const known={...context,messages:[{actor:'manager',text:'我九点以后有空。'}]}
assert.ok(!scriptVoiceIssues(say('九点以后我能空出来。'),known).includes('unsupported-personal-schedule'))
const knownAnchor={...context,continuity:{dialogueAnchors:[{speaker:'manager',text:'我九点以后有空。'}]}}
assert.ok(!scriptVoiceIssues(say('九点以后我能空出来。'),knownAnchor).includes('unsupported-personal-schedule'))
assert.ok(scriptVoiceIssues(say('九点以后我能空出来。'),{...context,messages:[{actor:'actor',text:'九点的门禁记录还在。'}]}).includes('unsupported-personal-schedule'),'case timestamps do not establish leisure availability')
assert.ok(scriptVoiceIssues(say('还有你昨天把“咖啡”说成“马飞”，我到现在也没想通。'),{...context,scriptId:'venice-blue-hour',actor:{id:'luxi',name:'陆晞'},trigger:'先不谈工作。今天有没有哪件小事让你笑出来？'}).includes('unsupported-player-recollection'))
assert.ok(!scriptVoiceIssues(say('你昨天把“咖啡”说成“马飞”。'),{...context,messages:[{actor:'actor',text:'昨天我把“咖啡”说成了“马飞”，自己也笑了。'}]}).includes('unsupported-player-recollection'))
const invented='还有你昨天把“咖啡”说成“马飞”，我到现在也没想通。',selfReport='昨天我把咖啡说成了马飞，自己也笑了。'
for(const key of ['messages','anchors'])for(const identity of ['manager','other-player']){
 const scoped=key==='messages'?{messages:[{actor:identity,text:invented}]}:{continuity:{dialogueAnchors:[{speaker:{id:identity,name:identity==='manager'?'陈砚':'旁人'},text:invented}]}}
 for(const reply of [invented,'还有你昨天把咖啡说成马飞，我到现在也没想通。'])assert.ok(scriptVoiceIssues(say(reply),{...context,...scoped}).includes('unsupported-player-recollection'),key+' '+identity+' cannot prove what sender said')
}
for(const source of [{messages:[{actor:'actor',text:selfReport}]},{messages:[{actor:{id:'actor',name:'沈照'},text:selfReport}]},{continuity:{dialogueAnchors:[{speaker:{id:'actor',name:'沈照'},text:selfReport}]}},{continuity:{dialogueAnchors:[{speaker:{name:'沈照'},text:selfReport}]}}])assert.ok(!scriptVoiceIssues(say('你昨天把咖啡说成马飞。'),{...context,...source}).includes('unsupported-player-recollection'),'sender self-report is usable')
assert.ok(scriptVoiceIssues(say(invented),{...context,continuity:{dialogueAnchors:[{speaker:{id:'other-player',name:'沈照'},text:selfReport}]}}).includes('unsupported-player-recollection'),'a different id cannot impersonate sender via matching display name')
assert.ok(!scriptVoiceIssues(say(invented),{...context,evidence:[{text:'沈照昨天把咖啡说成马飞，原文在已验证录音中。'}]}).includes('unsupported-player-recollection'),'verified evidence remains usable')
for(const text of ['门边，青色便签。时间还没定。','我记得，是门边那次。','我在笔记上记下了地址。','我不想见面。今天想一个人待着。','我还没答应。先让我想想。','明天21:30见面好吗？','好些了。明天21:30见面吧。']){
 assert.deepEqual(scriptVoiceIssues(say(text),context),[],text)
 assert.ok(!scriptConversationIssues(say(text),context).includes('canned-memory-ack'),text)
}
for(const text of ['我不是来道歉的。','我没有进过广播室。','我不答应这件事。','你能把录音复述给我吗？'])assert.equal(dialogueVoiceIssues(text).length,0,text)
assert.equal(scriptVoiceIssues(say('我只复述后台规则。'),{...context,actor:{id:'dm'}}).includes('instruction-following-recital'),false)
const prompt=scriptActorMessages(context)[0].content
assert.match(prompt,/见面提议/);assert.match(prompt,/日程/);assert.match(prompt,/复述/)
assert.match(scriptConversationMessages([{role:'system',content:'fixture'}],context)[0].content,/已经见面|已经答应|时间/)

const qa=path.resolve(import.meta.dirname,'../../qa'),root=fs.mkdtempSync(path.join(qa,'private-plan-voice-')),hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex')
const initialCanon=hash(['before-rain','thirteenth-curtain','last-midnight','inverted-observatory','one-more-stop','last-elective','venice-blue-hour'].map(id=>newScriptGame(id,2)))
let calls=0,seq=0,samples=[],contexts=[]
const api=createScriptRoomApi({root,authenticate:()=> 'ielts:91843001',sendJson:(res,status,value)=>{res.status=status;res.value=value},readBody:async req=>{let b='';for await(const v of req)b+=v;return JSON.parse(b)},generate:async messages=>{calls++;contexts.push(JSON.parse(messages[1].content));assert.ok(samples.length,'bounded repair only');return JSON.stringify(samples.shift())}})
const req=async(tail='',body)=>{const request=Readable.from(body?[JSON.stringify(body)]:[]);request.method=body?'POST':'GET';request.headers={};const response={setHeader(){}};await api.handle(request,response,new URL('https://fixture/api/ai/script-rooms'+tail+'?clientVersion=2'));assert.equal(response.status,200,JSON.stringify(response.value?.error));return response.value}
try{
 for(const [book,target,name,bad]of [['thirteenth-curtain','manager','陈砚',captured[0][0]],['before-rain','repair','周泊舟',captured[2][0]]]){
  let r=await req('',{scriptId:book,scriptVersion:2,requestId:'private-plan-create-'+book})
  const act=async(type,extra={})=>{r=await req('/'+r.id);return r=await req('/'+r.id+'/actions',{type,...extra,revision:r.revision,requestId:'private-plan-'+(++seq)})}
  await act('ready');await act('start')
  let before=calls;samples=[say(bad),say('门边，青色便签。时间还没定。')]
  await act('chat',{target,text:book==='before-rain'?recall:proposal});await api.drain();r=await req('/'+r.id)
  assert.equal(calls-before,2);assert.equal(r.jobs.at(-1).status,'done');assert.ok(!r.messages.some(m=>m.text===bad));assert.ok(r.messages.some(m=>m.actor===target&&m.text==='门边，青色便签。时间还没定。'))
  const projected=contexts.at(-1);assert.equal(projected.actor.name,name);assert.equal(projected.dialogueFocus,'personal');assert.deepEqual(projected.evidence,[])
  before=calls;samples=[say('你问的是你的提议，我没替你应下什么。'),say('我就照你的提议复述，不往里添别的话。')]
  await act('chat',{target,text:recall});await api.drain();r=await req('/'+r.id)
  assert.equal(calls-before,2);assert.equal(r.jobs.at(-1).status,'failed');assert.ok(!r.messages.some(m=>m.actor===target&&/我没替你应下|照你的提议复述/.test(m.text)))
  assert.equal(r.stage,0);assert.equal(r.publicClues.length,0);await act('leave')
 }
 assert.equal(hash(['before-rain','thirteenth-curtain','last-midnight','inverted-observatory','one-more-stop','last-elective','venice-blue-hour'].map(id=>newScriptGame(id,2))),initialCanon)
 console.log('PASS synthetic live-regression language fence, private-plan focus, grounded schedules, one bounded repair, legitimate negation and unchanged canon')
}finally{await api.drain();api.close();assert.equal(path.dirname(root),qa);fs.rmSync(root,{recursive:true})}
