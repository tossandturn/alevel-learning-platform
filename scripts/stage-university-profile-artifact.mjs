// Local source-tree staging only. Immutable additions are validated before index promotion.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {validateUniversityProfile,validateUniversityProfileIndex,validateUniversityLogo,UNIVERSITY_PROFILE_PREFIX as PREFIX} from '../server/universityProfiles.js'
const artifact=path.resolve(process.argv[2]||''),root=path.resolve(import.meta.dirname,'..'),target=path.join(root,'public/data/university-profiles/v1'),retainedFile=path.join(root,'server/catalogs/university-profile-retention.json'),hash=b=>crypto.createHash('sha256').update(b).digest('hex')
assert(process.argv[2]&&artifact!==target,'Provide a separately built review artifact')
const read=(dir,name)=>{const file=path.join(dir,name);assert(!fs.lstatSync(file).isSymbolicLink());return fs.readFileSync(file)}
const current=JSON.parse(read(target,'index.json')),next=JSON.parse(read(artifact,'index.json'));validateUniversityProfileIndex(current);validateUniversityProfileIndex(next)
const retained=fs.existsSync(retainedFile)?JSON.parse(fs.readFileSync(retainedFile,'utf8')):{schemaVersion:'university-profile-retention-v1',items:[]},files=[]
for(const entry of next.items){
 const name=entry.profilePath.slice(PREFIX.length),bytes=read(artifact,name);assert.equal(hash(bytes),entry.profileSha256);validateUniversityProfile(JSON.parse(bytes));files.push({name,bytes})
 if(entry.logo){const name=entry.logo.path.slice(PREFIX.length),bytes=read(artifact,name);assert.equal(hash(bytes),entry.logo.sha256);validateUniversityLogo(bytes,path.extname(name).slice(1));files.push({name,bytes})}
}
for(const entry of current.items){const name=entry.profilePath.slice(PREFIX.length),bytes=read(target,name);assert.equal(hash(bytes),entry.profileSha256);if(!retained.items.some(x=>x.path===name))retained.items.push({path:name,sha256:entry.profileSha256})}
for(const file of files)if(fs.existsSync(path.join(target,file.name)))assert.equal(hash(read(target,file.name)),hash(file.bytes),'Immutable asset collision')
const provenance=read(artifact,'provenance.json');assert.equal(JSON.parse(provenance).schemaVersion,'stemist-university-profile-provenance-v1')
for(const file of files){const dest=path.join(target,file.name);if(!fs.existsSync(dest))fs.writeFileSync(dest,file.bytes,{flag:'wx'})}
fs.writeFileSync(retainedFile,JSON.stringify(retained,null,2)+'\n')
fs.writeFileSync(path.join(target,'provenance.json'),provenance)
fs.writeFileSync(path.join(target,'index.json'),read(artifact,'index.json'))
console.log(JSON.stringify({status:'STAGED_LOCAL_ONLY',active:next.items.length,retained:retained.items.length,revision:next.revision}))
