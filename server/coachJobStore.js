import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  applyCoachTaskEvent,
  createCoachTask,
  estimateCoachDuration,
  legacyCoachTask,
  normalizeCoachTaskProfile,
  parseCoachTask,
  taskSnapshot,
} from './coachTaskProgress.js'

const failure=(statusCode,code,message)=>Object.assign(new Error(message),{statusCode,code})
export const DEFAULT_COACH_JOB_MAX_ROWS=4096
const ownerKey=owner=>{
  if(!/^ielts:\d+$/.test(String(owner)))throw failure(401,'coach_auth_required','请先登录。')
  return crypto.createHash('sha256').update(owner).digest('hex')
}
export function coachJobId(value){
  if(typeof value!=='string'||!/^cj-[a-zA-Z0-9_-]{16,80}$/.test(value))throw failure(400,'coach_job_id_invalid','答疑任务编号无效。')
  return value
}

// Single-process STEM worker; never persists uploaded images, request text or credentials.
// Saved answers retain for three days; legacy jobs retain 24 hours; explicit
// instant answers live only in bounded RAM with a ten-minute SQLite tombstone.
export function createCoachJobStore({root,now=Date.now,ttlMs=86400000,maxActive=4,maxPerOwner=1,maxRows=DEFAULT_COACH_JOB_MAX_ROWS}={}){
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
      task_json TEXT, model TEXT, effort TEXT, thinking_enabled INTEGER, input_kind TEXT,
      help_intent TEXT, duration_ms INTEGER, completed INTEGER, saved_task INTEGER,
      PRIMARY KEY(owner,id));
    CREATE INDEX IF NOT EXISTS coach_jobs_expiry ON coach_jobs(expires);`)
  const columns=new Set(db.prepare('PRAGMA table_info(coach_jobs)').all().map(column=>column.name))
  const additions={task_json:'TEXT',model:'TEXT',effort:'TEXT',thinking_enabled:'INTEGER',input_kind:'TEXT',help_intent:'TEXT',duration_ms:'INTEGER',completed:'INTEGER',saved_task:'INTEGER'}
  for(const [name,type] of Object.entries(additions))if(!columns.has(name))db.exec(`ALTER TABLE coach_jobs ADD COLUMN ${name} ${type}`)
  db.exec(`CREATE INDEX IF NOT EXISTS coach_jobs_owner_created ON coach_jobs(owner,created DESC,id DESC);
    CREATE INDEX IF NOT EXISTS coach_jobs_cohort ON coach_jobs(status,model,effort,input_kind,help_intent,completed DESC);
    CREATE TABLE IF NOT EXISTS coach_job_duration_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT, model TEXT NOT NULL, effort TEXT NOT NULL,
      input_kind TEXT NOT NULL, help_intent TEXT NOT NULL, duration_ms INTEGER NOT NULL, completed INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS coach_job_duration_cohort ON coach_job_duration_samples(model,effort,input_kind,help_intent,completed DESC);`)
  const instantResults=new Map(),instantKey=(owner,id)=>`${owner}\n${id}`,MAX_INSTANT_ROWS=128
  const encodeTask=task=>{
    const text=JSON.stringify(task)
    if(Buffer.byteLength(text)>16384)throw failure(500,'coach_task_invalid','答疑任务状态无效。')
    return text
  }
  const interruptedAt=now()
  db.prepare("UPDATE coach_jobs SET status='interrupted',stage='interrupted',answer='',result=NULL,task_json=NULL,model=NULL,effort=NULL,thinking_enabled=NULL,input_kind=NULL,help_intent=NULL,duration_ms=NULL,completed=?,updated=? WHERE saved_task=0 AND expires>?")
    .run(interruptedAt,interruptedAt,interruptedAt)
  const interruptedRows=db.prepare("SELECT * FROM coach_jobs WHERE status='running' AND (saved_task IS NULL OR saved_task=1)").all()
  const interrupt=db.prepare("UPDATE coach_jobs SET status='interrupted',stage='interrupted',task_json=?,updated=?,completed=? WHERE owner=? AND id=? AND status='running'")
  for(const value of interruptedRows){
    const task=parseCoachTask(value.task_json)||legacyCoachTask(value,interruptedAt)
    interrupt.run(encodeTask(applyCoachTaskEvent(task,{type:'interrupted',at:interruptedAt},interruptedAt)),interruptedAt,interruptedAt,value.owner,value.id)
  }
  const cleanup=()=>{const at=now();db.prepare('DELETE FROM coach_jobs WHERE expires<=?').run(at);db.prepare('DELETE FROM coach_job_duration_samples WHERE completed<=?').run(at-2592000000);for(const [key,value] of instantResults)if(value.expires<=at)instantResults.delete(key)}
  const row=(owner,id)=>{
    cleanup()
    const value=db.prepare('SELECT * FROM coach_jobs WHERE owner=? AND id=?').get(ownerKey(owner),id)
    if(!value)throw failure(404,'coach_job_not_found','该答疑任务已过期或不可用，请重新提交。')
    return value
  }
  const memoryFor=value=>value.saved_task===0?instantResults.get(instantKey(value.owner,value.id)):null
  const taskFor=value=>memoryFor(value)?.task||parseCoachTask(value.task_json)||legacyCoachTask(value,now())
  const snapshot=value=>{const memory=memoryFor(value),answer=memory?.answer??value.answer,result=memory?.result??(value.result?JSON.parse(value.result):null);return{id:value.id,status:value.status,stage:value.stage,answer,
    ...(result?{result}:{}),createdAt:value.created,updatedAt:value.updated,expiresAt:value.expires,retryAfterMs:1000,serverNow:now(),task:taskSnapshot(taskFor(value),{now:now(),status:value.status})}}
  const listSnapshot=value=>({id:value.id,status:value.status,stage:value.stage,createdAt:value.created,updatedAt:value.updated,expiresAt:value.expires,task:taskSnapshot(taskFor(value),{now:now(),status:value.status})})
  const taskProfile=task=>normalizeCoachTaskProfile({
    requestedEffort:task.reasoning.requestedEffort,effectiveEffort:task.reasoning.effectiveEffort,
    thinkingEnabled:task.reasoning.enabled,inputKind:task.input.kind,imageCount:task.input.imageCount,
    helpIntent:task.helpIntent,provider:task.model.provider,model:task.model.id,
    saved:task.persistence?.saved===true,retentionMs:task.persistence?.retentionMs,
    persistenceMode:task.persistence?.saved===true?'saved':task.persistence?.retentionMs===600000?'instant':'legacy',
  })
  const samples=profile=>{
    const normalized=normalizeCoachTaskProfile(profile)
    if(!normalized.model||!normalized.effectiveEffort)return[]
    return db.prepare("SELECT duration_ms FROM coach_job_duration_samples WHERE model=? AND effort=? AND input_kind=? AND help_intent=? ORDER BY completed DESC,id DESC LIMIT 20")
      .all(normalized.model,normalized.effectiveEffort,normalized.inputKind,normalized.helpIntent).map(row=>row.duration_ms)
  }
  const recordSample=(task,duration,at)=>{
    if(!Number.isFinite(duration)||duration<100||duration>600000)return
    const profile=taskProfile(task)
    if(!profile.model||!profile.effectiveEffort)return
    db.prepare('INSERT INTO coach_job_duration_samples(model,effort,input_kind,help_intent,duration_ms,completed) VALUES(?,?,?,?,?,?)')
      .run(profile.model,profile.effectiveEffort,profile.inputKind,profile.helpIntent,Math.round(duration),at)
    db.exec('DELETE FROM coach_job_duration_samples WHERE id NOT IN (SELECT id FROM coach_job_duration_samples ORDER BY completed DESC,id DESC LIMIT 4096)')
  }
  const cursorFor=value=>Buffer.from(JSON.stringify({created:value.created,id:value.id})).toString('base64url')
  const listColumns='id,scope,status,stage,created,updated,expires,task_json,model,effort,thinking_enabled,input_kind,help_intent,duration_ms,completed,saved_task'
  const parseCursor=value=>{
    if(value===undefined||value===null||value==='')return null
    if(typeof value!=='string'||value.length>240||!/^[A-Za-z0-9_-]+$/.test(value))throw failure(400,'coach_job_cursor_invalid','答疑任务游标无效。')
    try{const decoded=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));if(!Number.isSafeInteger(decoded.created)||!/^cj-[a-zA-Z0-9_-]{16,80}$/.test(decoded.id))throw Error();return decoded}catch{throw failure(400,'coach_job_cursor_invalid','答疑任务游标无效。')}
  }
  cleanup()
  const sweep=setInterval(()=>{try{cleanup()}catch{console.warn('[coach-jobs] retention sweep unavailable')}},60000);sweep.unref?.()
  return {
    begin({owner,id,hash,scope,taskProfile:profileValue={}}){
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
      const at=now(),profile=normalizeCoachTaskProfile({...profileValue,retentionMs:profileValue?.retentionMs??ttlMs}),estimate=estimateCoachDuration(profile,samples(profile)),task=createCoachTask(profile,at,estimate),instant=profile.persistenceMode==='instant'
      if(instant&&instantResults.size>=MAX_INSTANT_ROWS)throw failure(429,'coach_job_busy','即时答疑恢复空间已满，请稍后继续。')
      db.prepare("INSERT INTO coach_jobs(owner,id,request_hash,scope,status,stage,created,updated,expires,task_json,model,effort,thinking_enabled,input_kind,help_intent,saved_task) VALUES(?,?,?,?,'running','accepted',?,?,?,?,?,?,?,?,?,?)")
        .run(key,id,hash,instant?'{}':JSON.stringify(scope),at,at,at+profile.retentionMs,instant?null:encodeTask(task),instant?null:profile.model,instant?null:profile.effectiveEffort,instant?null:profile.thinkingEnabled?1:0,instant?null:profile.inputKind,instant?null:profile.helpIntent,profile.saved?1:instant?0:null)
      if(instant)instantResults.set(instantKey(key,id),{task,scope,answer:'',result:null,expires:at+profile.retentionMs})
      return {created:true,...snapshot(row(owner,id))}
    },
    scope(owner,id){const value=row(owner,id);return memoryFor(value)?.scope||JSON.parse(value.scope)},
    get(owner,id){return snapshot(row(owner,id))},
    update(owner,id,{answer=''}){
      if(Buffer.byteLength(answer)>65536)throw failure(502,'coach_answer_too_large','回答过长，未完整生成。')
      const value=row(owner,id),memory=memoryFor(value)
      if(memory){memory.answer=answer;db.prepare("UPDATE coach_jobs SET updated=? WHERE owner=? AND id=? AND status='running'").run(now(),ownerKey(owner),id);return}
      db.prepare("UPDATE coach_jobs SET answer=?,updated=? WHERE owner=? AND id=? AND status='running'")
        .run(answer,now(),ownerKey(owner),id)
    },
    progress(owner,id,event){
      const value=row(owner,id)
      if(value.status!=='running')return snapshot(value)
      const memory=memoryFor(value),before=taskFor(value),modelChanged=event?.type==='requesting_model'&&((event.model&&event.model!==before.model.id)||(event.provider&&event.provider!==before.model.provider))
      let task=applyCoachTaskEvent(before,event,now())
      if(modelChanged)task={...task,estimate:estimateCoachDuration(taskProfile(task),samples(taskProfile(task)))}
      const encoded=encodeTask(task)
      if(encoded===encodeTask(before))return snapshot(value)
      const profile=taskProfile(task),at=now()
      if(memory){memory.task=task;db.prepare("UPDATE coach_jobs SET stage=?,updated=? WHERE owner=? AND id=? AND status='running'").run(task.stage.code,at,ownerKey(owner),id);return snapshot(row(owner,id))}
      db.prepare("UPDATE coach_jobs SET stage=?,task_json=?,model=?,effort=?,thinking_enabled=?,input_kind=?,help_intent=?,updated=? WHERE owner=? AND id=? AND status='running'")
        .run(task.stage.code,encoded,profile.model,profile.effectiveEffort,profile.thinkingEnabled?1:0,profile.inputKind,profile.helpIntent,at,ownerKey(owner),id)
      return snapshot(row(owner,id))
    },
    finish(owner,id,result){
      if(Buffer.byteLength(JSON.stringify(result))>131072)throw failure(502,'coach_answer_too_large','回答过长，未完整生成。')
      const success=(result.mode==='ai'&&result.providerStatus==='connected'||result.mode==='local'&&result.providerStatus==='skipped')&&Boolean(result.answer)&&!result.partial&&result.answerStatus!=='partial'
      const value=row(owner,id),memory=memoryFor(value),at=now(),type=success?'complete':'failed',task=applyCoachTaskEvent(taskFor(value),{type,at},at)
      if(result.provider)task.model.provider=String(result.provider).slice(0,40)
      if(result.model)task.model.id=String(result.model).slice(0,120)
      const duration=success&&result.mode==='ai'?Math.max(0,at-value.created):null
      if(success&&result.mode==='ai')recordSample(task,duration,at)
      if(memory){memory.task=task;memory.answer=result.answer||'';memory.result=result;db.prepare("UPDATE coach_jobs SET status=?,stage=?,answer='',result=NULL,task_json=NULL,model=NULL,effort=NULL,thinking_enabled=NULL,input_kind=NULL,help_intent=NULL,duration_ms=NULL,completed=?,updated=? WHERE owner=? AND id=? AND status='running'")
        .run(success?'succeeded':'failed',type,at,at,ownerKey(owner),id);return}
      db.prepare("UPDATE coach_jobs SET status=?,stage=?,answer=?,result=?,task_json=?,model=?,duration_ms=?,completed=?,updated=? WHERE owner=? AND id=? AND status='running'")
        .run(success?'succeeded':'failed',type,result.answer||'',JSON.stringify(result),encodeTask(task),task.model.id,duration,at,at,ownerKey(owner),id)
    },
    fail(owner,id){
      const value=row(owner,id)
      if(value.status!=='running')return
      const memory=memoryFor(value),at=now(),task=applyCoachTaskEvent(taskFor(value),{type:'interrupted',at},at)
      if(memory){memory.task=task;db.prepare("UPDATE coach_jobs SET status='interrupted',stage='interrupted',updated=?,completed=? WHERE owner=? AND id=? AND status='running'").run(at,at,ownerKey(owner),id);return}
      db.prepare("UPDATE coach_jobs SET status='interrupted',stage='interrupted',task_json=?,completed=?,updated=? WHERE owner=? AND id=? AND status='running'")
        .run(encodeTask(task),at,at,ownerKey(owner),id)
    },
    listCandidates(owner,{limit=20,cursor=null}={}){
      if(!Number.isInteger(limit)||limit<1||limit>60)throw failure(400,'coach_job_limit_invalid','答疑任务数量无效。')
      cleanup();const key=ownerKey(owner),boundary=parseCursor(cursor),at=now()
      const rows=boundary
        ? db.prepare(`SELECT ${listColumns} FROM coach_jobs WHERE owner=? AND saved_task=1 AND expires>? AND (created<? OR (created=? AND id<?)) ORDER BY created DESC,id DESC LIMIT ?`).all(key,at,boundary.created,boundary.created,boundary.id,limit)
        : db.prepare(`SELECT ${listColumns} FROM coach_jobs WHERE owner=? AND saved_task=1 AND expires>? ORDER BY created DESC,id DESC LIMIT ?`).all(key,at,limit)
      return{serverNow:at,items:rows.map(value=>({snapshot:listSnapshot(value),scope:JSON.parse(value.scope),cursor:cursorFor(value)})),nextCursor:rows.length===limit?cursorFor(rows.at(-1)):null}
    },
    serverNow:()=>now(),
    close(){clearInterval(sweep);const at=now();db.prepare("UPDATE coach_jobs SET status='interrupted',stage='interrupted',answer='',result=NULL,task_json=NULL,model=NULL,effort=NULL,thinking_enabled=NULL,input_kind=NULL,help_intent=NULL,duration_ms=NULL,completed=?,updated=? WHERE saved_task=0 AND expires>?").run(at,at,at);instantResults.clear();db.close()},
  }
}
