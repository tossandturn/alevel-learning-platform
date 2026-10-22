import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
assert.ok(fs.existsSync(new URL('../server/universityProfiles.js',import.meta.url)),'University profiles need a separate validated public-data contract')
const {validateUniversityProfile,validateUniversityProfileIndex,validateUniversityLogo}=await import('../server/universityProfiles.js')
const profile=()=>({schemaVersion:'stemist-university-profile-v1',id:'fixture-university',kind:'verified-overview',updatedOn:'2026-10-22',scope:'International undergraduate overview',summary:'Official undergraduate overview',sections:[{label:'Academic','text':'Requirements vary by course.',sourceIds:['entry']}],sources:[{id:'entry',title:'Official admissions',url:'https://www.fixture.edu/admissions/'}],notice:'Check the selected course and intake; meeting conditions does not guarantee admission.'})
assert.equal(validateUniversityProfile(profile()),true)
for(const mutate of[p=>p.kind='guaranteed-offer',p=>p.updatedOn='2026-02-30',p=>p.sections[0].sourceIds=[],p=>p.sections[0].sourceIds=['missing'],p=>p.sources[0].url='http://localhost/',p=>p.sections[0].text='x'.repeat(801),p=>p.sources.push(p.sources[0])]){const p=profile();mutate(p);assert.throws(()=>validateUniversityProfile(p))}
const preparation=profile();preparation.kind='preparation-guide';preparation.sections[0].sourceIds=[];assert.equal(validateUniversityProfile(preparation),true,'Original checklist must be distinguishable from school-verified requirements')
const digest='a'.repeat(64),entry={id:'fixture-university',aliases:['fixture-university','fixture-campus-alias'],profilePath:'/data/university-profiles/v1/profiles/fixture-university-'+digest.slice(0,16)+'.json',profileSha256:digest,kind:'verified-overview',summary:'Official overview',logo:{path:'/data/university-profiles/v1/logos/fixture-university-'+digest.slice(0,16)+'.png',sha256:digest,bytes:128}};
const index=()=>({schemaVersion:'stemist-university-profile-index-v1',updatedAt:'2026-10-22T12:00:00Z',revision:'20261022-v1',items:[structuredClone(entry)]});
assert.equal(validateUniversityProfileIndex(index()),true)
for(const mutate of[x=>x.items[0].profilePath='/private.json',x=>x.items[0].logo.path='https://untrusted.example/image.png',x=>x.items[0].logo.bytes=9999999,x=>x.items.push(x.items[0]),x=>x.items[0].aliases.push('__proto__'),x=>x.items[0].profileSha256='bad',x=>x.items[0].logo.path=x.items[0].logo.path.replace('.png','.html')]){const v=index();mutate(v);assert.throws(()=>validateUniversityProfileIndex(v))}
const logo=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0H10V10Z" fill="#543"/></svg>');
assert.equal(validateUniversityLogo(logo,'svg'),true)
for(const svg of['<svg><script>1</script></svg>','<svg onload="alert(1)"></svg>','<svg><image href="https://remote.edu/pixel"/></svg>','<svg><foreignObject/></svg>','<svg><style>@import url(https://remote.edu)</style></svg>','<html><body><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H10"/></svg></body></html>'])assert.throws(()=>validateUniversityLogo(Buffer.from(svg),'svg'))
assert.throws(()=>validateUniversityLogo(Buffer.from('<html>challenge</html>'),'png'))
console.log('University enrichment: separate safe index, sourced profile claims, honest preparation fallback, bounded logos and SVG safety PASS')
