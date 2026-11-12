import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {scriptGame,newScriptGame} from '../server/scriptGameCatalog.js'
import {scriptStageScene} from '../server/scriptSceneBeats.js'
import {campusStageResolution,campusOutcomes} from '../server/scriptCampusElective.js'
import {veniceOutcomes} from '../server/scriptVeniceRomance.js'
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const originals=[['before-rain',4,'romance-case-20261106'],['thirteenth-curtain',2],['last-midnight',2],['inverted-observatory',2],['one-more-stop',3,'duet-iceland-20261108'],['last-elective',2,'campus-elective-20261107'],['venice-blue-hour',2,'venice-blue-hour-20261107']]
for(const [id,version,edition]of originals){
 const old=scriptGame(id,version,edition),before=hash(old),current=newScriptGame(id,2)
 assert.ok(current.version>version,`${id}: new rooms need a distinct canonical edition`)
 assert.equal(current.sourceScriptVersion,version)
 assert.equal(current.sourceContentEdition,edition||null)
 assert.equal(hash(scriptGame(id,version,edition)),before,`${id}: old canon remains unchanged`)
 assert.equal(scriptGame(id,current.version,current.contentEdition),current)
 for(let mask=0;mask<(1<<current.roles.length);mask++){
  const ai=current.roles.filter((_,i)=>mask&(1<<i)).map(r=>r.id)
  for(let stage=0;stage<3;stage++){const scene=scriptStageScene(current,stage,ai);assert.ok(scene);assert.ok(scene.lines.every(line=>ai.includes(line.actor)))}
 }
}
const curtain=newScriptGame('thirteenth-curtain',2)
assert.ok(!curtain.summary.includes('都声称'))
assert.match(curtain.clues[1].text,/备用电源/)
assert.doesNotMatch(curtain.clues[1].text,/预录|21:04|21:10/)
assert.match(curtain.clues[5].text,/21:10/)
const midnight=newScriptGame('last-midnight',2)
assert.doesNotMatch(midnight.acts[2].opening,/访客名单|未结束的演练/)
assert.doesNotMatch(scriptStageScene(midnight,2,midnight.roles.map(r=>r.id)).narration,/访客名单|未结束的演练/)
const rain=newScriptGame('before-rain',2)
assert.match(rain.clues[9].text,/独立.*连续录音/)
assert.match(rain.clues.find(c=>c.id==='case13').text,/裁切/)
assert.doesNotMatch(rain.roles[1].chapters.map(c=>c.text).join(''),/AI|服务器/)
const campus=newScriptGame('last-elective',2)
assert.doesNotMatch(campus.roles[1].entryBook,/留给最终那张折页活动揭开/)
assert.match(campusStageResolution(campus,{stage:0,solved:[0]}),/宋弥这张图比我讲三分钟管用/)
const venice=newScriptGame('venice-blue-hour',2)
assert.doesNotMatch(venice.roles[0].biography,/陆晞就是/)
assert.doesNotMatch(venice.roles[1].biography,/许映就是/)
for(const [game,outcomes]of [[campus,campusOutcomes],[venice,veniceOutcomes]])for(const a of ['date','slow','friends'])for(const b of ['date','slow','friends']){
 const [ra,rb]=game.roles.map(r=>r.id),room={missionChoices:{[ra]:{[`${ra}-2`]:a},[rb]:{[`${rb}-2`]:b}}}
 assert.equal(outcomes(game,room)[0].status,a==='date'&&b==='date'?'mutual':[a,b].includes('friends')?'friends':'slow')
}
console.log('PASS editorial editions: seven immutable old canons, new room remasters, clue timing, narrator knowledge, all seat combinations and nine relationship outcomes')
