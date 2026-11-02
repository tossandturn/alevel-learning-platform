import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { admissionsInstitutions, planAdmissionsResearch } from '../server/admissionsResearchContext.js'
import { createAdmissionsResearch } from '../server/admissionsResearch.js'
import { assessAdmissionsPage } from '../server/admissionsResearchEvidence.js'

const boards = JSON.parse(fs.readFileSync(new URL('../public/data/university-directory.json', import.meta.url), 'utf8')).examBoards
const institutions = admissionsInstitutions([], host => host)
const prompt = board => `我想了解 ${board.label} 课程体系（${board.organization}）。\n课程官网：${board.url}\n首轮请简短确认课程，只询问我目前的年级、已学课程以及目标地区/专业这三项，等我回复再展开课程结构、选课衔接、考核方式和升学准备。上面的网址不是已读取的网页正文；把课程考试规则与大学录取要求分开，区分官方说明、待核实信息和 AI 建议，不编造具体分数线、科目要求或截止日期，没有实时核验官网时请明确说明。`
const board = id => boards.find(item => item.id === id)

for (const current of boards) {
  test(`${current.id}: published directory intake is curriculum scope without university research`, async () => {
    const plan = planAdmissionsResearch({ message: prompt(current), institutions })
    assert.equal(plan.curriculum?.id, current.id)
    assert.equal(plan.school, null)
    assert.deepEqual(plan.missing, ['grade', 'studiedCourses', 'targetRegionOrSubject'])
    let searches = 0
    const research = createAdmissionsResearch({ sourceCatalog: [], searchPublicSources: async () => { searches++; return [] } })
    const result = await research.prepareTurn({ message: prompt(current) })
    assert.equal(searches, 0)
    assert.equal(result.guardedAnswer, '')
    assert.equal(result.publicFields.research.status, 'needs_clarification')
    assert.equal(result.publicFields.research.scope.curriculum, current.label)
    assert.equal(result.publicFields.research.scope.institution, null)
  })

  test(`${current.id}: a factual follow-up retains its exam board, not a university`, () => {
    const plan = planAdmissionsResearch({ message: '请查官网，介绍课程结构和科目选择。', history: [{ role: 'user', content: prompt(current) }], institutions })
    assert.equal(plan.curriculum?.id, current.id)
    assert.equal(plan.school, null)
    assert.deepEqual(plan.missing, [])
    assert.equal(plan.kind, 'curriculum structure')
    assert.match(plan.query, current.id === 'ap' ? /AP courses and exams/ : /curriculum/)
    assert.match(plan.query, new RegExp(`site:${new URL(current.url).hostname.replace(/^www\./, '').replaceAll('.', '\\.')}`))
    assert.doesNotMatch(plan.query, /site:cam\.ac\.uk|undergraduate entry/)
  })
}

test('Cambridge International A-Level is not Cambridge University without a pasted URL', () => {
  const plan = planAdmissionsResearch({ message: 'Cambridge International A-Level 的课程结构是什么？', institutions })
  assert.equal(plan.curriculum?.id, 'alevel')
  assert.equal(plan.school, null)
})

test('a university offer query using an exam qualification stays a university query', () => {
  for (const text of ['MIT本科申请 AP 要求？', 'Cambridge University A-Level entry requirements?', '剑桥大学A-Level申请要求']) {
    const plan = planAdmissionsResearch({ message: text, history: [{ role: 'user', content: prompt(board('alevel')) }], institutions })
    assert.ok(plan.school)
    assert.equal(plan.curriculum, undefined)
    assert.match(plan.query, /undergraduate entry requirements/)
  }
})

test('a new curriculum card replaces older university context', () => {
  const history = [{ role: 'user', content: 'Oxford Physics 2027 entry requirements?' }, { role: 'user', content: prompt(board('ib')) }]
  const plan = planAdmissionsResearch({ message: '六个学科组和核心课程是什么？请查官网。', history, institutions })
  assert.equal(plan.curriculum?.id, 'ib')
  assert.equal(plan.school, null)
  assert.equal(plan.year, '')
  assert.doesNotMatch(plan.query, /Oxford|Physics|2027/)
})

test('a typed curriculum target supersedes older university history even without prose labels', () => {
  const plan=planAdmissionsResearch({message:'请查课程结构。',directoryTarget:{kind:'course',id:'alevel'},history:[{role:'user',content:'Oxford Physics entry requirements?'}],institutions})
  assert.equal(plan.curriculum?.id,'alevel')
  assert.equal(plan.school,null)
})

test('a typed university target supersedes older curriculum history', () => {
  const institution=institutions.find(item=>item.domain==='ethz.ch')
  const plan=planAdmissionsResearch({message:'请查本科申请要求。',directoryTarget:{kind:'university',id:'eth-zurich',institution},history:[{role:'user',content:prompt(board('alevel'))}],institutions})
  assert.equal(plan.curriculum,undefined)
  assert.equal(plan.school?.domain,'ethz.ch')
})

test('curriculum queries are enum-based and do not send private profile text', () => {
  const plan = planAdmissionsResearch({ message: 'AP 课程如何选课？姓名 Alice，电话123456789，邮箱 alice@example.com，PRIVATE_ESSAY，预测AB。查官网。', institutions })
  assert.equal(plan.curriculum?.id, 'ap')
  assert.doesNotMatch(plan.query, /Alice|123456789|example|PRIVATE|预测|AB\b/)
})

test('a pure curriculum translation is still offline', () => {
  const plan = planAdmissionsResearch({ message: '请翻译这句话：AP课程有哪些？', institutions })
  assert.equal(plan.requested, false)
})

test('answering the intake profile never falls back to asking for a university', () => {
  const plan = planAdmissionsResearch({ message: '我是10年级，已经学过数学和物理，目标英国工程方向。', history: [{ role: 'user', content: prompt(board('alevel')) }], institutions })
  assert.equal(plan.curriculum?.id, 'alevel')
  assert.equal(plan.school, null)
  assert.deepEqual(plan.missing, [])
  assert.doesNotMatch(plan.query, /10|数学|物理|英国|工程/)
})

const pages = {
  alevel: { url: board('alevel').url+'curriculum/', title: 'Curriculum', text: '# Curriculum\nCambridge International AS & A Level develops subject knowledge and independent thinking.\nLearners can specialise in a subject area or study a range of subjects. Cambridge International A Level is typically a two-year course and AS Level is typically one year.' },
  ap: { url: 'https://apstudents.collegeboard.org/what-is-ap', title: 'What Is AP?', text: '# What Is AP?\nThe AP Program offers college-level courses and exams that you can take in high school.\nAP scores could earn college credit and placement. Check each college’s policy; this is not a guaranteed admissions offer.' },
  ib: { url: 'https://www.ibo.org/programmes/diploma-programme/curriculum/', title: 'DP curriculum', text: '# DP curriculum\nThe International Baccalaureate Diploma Programme curriculum is made up of the DP core and six subject groups.\nThe core includes theory of knowledge, creativity activity service, and the extended essay. Students take subjects at higher level and standard level.' },
}
for (const current of boards) {
  test(`${current.id}: real curriculum prose is evidence without an admissions cutoff`, async () => {
    const plan = planAdmissionsResearch({ message: `${current.label}课程结构是什么？`, history: [{ role: 'user', content: prompt(current) }], institutions })
    const assessment = assessAdmissionsPage(pages[current.id], plan)
    assert.equal(assessment.rejection, null)
    assert.equal(assessment.verification.kind, 'curriculum-information')
    assert.equal(assessment.verification.courseOfferVerified, false)
    assert.match(assessment.verification.limitations.join(' '), /不是大学录取要求/)
    const research = createAdmissionsResearch({ sourceCatalog: [], searchPublicSources: async () => [{ url: pages[current.id].url }], readPublicPage: async url => ({ ...pages[current.id], url }), resolveAddresses: async () => [{ address: '8.8.8.8', family: 4 }] })
    const prepared = await research.prepareTurn({ message: `${current.label}课程结构是什么？` })
    assert.ok(prepared.publicFields.research.sourceCount > 0)
    assert.equal(prepared.guardedAnswer, '')
    assert.match(prepared.systemMessage, /curriculum-information/)
    assert.match(prepared.answerSuffix, /课程体系/)
  })
}

test('a curriculum menu alone cannot stand in for substantive course rules', () => {
  const plan = planAdmissionsResearch({ message: 'IB课程结构是什么？', institutions })
  const result = assessAdmissionsPage({ ...pages.ib, text: '# DP curriculum\nHome\nSubjects\nAssessment\nApply\nContact us' }, plan)
  assert.ok(result.rejection)
})

test('IB DP must not borrow MYP rules or another official organisation', () => {
  const plan = planAdmissionsResearch({ message: 'IB课程结构是什么？', institutions })
  assert.ok(assessAdmissionsPage({ ...pages.ib, url: pages.ib.url.replace('/diploma-programme/', '/middle-years-programme/'), title: 'MYP curriculum', text: '# MYP curriculum\nThe Middle Years Programme curriculum includes eight subject groups.' }, plan).rejection)
  assert.ok(assessAdmissionsPage({ ...pages.ib, url: 'https://www.evil.example/ib' }, plan).rejection)
})

test('the reviewed Cambridge path accepts case variants without changing the requested URL', () => {
  const plan=planAdmissionsResearch({message:'A-Level课程结构是什么？',institutions})
  const page={...pages.alevel,url:pages.alevel.url.replaceAll('/cambridge-','/Cambridge-')}
  assert.equal(assessAdmissionsPage(page,plan).rejection,null)
})

test('board research cannot fetch an unrelated user URL or transmit credential query values', async () => {
  const reads = []
  const research = createAdmissionsResearch({ sourceCatalog: [], searchPublicSources: async () => [], readPublicPage: async url => { reads.push(url); return pages.ap }, resolveAddresses: async () => [{ address: '8.8.8.8', family: 4 }] })
  await research.prepareTurn({ message: '查 AP 课程结构 https://evil.example/?token=secret https://apstudents.collegeboard.org/account?session=private' })
  assert.ok(reads.every(url => !url.includes('evil') && !url.includes('token') && !url.includes('session') && !url.includes('/account')))
})

test('large official curriculum HTML is read within a distinct bounded budget, not truncated to a cookie notice', async () => {
  const html = '<html><title>Curriculum</title><nav>'+ 'navigation '.repeat(60000) +'</nav><main><h1>Cambridge International AS &amp; A Level</h1><p>Cambridge International A Level is typically a two-year course. Learners can choose subjects and study a range of subjects.</p></main></html>'
  const research = createAdmissionsResearch({ sourceCatalog: [], searchPublicSources: async () => [], resolveAddresses: async () => [{ address: '8.8.8.8', family: 4 }], requestPublicPage: async () => ({ statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(html) }) })
  const result = await research.prepareTurn({ message: 'A-Level课程结构是什么？' })
  assert.equal(result.guardedAnswer, '')
  assert.equal(result.publicFields.research.sourceCount, 1)
  assert.match(result.publicFields.research.sources[0].excerpt, /two-year/)
})

test('curriculum HTML remains bounded even when a reviewed website returns an oversized response', async () => {
  const research = createAdmissionsResearch({ sourceCatalog: [], searchPublicSources: async () => [], resolveAddresses: async () => [{ address: '8.8.8.8', family: 4 }], requestPublicPage: async () => ({ statusCode: 200, headers: { 'content-type': 'text/html' }, body: Buffer.alloc(2*1024*1024+1, 65) }) })
  const result = await research.prepareTurn({ message: 'A-Level课程结构是什么？' })
  assert.equal(result.publicFields.research.sourceCount, 0)
  assert.ok(result.guardedAnswer)
})

test('the official AP course catalog preserves subject names without treating navigation as requirements', () => {
  const plan=planAdmissionsResearch({message:'AP课程有哪些科目？',institutions})
  const result=assessAdmissionsPage({url:'https://apstudents.collegeboard.org/courses',title:'AP Courses and Exams',text:'# AP Courses and Exams\nFind course and exam information for AP subjects.\n## Math and Computer Science\n[AP Calculus AB](https://apstudents.collegeboard.org/courses/ap-calculus-ab)\n[AP Calculus BC](https://apstudents.collegeboard.org/courses/ap-calculus-bc)\n## Sciences\n[AP Biology](https://apstudents.collegeboard.org/courses/ap-biology)\n[AP Physics C: Mechanics](https://apstudents.collegeboard.org/courses/ap-physics-c-mechanics)'},plan)
  assert.equal(result.rejection,null)
  assert.match(result.evidence,/AP Calculus AB/)
  assert.match(result.evidence,/AP Physics C: Mechanics/)
})
