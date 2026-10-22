import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {validateUniversityProfile,validateUniversityProfileIndex,validateUniversityLogo,UNIVERSITY_PROFILE_PREFIX as PREFIX} from '../server/universityProfiles.js'
const root=path.resolve(import.meta.dirname,'..'),args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?'':args[i+1]},sourcePath=path.resolve(value('--source')||path.join(root,'server/catalogs/university-profiles-source.json')),outValue=value('--out')
if(!outValue)throw Error('Provide --out with a new review/artifact folder. This builder never deploys.')
const out=path.resolve(outValue);if(fs.existsSync(out))throw Error('Existing output is preserved; choose a new folder')
const source=JSON.parse(fs.readFileSync(sourcePath,'utf8'));if(source.schemaVersion!=='stemist-university-profile-source-v1'||!Array.isArray(source.items))throw Error('Invalid reviewed source')
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),files=[],index={schemaVersion:'stemist-university-profile-index-v1',updatedAt:source.updatedAt,revision:source.revision,items:[]},provenance={schemaVersion:'stemist-university-profile-provenance-v1',updatedAt:source.updatedAt,items:[]}
for(const row of source.items){
 validateUniversityProfile(row.profile);if(row.profile.id!==row.id)throw Error('Institution/profile identity mismatch');const b=Buffer.from(JSON.stringify(row.profile)+'\n'),digest=hash(b),profilePath='profiles/'+row.id+'-'+digest.slice(0,16)+'.json';files.push({path:profilePath,bytes:b});let logo=null
 if(row.logo){if(path.basename(row.logo.file)!==row.logo.file)throw Error('Invalid logo basename');const file=path.join(root,'public/data/university-profiles/v1/logos',row.logo.file),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Logo source must be a physical file');const bytes=fs.readFileSync(file);if(hash(bytes)!==row.logo.sha256||bytes.length!==row.logo.bytes)throw Error('Logo source integrity mismatch');validateUniversityLogo(bytes,path.extname(file).slice(1));logo={path:PREFIX+'logos/'+row.logo.file,sha256:row.logo.sha256,bytes:bytes.length,tone:row.logo.tone||'light'};files.push({path:'logos/'+row.logo.file,bytes})}
 index.items.push({id:row.id,aliases:row.aliases,profilePath:PREFIX+profilePath,profileSha256:digest,kind:row.profile.kind,summary:row.profile.summary,logo});provenance.items.push(row.provenance)
}
validateUniversityProfileIndex(index)
const directory=JSON.parse(fs.readFileSync(path.join(root,'public/data/university-directory.json'),'utf8')),wanted=new Set(directory.rankings.flatMap(r=>r.items.map(i=>i.id))),got=new Set(index.items.flatMap(i=>i.aliases));if(wanted.size!==got.size||[...wanted].some(id=>!got.has(id)))throw Error('The reviewed source does not cover the current ranking identities')
files.push({path:'index.json',bytes:Buffer.from(JSON.stringify(index)+'\n')},{path:'provenance.json',bytes:Buffer.from(JSON.stringify(provenance,null,2)+'\n')});fs.mkdirSync(out,{recursive:true});for(const file of files){const target=path.join(out,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file.bytes,{flag:'wx'})}
console.log(JSON.stringify({status:'PASS_LOCAL_BUILD',out,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes.length,0),institutions:index.items.length,logos:index.items.filter(x=>x.logo).length,verifiedOverviews:index.items.filter(x=>x.kind==='verified-overview').length}))
