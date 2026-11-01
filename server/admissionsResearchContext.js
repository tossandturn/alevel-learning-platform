const COURSE_ENTITIES = [
  ['Mechanical Engineering', '机械工程'], ['Electrical Engineering', '电气工程', '电子工程'],
  ['Chemical Engineering', '化学工程'], ['Civil Engineering', '土木工程'], ['Biomedical Engineering', '生物医学工程'],
  ['Computer Science', '计算机科学', '计算机', '电脑科学'], ['Mathematics', '数学'], ['Physics', '物理'],
  ['Chemistry', '化学'], ['Biology', '生物学', '生物'], ['Economics', '经济学', '经济'],
  ['Medicine', '医学', '临床医学'], ['Law', '法律', '法学'], ['Psychology', '心理学'],
  ['Engineering', '工程学', '工程'], ['Architecture', '建筑学'], ['Finance', '金融'],
  ['Business', '商科', '商业'], ['History', '历史'], ['English Literature', '英国文学', '英语文学'],
  ['Materials Science', '材料科学', '材料学'], ['Philosophy', '哲学'],
].map(([name, ...aliases]) => ({ name, aliases: [name, ...aliases] }))

const SCHOOL_NAMES = {
  'ox.ac.uk': ['Oxford', 'University of Oxford', '牛津大学', '牛津'],
  'cam.ac.uk': ['Cambridge', 'University of Cambridge', '剑桥大学', '剑桥'],
  'imperial.ac.uk': ['Imperial College London', 'Imperial', '帝国理工学院', '帝国理工', 'IC'],
  'ucl.ac.uk': ['UCL', 'University College London', '伦敦大学学院'],
  'mitadmissions.org': ['MIT', 'Massachusetts Institute of Technology', '麻省理工学院', '麻省理工'],
  'mit.edu': ['MIT', 'Massachusetts Institute of Technology', '麻省理工学院', '麻省理工'],
  'harvard.edu': ['Harvard', 'Harvard University', '哈佛大学', '哈佛'],
  'stanford.edu': ['Stanford', 'Stanford University', '斯坦福大学', '斯坦福'],
  'lse.ac.uk': ['LSE', 'London School of Economics', '伦敦政治经济学院', '伦敦政经'],
  'manchester.ac.uk': ['University of Manchester', 'Manchester', '曼彻斯特大学', '曼大'],
  'ed.ac.uk': ['University of Edinburgh', 'Edinburgh', '爱丁堡大学', '爱丁堡'],
  'kcl.ac.uk': ["King's College London", 'KCL', '伦敦国王学院'],
  'bristol.ac.uk': ['University of Bristol', 'Bristol', '布里斯托大学', '布里斯托'],
  'sheffield.ac.uk': ['University of Sheffield', 'Sheffield', '谢菲尔德大学', '谢菲尔德'],
}
const EDIT = /\b(?:draft|rewrite|edit|tighten|shorten|proofread|grammar|translate|wording|personal statement|email|letter)\b|草拟|起草|润色|改写|缩短|校对|语法|翻译|措辞|个人陈述|邮件|信件/iu
const EXPLICIT_LOOKUP = /\b(?:verify|fact[- ]?check|research|look up|search|check (?:the )?(?:current|official|latest)|cite (?:the )?(?:official|source))\b|核实|查证|检索|查一下|查官网|核对.{0,8}(?:要求|政策|官网|条件)/iu
const FACT_REQUEST = /\b(?:current|latest|official|requirements?|deadline|tuition|fees?|policy|grades?|A\*|A[- ]?levels?|IELTS|IB|AP)\b|官网|官方|最新|目前|来源|引用|截止|要求|条件|学费|政策|几个\s*A\*?|多少.{0,5}(?:分|星|A)|成绩/iu
const FOLLOWUP = /[?？]|\bwhat about\b|\band\b|呢|那|这个|这个专业/iu

function containsEntity(text, alias) {
  const normalized = String(text || '').toLowerCase().replaceAll('-', ' ')
  const target = String(alias || '').toLowerCase().replaceAll('-', ' ')
  let index = normalized.indexOf(target)
  while (index >= 0) {
    const before = normalized.slice(Math.max(0, index - 12), index)
    const after = normalized[index + target.length] || ''
    const bounded = /[\u0080-\uffff]/u.test(target) || ((!/[a-z]/.test(normalized[index - 1] || '')) && !/[a-z]/.test(after))
    if (bounded && !/(?:\bnot\s+|不是|不要|别选)\s*$/iu.test(before)) return true
    index = normalized.indexOf(target, index + 1)
  }
  return false
}

export function admissionsInstitutions(catalog, rootDomain) {
  // Reviewed domains are the minimum public-scope registry. Catalogs enrich
  // titles and sources, but a missing release artifact cannot erase a known
  // institution or turn its explicit name into a clarification loop.
  const grouped = new Map(Object.entries(SCHOOL_NAMES).map(([domain, aliases]) => [domain, {
    domain,
    name: aliases[0],
    aliases: [...new Set([...aliases, domain, `www.${domain}`])],
  }]))
  for (const source of catalog) {
    const domain = rootDomain(new URL(source.url).hostname)
    if (!domain) continue
    const known = SCHOOL_NAMES[domain] || []
    const candidateNames = [
      ...known,
      ...(source.aliases || []).filter(alias => /university|college|institute|school|大学|学院/iu.test(alias)).map(alias => alias.replaceAll('-', ' ')),
      source.title?.split('·')[0]?.trim(),
    ].filter(name => name && (known.includes(name) || name.length >= 3 || /[\u4e00-\u9fff]{2}/u.test(name)) && !/专业|课程|programme|entry requirements|official/i.test(name))
    const current = grouped.get(domain) || { domain, name: known[0] || candidateNames[0] || domain, aliases: [] }
    current.aliases = [...new Set([...current.aliases, ...candidateNames])]
    grouped.set(domain, current)
  }
  return [...grouped.values()]
}

function explicitYear(text) {
  const match = String(text || '').match(/\b(20\d{2})\s*(?:entry|intake|admission|入学|年.{0,4}(?:入学|申请))|(?:entry|intake|for|入学|申请)\s*(?:year\s*)?(20\d{2})|^(20\d{2})年?[。.！!]?$/iu)
  return match ? (match[1] || match[2] || match[3]) : ''
}

function requirementKind(text) {
  if (/IELTS|TOEFL|language requirement|英语|语言|雅思/iu.test(text)) return 'English language requirements'
  if (/deadline|截止/iu.test(text)) return 'application deadline'
  if (/tuition|fee|学费/iu.test(text)) return 'tuition fees'
  return 'undergraduate entry requirements'
}

export function admissionsPublicCourseName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ')
  if (Array.from(name).length < 2 || Array.from(name).length > 80 || !/^[-\p{L}\p{M} &/'()]+$/u.test(name)) return null
  if (/\b(?:requirements?|admission|please|what|about|how|hello|thanks?|yes|no|email|phone|private|essay|prompt|secret|token|ignore|instructions)\b|申请|要求|条件|几个|多少|成绩|姓名|邮箱|谢谢|你好/iu.test(name)) return null
  const known = COURSE_ENTITIES.find(course => course.aliases.some(alias => alias.toLowerCase() === name.toLowerCase()))
  return known || { name, aliases: [name], scopeSource: 'explicit-public-course' }
}

function institutionIn(text, institutions) {
  const hosts = (String(text || '').match(/https:\/\/[^\s<>"']+/giu) || []).flatMap(raw => { try { return [new URL(raw).hostname] } catch { return [] } })
  return institutions.find(item => item.aliases.some(alias => containsEntity(text, alias)) || hosts.some(host => host === item.domain || host.endsWith(`.${item.domain}`)))
}

function courseIn(text, institutions, allowShort = false) {
  const field = String(text || '').match(/(?:专业|课程|course|programme|program)\s*[:：]\s*([^;,\n，。！？!?]{2,100})/iu)?.[1]
  if (field) return admissionsPublicCourseName(field)
  for (const raw of String(text || '').match(/https:\/\/[^\s<>"']+/giu) || []) {
    try {
      const url = new URL(raw)
      if (!institutionIn(raw, institutions) || url.username || url.password || url.search || !/\/(?:courses?|degrees?|programmes?|programs?|undergraduate)\//iu.test(url.pathname)) continue
      const slug = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || '')
        .replace(/(?:^|-)(?:beng|meng|bsc|msc|ba|ma|hons)(?:-|$)/giu, '-')
        .replaceAll('-', ' ').trim()
      const name = admissionsPublicCourseName(slug)
      if (name) return { ...name, scopeSource: 'public-course-url' }
    } catch { /* An untrusted URL is not a course name. */ }
  }
  const known = COURSE_ENTITIES.flatMap(course => course.aliases.filter(alias => containsEntity(text, alias)).map(alias => ({ course, length: alias.length })))
    .sort((left, right) => right.length - left.length)[0]?.course
  if (known) return known
  return allowShort ? admissionsPublicCourseName(String(text || '').replace(/^what about\s+/iu, '').replace(/(?:呢|[?？])\s*$/u, '').trim()) : null
}

function directCourseUrlIn(text, institutions) {
  for (const raw of String(text || '').match(/https:\/\/[^\s<>"']+/giu) || []) {
    try {
      const url = new URL(raw)
      if (institutionIn(raw, institutions) && !url.username && !url.password && !url.search
        && /\/(?:courses?|degrees?|programmes?|programs?|course-listing)\/[^/]+/iu.test(url.pathname)) return url.href
    } catch { /* Invalid links cannot supply public scope. */ }
  }
  return ''
}

export function planAdmissionsResearch({ message = '', history = [], institutions = [] } = {}) {
  const text = String(message || '')
  const planning = /choose.{0,20}(?:universit|school)|recommend.{0,20}universit|选校|申请规划|职业规划/iu.test(text)
  if (planning && !EXPLICIT_LOOKUP.test(text) && !institutionIn(text, institutions)) return { requested: false }
  const editOnly = EDIT.test(text) && !EXPLICIT_LOOKUP.test(text)
  const currentCourse = courseIn(text, institutions, history.length > 0 && !institutionIn(text, institutions))
  const lastUser = history.filter(turn => turn?.role === 'user').at(-1)?.content || ''
  const providesScope = text.length <= 120 && (currentCourse || explicitYear(text) || institutions.some(school => school.aliases.some(alias => containsEntity(text, alias))))
  const answersPriorQuestion = providesScope && (FACT_REQUEST.test(lastUser) || EXPLICIT_LOOKUP.test(lastUser))
  const requested = !editOnly && (EXPLICIT_LOOKUP.test(text) || FACT_REQUEST.test(text) || /https:\/\//i.test(text) || (currentCourse && (FOLLOWUP.test(text) || history.length > 0)) || answersPriorQuestion)
  if (!requested) return { requested: false }

  let school = null
  let course = null
  let year = ''
  let directCourseUrl = ''
  let kind = 'undergraduate entry requirements'
  let qualification = ''
  const turns = [...history.filter(turn => turn?.role === 'user').slice(-20), { role: 'user', content: text }]
  for (const turn of turns) {
    const content = String(turn.content || '').slice(0, 12_000)
    const matchedSchool = institutionIn(content, institutions)
    if (matchedSchool) school = matchedSchool
    const matchedCourse = courseIn(content, institutions, Boolean(school) && !matchedSchool)
    const directUrl = directCourseUrlIn(content, institutions)
    if (matchedCourse) { course = matchedCourse; directCourseUrl = '' }
    if (directUrl) directCourseUrl = directUrl
    year = explicitYear(content) || year
    if (/\bAP\b|Advanced Placement/iu.test(content)) qualification = 'AP'
    else if (/\bIB\b|International Baccalaureate/iu.test(content)) qualification = 'IB'
    else if (/A[- ]?levels?|A\*|A[ -]?Level|\bA\*AA\b/iu.test(content)) qualification = 'A-Level'
    if (FACT_REQUEST.test(content) || EXPLICIT_LOOKUP.test(content)) kind = requirementKind(content)
  }
  // A changed subject replaces the previous one; it never adds private profile text to a query.
  course = currentCourse || course
  if (/一般|通用|全校|统一|general|university-wide|institution-wide/iu.test(text) && !currentCourse) { course = null; directCourseUrl = '' }
  const missing = [!school && 'institution', !school && !course && !directCourseUrl && !qualification && kind === 'undergraduate entry requirements' && 'course'].filter(Boolean)
  if (missing.length) return { requested: true, school, course, year, kind, qualification, directCourseUrl, missing, query: '' }
  const suffix = `${year ? `${year} ` : ''}${kind}${qualification ? ` ${qualification}` : ''} site:${school.domain}`
  const prefix = [school.name, course?.name].filter(Boolean).join(' ')
  const publicName = Array.from(`${prefix} ${suffix}`).length <= 128 ? prefix : course?.name || ''
  const query = `${publicName} ${suffix}`.trim()
  return { requested: true, school, course, year, kind, qualification, directCourseUrl, missing: [], query }
}

export function researchScope(plan) {
  return {
    institution: plan.school?.name || null,
    course: plan.course?.name || null,
    entryYear: plan.year || null,
    requirement: plan.kind || null,
    qualification: plan.qualification || null,
  }
}
