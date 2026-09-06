import assert from 'node:assert/strict'
import http from 'node:http'
import {createStemApi,closeStemDatabaseForTests} from '../server/stemApi.js'
const calls=[]
const middleware=createStemApi({env:{STEM_INTERNAL_AUTH_KEY:'native-wechat-test-key',STEM_DB_PATH:':memory:'},fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return{ok:true,status:200,json:async()=>({identity:{id:'ielts:91',username:'wechat-test',roles:['student']}})}}})
const server=http.createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end()}))
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const url='http://127.0.0.1:'+server.address().port+'/api/auth/wechat'
try{
 const bad=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})
 assert.equal(bad.status,400);assert.equal(calls.length,0)
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:'one-time-code',userId:'attacker'})})
 const payload=await response.json();assert.equal(response.status,200)
 assert.deepEqual(calls[0].body,{mode:'wechat',code:'one-time-code'})
 assert.doesNotMatch(JSON.stringify(payload),/one-time-code|attacker/)
 assert.equal(payload.authenticated,true)
 console.log('Native WeChat entry delegates code verification to the shared identity authority; client identities ignored.')
}finally{await new Promise(resolve=>server.close(resolve));closeStemDatabaseForTests()}
