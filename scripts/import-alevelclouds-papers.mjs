import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {execFileSync,execFile} from 'node:child_process'
import {promisify} from 'node:util'

const SOURCES=[['Edexcel','physics','edephy'],['Edexcel','maths','edemat'],['AQA','physics','aqaphy'],['AQA','maths','aqamat']]
const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
export function parseSource(html,{board,subject,host}){
 const source=html.replace(/<!--[\s\S]*?-->/g,''),rows=[]
 for(const match of source.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/gi)){
  const section=clean(match[0].match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)?.[1]||'')
  if(!section)continue
  const before=source.slice(0,match.index),legacy=before.lastIndexOf('旧考纲')>before.lastIndexOf('新考纲')
  let rowDate=''
  for(const row of match[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)){
   const date=clean(row[0]).match(/(20\d{2})年(\d{1,2})月/);if(date)rowDate=date[1]+'-'+date[2].padStart(2,'0')
   for(const link of row[0].matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    let url;try{url=new URL(link[1])}catch{continue}
    if(url.protocol!=='https:'||url.hostname!==host+'.alevelclouds.com'||!url.pathname.endsWith('.pdf'))continue
    const name=decodeURIComponent(path.posix.basename(url.pathname)),parts=name.match(/^(\d{2})_(\d{2})_(QP|MS)_(.+)\.pdf$/i)
    if(!parts)throw Error('Unknown source filename: '+name)
    const year=2000+Number(parts[1]),month=Number(parts[2]);if(rowDate&&rowDate!==year+'-'+String(month).padStart(2,'0'))throw Error('Year/session disagrees with table: '+name)
    const unit=section.split(/[:：\s]/)[0].toUpperCase(),variant=parts[4].toUpperCase().startsWith(unit)?parts[4].slice(unit.length):parts[4]
    rows.push({board:board==='Edexcel'?'edexcel':'oxfordaqa',subject,sourcePage:`https://alevelclouds.com/past-papers/${board}/${subject}/`,sourceUrl:url.href,name,year,month,kind:parts[3].toUpperCase(),unit,variant,legacy,section})
   }
  }
 }
 return [...new Map(rows.map(r=>[r.sourceUrl,r])).values()]
}
const hash=b=>crypto.createHash('sha256').update(b).digest('hex')
async function fetchBounded(url,maxBytes){
 if(process.platform==='win32'){
  const parsed=new URL(url);if(parsed.protocol!=='https:'||!/(^|\.)alevelclouds\.com$/.test(parsed.hostname))throw Error('Unexpected source host')
  const result=await promisify(execFile)('curl.exe',['--fail','--silent','--show-error','--location','--max-redirs','0','--connect-timeout','10','--max-time','45','--max-filesize',String(maxBytes),'--proto','=https',url],{encoding:'buffer',maxBuffer:maxBytes+1024,timeout:55000,windowsHide:true})
  if(result.stdout.length>maxBytes)throw Error('Source too large')
  return result.stdout
 }
 let target=url
 for(let redirect=0;redirect<4;redirect++){
  const u=new URL(target);if(u.protocol!=='https:'||!/(^|\.)alevelclouds\.com$/.test(u.hostname))throw Error('Unexpected source redirect')
  const response=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(45000),headers:{'user-agent':'STEMist-Paper-Catalog/1.0 (bounded archival verification)'}})
  if([301,302,303,307,308].includes(response.status)){target=new URL(response.headers.get('location'),target).href;continue}
  if(!response.ok)throw Error('HTTP '+response.status)
  const chunks=[];let total=0;for await(const value of response.body){total+=value.length;if(total>maxBytes)throw Error('Source too large');chunks.push(value)}
  return Buffer.concat(chunks)
 }
 throw Error('Too many redirects')
}
async function main(){
 const args=process.argv.slice(2),out=path.resolve(args[args.indexOf('--out')+1]||'')
 const approvedRoot=process.platform==='win32'?out.startsWith('D:\\CodexWork\\'):out==='/home/ubuntu/alevel-physics-imports/alevelclouds-20261104'
 if(!args.includes('--out')||!approvedRoot)throw Error('Pass the explicit task-owned import output directory')
 fs.mkdirSync(out,{recursive:true});const index=[]
 for(const [board,subject,host]of SOURCES){
  const page=`https://alevelclouds.com/past-papers/${board}/${subject}/`,cached=path.join(out,`${host}-source.html`)
  let html;try{html=await fetchBounded(page,2*1024*1024);fs.writeFileSync(cached,html)}catch(e){if(fs.existsSync(cached)&&Date.now()-fs.statSync(cached).mtimeMs<21600000)html=fs.readFileSync(cached);else throw Error(host+': '+e.message)}
  index.push(...parseSource(html.toString('utf8'),{board,subject,host}));console.log(JSON.stringify({source:host,indexed:index.length}))
 }
 fs.writeFileSync(path.join(out,'source-index.json'),JSON.stringify({fetchedAt:new Date().toISOString(),files:index},null,2)+'\n')
 console.log(JSON.stringify({indexed:index.length,byBoard:Object.fromEntries(['edexcel','oxfordaqa'].map(b=>[b,index.filter(x=>x.board===b).length]))}))
 if(args.includes('--index-only'))return
 const receiptsFile=path.join(out,'download-receipts.json'),receipts=fs.existsSync(receiptsFile)?JSON.parse(fs.readFileSync(receiptsFile,'utf8')):{},queue=[...index]
 const save=()=>fs.writeFileSync(receiptsFile,JSON.stringify(receipts,null,2)+'\n')
 const max=args.includes('--limit')?Number(args[args.indexOf('--limit')+1]):Infinity;let completed=0,totalBytes=Object.values(receipts).reduce((s,r)=>s+(r.bytes||0),0)
 async function worker(){while(queue.length&&completed<max){const item=queue.shift();completed++
  const relativePath=`${item.board}/${item.subject}/${item.legacy?'legacy':'current'}/${item.name}`,file=path.join(out,relativePath);fs.mkdirSync(path.dirname(file),{recursive:true})
  if(receipts[item.sourceUrl]?.status==='verified'&&fs.existsSync(file)&&hash(fs.readFileSync(file))===receipts[item.sourceUrl].sha256)continue
  try{
   const disk=fs.statfsSync(out);if(totalBytes>2*1024**3||Number(disk.bavail)*Number(disk.bsize)<4*1024**3){queue.length=0;throw Error('Import storage budget reached')}
   const bytes=await fetchBounded(item.sourceUrl,48*1024*1024);if(bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Not a PDF')
   fs.writeFileSync(file+'.part',bytes);fs.renameSync(file+'.part',file)
   const meta=JSON.parse(execFileSync(process.platform==='win32'?'py':'python3',[...(process.platform==='win32'?['-3.12']:[]),path.join(import.meta.dirname,'inspect-paper-pdf.py'),file],{encoding:'utf8',timeout:20000,windowsHide:true,maxBuffer:100000,stdio:['ignore','pipe','pipe']}))
   totalBytes+=bytes.length-(receipts[item.sourceUrl]?.bytes||0)
   receipts[item.sourceUrl]={status:'verified',relativePath,bytes:bytes.length,sha256:hash(bytes),...meta,downloadedAt:new Date().toISOString()}
  }catch(e){receipts[item.sourceUrl]={status:'failed',relativePath,error:String(e.message).split('\n')[0].slice(0,150)}}
  if(completed%20===0){save();console.log(JSON.stringify({attempted:completed,remaining:queue.length,verified:Object.values(receipts).filter(x=>x.status==='verified').length,failed:Object.values(receipts).filter(x=>x.status==='failed').length}))}
  await new Promise(resolve=>setTimeout(resolve,200))
 }}
 await Promise.all([worker(),worker()]);save()
 console.log(JSON.stringify({finished:true,indexed:index.length,verified:Object.values(receipts).filter(x=>x.status==='verified').length,failed:Object.values(receipts).filter(x=>x.status==='failed').length,out}))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1})
