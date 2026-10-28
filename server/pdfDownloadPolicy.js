import crypto from 'node:crypto'
import {createPdfDownloadLedger,PDF_QUOTA_PROTOCOL} from './pdfDownloadQuota.js'

const flag=value=>['1','true','yes','on'].includes(String(value||'').trim().toLowerCase())
const unavailable=()=>Object.assign(new Error('下载额度暂时无法核验，请稍后重试；已下载进度会保留。'),{statusCode:503,code:'pdf_quota_unavailable'})
const authRequired=()=>Object.assign(new Error('请登录后继续下载，已下载进度会保留。'),{statusCode:401,code:'pdf_auth_required',headers:{'X-Pdf-Access-Code':'pdf_auth_required'}})
const canonical=value=>typeof value==='string'&&/^ielts:[1-9]\d{0,14}$/.test(value)&&Number.isSafeInteger(Number(value.slice(6)))
const quotaEnabled=env=>flag(env.STEM_PDF_DOWNLOAD_QUOTA_ENABLED)&&flag(env.STEM_PDF_DOWNLOAD_QUOTA_READY)

export async function authorizePdfFile({env={},authorizeFile,request,sha256,consume=true}={}){
  const required=quotaEnabled(env)
  if(typeof authorizeFile!=='function'){
    if(required)throw unavailable()
    return null
  }
  const decision=await authorizeFile({request,sha256,consume})
  // An enabled route must never serve bytes after missing or incomplete wiring.
  if(required&&!(consume?decision?.allowed===true&&decision.protocol===PDF_QUOTA_PROTOCOL:decision?.metadataOnly===true))throw unavailable()
  return decision
}

export function createPdfDownloadPolicy({env={},authenticateRequest,databaseProvider,fetchImpl=fetch,clock=Date.now,timeoutMs=3000}={}){
  const ledgers=new WeakMap(),inflight=new Map()
  const enabled=()=>quotaEnabled(env)
  function ledger(){const database=databaseProvider();let result=ledgers.get(database);if(!result){result=createPdfDownloadLedger({database,clock});ledgers.set(database,result)}return result}
  async function membership(userId){
    if(inflight.has(userId))return inflight.get(userId)
    const pending=(async()=>{
      let url
      try{url=new URL(String(env.STEM_AUTH_INTERNAL_ORIGIN||'http://127.0.0.1:4321'))}catch{throw unavailable()}
      if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname.toLowerCase())||url.username||url.password||url.search||url.hash)throw unavailable()
      const key=String(env.STEM_INTERNAL_AUTH_KEY||env.STEM_IDENTITY_SIGNING_KEY||'')
      if(!key)throw unavailable()
      url.pathname='/api/stem/internal/entitlements'
      const body=JSON.stringify({userId,featureIds:['stem.all-access']}),timestamp=String(clock())
      const digest=crypto.createHash('sha256').update(body).digest('hex')
      const signature=crypto.createHmac('sha256',key).update(timestamp+'.'+digest).digest('base64url')
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(5000,Math.max(50,timeoutMs)))
      try{
        const response=await fetchImpl(url.toString(),{method:'POST',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json','x-stem-auth-timestamp':timestamp,'x-stem-auth-signature':signature},body})
        if(!response.ok||Number(response.headers?.get?.('content-length')||0)>32768)throw unavailable()
        const text=await response.text();if(Buffer.byteLength(text)>32768)throw unavailable()
        const value=JSON.parse(text),entitlement=value.entitlement,checkedAt=Date.parse(value.checkedAt),observed=Number(clock())
        if(value.protocol!=='stemist-membership-v1'||value.authority!=='ieltsist-membership'||value.userId!==userId||typeof entitlement?.active!=='boolean'||value.maxAgeSeconds!==30||!Number.isFinite(checkedAt)||checkedAt>observed+5000||observed-checkedAt>60000||entitlement.active&&!Number.isFinite(Date.parse(entitlement.expiresAt)))throw unavailable()
        // Global enforcement/features.allowed may be disabled for all users.
        // Only the authoritative membership status/expiry grants unlimited use.
        return{active:entitlement.active,expiresAt:entitlement.expiresAt||null}
      }catch{throw unavailable()}finally{clearTimeout(timer)}
    })().finally(()=>inflight.delete(userId))
    inflight.set(userId,pending);return pending
  }
  async function authorize({request,sha256,consume=true}={}){
    if(!enabled())return null
    let user
    try{user=await authenticateRequest(request)}catch(error){if(error?.statusCode===401||error?.status===401)throw authRequired();throw unavailable()}
    if(!canonical(user?.id))throw authRequired()
    if(!consume)return{metadataOnly:true}
    if(!/^[a-f0-9]{64}$/.test(String(sha256||'')))throw unavailable()
    try{
      const store=ledger(),existing=store.lookup({userId:user.id,sha256})
      if(existing)return existing
      const entitlement=await membership(user.id)
      return store.grant({userId:user.id,sha256,entitlement})
    }catch(error){if(error?.code==='pdf_daily_limit_reached')throw error;throw unavailable()}
  }
  return Object.freeze({enabled,authorize})
}

export function applyPdfQuotaHeaders(response,quota){
  if(!quota)return
  response.setHeader('Cache-Control','private, no-store')
  response.setHeader('Vary','Authorization, Cookie')
  if(quota.metadataOnly)return
  response.setHeader('X-Pdf-Quota-Limit',String(quota.limit))
  response.setHeader('X-Pdf-Quota-Used',String(quota.used))
  response.setHeader('X-Pdf-Quota-Reset',quota.resetAt)
  response.setHeader('X-Pdf-Quota-Reused',String(quota.reused))
  if(typeof quota.unlimited==='boolean')response.setHeader('X-Pdf-Quota-Unlimited',String(quota.unlimited))
  if(Number.isInteger(quota.remaining))response.setHeader('X-Pdf-Quota-Remaining',String(quota.remaining))
}

export function pdfNotModified(request,etag){
  return String(request.headers?.['if-none-match']||'').split(',').some(value=>['*',etag,'W/'+etag].includes(value.trim()))
}

export function sendPdfAccessError(response,error){
  if(!['pdf_auth_required','pdf_daily_limit_reached','pdf_quota_unavailable'].includes(error?.code))return false
  if(response.headersSent||response.destroyed||response.writableEnded)return true
  const body=Buffer.from(JSON.stringify({code:error.code,error:error.message,...(error.quota?{quota:error.quota}:{})}),'utf8')
  response.statusCode=error.statusCode
  response.setHeader('Content-Type','application/json; charset=utf-8')
  response.setHeader('Content-Length',String(body.length))
  response.setHeader('Cache-Control','private, no-store')
  response.setHeader('Vary','Authorization, Cookie')
  response.setHeader('X-Pdf-Access-Code',error.code)
  for(const name of ['ETag','Content-Range','Content-Disposition','Accept-Ranges'])response.removeHeader(name)
  for(const [key,value] of Object.entries(error.headers||{}))response.setHeader(key,value)
  response.end(body);return true
}
