import fs from 'node:fs'
import path from 'node:path'
const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1]
if(!args.includes('--import-root')||!args.includes('--out'))throw Error('Pass --import-root and --out')
const root=path.resolve(arg('--import-root')),out=path.resolve(arg('--out'))
const source=JSON.parse(fs.readFileSync(path.join(root,'source-index.json'),'utf8')),receipts=JSON.parse(fs.readFileSync(path.join(root,'download-receipts.json'),'utf8'))
const boards={edexcel:'Edexcel IAL',oxfordaqa:'OxfordAQA'},subjects={physics:'Physics',maths:'Mathematics'},courses=Object.entries(boards).flatMap(([board,label])=>Object.entries(subjects).map(([subject,name])=>({id:board+'-ial-'+subject,board,label:label+' '+name,subject:name})))
const key=r=>[r.board,r.subject,r.legacy?'legacy':'current',r.year,r.month,r.unit,r.variant].join('-').toLowerCase().replace(/[^a-z0-9-]/g,'-')
const groups=new Map();for(const row of source.files){const k=key(row);if(!groups.has(k))groups.set(k,{});const group=groups.get(k);if(group[row.kind]&&group[row.kind].sourceUrl!==row.sourceUrl)throw Error('Duplicate source pair key '+k);group[row.kind]=row}
const refs=m=>new Set((m.paperReferences||[]).map(s=>s.toUpperCase().replace(/\s/g,'').split('/')[0]))
const papers=[],review=[]
for(const [id,group]of groups){
 const q=group.QP,m=group.MS,qr=q&&receipts[q.sourceUrl],mr=m&&receipts[m.sourceUrl]
 if(!q||qr?.status!=='verified'){review.push({id,reason:'question_file_unverified'});continue}
 const course=courses.find(c=>c.id===q.board+'-ial-'+q.subject),known=refs(qr),matching=mr?.status==='verified'&&[...refs(mr)].some(x=>known.has(x))
 const file=(row,receipt)=>({id:id+'-'+row.kind.toLowerCase(),name:row.name,relativePath:receipt.relativePath,sourceUrl:row.sourceUrl,bytes:receipt.bytes,pages:receipt.pages,sha256:receipt.sha256,integrityStatus:'verified',rightsStatus:'unverified'})
 const unitNumber=Number(q.unit.match(/\d+/)?.[0]),level=q.subject==='physics'?(unitNumber<=(q.board==='edexcel'?3:2)?'International AS':'International A-Level'):'International AS / A-Level 单元'
 papers.push({id,board:q.board,course:course.id,courseLabel:course.label,subject:course.subject,level:level+(q.legacy?' · 旧考纲':''),year:q.year,session:({1:'January',6:'June',10:'October'})[q.month]||String(q.month),paper:q.unit,variant:q.variant,title:`${q.year} ${String(q.month).padStart(2,'0')} · ${q.unit}${q.variant?' · '+q.variant:''}${q.legacy?' · 旧考纲':''}`,section:q.section,fullExam:true,practiceReady:false,pairStatus:matching?'verified':mr?.status==='verified'?'candidate':'missing',questionPaper:file(q,qr),markScheme:mr?.status==='verified'?file(m,mr):null})
 if(!matching)review.push({id,reason:mr?.status==='verified'?'paper_reference_needs_review':'mark_scheme_missing'})
}
papers.sort((a,b)=>a.board.localeCompare(b.board)||a.course.localeCompare(b.course)||b.year-a.year||a.id.localeCompare(b.id))
const catalog={schemaVersion:'curriculum-paper-source-v1',generatedAt:new Date().toISOString(),sourceIndexAt:source.fetchedAt,courses,papers}
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(catalog,null,2)+'\n')
fs.writeFileSync(out+'.review.json',JSON.stringify({generatedAt:catalog.generatedAt,sourceFileCount:source.files.length,verifiedFiles:Object.values(receipts).filter(r=>r.status==='verified').length,failedFiles:Object.values(receipts).filter(r=>r.status==='failed').length,papers:papers.length,verifiedPairs:papers.filter(p=>p.pairStatus==='verified').length,rightsStatus:'unverified',review},null,2)+'\n')
console.log(JSON.stringify({papers:papers.length,paired:papers.filter(p=>p.pairStatus==='verified').length,review:review.length,rightsStatus:'unverified',out}))
