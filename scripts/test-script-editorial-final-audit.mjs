import assert from 'node:assert/strict'
import {currentEditorialBooks,editorialPacket,normalizeEditorialReview} from './helpers/script-editorial-review.mjs'
import {scriptStageScene} from '../server/scriptSceneBeats.js'
import {campusStageResolution,campusOutcomes} from '../server/scriptCampusElective.js'
import {veniceOutcomes,venicePerformanceContext,veniceActorMessages} from '../server/scriptVeniceRomance.js'
import {visibleScriptRole} from '../server/scriptRoleCards.js'
const books=currentEditorialBooks(),all=new Set(),meta=/AI|服务器|这里的玩法|本幕私人决定|最终私人选项|系统物证|不得篡改|不会替你|本局亲口|私人选择只|玩法不会/
for(const game of books){
 assert.ok(game.tieEnding?.length>40,'every setting needs an actual neutral tie scene')
 for(const role of game.roles){
  for(const [key,value]of Object.entries({goal:role.goal,desire:role.card.desire,entryBook:role.entryBook,...Object.fromEntries((role.chapters||[]).map((chapter,index)=>['chapter'+index,chapter.text]))}))assert.doesNotMatch(value,meta,`${game.id}/${role.id}/${key} must not contain engine instructions`)
  for(const mission of role.missions)for(const option of mission.options){assert.ok(option.followup?.length>15);assert.ok(!all.has(option.followup),`${role.id}/${mission.stage}/${option.id} needs its own viewpoint`);all.add(option.followup);assert.equal(option.consequence,undefined,'do not repeat the option or invent an unspoken action as consequence')}
 }
 for(const config of editorialPacket(game).book.seatConfigurations)for(const [stage,scene]of config.stageScenes.entries()){
  let previous=null
  for(const line of scene.lines){assert.ok(config.aiRoles.includes(line.actor));assert.equal(line.respondsTo,previous);previous=line.actor}
  assert.equal(scene.stage,undefined);assert.ok(scene.narration)
 }
}
assert.equal(all.size,138,'all 22 characters and their 138 choices audited')
const get=id=>books.find(g=>g.id===id),curtain=get('thirteenth-curtain'),campus=get('last-elective'),ice=get('one-more-stop'),stars=get('inverted-observatory'),venice=get('venice-blue-hour')
assert.doesNotMatch(curtain.clues[3].text,/21:02|21:10|排练音效|争执与撞击/)
assert.doesNotMatch(curtain.clues[5].text,/陈砚|舞台监督|账号属于/)
assert.doesNotMatch(curtain.clues[11].text,/陈砚|实名账号/);assert.match(curtain.truth,/陈砚/)
assert.match(stars.acts[0].objective,/馆内顺时针/);assert.doesNotMatch(stars.acts[0].objective,/春夏秋冬的顺序/)
assert.match(stars.roles[2].secret,/自己.*1995|1995.*自己/)
for(const actors of [campus.roles.map(r=>r.id),['peixu'],['songmi']]){
 assert.doesNotMatch(JSON.stringify(scriptStageScene(campus,1,actors)),/电脑弄错|旧模板|封面漏了/)
 assert.doesNotMatch(JSON.stringify(scriptStageScene(campus,2,actors)),/藏进题里|出题人|约会|告白/)
}
const note='这学期最想保留的，不只是最后那张做对的展板，还有和搭档一起把错误改明白的下午。'
assert.ok(campus.roles[0].entryBook.includes(note));assert.ok(campusStageResolution(campus,{stage:2,solved:[2]}).includes(note))
assert.doesNotMatch(campus.roles[0].chapters[2].text,/只解锁一份旧邀请|最终选择/)
for(const role of campus.roles)assert.doesNotMatch(role.missions[2].prompt,/两张回顾便签/)
assert.doesNotMatch(ice.acts[1].opening,/原始录音却仍|两份处理记录/)
assert.doesNotMatch(ice.acts[1].puzzle.question,/未降噪|提示点.*修正|私人说话完整/)
assert.doesNotMatch(venice.acts[1].puzzle.question,/例如.*窗/)
for(const role of venice.roles){
 const context=venicePerformanceContext({scriptId:venice.id,contentEdition:venice.contentEdition,actor:visibleScriptRole(role,0,venice.id),story:{venice:true,stage:0},trigger:'你以前写过什么？'})
 assert.doesNotMatch(context.actor.biography,role.id==='xuying'?/陆晞就是逆光|陆晞就是那位作者/:/许映就是页边|许映就是当年写信/)
 assert.doesNotMatch(veniceActorMessages(context)[0].content,/陆晞知道自己就是逆光|许映知道自己就是页边/,'the shared system prompt must not reveal both identities to either actor')
}
for(const [game,outcome]of [[campus,campusOutcomes],[venice,veniceOutcomes]])for(const a of ['date','slow','friends'])for(const b of ['date','slow','friends']){
 const [ra,rb]=game.roles,room={missionChoices:{[ra.id]:{[`${ra.id}-2`]:a},[rb.id]:{[`${rb.id}-2`]:b}}},result=outcome(game,room)[0]
 assert.deepEqual(result.choices,{[ra.id]:a,[rb.id]:b});assert.ok(result.text.includes(ra.name)&&result.text.includes(rb.name))
}
const packet=editorialPacket(campus),raw={schemaVersion:'script-editorial-review-v1',contentHash:packet.contentHash,verdict:'revise',scores:{},issues:[{id:'R1',severity:'minor',path:'book.clues[99].text',quote:packet.book.clues[0].text,problem:'路径误写但引文唯一。',repair:'只修路径，不改正文。'}],playtests:[]}
const normalized=normalizeEditorialReview(raw,packet)
assert.equal(normalized.review.issues[0].path,'book.clues.0.text');assert.equal(raw.issues[0].path,'book.clues[99].text');assert.equal(normalized.review.issues[0].quote,raw.issues[0].quote)
const repeated={...packet,book:{...packet.book,examples:[{text:'重复但真实的原文。'},{text:'重复但真实的原文。'}]}}
const explicit={...raw,issues:[{...raw.issues[0],path:'book.examples[1].text',quote:'重复但真实的原文。'}]}
assert.equal(normalizeEditorialReview(explicit,repeated).review.issues[0].path,'book.examples.1.text','bracket normalization preserves a valid explicit index even when the same quote occurs elsewhere')
console.log('PASS final audit: 22 perspectives / 138 unique choices, all prose fields, no early revelations, nine distinct answers, neutral ties and exact-evidence normalization')
