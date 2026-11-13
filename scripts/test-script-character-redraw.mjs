import assert from 'node:assert/strict'
import {loadTavernMediaCatalog} from '../server/tavernMedia.js'
import {scriptImagePlan,scriptArtReferenceUrls} from '../server/scriptArt.js'
import {newScriptGame,scriptGame} from './helpers/historical-script-fixture.mjs'

const loaded=loadTavernMediaCatalog(),original={...loaded,byId:new Map([...loaded.byId].filter(([id])=>!id.endsWith('-v2')))},byId=new Map(original.byId)
for(const id of ['scriptanime-elective-role-songmi','scriptanime-elective-role-peixu','scriptanime-elective-ensemble']){
 const old=byId.get(id);byId.set(id+'-v2',{...old,id:id+'-v2',src:old.src.replace('.webp','-v2.webp')})
}
const catalog={...original,byId},game=newScriptGame('last-elective',2)
assert.equal(scriptImagePlan(game,0,'看看宋弥立绘',catalog).asset.id,'scriptanime-elective-role-songmi-v2','current portrait resolves to approved redraw')
assert.equal(scriptImagePlan(game,0,'看看全员合影',catalog).asset.id,'scriptanime-elective-ensemble-v2')
const plan=scriptImagePlan(game,0,'重新画宋弥和裴叙在教室聊天',catalog)
assert.ok(plan.referenceIds.includes('scriptanime-elective-role-songmi-v2'))
assert.ok(plan.referenceIds.includes('scriptanime-elective-role-peixu-v2'))
assert.equal(scriptArtReferenceUrls({id:game.id,contentEdition:game.contentEdition,sourceContentEdition:game.sourceContentEdition,stage:0,referenceIds:plan.referenceIds},catalog).length,3)
assert.equal(scriptArtReferenceUrls({id:game.id,stage:0,referenceIds:['scriptanime-rain-role-letter-v2','scriptanime-elective-scene-2']},catalog).length,0)
assert.equal(scriptImagePlan(game,0,'看看宋弥立绘',original).asset.id,'scriptanime-elective-role-songmi','partial deployment safely falls back')
const legacy=scriptGame('one-more-stop',2,'duet-one-more-stop-20261106')
assert.equal(scriptImagePlan(legacy,0,'看看苏棠立绘',catalog).asset.id,'scriptanime-duet-role-sutang','legacy edition does not change identity')
assert.ok(original.byId.has('scriptanime-elective-role-songmi'),'historical media remains addressable')
console.log('PASS: redraw preference, reference isolation, fallback and historical art')
