// Reviewed curriculum identities, separate from university admissions identity.
// A client label or a search snippet cannot extend this public-source boundary.
const CAMBRIDGE = 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-advanced/cambridge-international-as-and-a-levels/'
export const ADMISSIONS_CURRICULA = Object.freeze([
  { id: 'alevel', name: 'A-Level', organization: 'Cambridge International', domain: 'cambridgeinternational.org', domains: ['cambridgeinternational.org'], aliases: ['A-Level', 'A Level', 'A-Levels', 'A Levels', 'ALevel', 'Cambridge International AS'],
    overviewUrl: CAMBRIDGE + 'curriculum/', assessmentUrl: CAMBRIDGE + 'qualification/', path: '/programmes-and-qualifications/cambridge-advanced/cambridge-international-as-and-a-levels/' },
  { id: 'ap', name: 'AP', organization: 'College Board', domain: 'apstudents.collegeboard.org', domains: ['collegeboard.org'], aliases: ['AP', 'Advanced Placement'],
    overviewUrl: 'https://apstudents.collegeboard.org/what-is-ap', catalogueUrl: 'https://apstudents.collegeboard.org/courses', assessmentUrl: 'https://apstudents.collegeboard.org/about-ap-scores', path: '/' },
  { id: 'ib', name: 'IB', organization: 'International Baccalaureate', domain: 'ibo.org', domains: ['ibo.org'], aliases: ['IB', 'IBDP', 'IB DP', 'International Baccalaureate', 'Diploma Programme'],
    overviewUrl: 'https://www.ibo.org/programmes/diploma-programme/curriculum/', catalogueUrl: 'https://www.ibo.org/programmes/diploma-programme/', assessmentUrl: 'https://www.ibo.org/programmes/diploma-programme/assessment-and-exams/', path: '/programmes/diploma-programme/' },
])

const INTAKE = '首轮请简短确认课程，只询问我目前的年级、已学课程以及目标地区/专业这三项，等我回复再展开'
const INTAKE_END = '没有实时核验官网时请明确说明。'
const CURRICULUM_INTENT = /课程体系|课程结构|选课|学科组|核心课程|考试规则|评分规则|怎么考|如何考|课程.{0,10}(?:是什么|有什么|如何|怎么|介绍)|\b(?:curriculum|subject (?:choice|groups?)|assessment|exam rules?|what is (?:AP|IB|A[- ]?Level))\b/iu
const LOOKUP = /查|官网|官方|核实|规则|要求|结构|怎么|如何|是什么|\?|？|\b(?:search|verify|research|official|structure|requirements?|assessment|exams?|subjects?|what|how)\b/iu
const EDIT = /翻译|润色|改写|草拟|校对|\b(?:translate|rewrite|proofread|edit|draft)\b/iu
const VERIFY = /查官网|查证|核实|查资料|\b(?:verify|research|search|fact[- ]check)\b/iu

export function curriculumOrganizationFreeText(value) {
  return String(value || '').replace(/Cambridge International(?: Education)?/giu, '').replace(/剑桥国际(?:考试局|教育)?/gu, '')
}

function matchesAlias(text, alias) {
  const normalized = text.toLowerCase().replace(/[-–]/g, ' ')
  const wanted = alias.toLowerCase().replace(/[-–]/g, ' ')
  let index = normalized.indexOf(wanted)
  while (index >= 0) {
    if (!/[a-z]/.test(normalized[index - 1] || '') && !/[a-z]/.test(normalized[index + wanted.length] || '')) return true
    index = normalized.indexOf(wanted, index + 1)
  }
  return false
}

function mentionedCurriculum(text) {
  const urls = (text.match(/https:\/\/[^\s<>"']+/giu) || []).flatMap(raw => { try { return [new URL(raw)] } catch { return [] } })
  return ADMISSIONS_CURRICULA.find(item => urls.some(url => (url.hostname === item.domain || url.hostname === `www.${item.domain}`) && (item.id !== 'alevel' || url.pathname.startsWith(item.path))))
    || ADMISSIONS_CURRICULA.find(item => item.aliases.some(alias => matchesAlias(text, alias)))
}

function intakeContext(text) {
  const start = text.indexOf(INTAKE), end = start < 0 ? -1 : text.indexOf(INTAKE_END, start)
  if (start < 0 || end < 0 || !/^课程官网：https:\/\//mu.test(text)) return null
  const trailing = text.slice(end + INTAKE_END.length).trim()
  return { only: !trailing, text: text.slice(0, start) + '\n' + trailing }
}

export function planCurriculumResearch({ message = '', history = [], findInstitution = () => null, directoryTarget = null } = {}) {
  const text = String(message || ''), intake = intakeContext(text)
  if (EDIT.test(text) && !VERIFY.test(text)) return null
  let curriculum = directoryTarget?.kind === 'course' ? ADMISSIONS_CURRICULA.find(item => item.id === directoryTarget.id) : null
  let university = directoryTarget?.kind === 'university'
  const turns = [...history.filter(turn => turn?.role === 'user').slice(-20), { role: 'user', content: text }]
  for (const [index, turn] of turns.entries()) {
    const raw = String(turn.content || '').slice(0, 12_000), directory = intakeContext(raw)
    const content = directory?.text || raw
    const board = mentionedCurriculum(content)
    const school = findInstitution(curriculumOrganizationFreeText(content))
    const current = index === turns.length - 1
    if (current && directoryTarget) {
      university = directoryTarget.kind === 'university'
      curriculum = university ? null : ADMISSIONS_CURRICULA.find(item => item.id === directoryTarget.id)
      continue
    }
    if (school) { university = true; curriculum = null; continue }
    if (board && (directory || CURRICULUM_INTENT.test(content) || !university)) { curriculum = board; university = false }
  }
  if (!curriculum || university) return null
  const requested = Boolean(intake || mentionedCurriculum(text) || LOOKUP.test(text) || CURRICULUM_INTENT.test(text)
    || /(?:\d{1,2}|[一二三四五六七八九十]+)年级|高[一二三]|目标|已(?:学|有)|\b(?:grade|year)\s*\d{1,2}\b/iu.test(text))
  const kind = /考试|评分|计分|assessment|grading|scores?|exam/iu.test(intake?.text || text) ? 'curriculum assessment' : 'curriculum structure'
  const year = (text.match(/\b(20\d{2})\s*年?\s*(?:考试|考纲|exams?|syllabus)|(?:exams?|syllabus)\s*(?:in|for)?\s*(20\d{2})/iu) || []).slice(1).find(Boolean) || ''
  return {
    requested, school: null, course: null, curriculum, year, kind, qualification: curriculum.name, directCourseUrl: '',
    missing: intake?.only ? ['grade', 'studiedCourses', 'targetRegionOrSubject'] : [],
    ...(intake?.only ? { intakeOnly: true } : {}),
    query: kind === 'curriculum structure'
      ? curriculum.id === 'ap' ? `AP courses and exams site:${curriculum.domain}/courses`
        : curriculum.id === 'alevel' ? 'AS A Level curriculum site:cambridgeinternational.org/programmes-and-qualifications/cambridge-advanced/'
          : 'IB Diploma Programme curriculum subjects core site:ibo.org/programmes/diploma-programme/'
      : `${curriculum.id === 'alevel' ? 'Cambridge International AS A Level' : curriculum.id === 'ib' ? 'IB Diploma Programme' : 'AP'} ${year ? year + ' ' : ''}${kind} site:${curriculum.domain}`,
    seedUrls: kind === 'curriculum assessment' ? [curriculum.assessmentUrl] : [curriculum.overviewUrl, curriculum.catalogueUrl].filter(Boolean),
  }
}

export function isCurriculumSourceCandidate(rawUrl, curriculum) {
  let url
  try { url = new URL(rawUrl) } catch { return false }
  const validHost = url.hostname === curriculum.domain || url.hostname === `www.${curriculum.domain}`
  const pathname = url.pathname.toLowerCase()
  const validPath = curriculum.id === 'ib' ? pathname.startsWith(curriculum.path) || pathname.startsWith('/university-admission/') : pathname.startsWith(curriculum.path)
  return url.protocol === 'https:' && !url.username && !url.password && validHost && validPath
}

export function assessCurriculumPage(page, plan) {
  const curriculum = plan.curriculum
  const rejected = rejection => ({ rejection })
  if (!isCurriculumSourceCandidate(page?.url, curriculum)) return rejected('curriculum_source_mismatch')
  const url = new URL(page.url)
  const catalogue = curriculum.id === 'ap' && url.pathname.replace(/\/$/, '') === '/courses' && /AP Courses (?:and|&) Exams/iu.test(String(page.title || ''))
  const content = String(page.text || '').slice(0, 60_000)
    .split('\n').flatMap(line => {
      const link = line.match(/^\s*(?:[-*]\s*)?\[([^\]]+)\]\([^)]*\)\s*$/)
      return link ? catalogue ? [link[1]] : [] : [line]
    }).join('\n')
  const identity = `${page.title || ''}\n${content.slice(0, 2500)}`
  const identityMatches = curriculum.id === 'alevel' ? /Cambridge International.{0,30}(?:AS|A\s*(?:&|and)?\s*Level)|AS\s*(?:&|and)\s*A\s*Level/iu.test(identity)
    : curriculum.id === 'ib' ? /Diploma Programme|DP curriculum|DP subjects/iu.test(identity) : /\bAP\b|Advanced Placement/iu.test(identity)
  if (!identityMatches) return rejected('curriculum_identity_unconfirmed')
  const paragraphs = content.split(/\n+/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const topic = /curricul|subjects?|syllab|qualifications?|assessment|exams?|course|higher level|standard level|\bHL\b|\bSL\b|\bAP\b|diploma|credit|grades?|scores?|knowledge/iu
  const statement = /\b(?:is|are|offers?|offered|consists?|comprises?|includes?|made up|take|takes|choose|chosen|study|learn|develops?|earn|scored|graded|awarded|assessed|can|may|must|should|typically|required)\b/iu
  const catalogueBody = catalogue && /\b(?:Find|Explore|Browse) (?:course|AP|subject)[^\n]{0,100}(?:subjects|courses|exams)/iu.test(content)
    && new Set(paragraphs.filter(line => /^AP [A-Z][A-Za-z0-9 :&()-]{3,80}$/.test(line))).size >= 3
  const positions = paragraphs.flatMap((line, index) => line.length >= 35 && topic.test(line) && statement.test(line) ? [index] : [])
  if (catalogueBody) positions.unshift(paragraphs.findIndex(line => /AP Courses (?:and|&) Exams/iu.test(line)))
  if (!positions.length) return rejected('no_substantive_curriculum_information')
  const ranked = positions.sort((a, b) => Number(/subjects?|curriculum|choose|higher level|standard level/iu.test(paragraphs[b])) - Number(/subjects?|curriculum|choose|higher level|standard level/iu.test(paragraphs[a])) || a - b)
  const snippets = [...new Set(ranked.slice(0, 10).map(index => paragraphs.slice(Math.max(0, index - 1), index + 5).join('\n')))]
  if (catalogueBody) snippets.unshift(paragraphs.slice(Math.max(0, paragraphs.findIndex(line => /AP Courses (?:and|&) Exams/iu.test(line)))).join('\n').slice(0, 6_000))
  const applicableYears = [...new Set([...content.matchAll(/(?:syllabus|examinations?|exams?)\s+(?:for|in)\s+(20\d{2})|(20\d{2})\s+(?:examinations?|exams?)/giu)].map(match => match[1] || match[2]))].slice(0, 6)
  const yearMatched = plan.year ? applicableYears.includes(plan.year) : null
  return {
    rejection: null, evidence: `Curriculum: ${curriculum.name}; official organisation: ${curriculum.organization}\nPage title: ${String(page.title || '').slice(0, 180)}\n${snippets.join('\n\n')}`.slice(0, 8_000),
    sourceExcerpt: snippets[0].slice(0, 900), applicableYears,
    verification: { kind: 'curriculum-information', curriculumId: curriculum.id, curriculumName: curriculum.name, organization: curriculum.organization,
      courseMatched: false, courseOfferVerified: false, courseName: null, requestedCourse: null, requestedYear: plan.year || null, yearMatched,
      pageYearVerified: applicableYears.length > 0, yearStatus: !plan.year ? 'target_not_specified' : yearMatched ? 'matched' : 'not_verified',
      substantiveRequirements: false, substantiveCurriculum: true, gradeEvidence: false, subjectConditionEvidence: false,
      limitations: ['这是考试局或课程机构的课程体系说明，不是大学录取要求，也不是录取保证。'],
    },
  }
}
