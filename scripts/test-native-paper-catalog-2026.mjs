import assert from 'node:assert/strict'
import {createNativePaperCatalog} from '../server/nativePaperCatalog.js'

const api=createNativePaperCatalog()
const subjects=['0580','0606','0610','0625','9231','9700','9701','9702','9708','9709']
// Derive the exact approved paper set from the source increment, not fixture totals.
const source=await import('node:fs/promises')
const delta=JSON.parse(await source.readFile(new URL('../src/data/paperSourceIncrement2026.json',import.meta.url),'utf8'))
const results=[]
for(const subject of subjects){
 const originals=delta.items.filter(item=>item.subject===subject&&item.kind==='qp')
 const page=await api.list({subject,stage:'all',year:2026,pageSize:30})
 assert.equal(page.total,originals.length,`${subject}: all approved 2026 question papers must be discoverable`)
 assert.equal(page.pairedTotal,originals.length,`${subject}: each 2026 QP must have its exact MS`)
 assert.equal(page.facets.years[0],2026)
 const projected=[]
 for(let number=1;number<=page.pageCount;number++)projected.push(...(await api.list({subject,stage:'all',year:2026,page:number,pageSize:30})).items)
 assert.deepEqual(projected.map(item=>item.id).sort(),originals.map(item=>`cie-${item.subject}-${item.file.slice(0,-4)}`).sort())
 assert.ok(projected.every(item=>item.year===2026&&item.markScheme&&['spring','summer'].includes(item.seasonKey)&&item.localUrl.endsWith(item.file)))
 for(const component of page.facets.paperComponents){const filtered=await api.list({subject,stage:'all',year:2026,component:component.value});assert.ok(filtered.total>0&&filtered.items.every(item=>String(item.paperComponent)===component.value))}
 results.push({subject,papers:page.total,paired:page.pairedTotal})
}
assert.equal(results.reduce((sum,row)=>sum+row.papers,0),217)
console.log(JSON.stringify({status:'PASS',year:2026,subjects:results,questionPapers:217,pairedMarkSchemes:217,automaticMarkingPromoted:false}))
