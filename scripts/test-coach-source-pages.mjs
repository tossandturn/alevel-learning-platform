import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import {createCoachSourcePageProvider,sourcePageRows,COACH_SOURCE_PAGE_SCHEMA} from '../server/coachSourcePages.js'
import {createCoachQuestionSourceResolver,appendCoachQuestionSource} from '../server/coachQuestionSource.js'
import {sourceTokens,verifySourcePassage} from '../server/coachSourceText.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'coach-source-pages-')),libraryRoot=path.join(root,'library','pdf'),indexPath=path.join(root,'coach-source-index','current.json.gz')
const text='A cyclist moves on a straight level road with an initial velocity of 12 m s-1. The total mass of the bicycle and cyclist is 75 kg. A constant braking force acts for 4 seconds. Calculate the acceleration and the work done against this force.'
const bytes=Buffer.from('%PDF-synthetic-test-only'),hash=crypto.createHash('sha256').update(bytes).digest('hex')
const doc={paperFile:'9702_s24_qp_21.pdf',paperId:'cie-9702-9702_s24_qp_21',subjectCode:'9702',year:2024,documentSha256:hash,pages:[{page:4,text}]}
const fixture={schemaVersion:COACH_SOURCE_PAGE_SCHEMA,documents:[doc]}
try{
 fs.mkdirSync(path.join(libraryRoot,'9702'),{recursive:true});fs.mkdirSync(path.dirname(indexPath),{recursive:true});fs.writeFileSync(path.join(libraryRoot,'9702',doc.paperFile),bytes);fs.writeFileSync(indexPath,zlib.gzipSync(JSON.stringify(fixture)))
 const provider=createCoachSourcePageProvider({libraryRoot,indexPath}),rows=provider.rows();assert.equal(rows.length,1);assert.equal(provider.rows(),rows,'unchanged page index must not rebuild')
 const resolver=createCoachQuestionSourceResolver({sourcePageProvider:provider}),result=resolver.resolve({hasImages:true,lookupText:text.replace('constant','constart')})
 assert.equal(result.status,'paper-matched');assert.equal(result.page,4);assert.equal(result.questionNumber,null)
 assert.match(appendCoachQuestionSource('教学答案',result),/题号尚未核实/);assert.doesNotMatch(appendCoachQuestionSource('教学答案',result),/第 4 题/)
 assert.equal(resolver.resolve({hasImages:true,lookupText:text.replace('75 kg','85 kg')}).status,'unconfirmed')
 fs.writeFileSync(path.join(libraryRoot,'9702',doc.paperFile),'modified-original-pdf')
 assert.equal(resolver.resolve({hasImages:true,lookupText:text}).status,'unconfirmed','A source changed on disk must invalidate the result')
 const corrupt=structuredClone(fixture);corrupt.documents[0].year=2099;assert.throws(()=>sourcePageRows(corrupt))
 const traversal=structuredClone(fixture);traversal.documents[0].paperFile='../../9702_s24_qp_21.pdf';assert.throws(()=>sourcePageRows(traversal))
 const duplicate=structuredClone(fixture);duplicate.documents[0].pages.push(duplicate.documents[0].pages[0]);assert.throws(()=>sourcePageRows(duplicate))
 fs.writeFileSync(indexPath,'not gzip');assert.deepEqual(provider.rows(),[]);assert.equal(provider.status(),'unavailable')
 assert.equal(verifySourcePassage(sourceTokens(text.replace('75 kg','- 75 kg')),sourceTokens(text)),null,'Changing the sign of a numerical given cannot match')
 assert.equal(verifySourcePassage(sourceTokens(text.replace('this force.','this momentum.')),sourceTokens(text)),null,'Do not discard arbitrary changed trailing words')
 console.log('Source pages: private index, page-not-question, original checksum, cache invalidation, corruption, bounds and numeric/word negatives PASS')
}finally{fs.rmSync(root,{recursive:true,force:true})}
