import { createAdmissionsResearch, createAdmissionsPageReader } from '../server/admissionsResearch.js'
import { assessAdmissionsPage } from '../server/admissionsResearchEvidence.js'

// Public fixed probes only. Never accept a student's free-text question or
// output provider bodies, credentials, private config, or model prompts.
const started = performance.now()
const direct = process.argv.includes('--direct-course')
const courseUrl = 'https://sheffield.ac.uk/undergraduate/courses/2027/mechanical-engineering-beng'
try {
  if (direct) {
    const reader = createAdmissionsPageReader({ allowedDomains: new Set(['sheffield.ac.uk']), maxPageChars: 60_000 })
    const page = await reader(courseUrl)
    const assessment = assessAdmissionsPage(page, { course: { name: 'Mechanical Engineering', aliases: ['Mechanical Engineering'] }, year: '2027', kind: 'undergraduate entry requirements' })
    console.log(JSON.stringify({
      mode: 'direct-course-read', status: assessment.rejection ? 'insufficient_evidence' : 'retrieved',
      officialDomain: new URL(page.url).hostname, courseUrl: page.url,
      bodyCharacters: page.text.length, applicableYears: assessment.applicableYears,
      verification: assessment.verification, durationMs: Math.round(performance.now() - started),
    }))
    if (assessment.rejection) process.exitCode = 2
  } else {
    const research = createAdmissionsResearch()
    const phases = []
    const generalPolicy = process.argv.includes('--mit-general')
    const result = await research.prepareTurn({
      message: generalPolicy ? 'Verify MIT general international undergraduate application and AP requirements.'
        : process.argv.includes('--current')
        ? 'Verify Imperial College London Mechanical Engineering undergraduate entry requirements.'
        : 'Verify Imperial College London Mechanical Engineering undergraduate entry requirements for 2027.',
      onActivity: event => phases.push(event.phase),
    })
    const { status, code, sources, sourceCount } = result.publicFields.research
    console.log(JSON.stringify({
      mode: 'official-search-fetch', provider: 'deepseek', status, code, sourceCount, phases,
      sources: sources.map(source => ({ officialDomain: new URL(source.url).hostname, courseUrl: source.url, applicableYears: source.applicableYears, verification: source.verification, textSha256: source.textSha256 })),
      durationMs: Math.round(performance.now() - started),
    }))
    const applicableGeneralPolicy = generalPolicy && sourceCount > 0 && sources.every(source => source.verification.kind === 'institution-requirements' && source.verification.substantiveRequirements)
    if (status !== 'complete' && !applicableGeneralPolicy) process.exitCode = 2
  }
} catch (error) {
  console.log(JSON.stringify({ status: 'blocked', code: /^ADMISSIONS_[A-Z_\d]+$/.test(error?.code || '') ? error.code : 'ADMISSIONS_PROBE_FAILED', durationMs: Math.round(performance.now() - started) }))
  process.exitCode = 2
}
