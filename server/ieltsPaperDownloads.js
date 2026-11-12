import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {applyPdfQuotaHeaders,pdfNotModified,sendPdfAccessError} from './pdfDownloadPolicy.js'

const PREFIX='/api/stem/ielts-papers',MAX_BYTES=32*1024*1024
export function defaultIeltsDownloadsRoot(){
  const runtime=fs.realpathSync(path.resolve(import.meta.dirname,'..'))
  return path.join(path.basename(path.dirname(runtime))==='releases'?path.resolve(runtime,'../..'):runtime,'data','ielts-downloads','current')
}
const publicItem=item=>Object.fromEntries(['id','sourceId','book','test','practiceTest','module','task','kind','title','fileName','sha256','bytes','pages','answerStatus'].map(k=>[k,item[k]]))
const json=(res,status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value))}

export function createIeltsPaperDownloads({root=defaultIeltsDownloadsRoot(),authorizeFile}={}){
  let cached=null,stamp='';const verified=new Map()
  async function catalogue(){
    const actual=await fs.promises.realpath(root),file=path.join(actual,'catalog.json'),stat=await fs.promises.stat(file),key=[actual,stat.size,stat.mtimeMs,stat.ctimeMs].join('|')
    if(stat.size>4*1024*1024)throw Error('Catalogue bound')
    if(cached&&key===stamp)return cached
    const data=JSON.parse(await fs.promises.readFile(file,'utf8')),ids=new Set()
    if(data.schemaVersion!=='ielts-paper-downloads-v1'||!/^[a-f0-9]{24}$/.test(data.version)||!Array.isArray(data.files)||data.files.length>2000)throw Error('Catalogue schema')
    for(const f of data.files){
      if(!/^ielts-cam[0-9]+-[a-z0-9-]+-(?:qp|ak)$/.test(f.id)||ids.has(f.id)||!['qp','ak'].includes(f.kind)||!['listening','reading','writing','speaking'].includes(f.module)||!Number.isInteger(f.book)||f.book<4||f.book>99||!Number.isInteger(f.test)||f.test<0||f.test>10||!Number.isInteger(f.pages)||f.pages<1||!Number.isSafeInteger(f.bytes)||f.bytes<5||f.bytes>MAX_BYTES||!/^[a-f0-9]{64}$/.test(f.sha256)||f.file!==f.sha256+'.pdf'||!/^Cambridge_IELTS_[A-Za-z0-9_-]+\.pdf$/.test(f.fileName))throw Error('Invalid catalogue entry')
      ids.add(f.id)
    }
    cached={...data,root:actual,index:new Map(data.files.map(f=>[f.id,f]))};stamp=key;verified.clear();return cached
  }
  async function openVerified(catalogue,item){
    const actual=await fs.promises.realpath(path.join(catalogue.root,item.file))
    if(path.dirname(actual)!==catalogue.root)throw Error('File boundary')
    const handle=await fs.promises.open(actual,'r')
    try{
      const stat=await handle.stat(),key=[actual,stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join('|')
      if(!stat.isFile()||stat.size!==item.bytes)throw Error('File size')
      if(!verified.has(key)){
        const hash=crypto.createHash('sha256');let head=Buffer.alloc(0)
        for await(const chunk of handle.createReadStream({start:0,autoClose:false})){if(head.length<5)head=Buffer.concat([head,chunk.subarray(0,5-head.length)]);hash.update(chunk)}
        const after=await handle.stat()
        if(head.toString()!=='%PDF-'||hash.digest('hex')!==item.sha256||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs||after.size!==stat.size)throw Error('File integrity')
        if(verified.size>=2000)verified.clear();verified.set(key,true)
      }
      return handle
    }catch(e){await handle.close();throw e}
  }
  return {async handle(req,res,url){
    if(url.pathname!==PREFIX&&!url.pathname.startsWith(PREFIX+'/'))return false
    let handle=null
    try{
      if(!['GET','HEAD'].includes(req.method)){json(res,405,{error:'请求方式不支持。'});return true}
      const data=await catalogue()
      if(url.pathname===PREFIX){
        const book=Number(url.searchParams.get('book'))||0,module=url.searchParams.get('module')||'',kind=url.searchParams.get('kind')||''
        const items=data.files.filter(f=>(!book||f.book===book)&&(!module||f.module===module)&&(!kind||f.kind===kind)).map(f=>({...publicItem(f),url:PREFIX+'/files/'+f.id}))
        json(res,200,{schemaVersion:data.schemaVersion,version:data.version,items,books:[...new Set(data.files.map(f=>f.book))].sort((a,b)=>b-a),quota:{limit:2,timezone:'Asia/Shanghai',shared:true}});return true
      }
      const match=url.pathname.match(/^\/api\/stem\/ielts-papers\/files\/(ielts-cam[0-9]+-[a-z0-9-]+-(?:qp|ak))$/),item=match&&data.index.get(match[1])
      if(!item){json(res,404,{error:'资料不存在。'});return true}
      if(typeof authorizeFile!=='function')throw Object.assign(Error('下载额度暂时无法核验。'),{statusCode:503,code:'pdf_quota_unavailable'})
      const access=await authorizeFile({request:req,sha256:item.sha256,consume:false})
      if(access?.metadataOnly!==true)throw Object.assign(Error('下载额度暂时无法核验。'),{statusCode:503,code:'pdf_quota_unavailable'})
      handle=await openVerified(data,item)
      const etag='"'+item.sha256+'"'
      let start=0,end=item.bytes-1,status=200
      const range=req.method==='GET'&&(!req.headers['if-range']||req.headers['if-range']===etag)?req.headers.range:null
      if(range){
        const r=/^bytes=(\d+)-(\d*)$/.exec(range)
        if(!r||!Number.isSafeInteger(Number(r[1]))||Number(r[1])>=item.bytes||r[2]&&(!Number.isSafeInteger(Number(r[2]))||Number(r[2])<Number(r[1]))){res.statusCode=416;res.setHeader('Content-Range','bytes */'+item.bytes);res.end();return true}
        start=Number(r[1]);end=r[2]?Math.min(Number(r[2]),end):end;status=206
      }
      applyPdfQuotaHeaders(res,access);res.setHeader('ETag',etag);res.setHeader('Accept-Ranges','bytes')
      if(pdfNotModified(req,etag)){res.statusCode=304;res.end();return true}
      if(req.method==='GET'){
        const quota=await authorizeFile({request:req,sha256:item.sha256,consume:true})
        if(!quota?.allowed)throw Object.assign(Error('下载额度暂时无法核验。'),{statusCode:503,code:'pdf_quota_unavailable'})
        applyPdfQuotaHeaders(res,quota)
      }
      res.statusCode=status;res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Length',String(end-start+1));res.setHeader('Content-Disposition','inline; filename="'+item.fileName+'"')
      if(status===206)res.setHeader('Content-Range',`bytes ${start}-${end}/${item.bytes}`)
      if(req.method==='HEAD'){res.end();return true}
      const stream=handle.createReadStream({start,end,autoClose:true});handle=null
      stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return true
    }catch(e){
      if(!sendPdfAccessError(res,e)){if(!res.headersSent)json(res,503,{code:'ielts_papers_unavailable',error:'剑雅资料暂时无法读取，请稍后重试。'});else if(!res.writableEnded)res.destroy()}
      return true
    }finally{await handle?.close()}
  }}
}
