import assert from 'node:assert/strict'
import {SCRIPT_ANIME_BOOKS,SCRIPT_ANIME_ASSETS,SCRIPT_ANIME_STYLE} from '../server/scriptArtSpec.js'
import {newScriptGame,publicScriptCatalog} from './helpers/historical-script-fixture.mjs'
assert.equal(SCRIPT_ANIME_BOOKS.length,8);assert.equal(SCRIPT_ANIME_ASSETS.length,72)
assert.equal(new Set(SCRIPT_ANIME_ASSETS.map(a=>a.id)).size,72)
assert.match(SCRIPT_ANIME_STYLE,/2D anime/)
for(const book of SCRIPT_ANIME_BOOKS){const game=newScriptGame(book.id,2);assert.ok(game);assert.deepEqual(book.characters.map(c=>[c.roleId,c.name]),game.roles.map(r=>[r.id,r.name]));assert.equal(book.scenes.length,3);assert.equal(book.props.length,2)}
assert.equal(SCRIPT_ANIME_ASSETS.filter(a=>a.kind==='scene').length,24)
assert.equal(SCRIPT_ANIME_ASSETS.filter(a=>a.kind==='portrait').length,24)
assert.equal(SCRIPT_ANIME_ASSETS.filter(a=>a.kind==='prop').length,16)
assert.equal(SCRIPT_ANIME_ASSETS.filter(a=>a.kind==='ensemble').length,8)
for(const a of SCRIPT_ANIME_ASSETS){assert.ok(/^[a-z0-9-]{3,60}$/.test(a.id));assert.ok(a.prompt.includes('no text'));assert.ok(a.prompt.includes('2D anime'));assert.equal(a.isEvidence,false)}
assert.deepEqual(publicScriptCatalog().map(g=>g.id),[...new Set(SCRIPT_ANIME_BOOKS.map(b=>b.id))])
assert.equal(SCRIPT_ANIME_ASSETS.filter(a=>a.scriptId==='last-elective').length,8)
assert.equal(SCRIPT_ANIME_ASSETS.filter(a=>a.scriptId==='venice-blue-hour').length,8)
console.log('PASS 72 scoped anime art specs, seven current books plus pinned station edition, scene/portrait/prop/ensemble coverage')
