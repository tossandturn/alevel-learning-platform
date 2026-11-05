import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'
// Only freshly-created synthetic local lobby fixtures. Never used by runtime.
export function pinTestRoomEdition(root,id,game){
 const qa=fs.realpathSync(path.resolve(import.meta.dirname,'../../../qa')),target=fs.realpathSync(root)
 assert.ok(target.startsWith(qa+path.sep),'fixture root must be inside this task QA directory')
 const db=new DatabaseSync(path.join(target,'script-rooms.sqlite'))
 try{const r=JSON.parse(db.prepare('SELECT snapshot FROM script_rooms WHERE id=?').get(id).snapshot)
  assert.equal(r.phase,'lobby');assert.equal(r.scriptId,game.id);assert.equal(r.messages.length,0)
  assert.deepEqual(r.seats.map(s=>s.roleId),game.roles.map(r=>r.id))
  r.scriptVersion=game.version;if(game.contentEdition)r.contentEdition=game.contentEdition;else delete r.contentEdition
  db.prepare('UPDATE script_rooms SET snapshot=? WHERE id=?').run(JSON.stringify(r),id)
 }finally{db.close()}
}
