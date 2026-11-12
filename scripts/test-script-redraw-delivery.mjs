import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import {SCRIPT_ANIME_ASSETS} from '../server/scriptArtSpec.js'
import {loadTavernMediaCatalog,DEFAULT_TAVERN_MEDIA_ROOT} from '../server/tavernMedia.js'
import {newScriptGame,publicScriptCatalog} from '../server/scriptGameCatalog.js'
import {scriptImagePlan,scriptArtReferenceUrls} from '../server/scriptArt.js'
const catalog=loadTavernMediaCatalog(),expected=SCRIPT_ANIME_ASSETS.filter(a=>['portrait','ensemble'].includes(a.kind)&&a.contentEdition!=='duet-one-more-stop-20261106')
assert.equal(expected.length,29)
assert.equal(catalog.items.filter(a=>a.id.startsWith('scriptanime-')&&a.id.endsWith('-v2')).length,29,'all seven current casts redrawn and registered')
for(const spec of expected){
 const item=catalog.byId.get('scriptanime-'+spec.id+'-v2');assert.ok(item,spec.id)
 const bytes=fs.readFileSync(path.join(DEFAULT_TAVERN_MEDIA_ROOT,item.file))
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.sha256);assert.ok(bytes.length<2*1024*1024)
 assert.ok(catalog.byId.has('scriptanime-'+spec.id),'old asset remains served')
}
for(const row of publicScriptCatalog()){
 const game=newScriptGame(row.id,2)
 for(const role of game.roles){const plan=scriptImagePlan(game,0,'看看'+role.name+'立绘',catalog);assert.ok(plan.asset?.id.endsWith('-v2'),role.name)}
 const group=scriptImagePlan(game,0,'看看全员合影',catalog);assert.ok(group.asset?.id.endsWith('-v2'))
 const custom=scriptImagePlan(game,0,'重新画'+game.roles[0].name+'站在窗边',catalog)
 assert.ok(custom.referenceIds.some(id=>id.endsWith('-v2')));assert.ok(custom.artDirection.includes('fine variable-width'))
 assert.equal(scriptArtReferenceUrls({id:game.id,contentEdition:game.contentEdition,sourceContentEdition:game.sourceContentEdition,stage:0,referenceIds:custom.referenceIds},catalog).length,custom.referenceIds.length)
}
console.log('PASS: 29 approved redraws, old URL preservation, seven-book stock and live references')
