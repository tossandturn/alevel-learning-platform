import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {createStemApi,closeStemDatabaseForTests} from '../server/stemApi.js'
import {createNativePaperCatalog} from '../server/nativePaperCatalog.js'
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'stem-native-catalog-'))
const profile={code:'9702/2',title:'Structured Questions',stages:['as'],courseRouteIds:['cie-9702-as-physics']}
const items=Array.from({length:4000},(_,i)=>({id:'p-'+i,subject:'9702',year:2025-Math.floor(i/300),season:'May',kind:'qp',file:'9702_'+i+'_qp.pdf',pairKey:'pair-'+i,markSchemeId:i===0?'ms-0':'',localUrl:'/local-pdf/9702/9702_'+i+'_qp.pdf',examProfile:i%2?{...profile,code:'9702/4',stages:['a2'],courseRouteIds:['cie-9702-a2-physics']}:profile,governance:{state:'active'},answer:'never in catalog',oversizedMetadata:'x'.repeat(80)}))
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
 const handler=createStemApi({env:{STEM_DB_PATH:':memory:'},paperCatalogDirectory:directory})
 const server=http.createServer((req,res)=>handler(req,res,()=>{res.statusCode=404;res.end()}))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/stem/paper-catalog?subject=9702&page=1');const body=await response.json();assert.equal(response.status,200);assert.equal(body.total,2);assert.equal(body.schemaVersion,'native-paper-catalog-v1')}
 finally{await new Promise(resolve=>server.close(resolve));closeStemDatabaseForTests()}
 console.log(JSON.stringify({status:'pass',records:4000,pageItems:first.items.length,pageBytes:Buffer.byteLength(JSON.stringify(first)),scope:'native paper catalog pagination, source projection, route binding, invalidation'}))
}finally{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('stem-native-catalog-'));await fs.rm(directory,{recursive:true,force:true})}
