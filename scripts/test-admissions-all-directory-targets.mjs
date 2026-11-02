import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createAdmissionsResearch } from '../server/admissionsResearch.js'

const directory=JSON.parse(fs.readFileSync(new URL('../public/data/university-directory.json',import.meta.url),'utf8'))
const schools=[...new Map(directory.rankings.flatMap(ranking=>ranking.items.map(item=>[item.id,item]))).values()]
let searches=0
const research=createAdmissionsResearch({searchPublicSources:async()=>{searches++;return[]}})
for(const school of schools){
 const target=research.normalizeDirectoryTarget({kind:'university',id:school.id})
 const message=`我想了解 ${school.nameZh}（${school.nameEn}）的国际本科申请。\n学校官网：${school.website}\n首轮请简短确认这所学校，只询问我的申请年份、课程体系和目标专业这三项，等我回复再展开。排名不是录取线。`
 const result=await research.prepareTurn({message,directoryTarget:target})
 assert.equal(result.guardedAnswer,'',school.id)
 assert.equal(result.publicFields.research.status,'needs_clarification',school.id)
 assert.equal(result.publicFields.research.scope.kind,'university',school.id)
 const host=new URL(school.website).hostname.replace(/^www\./,''),domain=result.publicFields.research.scope.institutionDomain
 assert.ok(host===domain||host.endsWith('.'+domain),school.id+': '+domain+' is not the selected official host')
}
assert.equal(searches,0)
for(const school of schools){
 const result=await research.prepareTurn({message:'请查本科申请要求。',directoryTarget:{kind:'university',id:school.id},history:[{role:'user',content:'我想了解 Cambridge International A-Level 课程体系。'}]})
 const host=new URL(school.website).hostname.replace(/^www\./,''),domain=result.publicFields.research.scope.institutionDomain
 assert.ok(host===domain||host.endsWith('.'+domain),school.id+': typed identity was lost to old curriculum or shared-source metadata')
}
console.log(`PASS all published directory targets: ${schools.length} university identities, canonical domains, typed intake and zero premature searches`)
