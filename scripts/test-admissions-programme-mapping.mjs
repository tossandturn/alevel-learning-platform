import assert from 'node:assert/strict'
import { assessAdmissionsPage } from '../server/admissionsResearchEvidence.js'

const mechanical = { name: 'Mechanical Engineering', aliases: ['Mechanical Engineering', '机械工程'] }
const cases = [
  {
    domain: 'ox.ac.uk', requested: mechanical, programme: 'Engineering Science', type: 'broader-programme',
    url: 'https://www.ox.ac.uk/admissions/undergraduate/courses/course-listing/engineering-science',
    title: 'Engineering Science | Oxford',
    mappingText: 'The first two years are a unified engineering course. In the third and fourth years students can specialise. Mechanical Engineering is an available later direction.',
  },
  {
    domain: 'cam.ac.uk', requested: mechanical, programme: 'Engineering', type: 'broader-programme',
    url: 'https://www.undergraduate.study.cam.ac.uk/courses/engineering',
    title: 'Engineering BA and MEng | Cambridge',
    mappingText: 'Engineering begins with two broad years. Mechanical engineering is one of the specialist areas available from the third year.',
  },
  {
    domain: 'imperial.ac.uk', requested: { name: 'Computer Science', aliases: ['Computer Science', '计算机科学'] }, programme: 'Computing', type: 'programme-alias',
    url: 'https://www.imperial.ac.uk/study/courses/undergraduate/computing-beng/',
    title: 'Computing BEng | Imperial',
    mappingText: 'This Computing degree develops the foundations of computer science and programming.',
  },
]

for (const fixture of cases) {
  const plan = { school: { domain: fixture.domain }, course: fixture.requested, year: '2027', kind: 'undergraduate entry requirements' }
  const page = { url: fixture.url, title: fixture.title, text: `# ${fixture.programme}\n2027 entry\n${fixture.mappingText}\nA-level offer: A*A*A including Mathematics and Physics.` }
  const result = assessAdmissionsPage(page, plan)
  assert.equal(result.rejection, null, fixture.programme)
  assert.equal(result.verification.programmeMapping?.type, fixture.type)
  assert.equal(result.verification.programmeMapping?.bodyConfirmed, true)
  assert.equal(result.verification.courseName, fixture.programme)
  assert.equal(result.verification.kind, 'course-requirements')
  assert.match(result.evidence, /actual application programme/i)
  assert.doesNotMatch(result.sourceExcerpt, /Actual application programme:|Requested direction:/)
  assert.match(result.evidence, new RegExp(fixture.programme))
  assert.ok(result.verification.limitations.some(text => text.includes(fixture.programme)))

  const unsupported = assessAdmissionsPage({ ...page, text: `# ${fixture.programme}\n2027 entry\nA-level offer: A*A*A including Mathematics.` }, plan)
  assert.equal(unsupported.rejection, 'course_mismatch', 'title alias alone cannot prove a direction mapping')
  if (fixture.type === 'broader-programme') {
    const mentionOnly = assessAdmissionsPage({ ...page, text: `# ${fixture.programme}\n2027 entry\nMechanical Engineering appears as a research interest.\nA-level offer: A*A*A including Mathematics.` }, plan)
    assert.equal(mentionOnly.rejection, 'course_mismatch', 'a research-topic mention without progression evidence is not an application mapping')
  }
  const elsewhere = assessAdmissionsPage({ ...page, url: fixture.url.replace(/https:\/\/[^/]+/, 'https://www.example.edu') }, plan)
  assert.equal(elsewhere.rejection, 'course_mismatch', 'mappings are institution-bound')
}
console.log('Admissions programme mapping: body-confirmed Oxbridge engineering directions and Imperial Computing alias, with unsupported-title and wrong-institution rejection passed.')
