import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {Readable} from 'node:stream'
import {createStemApi,closeStemDatabaseForTests} from '../server/stemApi.js'
import {studyQuestionBank} from '../src/data/questionBank.js'
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'stem-disk-seed-test-')),file=path.join(directory,'fixture.sqlite')
const routeId='cie-9702-a2-physics',source=studyQuestionBank.find(q=>q.routeId===routeId&&q.paperComponent===4)
assert.ok(source)
const scoped=suffix=>Object.freeze({...source,sourceQuestionId:source.sourceQuestionId+':disk-'+suffix,questionGroupId:source.sourceQuestionId+':disk-'+suffix,bankId:source.sourceQuestionId+':disk-'+suffix+'@'+routeId})
let bank=Object.freeze([scoped('a')]),observer
const api=createStemApi({env:{NODE_ENV:'production',STEM_DB_PATH:file},questionBank:Object.freeze([]),topicQuestionBankProvider:()=>bank})
function call(url){return new Promise((resolve,reject)=>{const req=Readable.from([]);req.url=url;req.method='GET';req.headers={};const res={statusCode:200,setHeader(){},end(text=''){resolve({status:this.statusCode,body:text?JSON.parse(String(text)):null})}};Promise.resolve(api(req,res,()=>resolve({status:404}))).catch(reject)})}
try{
 const url='/api/stem/routes/'+routeId+'/syllabus-topics'
 assert.equal((await call(url)).status,200)
 observer=new DatabaseSync(file)
 const version=()=>observer.prepare('PRAGMA data_version').get().data_version
 const before=version(),start=performance.now()
 assert.equal((await call(url)).status,200)
 const warmReadMs=Math.round(performance.now()-start)
 assert.equal(version(),before,'unchanged source GET must not reseed base and runtime banks on a disk database')
 await call('/api/stem/attempts')
 assert.equal(version(),before,'unrelated request must not demote runtime data by reseeding the static base')
 const target=observer.prepare('SELECT route_id,id,updated_at FROM syllabus_route_topics ORDER BY route_id,id LIMIT 1 OFFSET 1').get()
 observer.exec(`CREATE TRIGGER block_test_source_seed BEFORE INSERT ON syllabus_route_topics WHEN NEW.route_id='${target.route_id}' AND NEW.id='${target.id}' BEGIN SELECT RAISE(ABORT,'fixture-source-seed-failure'); END`)
 const first=observer.prepare('SELECT route_id,id,updated_at FROM syllabus_route_topics ORDER BY route_id,id LIMIT 1').get()
 bank=Object.freeze([scoped('b')])
 assert.equal((await call(url)).status,500)
 assert.equal(observer.prepare('SELECT updated_at FROM syllabus_route_topics WHERE route_id=? AND id=?').get(first.route_id,first.id).updated_at,first.updated_at,'failed source sync must roll back all prior topic updates')
 observer.exec('DROP TRIGGER block_test_source_seed')
 assert.equal((await call(url)).status,200)
 const after=version();await call(url);assert.equal(version(),after)
 console.log(JSON.stringify({status:'PASS',scope:'real disk WAL, no warm-read writes, no static/runtime flip, atomic failed seed rollback',warmReadMs}))
}finally{observer?.close();closeStemDatabaseForTests();assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('stem-disk-seed-test-'));fs.rmSync(directory,{recursive:true,force:true})}
