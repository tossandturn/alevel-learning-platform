// Institution-specific naming rules require evidence in the retrieved body.
// https://www.ox.ac.uk/admissions/undergraduate/courses/course-listing/engineering-science
// https://www.undergraduate.study.cam.ac.uk/courses/engineering
// https://www.imperial.ac.uk/study/courses/undergraduate/computing-beng/
export function bodyConfirmedAdmissionsProgramme(page, plan, content, heading) {
  if (!plan.course || !plan.school?.domain) return null
  let hostname
  try { hostname = new URL(page.url).hostname.toLowerCase() } catch { return null }
  const domain = plan.school.domain.toLowerCase()
  if (hostname !== domain && !hostname.endsWith(`.${domain}`)) return null
  const programme = String(heading || page.title || '').split(/\||·|\s[-–]\s/u)[0]
    .replace(/\b(?:BA|BEng|MEng|BSc|Hons|and)\b|[(),]/giu, ' ').replace(/\s+/g, ' ').trim()
  const actualProgramme = domain === 'ox.ac.uk' && /^Engineering Science$/iu.test(programme) ? 'Engineering Science'
    : domain === 'cam.ac.uk' && /^Engineering$/iu.test(programme) ? 'Engineering'
      : domain === 'imperial.ac.uk' && /^Computing$/iu.test(programme) ? 'Computing' : null
  if (!actualProgramme) return null
  const mechanical = plan.course.name === 'Mechanical Engineering' && actualProgramme !== 'Computing'
  const computing = plan.course.name === 'Computer Science' && actualProgramme === 'Computing'
  if (!mechanical && !computing) return null
  const matches = [...content.matchAll(mechanical ? /mechanical\s+engineering/giu : /computer\s+science/giu)].slice(0, 20)
  if (!matches.length) return null
  let temporalEvidence = ''
  if (mechanical) {
    const progression = [...content.matchAll(/speciali[sz]\w*|specialist\s+areas?|branches|third(?:\s+and\s+fourth)?\s+years?|years?\s*[34]/giu)].slice(0, 30)
    const timing = [...content.matchAll(/third|fourth|years?\s*[34]|later|first\s+two\s+years?/giu)].slice(0, 30)
    if (!progression.some(step => matches.some(match => Math.abs(step.index - match.index) <= 4000)) || !timing.length) return null
    temporalEvidence = content.slice(Math.max(0, timing[0].index - 100), timing[0].index + 300)
  }
  const match = matches[0]
  return {
    mapping: { type: mechanical ? 'broader-programme' : 'programme-alias', requestedDirection: plan.course.name, applicationProgramme: actualProgramme, bodyConfirmed: true, laterSpecialisation: mechanical },
    evidence: `Actual application programme: ${actualProgramme}. Requested direction: ${plan.course.name}.\n${content.slice(Math.max(0, match.index - 150), match.index + 400)}\n${temporalEvidence}`,
    limitation: mechanical
      ? `实际申请项目为 ${actualProgramme}；Mechanical Engineering 是官网正文说明的后续方向，不能写成独立专业的 offer。`
      : `实际申请项目为 ${actualProgramme}；该页正文对应 Computer Science 领域，门槛应归于此申请项目。`,
  }
}
