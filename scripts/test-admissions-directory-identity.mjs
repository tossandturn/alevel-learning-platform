import assert from 'node:assert/strict'
import { test } from 'node:test'
import { admissionsInstitutions, planAdmissionsResearch } from '../server/admissionsResearchContext.js'
import { assessAdmissionsPage, admissionsEvidencePreparation } from '../server/admissionsResearchEvidence.js'
import { createAdmissionsResearch } from '../server/admissionsResearch.js'

// Exact public directory prompt shape. No student profile or private history.
const intake = `我想了解 苏黎世联邦理工学院（ETH Zurich）的国际本科申请。
参考榜单：QS 世界大学排名 2027，名次 =8；Switzerland。
学校官网：https://ethz.ch/
榜单来源：https://www.topuniversities.com/world-university-rankings
首轮请简短确认这所学校，只询问我的申请年份、课程体系和目标专业这三项，等我回复再展开。目标专业用于了解兴趣，不代表该校按专业招生。上面的网址不是已读取的网页正文；按学校、学院还是专业申请、本科与研究生申请机制、考试与语言政策都须有官方材料依据，未核实就标待核实，不要顺带断言。后续帮我梳理成绩、语言及活动/项目准备，区分官方要求、待核实信息和 AI 建议；不编造 A-Level、IB、AP 分数门槛、截止日期或录取概率，排名不是录取线。`
const catalog = [
  { title: '学校官网 · 招生信息入口', url: 'https://www.lse.ac.uk/', aliases: ['lse'] },
  { title: '学校官网 · 招生信息入口', url: 'https://ethz.ch/', aliases: ['eth-zurich'] },
]
const institutions = admissionsInstitutions(catalog, host => host.replace(/^www\./, ''))

test('school link identifies ETH, never the generic title of another university', () => {
  const plan = planAdmissionsResearch({ message: '请查询 ETH Zurich 的国际本科申请要求。学校官网：https://ethz.ch/', institutions })
  assert.equal(plan.school.domain, 'ethz.ch')
  assert.equal(plan.school.name, 'ETH Zurich')
  assert.match(plan.query, /site:ethz\.ch/)
})

test('generic source labels can never become institution aliases', () => {
  assert.ok(institutions.every(school => !school.aliases.includes('学校官网')))
  const unknown = planAdmissionsResearch({ message: '学校官网的申请要求有哪些？', institutions })
  assert.equal(unknown.school, null)
  assert.ok(unknown.missing.includes('institution'))
})

test('ETH Chinese and English names survive missing optional catalog', () => {
  const fallback = admissionsInstitutions([], host => host)
  for (const name of ['ETH Zurich', 'ETH Zürich', '苏黎世联邦理工学院']) {
    const plan = planAdmissionsResearch({ message: `${name} 国际本科要求？`, institutions: fallback })
    assert.equal(plan.school?.domain, 'ethz.ch')
  }
})

test('directory intake asks scope without premature search or inferred qualification', async () => {
  let searches = 0
  const research = createAdmissionsResearch({ sourceCatalog: catalog, searchPublicSources: async () => { searches++; return [] } })
  const result = await research.prepareTurn({ message: intake })
  assert.equal(searches, 0)
  assert.equal(result.publicFields.research.status, 'needs_clarification')
  assert.equal(result.publicFields.research.scope.institution, 'ETH Zurich')
  assert.equal(result.publicFields.research.scope.entryYear, null)
  assert.equal(result.publicFields.research.scope.qualification, null)
  assert.deepEqual(result.publicFields.research.missingFields, ['entryYear', 'qualification', 'course'])
  assert.equal(result.guardedAnswer, '')
})

test('intake history retains ETH but not the template examples or ranking year', () => {
  const plan = planAdmissionsResearch({ message: '2028年入学，A-Level，机械工程。请查官方要求。', history: [{ role: 'user', content: intake }], institutions })
  assert.equal(plan.school.domain, 'ethz.ch')
  assert.equal(plan.course.name, 'Mechanical Engineering')
  assert.equal(plan.year, '2028')
  assert.equal(plan.qualification, 'A-Level')
  assert.equal(plan.kind, 'undergraduate entry requirements')
  assert.doesNotMatch(plan.query, /LSE|\bAP\b|2027|English/)
})

test('an appended current factual request overrides directory intake', () => {
  const plan = planAdmissionsResearch({ message: intake+'\n请先查询官网的本科申请要求。', institutions })
  assert.equal(plan.intakeOnly, undefined)
  assert.equal(plan.requested, true)
  assert.deepEqual(plan.missing, [])
  assert.equal(plan.school.domain, 'ethz.ch')
  assert.equal(plan.qualification, '')
})

test('general admissions covering several systems and language is not an AP-only English query', () => {
  const plan = planAdmissionsResearch({ message: 'ETH Zurich 国际本科申请要求，包括 A-Level、IB、AP 和语言要求。', institutions })
  assert.equal(plan.kind, 'undergraduate entry requirements')
  assert.equal(plan.qualification, '')
})

const prerequisites = {
  url: 'https://ethz.ch/en/studies/bachelor/application/non-swiss-matriculation-certificate/admission-prerequisites.html',
  title: 'Admission prerequisites | ETH Zurich',
  text: '# Admission prerequisites\n## Admission requirements with non-Swiss matriculation certificate\nUp-to-date information on admission requirements (country- and certificate-specific) are published on the website of swissuniversities.\nPlease check the admission requirements for your upper secondary school-leaving certificate.\nWe can only ascertain whether you need to sit an ETH entrance examination after receiving your complete application in eApply.\n## Language requirements\nThe main teaching language in all Bachelor’s degree programmes is German. Prospective Bachelor’s students must satisfy our language requirements to be admitted. This may mean submitting a certificate of proficiency in German.',
}
test('ETH bachelor prerequisite page is institution policy, not an invented course cutoff', () => {
  const plan = planAdmissionsResearch({ message: 'ETH Zurich 国际本科通用申请要求？', institutions })
  const result = assessAdmissionsPage(prerequisites, plan)
  assert.equal(result.rejection, null)
  assert.equal(result.verification.kind, 'institution-requirements')
  assert.equal(result.verification.courseOfferVerified, false)
  assert.match(result.evidence, /certificate|entrance examination/)
  assert.match(result.evidence, /German/)
})

test('German policy does not require a fabricated IELTS or English requirement', () => {
  const plan = planAdmissionsResearch({ message: 'ETH Zurich 本科德语语言要求？', institutions })
  assert.equal(plan.kind, 'language requirements')
  const result = assessAdmissionsPage({ ...prerequisites, url: 'https://ethz.ch/en/studies/bachelor/application/non-swiss-matriculation-certificate/language-requirements.html', title: 'Language requirements | ETH Zurich', text: '# Language requirements\nAll Bachelor’s degree programmes are taught in German. Applicants must provide a recognised German language certificate at level C1 before the application deadline.' }, plan)
  assert.equal(result.rejection, null)
  assert.match(result.evidence, /German.*C1/)
  assert.equal(result.verification.courseOfferVerified, false)
})

test('non-numeric admission pathways remain in evidence instead of being reduced to language only', () => {
  const plan = planAdmissionsResearch({ message: 'ETH Zurich 国际本科通用申请要求？', institutions })
  const page = { ...prerequisites, text: prerequisites.text.replace('## Language requirements', 'There are three types of admission:\nAdmission without entrance examination.\nAdmission contingent upon passing the reduced entrance examination.\nAdmission contingent upon passing the comprehensive entrance examination.\n## Language requirements') }
  const result = assessAdmissionsPage(page, plan)
  assert.match(result.evidence, /Admission without entrance examination/)
  assert.match(result.evidence, /reduced entrance examination/)
  assert.match(result.evidence, /comprehensive entrance examination/)
  assert.match(result.evidence, /complete application in eApply/)
})

test('the new bachelor policy path does not admit master requirements', () => {
  const plan = planAdmissionsResearch({ message: 'ETH Zurich 国际本科通用申请要求？', institutions })
  const result = assessAdmissionsPage({ ...prerequisites, url: prerequisites.url.replace('/bachelor/', '/master/'), title: 'Admission requirements', text: '# Admission requirements\nApplicants must provide a recognised university degree and transcripts.' }, plan)
  assert.equal(result.rejection, 'institution_policy_unconfirmed')
})

test('the research envelope teaches exact citation tokens without shortening the nonce', () => {
  const source = { id: 'S1-1234567890abcdef12345678', title: 'Official page', url: prerequisites.url, retrievedAt: '2026-11-02T00:00:00Z', applicableYears: [], verification: { kind: 'institution-requirements', limitations: [] } }
  const result = admissionsEvidencePreparation({ message: 'ETH requirements', status: 'partial', sources: [source] })
  assert.ok(result.systemMessage.includes('['+source.id+']'))
  assert.match(result.systemMessage, /Never shorten/)
})

test('an explicit excluded entry year is retained and can never become verified applicability', () => {
  const plan = planAdmissionsResearch({ message: 'ETH Zurich 2027年入学的本科通用要求？', institutions })
  const result = assessAdmissionsPage({ ...prerequisites, text: prerequisites.text + '\nThis information is not relevant for prospective students starting their degree in the autumn semester 2027.\n2027 entry information is published separately.' }, plan)
  assert.equal(result.verification.yearMatched, false)
  assert.ok(!result.applicableYears.includes('2027'))
  assert.deepEqual(result.verification.excludedYears, ['2027'])
  assert.match(result.evidence, /not relevant.*2027/)
  assert.match(result.verification.limitations.join(' '), /不适用.*2027/)
})
