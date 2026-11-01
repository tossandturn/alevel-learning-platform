import assert from 'node:assert/strict'
import { admissionsInstitutions, planAdmissionsResearch } from '../server/admissionsResearchContext.js'
import { assessAdmissionsPage, admissionsEvidencePreparation } from '../server/admissionsResearchEvidence.js'
import { createAdmissionsResearch } from '../server/admissionsResearch.js'

const catalog = [{ id: 'mit-tests', title: 'MIT Tests and scores', url: 'https://mitadmissions.org/apply/firstyear/tests-scores/', aliases: ['MIT', 'Massachusetts Institute of Technology'] }]
const institutions = admissionsInstitutions(catalog, () => 'mitadmissions.org')
const general = planAdmissionsResearch({ message: 'MIT国际本科一般申请要求和AP要求是什么？', institutions })
assert.deepEqual(general.missing, [], 'general undergraduate policy does not require a major')
assert.equal(general.course, null)
assert.equal(general.qualification, 'AP')
assert.match(general.query, /\bMIT\b.*\bAP\b/)

// Synthetic condensed policy text, not a live official requirements fixture.
const policyPage = {
  url: catalog[0].url,
  title: 'Tests & scores | MIT Admissions',
  text: '# Tests & scores\n## Testing requirement\nFirst-year applicants must submit SAT or ACT results.\n## Advanced Placement\nApplicants should self-report Advanced Placement examinations taken or planned.\n## English proficiency\nEnglish proficiency evidence is recommended in the circumstances stated on this page.',
}
const assessed = assessAdmissionsPage(policyPage, general)
assert.equal(assessed.rejection, null)
assert.equal(assessed.verification.kind, 'institution-requirements')
assert.equal(assessed.verification.courseOfferVerified, false)
assert.equal(assessed.verification.courseMatched, false)
assert.equal(assessed.verification.apFixedCountStatus, 'not_published_in_source')
assert.match(assessed.evidence, /SAT or ACT/)
assert.match(assessed.evidence, /self-report Advanced Placement/)
assert.match(assessed.verification.limitations.join(' '), /未公布固定.*AP.*不能.*不要求/)

const withMajor = planAdmissionsResearch({ message: 'MIT机械工程AP申请要求？', institutions })
const generalForMajor = assessAdmissionsPage(policyPage, withMajor)
assert.equal(generalForMajor.rejection, null, 'a course interest must not exclude applicable institutional policy')
assert.equal(generalForMajor.verification.kind, 'institution-requirements')
assert.equal(generalForMajor.verification.courseOfferVerified, false)
assert.equal(generalForMajor.verification.courseName, null)

const wrongCourse = assessAdmissionsPage({ url: 'https://mitadmissions.org/courses/computer-science/', title: 'Computer Science admission requirements', text: '# Computer Science\n2027 entry\nA-level requirement: A*AA including Mathematics.' }, withMajor)
assert.equal(wrongCourse.rejection, 'course_mismatch', 'specific course mismatches may not be relabelled as institutional policy')
const homepage = assessAdmissionsPage({ url: 'https://mitadmissions.org/', title: 'MIT Admissions', text: '# Discover MIT\nBrowse courses, research, blogs and campus visits.' }, general)
assert.ok(homepage.rejection, 'an admissions home/navigation page alone is not substantive policy')
const noAp = assessAdmissionsPage({ ...policyPage, text: '# Tests & scores\nFirst-year applicants must submit SAT or ACT results.\nApplicants should submit their school transcript.' }, general)
assert.equal(noAp.verification.apFixedCountStatus, 'not_published_in_source')
assert.equal(noAp.verification.apDiscussed, false)
assert.notEqual(noAp.verification.apFixedCountStatus, 'not_required')

let calls = 0
const research = createAdmissionsResearch({ sourceCatalog: catalog,
  searchPublicSources: async () => { calls += 1; return [{ title: 'MIT', url: policyPage.url }] },
  readPublicPage: async () => policyPage,
  resolveAddresses: async () => [{ address: '8.8.8.8', family: 4 }],
})
const prepared = await research.prepareTurn({ message: 'MIT国际本科一般申请要求和AP要求是什么？' })
assert.equal(calls, 1)
assert.equal(prepared.publicFields.research.sourceCount, 1)
assert.equal(prepared.publicFields.research.sources[0].verification.kind, 'institution-requirements')
assert.equal(prepared.publicFields.research.sources[0].verification.courseOfferVerified, false)
assert.match(prepared.systemMessage, /institution-requirements/)
assert.match(prepared.answerSuffix, /学校级政策/)
const modelContext = admissionsEvidencePreparation({ message: 'MIT机械工程AP要求？', status: 'partial', sources: prepared.publicFields.research.sources, evidence: [assessed.evidence] })
assert.match(modelContext.systemMessage, /not.*course.*offer/i)
console.log('Admissions institution policy: MIT undergraduate/AP without a major, applicable unified policy with a major, strict course mismatch and no AP-count inference passed.')
