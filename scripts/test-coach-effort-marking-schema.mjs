import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {createWholePaperMarkingService} from '../server/wholePaperMarking.js'
fs.mkdirSync('.tmp-test',{recursive:true});const root=fs.mkdtempSync(path.resolve('.tmp-test/effort-schema-')),database=new DatabaseSync(':memory:')
const initialize=()=>createWholePaperMarkingService({database,storageRoot:root,env:{},runner:async()=>{throw Error('No grading expected')}})
try{initialize();assert.ok(database.prepare('PRAGMA table_info(whole_paper_marking_jobs)').all().some(x=>x.name==='reasoning_effort'),'effort column missing');database.exec('ALTER TABLE whole_paper_marking_jobs DROP COLUMN reasoning_effort');const time=new Date().toISOString();database.prepare("INSERT INTO whole_paper_marking_jobs(id,user_id,client_request_id,request_hash,title,student_label,instructions,route_id,stage,paper_id,status,progress_json,created_at,updated_at) VALUES ('wpm-legacy','ielts:fixture','legacy-request','legacy-hash','Old title','','','','','','draft','{}',?,?)").run(time,time);initialize();initialize();const row=database.prepare('SELECT title,reasoning_effort FROM whole_paper_marking_jobs WHERE id=?').get('wpm-legacy');assert.equal(row.title,'Old title');assert.equal(row.reasoning_effort,null);console.log('Whole-paper effort schema: repeat-safe additive migration and unchanged legacy row PASS.')}finally{database.close();assert.equal(path.dirname(root),path.resolve('.tmp-test'));fs.rmSync(root,{recursive:true,force:true})}
