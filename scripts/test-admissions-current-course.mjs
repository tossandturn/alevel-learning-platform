import assert from 'node:assert/strict'
import { admissionsInstitutions, planAdmissionsResearch } from '../server/admissionsResearchContext.js'
import { assessAdmissionsPage } from '../server/admissionsResearchEvidence.js'
import { createAdmissionsResearch } from '../server/admissionsResearch.js'

const institutions = admissionsInstitutions([{ title: 'Imperial undergraduate courses', url: 'https://www.imperial.ac.uk/study/courses/' }], () => 'imperial.ac.uk')
const fallbackInstitutions = admissionsInstitutions([], hostname => hostname)
const fallbackImperial = planAdmissionsResearch({ message: '请查询帝国理工学院机械工程本科2027年入学A-Level要求。', institutions: fallbackInstitutions })
assert.deepEqual(fallbackImperial.missing, [], 'reviewed built-in institutions must survive an absent catalog')
assert.equal(fallbackImperial.school.domain, 'imperial.ac.uk')
assert.match(fallbackImperial.query, /Imperial College London Mechanical Engineering 2027 undergraduate entry requirements A-Level site:imperial\.ac\.uk/)
let emptyCatalogQuery = ''
const emptyCatalogResearch = createAdmissionsResearch({
  sourceCatalog: [],
  searchPublicSources: async ({ query }) => {
    emptyCatalogQuery = query
    return [{ title: 'Mechanical Engineering MEng', url: 'https://www.imperial.ac.uk/study/courses/undergraduate/mechanical-engineering/' }]
  },
  readPublicPage: async url => ({ url, title: 'Mechanical Engineering MEng | Imperial College London', text: '# Mechanical Engineering\n2027 entry\nA-level offer: A*A*A including Mathematics and Physics.' }),
  resolveAddresses: async () => [{ address: '8.8.8.8', family: 4 }],
})
const emptyCatalogResult = await emptyCatalogResearch.prepareTurn({ message: '请查询帝国理工学院机械工程本科2027年入学A-Level要求。' })
assert.equal(emptyCatalogResult.publicFields.research.status, 'complete')
assert.equal(emptyCatalogResult.publicFields.research.sourceCount, 1)
assert.match(emptyCatalogQuery, /site:imperial\.ac\.uk/)
const fallbackMit = planAdmissionsResearch({ message: '请查询MIT国际本科一般申请要求和AP要求。', institutions: fallbackInstitutions })
assert.deepEqual(fallbackMit.missing, [])
assert.equal(fallbackMit.school.domain, 'mitadmissions.org')
assert.match(fallbackMit.query, /MIT undergraduate entry requirements AP site:mitadmissions\.org/)
let emptyMitQuery = ''
const emptyMitResearch = createAdmissionsResearch({
  sourceCatalog: [],
  searchPublicSources: async ({ query }) => {
    emptyMitQuery = query
    return [{ title: 'Tests & scores', url: 'https://mitadmissions.org/apply/firstyear/tests-scores/' }]
  },
  readPublicPage: async url => ({ url, title: 'Tests & scores | MIT Admissions', text: '# Tests & scores\nFirst-year applicants must submit SAT or ACT results.\nApplicants should self-report Advanced Placement examinations taken or planned.' }),
  resolveAddresses: async () => [{ address: '8.8.8.8', family: 4 }],
})
const emptyMitResult = await emptyMitResearch.prepareTurn({ message: '请查询MIT国际本科一般申请要求和AP要求。' })
assert.equal(emptyMitResult.publicFields.research.status, 'partial')
assert.equal(emptyMitResult.publicFields.research.sourceCount, 1)
assert.equal(emptyMitResult.publicFields.research.sources[0].verification.kind, 'institution-requirements')
assert.match(emptyMitQuery, /site:mitadmissions\.org/)
const current = planAdmissionsResearch({ message: '几个A*？', history: [{ role: 'user', content: 'IC机械工程' }], institutions })
assert.equal(current.requested, true)
assert.deepEqual(current.missing, [], 'a target entry year is optional and must not cause a clarification loop')
assert.match(current.query, /Imperial College London Mechanical Engineering/)
assert.equal(current.year, '')
assert.doesNotMatch(current.query, /20\d\d/)

const philosophy = planAdmissionsResearch({ message: 'Imperial, 专业: Philosophy; entry requirements?', institutions })
assert.equal(philosophy.course?.name, 'Philosophy')
assert.deepEqual(philosophy.missing, [])
const materials = planAdmissionsResearch({ message: '材料科学呢？', history: [{ role: 'user', content: 'IC机械工程' }], institutions })
assert.equal(materials.course?.name, 'Materials Science')
assert.deepEqual(materials.missing, [])
const unfamiliar = planAdmissionsResearch({ message: '课程: Interdisciplinary Arts and Sciences; requirements?', history: [{ role: 'user', content: 'Imperial' }], institutions })
assert.equal(unfamiliar.course?.name, 'Interdisciplinary Arts and Sciences')
assert.doesNotMatch(unfamiliar.query, /课程:|requirements\?/)
const direct = planAdmissionsResearch({ message: 'Read https://www.imperial.ac.uk/study/courses/undergraduate/biomaterials-and-tissue-engineering/', institutions })
assert.deepEqual(direct.missing, [], 'a bounded course slug from an approved public URL supplies course scope')
assert.match(direct.course.name, /biomaterials and tissue engineering/i)
const codedUrl = planAdmissionsResearch({ message: 'Read https://www.imperial.ac.uk/study/courses/H301/', institutions })
assert.deepEqual(codedUrl.missing, [], 'an official course identifier URL can be resolved from the fetched page title')
const privacy = planAdmissionsResearch({ message: 'IC，专业: Materials Science; 姓名: Alice; alice@example.com; PRIVATE_ESSAY. 核实入学条件。', institutions })
assert.doesNotMatch(privacy.query, /Alice|example|PRIVATE|ESSAY|姓名/)

const nav = Array.from({ length: 12 }, (_, index) => `Entry requirements navigation item ${index + 1}`).join('\n')
const page = {
  title: 'Mechanical Engineering MEng - Imperial',
  text: `# Mechanical Engineering\n2027 entry\n${nav}\n## A levels\n### Standard offer\nA*A*A\nA* in Mathematics\nA* in Physics\nA in a third subject\n## English language\nIELTS 6.5 overall, with at least 6.0 in every component.`,
}
const evidence = assessAdmissionsPage(page, current)
assert.equal(evidence.rejection, null)
assert.match(evidence.evidence, /A\*A\*A/)
assert.match(evidence.evidence, /Mathematics/)
assert.match(evidence.evidence, /Physics/)
assert.match(evidence.evidence, /6\.5/)
assert.match(evidence.sourceExcerpt, /A\*A\*A/)
assert.doesNotMatch(evidence.sourceExcerpt, /Page heading:|Actual application programme:/)
assert.deepEqual(evidence.applicableYears, ['2027'])
assert.equal(evidence.verification.requestedYear, null)
assert.equal(evidence.verification.yearStatus, 'target_not_specified')
assert.equal(evidence.verification.substantiveRequirements, true)
const headingsOnly = assessAdmissionsPage({ title: page.title, text: `# Mechanical Engineering\n2027 entry\n${nav}` }, current)
assert.equal(headingsOnly.rejection, 'no_substantive_requirements', 'a requirements heading alone is not threshold evidence')
const codedEvidence = assessAdmissionsPage(page, codedUrl)
assert.equal(codedEvidence.rejection, null)
assert.match(codedEvidence.verification.courseName, /Mechanical Engineering/)
const longIntro = assessAdmissionsPage({ ...page, text: `# Mechanical Engineering\n2027 entry ${'Public programme overview. '.repeat(1000)}\n## Entry requirements\nA*A*A including A* in Mathematics and Physics.` }, current)
assert.match(longIntro.evidence, /A\*A\*A/)
assert.match(longIntro.evidence, /Mathematics and Physics/)
console.log('Admissions current course: optional target year, open course fields/URLs, private-query exclusion and numeric/subject evidence before navigation passed.')
