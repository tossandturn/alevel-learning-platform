import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/script-capacity-')),store=createScriptRoomStore({root})
let seq=0
const create=who=>store.create(who,{scriptId:'thirteenth-curtain',scriptVersion:2,requestId:`capacity-${++seq}`})
try{
 for(let i=0;i<3;i++)create('ielts:91854101')
 assert.throws(()=>create('ielts:91854101'),e=>e.statusCode===429&&e.code==='script_room_limit')
 const db=new DatabaseSync(path.join(root,'script-rooms.sqlite')),template=JSON.parse(db.prepare('SELECT snapshot FROM script_rooms LIMIT 1').get().snapshot)
 db.exec('BEGIN')
 for(let i=3;i<500;i++){
  const r=structuredClone(template);r.id=crypto.randomUUID();r.inviteCode=crypto.randomBytes(8).toString('hex').toUpperCase();r.host=`ielts:${91855000+i}`;r.seats[0].owner=r.host
  db.prepare('INSERT INTO script_rooms VALUES(?,?,?,?,?)').run(r.id,r.inviteCode,JSON.stringify(r),r.expiresAt,r.updatedAt)
 }
 db.exec('COMMIT');db.close()
 assert.throws(()=>create('ielts:91854999'),e=>e.statusCode===429&&e.code==='script_capacity'&&!e.message.includes('3间'),'global room capacity must not claim a fresh user owns three rooms')
 assert.equal(store.list('ielts:91854101').length,3,'existing room listing remains available at capacity')
 console.log('PASS distinct personal/global capacity errors; existing room list remains readable')
}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
