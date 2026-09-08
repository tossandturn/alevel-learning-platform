import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {createStemApi,closeStemDatabaseForTests} from '../server/stemApi.js'
import {createNativePaperCatalog} from '../server/nativePaperCatalog.js'
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'stem-native-catalog-'))
const profile={code:'9702/2',title:'Structured Questions',stages:['as'],courseRouteIds:['cie-9702-as-physics']}
const items=Array.from({length:4000},(_,i)=>({id:'p-'+i,subject:'9702',year:2025-Math.floor(i/300),season:['Mar','Jun','Nov'][i%3],kind:'qp',file:'9702_'+i+'_qp.pdf',pairKey:'pair-'+i,markSchemeId:i===0?'ms-0':'',localUrl:'/local-pdf/9702/9702_'+i+'_qp.pdf',examProfile:i%2?{...profile,code:'9702/4',stages:['a2'],courseRouteIds:['cie-9702-a2-physics']}:profile,governance:{state:'active'},answer:'never in catalog',oversizedMetadata:'x'.repeat(80)}))
items.push({...items[0],id:'ms-0',kind:'ms',file:'9702_0_ms.pdf',localUrl:'/local-pdf/9702/9702_0_ms.pdf'})
items.push({...items[0],id:'withdrawn',governance:{state:'withdrawn'}})
await fs.writeFile(path.join(directory,'9702.json'),JSON.stringify({schemaVersion:2,items}))
const service=createNativePaperCatalog({directory})
try{
 const first=await service.list({subject:'9702',stage:'a2',routeId:'cie-9702-a2-physics',page:1})
 assert.equal(first.items.length,30);assert.equal(first.total,2000);assert.equal(first.subjectTotal,4000)
 assert.ok(first.items.every(p=>p.stages.includes('a2')&&p.routeIds.includes('cie-9702-a2-physics')))
 assert.ok(Buffer.byteLength(JSON.stringify(first))<32000);assert.doesNotMatch(JSON.stringify(first),/oversizedMetadata|never in catalog/)
 const second=await service.list({subject:'9702',stage:'a2',page:2});assert.ok(!second.items.some(p=>first.items.some(q=>q.id===p.id)))
 const spring=await service.list({subject:'9702',stage:'as',routeId:'cie-9702-as-physics',year:2025,season:'spring'})
 assert.equal(spring.total,50,'filter the whole catalog before pagination, not the first 30 records')
 assert.equal(spring.items.length,30);assert.equal(spring.year,2025);assert.equal(spring.season,'spring')
 assert.ok(spring.items.every(p=>p.year===2025&&p.season==='Mar'&&p.seasonKey==='spring'))
 assert.deepEqual(spring.facets.seasons.map(s=>s.value),['spring','summer','winter'])
 assert.ok(spring.facets.years.includes(2024),'facets keep alternative years, not only the filtered year')
 const springNext=await service.list({subject:'9702',stage:'as',year:2025,season:'spring',page:2});assert.equal(springNext.items.length,20);assert.ok(!springNext.items.some(p=>spring.items.some(q=>q.id===p.id)))
 await assert.rejects(()=>service.list({subject:'9702',year:'2025x'}),e=>e.statusCode===400)
 await assert.rejects(()=>service.list({subject:'9702',season:'../../'}),e=>e.statusCode===400)
 assert.equal((await service.list({subject:'9702',query:'9702_3999_qp'})).total,1)
 const detail=await service.detail({subject:'9702',id:'p-0'});assert.equal(detail.paper.markScheme.id,'ms-0')
 await assert.rejects(()=>service.detail({subject:'9702',id:'withdrawn'}),e=>e.statusCode===404)
 await assert.rejects(()=>service.list({subject:'../9702'}),e=>e.statusCode===400)
 await assert.rejects(()=>service.list({subject:'9702',stage:'as',routeId:'cie-9702-a2-physics'}),e=>e.statusCode===409)
 await assert.rejects(()=>service.list({subject:'9702',routeId:'cie-9709-as-p1-p2'}),e=>e.statusCode===409)
 await assert.rejects(()=>service.list({subject:'9702',pageSize:100000}),e=>e.statusCode===400)
 const changed=JSON.stringify({schemaVersion:2,items:items.slice(0,2)})
 await fs.writeFile(path.join(directory,'9702.json'),changed)
 const refreshed=await service.list({subject:'9702'});assert.equal(refreshed.total,2);assert.notEqual(first.version,refreshed.version)
 const staleProfile={paperNumber:65,stages:['as','a2'],courseRouteIds:['cie-9709-as-p1-p5','cie-9709-a2-after-p1-p5-p3-p6'],code:'9709/65',title:'stale profile'}
 const maths=[['current-p1',2025,'12'],['current-p3',2025,'32'],['current-s2',2025,'65'],['legacy-s1',2010,'61'],['legacy-s2',2010,'71'],['legacy-m2',2010,'51']].map(([id,year,variant])=>({id,subject:'9709',year,variant,kind:'qp',file:`9709_s${String(year).slice(-2)}_qp_${variant}.pdf`,examProfile:staleProfile,governance:{state:'active'}}))
 await fs.writeFile(path.join(directory,'9709.json'),JSON.stringify({schemaVersion:2,items:maths}))
 const a2=await service.list({subject:'9709',stage:'a2',routeId:'cie-9709-a2-after-p1-p5-p3-p6'})
 assert.deepEqual(a2.items.map(p=>p.id).sort(),['current-p3','current-s2','legacy-s2'])
 const as=await service.list({subject:'9709',stage:'as',routeId:'cie-9709-as-p1-p5'})
 assert.deepEqual(as.items.map(p=>p.id).sort(),['current-p1','legacy-s1'])
 assert.equal((await service.detail({subject:'9709',id:'current-s2'})).paper.paperComponent,6,'variant 65 is component 6, not paper 65')
 const archive=await service.detail({subject:'9709',id:'legacy-m2'});assert.equal(archive.paper.routeIds.length,0,'obsolete M2 remains readable, never presented as S1')
 const competition=['R1','R2','春季'].map((season,i)=>({id:'bpho-'+i,subject:'bpho',year:2025,season,kind:'qp',file:'bpho-'+i+'.pdf',examProfile:{stages:['competition']},governance:{state:'active'}}))
 await fs.writeFile(path.join(directory,'bpho.json'),JSON.stringify({schemaVersion:2,items:competition}))
 const rounds=await service.list({subject:'bpho',stage:'competition'})
 assert.ok(rounds.facets.seasons.some(f=>f.value==='r1'&&f.label==='R1'))
 assert.ok(!rounds.facets.seasons.some(f=>f.value==='spring'),'competition rounds never acquire Cambridge season meaning')
 const alternate=rounds.facets.seasons.find(f=>f.label==='春季');assert.match(alternate.value,/^round-/)
 assert.equal((await service.list({subject:'bpho',season:alternate.value})).total,1,'every advertised round remains filterable')
 const further=[['legacy-further',2019,'21'],['current-further',2025,'21']].map(([id,year,variant])=>({id,subject:'9231',year,variant,kind:'qp',file:`9231_s${String(year).slice(-2)}_qp_${variant}.pdf`,localUrl:`/local-pdf/9231/9231_s${String(year).slice(-2)}_qp_${variant}.pdf`,examProfile:{title:'Incorrect current-paper fallback'},governance:{state:'active'}}))
 await fs.writeFile(path.join(directory,'9231.json'),JSON.stringify({schemaVersion:2,items:further}))
 const furtherArchive=await service.list({subject:'9231'});assert.equal(furtherArchive.total,2,'preserve the original historical archive')
 const legacyFurther=furtherArchive.items.find(p=>p.id==='legacy-further');assert.equal(legacyFurther.courseComponent,null);assert.equal(legacyFurther.routeIds.length,0);assert.doesNotMatch(legacyFurther.title,/Pure Mathematics 2/)
 assert.equal((await service.list({subject:'9231',stage:'a2',routeId:'cie-9231-a2-after-p1-p3-p2-p4'})).items.some(p=>p.id==='legacy-further'),false)
 const handler=createStemApi({env:{STEM_DB_PATH:':memory:'},paperCatalogDirectory:directory})
 const server=http.createServer((req,res)=>handler(req,res,()=>{res.statusCode=404;res.end()}))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/stem/paper-catalog?subject=9702&page=1');const body=await response.json();assert.equal(response.status,200);assert.equal(body.total,2);assert.equal(body.schemaVersion,'native-paper-catalog-v1')}
 finally{await new Promise(resolve=>server.close(resolve));closeStemDatabaseForTests()}
 console.log(JSON.stringify({status:'pass',records:4000,pageItems:first.items.length,pageBytes:Buffer.byteLength(JSON.stringify(first)),scope:'native paper catalog pagination, source projection, route binding, invalidation'}))
}finally{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('stem-native-catalog-'));await fs.rm(directory,{recursive:true,force:true})}
