import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {validateUniversityProfile,validateUniversityProfileIndex,validateUniversityLogo,UNIVERSITY_PROFILE_PREFIX as PREFIX} from '../server/universityProfiles.js'
const root=path.resolve(import.meta.dirname,'../public/data/university-profiles/v1'),hash=b=>crypto.createHash('sha256').update(b).digest('hex')
assert.ok(fs.existsSync(path.join(root,'index.json')),'Reviewed enrichment data must be present before release')
const index=JSON.parse(fs.readFileSync(path.join(root,'index.json'),'utf8')),ranking=JSON.parse(fs.readFileSync(new URL('../public/data/university-directory.json',import.meta.url),'utf8'))
validateUniversityProfileIndex(index)
const wanted=new Set(ranking.rankings.flatMap(r=>r.items.map(x=>x.id))),got=new Set(index.items.flatMap(x=>x.aliases))
assert.deepEqual(got,wanted,'Every ranking identity must resolve exactly once without merging distinct campuses')
let logos=0,verified=0,programmes=0;const expected=new Set(['index.json','provenance.json'])
for(const entry of index.items){
 const relative=entry.profilePath.slice(PREFIX.length),file=path.join(root,relative),bytes=fs.readFileSync(file);expected.add(relative);assert.equal(hash(bytes),entry.profileSha256);const profile=JSON.parse(bytes);validateUniversityProfile(profile);assert.equal(profile.id,entry.id);assert.equal(profile.kind,entry.kind);if(profile.kind==='verified-overview')verified++;if(profile.sources.some(x=>x.id==='programmes'))programmes++
 if(entry.logo){const relative=entry.logo.path.slice(PREFIX.length),file=path.join(root,relative),bytes=fs.readFileSync(file);assert.equal(fs.lstatSync(file).isSymbolicLink(),false);assert.equal(hash(bytes),entry.logo.sha256);assert.equal(bytes.length,entry.logo.bytes);validateUniversityLogo(bytes,path.extname(file).slice(1));expected.add(relative);logos++}
}
const retention=JSON.parse(fs.readFileSync(new URL('../server/catalogs/university-profile-retention.json',import.meta.url),'utf8'));assert.equal(retention.schemaVersion,'university-profile-retention-v1');assert(Array.isArray(retention.items));const retainedPaths=new Set()
for(const item of retention.items){assert(/^profiles\/[a-z0-9-]+-[a-f0-9]{16}\.json$/.test(item.path));assert(!retainedPaths.has(item.path));retainedPaths.add(item.path);const file=path.join(root,item.path);assert(!fs.lstatSync(file).isSymbolicLink());const bytes=fs.readFileSync(file);assert.equal(hash(bytes),item.sha256);const profile=JSON.parse(bytes);validateUniversityProfile(profile);assert.equal(item.path,'profiles/'+profile.id+'-'+item.sha256.slice(0,16)+'.json');expected.add(item.path)}
const walk=(dir,prefix='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(dir,x.name),prefix+x.name+'/'):[prefix+x.name]);assert.deepEqual(new Set(walk(root)),expected,'Only active assets and explicitly pinned previously reviewed profiles may enter the release')
assert.equal(index.items.length,184);assert.ok(verified>=38);assert.ok(logos>=168);assert.ok(programmes>=145)
console.log(JSON.stringify({status:'PASS',institutions:index.items.length,rankingRows:ranking.rankings.reduce((n,x)=>n+x.items.length,0),logos,verifiedOverviews:verified,preparationGuides:index.items.length-verified,programmeLinks:programmes,files:expected.size}))
