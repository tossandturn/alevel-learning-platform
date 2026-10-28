import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {createCurriculumPracticeAccess,closeStemDatabaseForTests} from '../server/stemApi.js'
const key='synthetic-pdf-auth-key',env={STEM_DB_PATH:':memory:',STEM_INTERNAL_AUTH_KEY:key}
const access=createCurriculumPracticeAccess({env,questionBank:[]})
try{
 const db=access.databaseProvider()
 assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='syllabus_topics'").get(),undefined,'PDF/account-only database bootstrap must not seed syllabus content')
 const now=Math.floor(Date.now()/1000)
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
 const make=claims=>{const h=encode({alg:'HS256',typ:'JWT'}),p=encode({iss:'ieltsist.com',aud:'stem.ieltsist.com',sub:'ielts:42',iat:now,exp:now+300,...claims});return h+'.'+p+'.'+crypto.createHmac('sha256',key).update(h+'.'+p).digest('base64url')}
 assert.equal(access.authenticatePdfRequest({headers:{authorization:'Bearer '+make({})}}).id,'ielts:42')
 const cookie='synthetic-cookie-000000000000000000000000',timestamp=new Date().toISOString()
 db.prepare('INSERT INTO stem_sessions(token_hash,user_id,username,avatar_data_url,roles_json,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?)').run(crypto.createHash('sha256').update(cookie).digest('hex'),'ielts:43','synthetic','',JSON.stringify([]),new Date(Date.now()+3600000).toISOString(),timestamp,timestamp)
 assert.equal(access.authenticatePdfRequest({headers:{cookie:'stem_session='+cookie}}).id,'ielts:43')
 assert.throws(()=>access.authenticatePdfRequest({headers:{authorization:'Bearer invalid',cookie:'stem_session='+cookie}}),e=>e.statusCode===401,'Invalid bearer cannot borrow a valid cookie identity')
 assert.throws(()=>access.authenticatePdfRequest({headers:{authorization:'Bearer '+make({exp:now-1})}}),e=>e.statusCode===401)
 assert.throws(()=>access.authenticatePdfRequest({headers:{cookie:'stem_session=wrong'}}),e=>e.statusCode===401)
 assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='syllabus_topics'").get(),undefined)
 console.log('PDF identity: actual signed bearer, hashed native cookie, invalid bearer isolation and no syllabus seed PASS')
}finally{closeStemDatabaseForTests()}
