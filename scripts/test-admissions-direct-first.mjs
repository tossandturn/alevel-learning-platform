import assert from 'node:assert/strict'
import { createAdmissionsResearch, extractAdmissionsPageText } from '../server/admissionsResearch.js'
import { assessAdmissionsPage } from '../server/admissionsResearchEvidence.js'

const url = 'https://www.imperial.ac.uk/study/courses/undergraduate/mechanical-engineering/'
const message = '请查询帝国理工学院机械工程本科2027年入学A-Level要求。'
const searchPublicSources = async () => [{ title: 'Mechanical Engineering MEng', url }]
const addresses = async () => [{ address: '8.8.8.8', family: 4 }]
const verifiedWithoutYear = { url, title: 'Mechanical Engineering MEng | Imperial College London', text: '# Mechanical Engineering\n## Minimum entry standard\nA*A*A or A*AAA including Mathematics and Physics.' }
const verified2027 = { ...verifiedWithoutYear, text: '# Mechanical Engineering\n2027 entry\n## Minimum entry standard\nA*A*A including Mathematics and Physics.' }

let directCalls = 0
let fetchCalls = 0
let directDeadline
let fetchDeadline
const directFirst = createAdmissionsResearch({
  sourceCatalog: [], searchPublicSources, resolveAddresses: addresses,
  readPublicPage: async (_url, options) => { directCalls += 1; directDeadline = options.deadlineAt; return verifiedWithoutYear },
  fetchReadPublicPage: async () => { fetchCalls += 1; return verified2027 },
})
const directResult = await directFirst.prepareTurn({ message, deadlineAt: Date.now() + 50_000 })
assert.equal(directCalls, 1)
assert.equal(fetchCalls, 0, 'body-verified direct HTML skips official Fetch')
assert.equal(directResult.publicFields.research.status, 'partial', 'missing target year remains explicit')
assert.equal(directResult.publicFields.research.sources[0].verification.transport, 'direct-pinned-html')
assert.equal(directResult.publicFields.research.sources[0].verification.gradeEvidence, true)
assert.equal(directResult.publicFields.research.sources[0].verification.subjectConditionEvidence, true)
assert.equal(directResult.publicFields.research.sources[0].verification.yearStatus, 'not_verified')

directCalls = 0
fetchCalls = 0
const fallback = createAdmissionsResearch({
  sourceCatalog: [], searchPublicSources, resolveAddresses: addresses,
  readPublicPage: async (_url, options) => { directCalls += 1; directDeadline = options.deadlineAt; throw Object.assign(Error('403'), { code: 'ADMISSIONS_SOURCE_HTTP_STATUS' }) },
  fetchReadPublicPage: async (_url, options) => { fetchCalls += 1; fetchDeadline = options.deadlineAt; return verified2027 },
})
const fallbackStarted = Date.now()
const fallbackResult = await fallback.prepareTurn({ message, deadlineAt: fallbackStarted + 50_000 })
assert.equal(directCalls, 1)
assert.equal(fetchCalls, 1)
assert.equal(fallbackResult.publicFields.research.status, 'complete')
assert.equal(fallbackResult.publicFields.research.sources[0].verification.transport, 'deepseek-fetch')
assert.equal(directDeadline, fetchDeadline, 'direct and fallback share one absolute research deadline')
assert.ok(fetchDeadline <= fallbackStarted + 18_100)

fetchCalls = 0
const shellFallback = createAdmissionsResearch({
  sourceCatalog: [], searchPublicSources, resolveAddresses: addresses,
  readPublicPage: async () => ({ url, title: 'Mechanical Engineering MEng', text: '# Mechanical Engineering\nEntry requirements navigation\nFooter ranking: A*A*A university.' }),
  fetchReadPublicPage: async () => { fetchCalls += 1; return verified2027 },
})
const shellResult = await shellFallback.prepareTurn({ message })
assert.equal(fetchCalls, 1, 'navigation/footer grade text cannot suppress Fetch fallback')
assert.equal(shellResult.publicFields.research.status, 'complete')

const allFailed = createAdmissionsResearch({
  sourceCatalog: [], searchPublicSources, resolveAddresses: addresses,
  readPublicPage: async () => { throw Object.assign(Error('403'), { code: 'ADMISSIONS_SOURCE_HTTP_STATUS' }) },
  fetchReadPublicPage: async () => { throw Object.assign(Error('404'), { code: 'ADMISSIONS_SEARCH_HTTP_404' }) },
})
const failed = await allFailed.prepareTurn({ message })
assert.equal(failed.publicFields.research.status, 'insufficient_evidence')
assert.equal(failed.publicFields.research.sourceCount, 0)
assert.equal(failed.publicFields.research.code, 'ADMISSIONS_SEARCH_HTTP_404')

const trackedCourseUrl = `${url}?utm_source=miragenews&utm_medium=miragenews&utm_campaign=news`
const selectedUrls = []
const filteredCandidates = createAdmissionsResearch({
  sourceCatalog: [], resolveAddresses: addresses,
  searchPublicSources: async () => [
    { title: 'Accepted qualifications PDF', url: 'https://www.imperial.ac.uk/study/international-students/accepted-qualifications.pdf' },
    { title: 'Old course document', url: 'https://www.imperial.ac.uk/study/documents/mechanical-engineering.docx' },
    { title: 'Archived admissions page', url: 'https://www.imperial.ac.uk/study/archive/mechanical-engineering/' },
    { title: 'Mechanical Engineering MEng', url: trackedCourseUrl },
  ],
  readPublicPage: async (candidateUrl) => {
    selectedUrls.push(candidateUrl)
    return { ...verified2027, url: trackedCourseUrl }
  },
  fetchReadPublicPage: async () => { throw Error('verified direct course HTML must not fall back') },
})
const filteredResult = await filteredCandidates.prepareTurn({ message })
assert.deepEqual(selectedUrls, [url], 'non-HTML documents and archive paths must not consume the top-three read budget')
assert.equal(filteredResult.publicFields.research.sourceCount, 1)
assert.equal(filteredResult.publicFields.research.sources[0].url, url, 'tracking parameters must never persist in source URLs')

const longHtml = `<main><h1>Mechanical Engineering</h1>${'<p>Course directory and campus information.</p>'.repeat(5000)}<h2>Minimum entry standard</h2><p>A*A*A or A*AAA including Mathematics and Physics.</p></main>`
const prioritized = extractAdmissionsPageText(longHtml, 60_000)
assert.ok(prioritized.length <= 60_000)
assert.match(prioritized.slice(0, 2_000), /Minimum entry standard/)
assert.match(prioritized.slice(0, 2_000), /A\*A\*A or A\*AAA including Mathematics and Physics/)
const realisticHtml = `<main>\r\n<h1>Mechanical Engineering</h1>\r\n<h2>Minimum entry standard</h2><p>A*A*A or A*AAA (A-level)</p><dl><dt>Start date</dt><dd>October 2027</dd><dt>UCAS course code</dt><dd>H301</dd></dl>${'<section><h3>A-level study option</h3><p>Course structure includes a Mathematics module, facilities and campus information.</p></section>'.repeat(5_000)}<h3>To include</h3><p>A* in Mathematics</p><p>A or A* in Physics (A* required with three A-levels; at least A with four)</p><p>A in a third or fourth subject</p></main>`
const realisticText = extractAdmissionsPageText(realisticHtml, 60_000)
assert.equal(realisticText.length, 60_000, 'the realistic page reaches the reader output cap')
assert.match(realisticText.slice(0, 15_000), /Minimum entry standard/)
assert.match(realisticText.slice(0, 15_000), /A\* in Mathematics/)
assert.match(realisticText.slice(0, 15_000), /A or A\* in Physics/)
assert.match(realisticText.slice(0, 15_000), /Start date\s+October 2027/)
const realisticAssessment = assessAdmissionsPage({ url, title: 'Mechanical Engineering MEng | Imperial College London', text: realisticText }, {
  school: { domain: 'imperial.ac.uk' }, course: { name: 'Mechanical Engineering', aliases: ['Mechanical Engineering'] }, year: '2027', kind: 'undergraduate entry requirements',
})
assert.equal(realisticAssessment.rejection, null)
assert.deepEqual(realisticAssessment.applicableYears, ['2027'])
assert.equal(realisticAssessment.verification.yearMatched, true)
assert.equal(realisticAssessment.verification.gradeEvidence, true)
assert.equal(realisticAssessment.verification.subjectConditionEvidence, true)

const courseContentOnly = assessAdmissionsPage({
  url,
  title: 'Mechanical Engineering MEng | Imperial College London',
  text: '# Mechanical Engineering\n## Minimum entry standard\nA*A*A or A*AAA\n## Course content\nMathematics for engineers is taught in the first year.',
}, {
  school: { domain: 'imperial.ac.uk' }, course: { name: 'Mechanical Engineering', aliases: ['Mechanical Engineering'] }, year: null, kind: 'undergraduate entry requirements',
})
assert.equal(courseContentOnly.verification.gradeEvidence, true)
assert.equal(courseContentOnly.verification.subjectConditionEvidence, false, 'course content is not a published subject-entry condition')
console.log('Admissions direct-first: verified HTML, strict candidate canonicalization, Fetch fallback, one 18s deadline, honest year partial, navigation rejection and requirement prioritization passed.')
