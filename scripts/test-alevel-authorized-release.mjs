import fs from 'node:fs'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
const c=JSON.parse(fs.readFileSync(new URL('../server/catalogs/alevel-extra-papers.json',import.meta.url),'utf8'))
assert.equal(c.authorization?.basis,'owner-confirmed-redistribution','explicit user authorization must be recorded for this frozen batch')
assert.equal(c.authorization.confirmedOn,'2026-11-05')
const files=c.papers.flatMap(p=>[p.questionPaper,p.markScheme].filter(Boolean))
assert.equal(files.length,1746)
assert.ok(files.every(f=>f.rightsStatus==='licensed'&&f.integrityStatus==='verified'))
assert.ok(c.papers.every(p=>p.practiceReady===false),'PDF permission does not authorize publishing unreviewed extracted exercises')
assert.equal(c.papers.filter(p=>p.pairStatus==='candidate').length,168,'uncertain answer links must remain labelled')
const hash=crypto.createHash('sha256').update(JSON.stringify(files.map(f=>[f.id,f.sha256]).sort((a,b)=>a[0].localeCompare(b[0],'en')))).digest('hex')
assert.equal(hash,c.authorization.fileSetSha256,'grant only covers the reviewed file identities and bytes')
console.log('PASS: user-authorized 1746-file batch, unchanged hashes, preserved pair warnings and practice quarantine')
