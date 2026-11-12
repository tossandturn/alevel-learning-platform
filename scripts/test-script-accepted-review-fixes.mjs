import assert from 'node:assert/strict'
import {newScriptGame,scriptGame} from '../server/scriptGameCatalog.js'
import {visibleScriptRole} from '../server/scriptRoleCards.js'
import {scriptStageScene} from '../server/scriptSceneBeats.js'
import {caseActorContext} from '../server/scriptRomanceCase.js'
import {scriptActorMessages} from '../server/scriptRoomApi.js'
import {veniceStageResolution,veniceOutcomes} from '../server/scriptVeniceRomance.js'
import {directorOpening} from '../server/scriptDirector.js'
import {editorialPacket} from './helpers/script-editorial-review.mjs'
const rain=newScriptGame('before-rain',2),curtain=newScriptGame('thirteenth-curtain',2),night=newScriptGame('last-midnight',2),stars=newScriptGame('inverted-observatory',2),ice=newScriptGame('one-more-stop',2),campus=newScriptGame('last-elective',2),venice=newScriptGame('venice-blue-hour',2)
assert.match(rain.clues[6].text,/签收.*进入大厅后接续/);assert.doesNotMatch(rain.clues[6].text,/21:04至21:17:50.*始终/)
assert.doesNotMatch(curtain.clues[9].text,/争执动机/);assert.doesNotMatch(curtain.clues[10].text,/不存在|证据|凶器/);assert.doesNotMatch(curtain.clues[11].text,/陈砚|实名账号/)
assert.doesNotMatch(night.summary,/去向被人擦/);assert.match(night.truth,/文章不是门锁或广播姓名的来源/);assert.doesNotMatch(night.endings.record,/全员回应/);assert.match(night.endings.record,/愿意留下声音的人/);assert.doesNotMatch(night.clues[11].text,/闻笙承认/);assert.match(night.clues[8].text,/自动拼接/);assert.doesNotMatch(night.roles[0].secret,/谁改/)
assert.doesNotMatch(stars.clues[4].text,/本题排序/);assert.doesNotMatch(stars.acts[2].puzzle.hint,/东门|北是|西是|南是/)
for(const game of [rain,curtain,night,stars,ice,campus,venice])for(const role of game.roles)for(let stage=0;stage<3;stage++){
 const view=visibleScriptRole(role,stage,game.id)
 assert.doesNotMatch(view.biography,/这不是替你|给这个并不只有|知识边界|不能提前替|身份则不用再/)
 if(stage<2)assert.match(role.missions.find(m=>m.stage===stage).title,/^内心打算/)
}
for(let stage=0;stage<2;stage++){
 const role=rain.roles[1],actor=caseActorContext(rain,{stage,publicClues:[]},role,visibleScriptRole(role,stage,rain.id))
 const messages=scriptActorMessages({scriptId:rain.id,actor,story:{case:true,stage},trigger:'你怎么想？',messages:[],evidence:[],sender:{id:'letter',name:'许知夏'},target:'letter'})
 assert.doesNotMatch(JSON.parse(messages[1].content).actor.biography,/服务器保留|本幕可演绎范围/)
 assert.match(messages[0].content,/不允许临时编新的借证件/,'truth guard stays in system policy')
}
assert.match(directorOpening(0),/右上角.*本局/);assert.match(directorOpening(0),/我的身份/);assert.match(directorOpening(0),/本幕任务/)
assert.doesNotMatch(JSON.stringify(scriptStageScene(ice,1,['jiangyuan'])),/原件在|我没有删/)
assert.match(scriptStageScene(campus,2,['songmi']).lines[0].parts[0].text,/路线纸/);assert.doesNotMatch(campus.roles[0].secret,/希望以后继续见面/);for(const act of campus.acts)assert.doesNotMatch(act.objective,/我的身份/)
for(const mask of [[],['xuying'],['luxi'],['xuying','luxi']])assert.doesNotMatch(JSON.stringify(scriptStageScene(venice,1,mask)),/当年收到|越看越眼熟|字写得.*端正|我一直留着/)
const publicPage=veniceStageResolution(venice,{stage:2,publicClues:venice.clues.filter(c=>c.stage===2).map(c=>c.id)})
assert.match(publicPage,/早先写下、尚未送出/);assert.match(publicPage,/不是一封今天已经发出的邀请/)
assert.doesNotMatch(veniceOutcomes(venice,{missionChoices:{xuying:{'xuying-2':'friends'},luxi:{'luxi-2':'friends'}}})[0].text,/另一人的期待/)
for(const game of [rain,curtain,night,stars,ice,campus,venice])for(const row of editorialPacket(game).book.privateChoiceFeedback){assert.match(row.privateText,/^私人笔记/);assert.doesNotMatch(row.privateText,/尚未替你|仅自己可见/)}
assert.match(scriptGame('thirteenth-curtain',2).clues[9].text,/争执动机/,'old canonical edition remains unchanged')
console.log('PASS accepted review fixes: actual composed profiles, guarded actor projection, no early identity/reveal, exact evidence boundaries, private-note presentation and preserved DM navigation/old canon')
