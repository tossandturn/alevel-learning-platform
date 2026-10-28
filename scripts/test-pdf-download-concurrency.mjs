import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads'
import {setTimeout as delay} from 'node:timers/promises'
import {createPdfDownloadLedger} from '../server/pdfDownloadQuota.js'

const free={active:false,expiresAt:null}
if(!isMainThread){
  const database=new DatabaseSync(workerData.file)
  const clock=()=>Number(Atomics.load(new BigInt64Array(workerData.clock),0))
  const ledger=createPdfDownloadLedger({database,clock})
  parentPort.once('message',()=>{
    parentPort.postMessage({type:'attempting'})
    try{parentPort.postMessage({type:'result',value:ledger.grant(workerData.grant)})}
    catch(error){parentPort.postMessage({type:'result',error:{code:error.code,message:error.message}})}
    finally{database.close();parentPort.close()}
  })
  parentPort.postMessage({type:'ready'})
}else{
  const prefix='stem-pdf-quota-race-',directory=await fs.mkdtemp(path.join(os.tmpdir(),prefix)),file=path.join(directory,'quota.sqlite')
  const database=new DatabaseSync(file),sharedClock=new SharedArrayBuffer(8),clockArray=new BigInt64Array(sharedClock),workers=[]
  const setClock=value=>Atomics.store(clockArray,0,BigInt(Date.parse(value)))
  setClock('2026-10-28T15:59:59.900Z')
  database.exec('PRAGMA journal_mode=WAL')
  const ledger=createPdfDownloadLedger({database,clock:()=>Number(Atomics.load(clockArray,0))})
  const grant=(userId,char,entitlement=free)=>({userId,sha256:char.repeat(64),entitlement})
  function launch(item){
    const worker=new Worker(new URL(import.meta.url),{workerData:{file,clock:sharedClock,grant:item}});workers.push(worker)
    const events={};const promises=Object.fromEntries(['ready','attempting','result'].map(type=>[type,new Promise((resolve,reject)=>{events[type]={resolve,reject}})]))
    worker.on('message',message=>events[message.type]?.resolve(message))
    worker.on('error',error=>Object.values(events).forEach(event=>event.reject(error)))
    return{worker,...promises}
  }
  async function race(items,whileLocked=()=>{}){
    const group=items.map(launch)
    await Promise.all(group.map(item=>item.ready))
    database.exec('BEGIN IMMEDIATE')
    try{
      for(const item of group)item.worker.postMessage('go')
      await Promise.all(group.map(item=>item.attempting))
      await delay(100)
      whileLocked()
    }finally{database.exec('COMMIT')}
    return Promise.all(group.map(item=>item.result))
  }
  const timeout=setTimeout(()=>{console.error('PDF quota concurrency timeout');process.exitCode=1;for(const worker of workers)worker.terminate()},10000)
  try{
    const same=await race(Array.from({length:4},()=>grant('ielts:51','a')))
    assert.ok(same.every(result=>result.value?.allowed),JSON.stringify(same))
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM pdf_download_grants WHERE user_id=?').get('ielts:51').n,1,'Concurrent retries must create one grant')
    ledger.grant(grant('ielts:52','a'))
    const different=await race([grant('ielts:52','b'),grant('ielts:52','c')])
    assert.equal(different.filter(result=>result.value?.allowed).length,1)
    assert.equal(different.filter(result=>result.error?.code==='pdf_daily_limit_reached').length,1,'Second contender must receive quota error, not SQLITE_BUSY or another slot')
    ledger.grant(grant('ielts:53','a'));ledger.grant(grant('ielts:53','b'))
    const midnight=await race([grant('ielts:53','c')],()=>setClock('2026-10-28T16:00:00.100Z'))
    assert.equal(midnight[0].value?.day,'2026-10-29');assert.equal(midnight[0].value?.used,1)
    ledger.grant(grant('ielts:54','a'));ledger.grant(grant('ielts:54','b'))
    const expired=await race([grant('ielts:54','c',{active:true,expiresAt:'2026-10-28T16:00:00.200Z'})],()=>setClock('2026-10-28T16:00:00.300Z'))
    assert.equal(expired[0].error?.code,'pdf_daily_limit_reached','Membership expiry is rechecked after the lock')
    console.log('PDF quota concurrency: independent connections, same-file race, final slot, lock across Beijing midnight/expiry PASS')
  }finally{
    clearTimeout(timeout)
    await Promise.all(workers.map(worker=>worker.terminate()))
    database.close()
    const resolved=path.resolve(directory)
    assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith(prefix))
    await fs.rm(resolved,{recursive:true,force:true})
  }
}
