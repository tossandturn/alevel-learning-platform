import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createCurriculumPaperCatalog} from '../server/curriculumPaperCatalog.js'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'extra-board-')),main=path.join(root,'base.json'),extra=path.join(root,'extra.json')
const base={schemaVersion:'curriculum-paper-source-v1',courses:[{id:'ap-physics',board:'ap',label:'AP Physics',subject:'Physics'}],papers:[]}
const file={id:'oxfordaqa-qp-2025-u1',name:'25_06_QP_U1.pdf',bytes:100,pages:32,sha256:'a'.repeat(64),relativePath:'oxfordaqa/physics/current/25_06_QP_U1.pdf',sourceUrl:'https://aqaphy.alevelclouds.com/25_06_QP_U1.pdf',rightsStatus:'unverified',integrityStatus:'verified'}
const additions={schemaVersion:base.schemaVersion,courses:[{id:'oxfordaqa-ial-physics',board:'oxfordaqa',label:'OxfordAQA 9630',subject:'Physics'}],papers:[{id:'oxfordaqa-2025-u1',board:'oxfordaqa',course:'oxfordaqa-ial-physics',courseLabel:'OxfordAQA 9630',subject:'Physics',level:'International AS',year:2025,session:'June',paper:'U1',variant:'',title:'2025 June U1',section:'Mechanics, materials and atoms',fullExam:true,practiceReady:false,pairStatus:'missing',questionPaper:file,markScheme:null}]}
try{
 await fs.writeFile(main,JSON.stringify(base));await fs.writeFile(extra,JSON.stringify(additions))
 const api=createCurriculumPaperCatalog({manifestPath:main,extraManifestPath:extra,alevelAssetRoot:root})
 const result=await api.list({board:'oxfordaqa'});assert.equal(result.total,1);assert.equal(result.items[0].availability,'source-only');assert.equal(result.items[0].questionPaper.downloadUrl,null);assert.equal(result.items[0].questionPaper.sourceUrl,file.sourceUrl)
 assert.equal((await api.list({board:'ap'})).total,0)
 await fs.writeFile(extra,'invalid');assert.equal((await api.list({board:'ap'})).total,0,'broken new board manifest must not break AP/IB')
 await assert.rejects(()=>api.list({board:'oxfordaqa'}),e=>e.statusCode===503)
 console.log('PASS independent extra board catalog, source provenance, rights gate and AP/IB failure isolation')
}finally{await fs.rm(root,{recursive:true,force:true})}
