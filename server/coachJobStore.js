import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const failure=(statusCode,code,message)=>Object.assign(new Error(message),{statusCode,code})
const ownerKey=owner=>{
  if(!/^ielts:\d+$/.test(String(owner)))throw failure(401,'coach_auth_required','请先登录。')
  return crypto.createHash('sha256').update(owner).digest('hex')
}
export function coachJobId(value){
  if(typeof value!=='string'||!/^cj-[a-zA-Z0-9_-]{16,80}$/.test(value))throw failure(400,'coach_job_id_invalid','答疑任务编号无效。')
  return value
}

// Single-process STEM worker; never persists uploaded images, request text or credentials.
// Terminal answers are private, bounded and retained for 24 hours for reconnect recovery.
export function createCoachJobStore({root,now=Date.now,ttlMs=86400000,maxActive=4,maxPerOwner=1,maxRows=1024}={}){
  const Database=process.getBuiltinModule?.('node:sqlite')?.DatabaseSync
  if(!Database)throw failure(503,'coach_job_storage_unavailable','答疑恢复服务暂不可用。')
  fs.mkdirSync(root,{recursive:true,mode:0o700})
  const file=path.join(root,'academic-coach-jobs.sqlite')
  const db=new Database(file)
  fs.chmodSync(file,0o600)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=2000;
    CREATE TABLE IF NOT EXISTS coach_jobs (
      owner TEXT NOT NULL, id TEXT NOT NULL, request_hash TEXT NOT NULL, scope TEXT NOT NULL,
      status TEXT NOT NULL, stage TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', result TEXT,
      created INTEGER NOT NULL, updated INTEGER NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(owner,id));
    CREATE INDEX IF NOT EXISTS coach_jobs_expiry ON coach_jobs(expires);`)
  db.prepare("UPDATE coach_jobs SET status='interrupted',stage='interrupted',updated=? WHERE status='running'").run(now())
  const cleanup=()=>db.prepare('DELETE FROM coach_jobs WHERE expires<=?').run(now())
  const row=(owner,id)=>{
    cleanup()
    const value=db.prepare('SELECT * FROM coach_jobs WHERE owner=? AND id=?').get(ownerKey(owner),id)
    if(!value)throw failure(404,'coach_job_not_found','该答疑任务已过期或不可用，请重新提交。')
    return value
  }
  const snapshot=value=>({id:value.id,status:value.status,stage:value.stage,answer:value.answer,
    ...(value.result?{result:JSON.parse(value.result)}:{}),createdAt:value.created,expiresAt:value.expires,retryAfterMs:1000})
  cleanup()
  const sweep=setInterval(()=>{try{cleanup()}catch{console.warn('[coach-jobs] retention sweep unavailable')}},60000);sweep.unref?.()
  return {
    begin({owner,id,hash,scope}){
      const key=ownerKey(owner)
      if(!/^[a-f0-9]{64}$/.test(hash))throw failure(400,'coach_job_hash_invalid','答疑请求无效。')
      cleanup()
      const prior=db.prepare('SELECT * FROM coach_jobs WHERE owner=? AND id=?').get(key,id)
      if(prior){
        if(prior.request_hash!==hash)throw failure(409,'coach_job_conflict','题目已变化，请重新提交。')
        return {created:false,...snapshot(prior)}
      }
      const total=db.prepare('SELECT COUNT(*) AS n FROM coach_jobs').get().n
      const active=db.prepare("SELECT COUNT(*) AS n FROM coach_jobs WHERE status='running'").get().n
      const owned=db.prepare("SELECT COUNT(*) AS n FROM coach_jobs WHERE status='running' AND owner=?").get(key).n
      if(total>=maxRows||active>=maxActive||owned>=maxPerOwner)throw failure(429,'coach_job_busy','已有答疑正在处理，请稍后继续。')
      const at=now()
      db.prepare("INSERT INTO coach_jobs(owner,id,request_hash,scope,status,stage,created,updated,expires) VALUES(?,?,?,?,'running','analysis',?,?,?)")
        .run(key,id,hash,JSON.stringify(scope),at,at,at+ttlMs)
      return {created:true,...snapshot(row(owner,id))}
    },
    scope(owner,id){return JSON.parse(row(owner,id).scope)},
    get(owner,id){return snapshot(row(owner,id))},
    update(owner,id,{answer='',stage='analysis'}){
      if(Buffer.byteLength(answer)>65536)throw failure(502,'coach_answer_too_large','回答过长，未完整生成。')
      db.prepare("UPDATE coach_jobs SET answer=?,stage=?,updated=? WHERE owner=? AND id=? AND status='running'")
        .run(answer,stage,now(),ownerKey(owner),id)
    },
    finish(owner,id,result){
      if(Buffer.byteLength(JSON.stringify(result))>131072)throw failure(502,'coach_answer_too_large','回答过长，未完整生成。')
      const success=(result.mode==='ai'&&result.providerStatus==='connected'||result.mode==='local'&&result.providerStatus==='skipped')&&Boolean(result.answer)&&!result.partial&&result.answerStatus!=='partial'
      db.prepare("UPDATE coach_jobs SET status=?,stage=?,answer=?,result=?,updated=? WHERE owner=? AND id=? AND status='running'")
        .run(success?'succeeded':'failed',success?'complete':'failed',result.answer||'',JSON.stringify(result),now(),ownerKey(owner),id)
    },
    fail(owner,id){
      db.prepare("UPDATE coach_jobs SET status='interrupted',stage='interrupted',updated=? WHERE owner=? AND id=? AND status='running'")
        .run(now(),ownerKey(owner),id)
    },
    close(){clearInterval(sweep);db.close()},
  }
}
