import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createAnnouncementBoard} from '../server/announcementBoard.js'

const database=new DatabaseSync(':memory:')
let clock='2026-11-01T00:00:00.000Z'
try{
 const board=createAnnouncementBoard({database,now:()=>clock}),actor={id:'synthetic-admin'}
 const guide=board.create(actor,{title:'真题编号怎么看？考试季、卷型与版本号说明',body:'Paper 1, Variant 2.',category:'learning',status:'published',pinned:false,expiresAt:'2026-11-02T00:00:00Z'})
 database.prepare('UPDATE announcements SET id=? WHERE id=?').run('announcement-paper-code-guide-v1',guide.id)
 clock='2026-11-12T00:00:00.000Z'
 board.create(actor,{title:'Newer notice',body:'Published later.',category:'feature',status:'published',pinned:true})
 const first=board.listPublic({limit:1})
 assert.equal(first.items[0].id,'announcement-paper-code-guide-v1','the numbering guide remains first even after its stored expiry')
 assert.equal(first.items[0].pinned,true);assert.equal(first.items[0].expiresAt,null)
 assert.equal(first.items[0].publishedAt,guide.publishedAt,'promotion must not forge a new publication date')
 assert.equal(database.prepare('SELECT pinned FROM announcements WHERE id=?').get(first.items[0].id).pinned,0,'presentation policy does not rewrite stored data')
 assert.equal(first.total,3);assert.equal(first.nextOffset,1)
 assert.equal(board.listPublic({offset:1,limit:10}).items.some(x=>x.id===first.items[0].id),false)
 assert.equal(board.recordRead({id:'synthetic-student'},first.items[0].id).announcementId,first.items[0].id)
 board.update(actor,first.items[0].id,{status:'archived'})
 assert.equal(board.listPublic().items.some(x=>x.id===first.items[0].id),false,'explicitly archived content must not be republished')
 console.log('PASS guide permanent featured order, truthful date, pagination, receipt and archive boundaries')
}finally{database.close()}
