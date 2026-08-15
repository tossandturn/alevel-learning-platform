import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { learningPlan, stagesForComponentTags } from '../src/data/learningPlan.js'
import { examStructures } from '../src/data/examStructure.js'
import { normaliseQuestionGroup, questionPartLabel, validateQuestionGroup } from '../src/data/questionParts.js'
import {
  isHumanReviewedIndexItem,
  knowledgeGroupForIndexItem,
  minimumQuestionGroupsForImport,
  replaceMachineIndexedPaperItems,
  syllabusMappingForIndexItem,
} from './question-index-review-protection.mjs'
import { normaliseQuestionFragmentHierarchy } from './question-index-fragment-normalization.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')
const paperCatalogPath = path.join(projectRoot, 'public', 'data', 'papers.json')
const outputPath = path.join(projectRoot, 'src', 'data', 'importedQuestionIndex.json')
const sourceManifestPath = path.join(projectRoot, 'src', 'data', 'sourceContentManifest.json')
const sourceAuditPath = path.join(projectRoot, 'scripts', 'audit-question-bank.mjs')
const assetRoot = path.join(projectRoot, 'public', 'question-assets')
const libraryRoot = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')
const visionConcurrency = Math.min(6, Math.max(1, Number(process.env.QUESTION_INDEX_CONCURRENCY) || 3))

function cambridgeConfig(code, subjectId, planSubjectId) {
  const structure = examStructures[code]
  const syllabusYears = structure?.syllabusUrl?.match(/(20\d{2})-(20\d{2})-syllabus/i)
  return {
    examFamilyId: 'cambridge',
    subjectId,
    qualificationId: `cambridge-${code}`,
    planSubjectId,
    specificationId: syllabusYears ? `cambridge-${code}-${syllabusYears[1]}-${syllabusYears[2]}` : `cambridge-${code}-current`,
    syllabusUrl: structure?.syllabusUrl || structure?.sourceUrl || '',
  }
}

const subjectConfig = Object.freeze({
  '0610': cambridgeConfig('0610', 'igcse-biology', 'biology-0610'),
  '0580': cambridgeConfig('0580', 'igcse-math', 'math-0580'),
  '0606': cambridgeConfig('0606', 'additional-math', 'math-0606'),
  '0625': cambridgeConfig('0625', 'igcse-physics', 'physics-0625'),
  '9701': cambridgeConfig('9701', 'chemistry', 'chemistry-9701'),
  '9700': cambridgeConfig('9700', 'biology', 'biology-9700'),
  '9702': cambridgeConfig('9702', 'physics', 'physics-9702'),
  '9708': cambridgeConfig('9708', 'economics', 'economics-9708'),
  '9709': cambridgeConfig('9709', 'math', 'math-9709'),
  '9231': cambridgeConfig('9231', 'further-math', 'math-9231'),
  bpho: { examFamilyId: 'olympiad', subjectId: 'bpho', qualificationId: 'bpho', specificationId: 'bpho-current', topicIds: ['bpho-mechanics', 'bpho-waves', 'bpho-electricity', 'bpho-thermal-modern'] },
  esat: { examFamilyId: 'admissions', subjectId: 'esat', qualificationId: 'esat', specificationId: 'esat-current', topicIds: ['esat-mathematics-1', 'esat-mathematics-2', 'esat-physics', 'esat-chemistry', 'esat-biology'] },
  tmua: { examFamilyId: 'admissions', subjectId: 'tmua', qualificationId: 'tmua', specificationId: 'tmua-current', topicIds: ['tmua-algebra', 'tmua-geometry', 'tmua-proof', 'tmua-problem-solving'] },
  amc12: { examFamilyId: 'competition', subjectId: 'amc12', qualificationId: 'amc12', specificationId: 'amc12-current', topicIds: ['amc12-algebra', 'amc12-geometry', 'amc12-number', 'amc12-combinatorics'] },
})

function parseArgs(argv) {
  const values = { subject: '9702', papers: 1, minQuestions: 10, model: '', components: [], files: [], dryRun: false, migrateOnly: false, all: false, force: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--subject') values.subject = argv[++index]
    else if (arg === '--papers') values.papers = Math.max(1, Number(argv[++index]) || 1)
    else if (arg === '--min-questions') values.minQuestions = Math.max(1, Number(argv[++index]) || 10)
    else if (arg === '--model') values.model = argv[++index]
    else if (arg === '--components') values.components = String(argv[++index] || '').split(',').map(Number).filter(Number.isFinite)
    else if (arg === '--files') values.files = String(argv[++index] || '').split(',').map((value) => value.trim()).filter(Boolean)
    else if (arg === '--dry-run') values.dryRun = true
    else if (arg === '--migrate-only') values.migrateOnly = true
    else if (arg === '--all') values.all = true
    else if (arg === '--force') values.force = true
  }
  return values
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const values = {}
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!match || match[1].startsWith('#')) continue
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return values
}

function providerConfig(args) {
  const env = { ...readEnvFile(path.join(projectRoot, '.env')), ...process.env }
  const workspaceId = env.DASHSCOPE_WORKSPACE_ID || env.QWEN_WORKSPACE_ID || ''
  const region = env.DASHSCOPE_REGION || 'cn-beijing'
  const defaultBase = workspaceId
    ? `https://${workspaceId}.${region}.maas.aliyuncs.com/compatible-mode/v1`
    : 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  return {
    apiKey: env.VISION_AI_API_KEY || env.QWEN_VISION_API_KEY || env.PHYSICS_AI_API_KEY || env.DASHSCOPE_API_KEY || env.QWEN_API_KEY || '',
    baseUrl: (env.VISION_AI_BASE_URL || env.QWEN_VISION_BASE_URL || env.PHYSICS_AI_BASE_URL || env.DASHSCOPE_COMPAT_BASE_URL || defaultBase).replace(/\/+$/, ''),
    model: args.model || env.VISION_AI_MODEL || env.QWEN_VISION_MODEL || env.PHYSICS_VISION_MODEL || 'qwen3-vl-plus',
  }
}

function topicsFor(config, paper) {
  if (config.topicIds) return config.topicIds.map((id) => ({ id, name: id.replaceAll('-', ' ') }))
  const planSubject = learningPlan.subjects.find((subject) => subject.id === config.planSubjectId)
  const paperStages = stageTags(paper, config)
  return (planSubject?.knowledgeGroupIds || []).map((id) => {
    const group = learningPlan.knowledgeGroups.find((item) => item.id === id)
    return { id, name: group?.name || id, aliases: group?.themes || [], stages: stagesForComponentTags(group?.stageTags || []) }
  }).filter((topic) => !learningPlan.knowledgeGroups.find((group) => group.id === topic.id)?.hidden)
    .filter((topic) => !paperStages.some((stage) => stage === 'AS' || stage === 'A2') || topic.stages.some((stage) => paperStages.includes(stage)))
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false, ...options })
  if (result.status !== 0) throw new Error(`${command} failed: ${String(result.stderr || result.stdout).slice(0, 500)}`)
  return result
}

function writeIndexAndRefreshSourceManifest(items) {
  const nextIndex = `${JSON.stringify(decoupleIndex(items), null, 2)}\n`
  const previousIndex = fs.existsSync(outputPath) ? fs.readFileSync(outputPath) : null
  const previousManifest = fs.existsSync(sourceManifestPath) ? fs.readFileSync(sourceManifestPath) : null
  fs.writeFileSync(outputPath, nextIndex, 'utf8')
  try {
    run(process.execPath, [sourceAuditPath, '--write-manifest'], { cwd: projectRoot })
  } catch (error) {
    if (previousIndex) fs.writeFileSync(outputPath, previousIndex)
    if (previousManifest) fs.writeFileSync(sourceManifestPath, previousManifest)
    throw error
  }
}

function popplerExecutable() {
  if (process.env.PDFTOPPM_BIN) return process.env.PDFTOPPM_BIN
  if (process.platform !== 'win32') return 'pdftoppm'
  const bundled = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'poppler', 'Library', 'bin', 'pdftoppm.exe')
  return fs.existsSync(bundled) ? bundled : 'pdftoppm.exe'
}

function renderPdf(pdfPath, outputDirectory, prefix) {
  fs.mkdirSync(outputDirectory, { recursive: true })
  const outputPrefix = path.join(outputDirectory, prefix)
  run(popplerExecutable(), ['-jpeg', '-jpegopt', 'quality=82', '-r', '120', pdfPath, outputPrefix])
  return fs.readdirSync(outputDirectory)
    .filter((file) => file.startsWith(`${prefix}-`) && file.endsWith('.jpg'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((file, index) => ({ page: index + 1, file, filePath: path.join(outputDirectory, file) }))
}

function dataUrl(filePath) {
  return `data:image/jpeg;base64,${fs.readFileSync(filePath).toString('base64')}`
}

async function fetchWithTimeout(url, options, timeoutMs = 90000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function parseJson(value) {
  const source = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const objectSource = source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1)
  const escapedStringSource = escapeInvalidJsonStringCharacters(objectSource)
  const variants = [
    objectSource,
    escapedStringSource,
    objectSource.replace(/,\s*([}\]])/g, '$1'),
    objectSource.replace(/}\s*(?=\{)/g, '},'),
    objectSource.replace(/]\s*(?=")/g, '],'),
    objectSource.replace(/([}\]"\d]|true|false|null)\s+(?=")/g, '$1,'),
  ]
  let lastError
  for (const candidate of variants) {
    try {
      return JSON.parse(candidate)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

function escapeInvalidJsonStringCharacters(source) {
  let output = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (!inString) {
      output += character
      if (character === '"') inString = true
      continue
    }
    if (escaped) {
      output += character
      escaped = false
      continue
    }
    if (character === '\\') {
      const next = source[index + 1]
      if (next && !'"\\/bfnrtu'.includes(next)) {
        output += '\\\\'
        continue
      }
      escaped = true
      output += character
      continue
    }
    if (character === '"') {
      output += character
      inString = false
      continue
    }
    if (character === '\n') {
      output += '\\n'
      continue
    }
    if (character === '\r') continue
    if (character === '\t') {
      output += '\\t'
      continue
    }
    output += character
  }
  return output
}

async function callVision(provider, imagePath, instruction) {
  if (!provider.apiKey) throw new Error('Qwen vision API is not configured. Add the key to .env without committing it.')
  let jsonMode = true
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    let response
    try {
      const requestBody = {
        model: provider.model,
        temperature: 0,
        max_tokens: 8192,
        stream: false,
        messages: [{ role: 'user', content: [{ type: 'text', text: instruction }, { type: 'image_url', image_url: { url: dataUrl(imagePath) } }] }],
      }
      if (jsonMode) requestBody.response_format = { type: 'json_object' }
      response = await fetchWithTimeout(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
    } catch (error) {
      if (attempt === 4) throw new Error(`Qwen vision request failed for ${path.basename(imagePath)}: ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500))
      continue
    }
    if (response.ok) {
      const payload = await response.json()
      try {
        return parseJson(payload?.choices?.[0]?.message?.content)
      } catch (error) {
        if (attempt === 4) throw new Error(`Qwen vision returned invalid JSON for ${path.basename(path.dirname(imagePath))}/${path.basename(imagePath)}: ${error.message}`)
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
        continue
      }
    }
    if (response.status === 400 && jsonMode) {
      jsonMode = false
      continue
    }
    if (attempt === 4 || ![400, 408, 429, 500, 502, 503, 504].includes(response.status)) throw new Error(`Qwen vision returned ${response.status}.`)
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500))
  }
  throw new Error('Qwen vision retry loop ended unexpectedly.')
}

async function mapLimited(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  async function next() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()))
  return results
}

function questionInstruction(subject, topics, page) {
  return [
    `This is page ${page} of an official ${subject} question paper. Index only text genuinely visible on this page.`,
    'Return JSON {"fragments":[...]}. Each fragment is one explicit QuestionPart inside a QuestionGroup: questionNumber (main printed number only), partId, label, promptFragment, startsHere, continues, marks, answerArea {type}, options, topicId, topicTags, skillTags, sourcePage.',
    'Never merge (a), (b), (i), (ii) or any separately marked response area into one fragment. The group total is the sum of its visible part marks.',
    'If this page continues a question from an earlier page, set continues=true and repeat the same main questionNumber. Never convert a subpart such as (i), (ii), or a letter in prose into questionNumber. If the main number is not visibly printed, use null and rely on continues=true; do not guess it from page position.',
    'Never complete missing text from memory. Preserve equations in plain Unicode only. Do not emit LaTeX commands or backslashes. Use answerType multiple-choice only when options are visible; otherwise handwritten.',
    `Choose exactly one topicId from: ${JSON.stringify(topics)}. If no exam question is visible, return {"fragments":[]}.`,
  ].join('\n')
}

function answerInstruction(subject, page) {
  return [
    `This is page ${page} of the exact official ${subject} mark scheme paired with a question paper.`,
    'Return JSON {"answers":[...]}. Each answer is one mark-scheme entry for one QuestionPart: questionNumber, partId, label, exactText, marks, markPoints, correctOption, sourcePage.',
    'Use the printed part label exactly. Do not combine marks from (a), (b), (i) or (ii). The answer total must reconcile with the QuestionGroup total.',
    'correctOption must be A/B/C/D only when explicitly printed. Use plain Unicode only and do not emit LaTeX commands or backslashes. Never invent missing mark points. If no answer entry is visible, return {"answers":[]}.',
  ].join('\n')
}

function normalizeQuestionNumber(value) {
  return String(value || '').trim().replace(/^Q/i, '').match(/^\d+/)?.[0] || ''
}

function normalizeMarkValue(value) {
  const numeric = Number(value)
  if (Number.isInteger(numeric)) return numeric
  const code = String(value || '').match(/(\d+)\s*$/)
  return code ? Number(code[1]) : 0
}

const OFFICIAL_9702_TAG_MAP = Object.freeze([
  [['measurement and uncertainty'], 'physics-9702-topic-01'],
  [['kinematics', 'projectile motion'], 'physics-9702-topic-02'],
  [['dynamics', 'forces and momentum', 'conservation laws', 'collisions', 'vector components'], 'physics-9702-topic-03'],
  [['buoyancy', 'static equilibrium', 'fluids', 'pressure'], 'physics-9702-topic-04'],
  [['work energy and power', 'energy and power'], 'physics-9702-topic-05'],
  [['elasticity'], 'physics-9702-topic-06'],
  [['wave properties', 'polarisation', 'optical waves', 'Doppler effect', 'waves', 'phase'], 'physics-9702-topic-07'],
  [['superposition', 'interference and diffraction', 'coherence', 'diffraction', 'stationary waves'], 'physics-9702-topic-08'],
  [['current and charge', 'potential difference and resistance', 'resistivity', 'resistance', 'thermistor', 'temperature dependence'], 'physics-9702-topic-09'],
  [['DC circuits'], 'physics-9702-topic-10'],
  [['quarks and leptons', 'particle interactions', 'hadrons', 'particles and nuclear physics'], 'physics-9702-topic-11'],
  [['circular motion'], 'physics-9702-topic-12'],
  [['gravitational fields', 'orbits'], 'physics-9702-topic-13'],
  [['specific heat and latent heat', 'temperature and internal energy'], 'physics-9702-topic-14'],
  [['ideal gases', 'kinetic theory'], 'physics-9702-topic-15'],
  [['thermal processes', 'internal energy'], 'physics-9702-topic-16'],
  [['oscillations', 'simple harmonic motion', 'resonance'], 'physics-9702-topic-17'],
  [['electric fields', "Coulomb's law"], 'physics-9702-topic-18'],
  [['capacitors'], 'physics-9702-topic-19'],
  [['magnetic fields', 'electromagnetic induction'], 'physics-9702-topic-20'],
  [['alternating currents'], 'physics-9702-topic-21'],
  [['quantum physics', 'photoelectric effect', 'wave-particle duality', 'energy levels'], 'physics-9702-topic-22'],
  [['nuclear structure', 'mass energy', 'radioactive decay'], 'physics-9702-topic-23'],
  [['ultrasound'], 'physics-9702-topic-24'],
  [['stellar physics', 'luminosity', 'blackbody radiation', "Stefan-Boltzmann law", "Wien's displacement law"], 'physics-9702-topic-25'],
])

function officialPhysicsTopicId(item) {
  if (item.subjectCode !== '9702') return item.knowledgeGroupId
  const tags = new Set((item.topicTags || []).map((tag) => String(tag).trim()))
  for (const [candidates, topicId] of OFFICIAL_9702_TAG_MAP) {
    if (candidates.some((tag) => tags.has(tag))) return topicId
  }
  return item.knowledgeGroupId
}

function mergeFragments(records, key) {
  const grouped = new Map()
  let activeQuestionNumber = null
  for (const record of records) {
    for (const fragment of record[key] || []) {
      const candidate = normalizeQuestionNumber(fragment.questionNumber)
      let questionNumber = candidate
      if (!questionNumber && activeQuestionNumber) questionNumber = activeQuestionNumber
      if (questionNumber && activeQuestionNumber && questionNumber !== activeQuestionNumber) {
        const expectedNext = String(Number(activeQuestionNumber) + 1)
        if (fragment.continues === true || questionNumber !== expectedNext) questionNumber = activeQuestionNumber
      }
      if (!questionNumber) continue
      if (questionNumber !== activeQuestionNumber && (!activeQuestionNumber || Number(questionNumber) >= Number(activeQuestionNumber))) {
        activeQuestionNumber = questionNumber
      }
      const current = grouped.get(questionNumber) || { questionNumber, pages: [], fragments: [] }
      current.pages.push(record.page)
      current.fragments.push(fragment)
      grouped.set(questionNumber, current)
    }
  }
  return grouped
}

function collapseFragments(fragments, { sumMarks = false, questionHierarchy = false } = {}) {
  const sourceFragments = questionHierarchy ? normaliseQuestionFragmentHierarchy(fragments) : fragments
  const grouped = new Map()
  for (const fragment of sourceFragments) {
    const label = questionPartLabel(fragment, sourceFragments.length === 1 ? 'a' : '')
    if (!label) return null
    const current = grouped.get(label)
    if (!current) {
      const key = String(fragment.exactText || fragment.promptFragment || fragment.answerText || '').trim().toLowerCase()
      grouped.set(label, { ...fragment, label, partId: fragment.partId || label, _markEntryKeys: key ? new Set([key]) : new Set() })
      continue
    }
    const currentMarks = normalizeMarkValue(current.marks)
    const nextMarks = normalizeMarkValue(fragment.marks)
    if (!sumMarks && Number.isInteger(currentMarks) && Number.isInteger(nextMarks) && currentMarks > 0 && nextMarks > 0 && currentMarks !== nextMarks) return null
    const currentText = String(current.promptFragment || current.exactText || '').trim()
    const nextText = String(fragment.promptFragment || fragment.exactText || '').trim()
    const mergedText = currentText && nextText && currentText !== nextText ? `${currentText}\n${nextText}` : currentText || nextText
    const currentPoints = Array.isArray(current.markPoints) ? current.markPoints : []
    const nextPoints = Array.isArray(fragment.markPoints) ? fragment.markPoints : []
    const entryKey = String(fragment.exactText || fragment.promptFragment || fragment.answerText || '').trim().toLowerCase()
    const seenEntry = entryKey && current._markEntryKeys?.has(entryKey)
    const markTotal = sumMarks
      ? (currentMarks || 0) + (seenEntry ? 0 : (nextMarks || 0))
      : currentMarks || nextMarks
    const markEntryKeys = new Set(current._markEntryKeys || [])
    if (entryKey) markEntryKeys.add(entryKey)
    grouped.set(label, {
      ...current,
      ...fragment,
      label,
      partId: current.partId || fragment.partId || label,
      promptFragment: mergedText,
      exactText: mergedText,
      marks: markTotal,
      markPoints: [...new Set([...currentPoints, ...nextPoints].map((value) => String(value).trim()).filter(Boolean))],
      sourcePage: Math.min(Number(current.sourcePage || current.page) || Number.POSITIVE_INFINITY, Number(fragment.sourcePage || fragment.page) || Number.POSITIVE_INFINITY),
      _markEntryKeys: markEntryKeys,
    })
  }
  return [...grouped.values()].map((fragment) => ({
    ...(({ _markEntryKeys, ...value }) => value)(fragment),
    sourcePage: Number.isFinite(fragment.sourcePage) ? fragment.sourcePage : null,
  }))
}

function stageTags(paper, config) {
  const stages = paper.examProfile?.stages || []
  if (paper.subject.startsWith('0')) return ['IGCSE']
  if (config.examFamilyId === 'olympiad') {
    const name = String(paper.file || '').toLowerCase()
    if (name.includes('spc')) return ['SPC']
    if (/round[_ -]?2|r2\b/.test(name)) return ['Round 2']
    if (/round[_ -]?1|r1\b/.test(name)) return ['Round 1']
    return ['Physics Challenge']
  }
  if (paper.subject === 'tmua') {
    const component = paper.examProfile?.paperNumber || String(paper.file || '').match(/paper[_ -]?(\d)/i)?.[1]
    return component ? [`Paper ${component}`] : []
  }
  if (paper.subject === 'esat') return ['Mathematics 1', 'Mathematics 2', 'Physics', 'Chemistry']
  if (paper.subject === 'amc12') return ['AMC 12']
  if (stages.includes('a2') && stages.includes('as')) return ['AS', 'A2']
  if (stages.includes('a2')) return ['A2']
  if (stages.includes('as')) return ['AS']
  return stages.map((stage) => String(stage))
}

function publicAssetUrl(paperId, file) {
  return `/question-assets/${encodeURIComponent(paperId)}/${encodeURIComponent(file)}`
}

function joinStoredIndex(index) {
  if (Array.isArray(index.items)) return index.items
  const answers = new Map((index.answers || []).map((answer) => [answer.answerId, answer]))
  const bindings = new Map((index.bindings || []).map((binding) => [binding.questionId, binding]))
  return (index.questions || []).map((question) => {
    const binding = bindings.get(question.questionId)
    const answer = answers.get(binding?.answerId)
    return answer ? { ...question, ...answer, bankId: question.questionId, answerBinding: binding } : question
  })
}

function decoupleIndex(items) {
  const questions = []
  const answers = []
  const bindings = []
  for (const item of items) {
    const { answer, answerKey, markPoints, exactAnswer, answerRef, answerBinding, answerParts: _answerParts, bankId, ...question } = item
    const questionId = bankId || item.questionId
    const questionGroup = normaliseQuestionGroup({ ...question, questionId }, item)
    const knowledgeGroupId = knowledgeGroupForIndexItem(item, officialPhysicsTopicId(item))
    const answerId = `${questionId}:answer`
    const preservedReviewEvidence = answerBinding?.verificationStatus === 'reviewed'
      ? {
          reviewedAt: answerBinding.reviewedAt,
          reviewedBy: answerBinding.reviewedBy,
          reviewEvidence: answerBinding.reviewEvidence,
        }
      : {}
    const config = subjectConfig[item.subjectCode]
    const specificationId = question.specificationId || config?.specificationId || `${item.qualificationId || item.subjectCode}-current`
    const componentTags = question.componentTags || []
    const migratedStageTags = item.subjectCode === '9709' && componentTags.some((component) => [4, 5, '4', '5'].includes(component))
      ? ['AS', 'A2']
      : question.stageTags
    const questionParts = (questionGroup.parts || []).map((part) => ({
      partId: part.partId,
      label: part.label,
      promptFragment: part.promptFragment,
      marks: part.marks,
      questionDeclaredMarks: part.questionDeclaredMarks || null,
      markSource: part.markSource || '',
      answerArea: part.answerArea,
      sourcePage: part.sourcePage,
      sourceEvidence: part.sourceEvidence || [],
      sourceRegion: part.sourceRegion || null,
    }))
    const answerPartRecords = (questionGroup.parts || []).map((part) => ({
      partId: part.partId,
      label: part.label,
      marks: part.marks,
      markSchemePoints: part.markSchemePoints || [],
      answerKey: part.answerKey || null,
      answerText: part.answerText || null,
      sourcePage: part.answerSourcePage || null,
      markSchemeEvidence: part.markSchemeEvidence || [],
    }))
    questions.push({
      ...question,
      questionId,
      questionGroupId: questionGroup.questionGroupId || questionId,
      questionGroupStatus: questionGroup.status,
      totalMarks: questionGroup.totalMarks || 0,
      parts: questionParts,
      marks: questionGroup.totalMarks || (question.answerType === 'multiple-choice' ? 1 : question.marks),
      stageTags: migratedStageTags,
      examFamilyId: question.examFamilyId || config?.examFamilyId || 'unknown',
      specificationId,
      knowledgeGroupId,
      topicId: question.subjectCode === '9702' ? knowledgeGroupId : question.topicId,
      syllabusMapping: syllabusMappingForIndexItem(item, {
        fallbackKnowledgeGroupId: knowledgeGroupId,
        specificationId,
        syllabusUrl: config?.syllabusUrl || null,
      }),
    })
    answers.push({
      answerId,
      answer,
      answerKey: answerKey || (question.answerType === 'multiple-choice' ? answer : null),
      markPoints,
      exactAnswer,
      answerRef,
      answerParts: answerPartRecords,
    })
    bindings.push({
      questionId,
      answerId,
      verificationStatus: questionGroup.status === 'quarantined'
        ? 'quarantined'
        : answerBinding?.verificationStatus === 'reviewed' ? 'reviewed' : 'machine-indexed',
      questionDocumentSha256: item.sourceRef?.sha256,
      answerDocumentSha256: answerRef?.sha256,
      ...preservedReviewEvidence,
    })
  }
  const questionIds = new Set(questions.map((question) => question.questionId))
  const answerIds = new Set(answers.map((answer) => answer.answerId))
  if (questionIds.size !== questions.length || answerIds.size !== answers.length || bindings.length !== questions.length) {
    throw new Error('Question index violates the one-question/one-answer/one-binding contract.')
  }
  return { schemaVersion: 2, generatedAt: new Date().toISOString(), questions, answers, bindings }
}

function buildItems(paper, markScheme, config, questionGroups, answerGroups) {
  const items = []
  const dropped = new Map()
  const drop = (reason) => dropped.set(reason, (dropped.get(reason) || 0) + 1)
  for (const [questionNumber, question] of questionGroups) {
    const answer = answerGroups.get(questionNumber)
    if (!answer) {
      drop('missing-answer-group')
      continue
    }
    const questionParts = collapseFragments(question.fragments || [], { questionHierarchy: true })
    const answerParts = collapseFragments(answer.fragments || [], { sumMarks: true })
    if (!questionParts || !answerParts) {
      drop('ambiguous-cross-page-fragments')
      continue
    }
    if (!questionParts.length || !answerParts.length) {
      drop('empty-question-or-answer-parts')
      continue
    }
    const first = questionParts[0]
    const questionPages = [...new Set(question.pages)].sort((a, b) => a - b)
    const answerPages = [...new Set(answer.pages)].sort((a, b) => a - b)
    const topicId = first.topicId
    if (!topicId) {
      drop('missing-topic')
      continue
    }
    const answerByLabel = new Map(answerParts.map((fragment, index) => [
      questionPartLabel(fragment, answerParts.length === 1 ? 'a' : String(index + 1)),
      fragment,
    ]))
    const parts = questionParts.map((fragment) => {
      const label = questionPartLabel(fragment, questionParts.length === 1 ? 'a' : '')
      const answerPart = answerByLabel.get(label)
      if (!label || !answerPart) return null
      const answerType = fragment.answerArea?.type || fragment.answerType || (answerPart.correctOption ? 'multiple-choice' : 'handwritten')
      const questionMarks = normalizeMarkValue(fragment.marks)
      const answerMarks = normalizeMarkValue(answerPart.marks)
      const marks = Number.isInteger(answerMarks) && answerMarks > 0
        ? answerMarks
        : answerType === 'multiple-choice' ? 1 : questionMarks
      if (!Number.isInteger(marks) || marks < 1) return null
      const explicitMarkSchemePoints = [...(answerPart.markPoints || fragment.markPoints || [])]
        .map((value) => String(value).trim())
        .filter(Boolean)
      const exactAnswer = String(answerPart.exactText || '').trim()
      const markSchemePoints = explicitMarkSchemePoints.length
        ? explicitMarkSchemePoints
        : exactAnswer ? [`Exact answer (${marks} mark${marks === 1 ? '' : 's'}): ${exactAnswer}`] : []
      return {
        partId: `${paper.id}:q${questionNumber}:part-${label}`,
        label,
        promptFragment: String(fragment.promptFragment || fragment.exactText || '').trim(),
        marks,
        questionDeclaredMarks: Number.isInteger(questionMarks) && questionMarks > 0 ? questionMarks : null,
        markSource: Number.isInteger(answerMarks) && answerMarks > 0 ? 'paired-mark-scheme' : 'question-paper',
        answerArea: typeof fragment.answerArea === 'object' ? fragment.answerArea : { type: answerType, input: answerType === 'multiple-choice' ? 'choice' : 'handwriting' },
        markSchemePoints,
        answerKey: answerPart.correctOption || fragment.answerKey || null,
        answerText: answerPart.exactText || null,
        sourcePage: Number(fragment.sourcePage || fragment.page || question.pages[0]) || null,
        answerSourcePage: Number(answerPart.sourcePage || answerPart.page || answer.pages[0]) || null,
        options: fragment.options?.length ? fragment.options : undefined,
      }
    })
    if (parts.some((part) => !part)) {
      drop('part-label-or-mark-mismatch')
      continue
    }
    if (parts.length !== answerParts.length) {
      drop('question-answer-part-count-mismatch')
      continue
    }
    const group = { questionGroupId: `${paper.id}:q${questionNumber}`, totalMarks: parts.reduce((sum, part) => sum + part.marks, 0), parts }
    if (!validateQuestionGroup(group).valid) {
      drop('question-group-validation')
      continue
    }
    const exactText = parts.map((part) => part.promptFragment).filter(Boolean).join('\n').trim()
    const exactAnswer = parts.map((part) => part.answerText).filter(Boolean).join('\n').trim()
    if (!exactText || !exactAnswer) {
      drop('missing-prompt-or-answer-text')
      continue
    }
    const answerType = parts.length === 1 ? parts[0].answerArea.type : 'structured'
    const correctOption = parts.length === 1 ? parts[0].answerKey : null
    const options = parts.length === 1 && answerType === 'multiple-choice' ? (parts[0].options?.length === 4 ? parts[0].options : ['A', 'B', 'C', 'D']) : undefined
    items.push({
      bankId: `${paper.id}:q${questionNumber}`,
      examFamilyId: config.examFamilyId,
      qualificationId: config.qualificationId,
      specificationId: config.specificationId,
      subjectId: config.subjectId,
      subjectCode: paper.subject,
      knowledgeGroupId: topicId,
      topicId,
      stageTags: stageTags(paper, config),
      componentTags: [paper.examProfile?.paperNumber].filter(Boolean),
      topicTags: [...new Set([topicId, ...(first.topicTags || [])])],
      skillTags: [...new Set(first.skillTags || [])],
      answerType,
      prompt: exactText,
      options,
      answer: correctOption,
      answerKey: correctOption,
      questionGroupId: group.questionGroupId,
      questionGroupStatus: 'verified',
      totalMarks: group.totalMarks,
      parts,
      marks: group.totalMarks,
      markPoints: parts.flatMap((part) => part.markSchemePoints || []).filter(Boolean),
      exactAnswer,
      sourceRef: {
        paperId: paper.id,
        paper: paper.file,
        question: `Q${questionNumber}`,
        localUrl: paper.localUrl,
        pageStart: questionPages[0],
        pageEnd: questionPages.at(-1),
        assetUrls: questionPages.map((page) => publicAssetUrl(paper.id, `qp-${String(page).padStart(2, '0')}.jpg`)),
        year: paper.year,
        season: paper.season,
        component: paper.examProfile?.paperNumber || null,
        sha256: paper.sha256,
      },
      answerRef: {
        documentId: markScheme.id,
        file: markScheme.file,
        localUrl: markScheme.localUrl,
        pageStart: answerPages[0],
        pageEnd: answerPages.at(-1),
        assetUrls: answerPages.map((page) => publicAssetUrl(paper.id, `ms-${String(page).padStart(2, '0')}.jpg`)),
        sha256: markScheme.sha256,
      },
      provenance: { licenseStatus: paper.copyrightStatus, indexedAt: new Date().toISOString() },
      syllabusMapping: {
        specificationId: config.specificationId,
        syllabusUrl: config.syllabusUrl || null,
        knowledgeGroupId: topicId,
        mappingStatus: 'machine-indexed',
      },
    })
  }
  if (process.env.QUESTION_INDEX_DEBUG) {
    console.log(JSON.stringify({
      paper: paper.file,
      questionGroups: questionGroups.size,
      answerGroups: answerGroups.size,
      accepted: items.length,
      dropped: Object.fromEntries(dropped),
    }))
  }
  return items
}

function copyRenderedPages(rendered, outputDirectory, prefix) {
  fs.mkdirSync(outputDirectory, { recursive: true })
  for (const page of rendered) {
    const target = path.join(outputDirectory, `${prefix}-${String(page.page).padStart(2, '0')}.jpg`)
    fs.copyFileSync(page.filePath, target)
  }
}

async function indexPaper(paper, markScheme, config, provider, topics) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-question-index-'))
  try {
    const paperPath = path.join(libraryRoot, paper.subject, paper.file)
    const markSchemePath = path.join(libraryRoot, markScheme.subject, markScheme.file)
    const qpPages = renderPdf(paperPath, path.join(tempDirectory, 'qp'), 'page')
    const msPages = renderPdf(markSchemePath, path.join(tempDirectory, 'ms'), 'page')
    const questionRecords = await mapLimited(qpPages, visionConcurrency, async (page) => {
      const value = await callVision(provider, page.filePath, questionInstruction(paper.subject, topics, page.page))
      return { page: page.page, fragments: value.fragments || [] }
    })
    const answerRecords = await mapLimited(msPages, visionConcurrency, async (page) => {
      const value = await callVision(provider, page.filePath, answerInstruction(paper.subject, page.page))
      return { page: page.page, answers: value.answers || [] }
    })
    if (process.env.QUESTION_INDEX_DEBUG) {
      const summarize = (record, key) => ({
        page: record.page,
        count: (record[key] || []).length,
        parts: (record[key] || []).slice(0, 12).map((fragment) => ({
          questionNumber: fragment.questionNumber,
          partId: fragment.partId,
          label: fragment.label,
          marks: fragment.marks,
          topicId: fragment.topicId,
        })),
      })
      console.log(JSON.stringify({
        paper: paper.file,
        questionPages: questionRecords.map((record) => summarize(record, 'fragments')),
        answerPages: answerRecords.map((record) => summarize(record, 'answers')),
      }))
    }
    if (process.env.QUESTION_INDEX_DEBUG_FILE) {
      const debugPath = path.resolve(process.env.QUESTION_INDEX_DEBUG_FILE)
      fs.mkdirSync(path.dirname(debugPath), { recursive: true })
      fs.writeFileSync(debugPath, `${JSON.stringify({
        paper: paper.file,
        markScheme: markScheme.file,
        questionRecords,
        answerRecords,
      }, null, 2)}\n`)
    }
    const outputDirectory = path.join(assetRoot, paper.id)
    copyRenderedPages(qpPages, outputDirectory, 'qp')
    copyRenderedPages(msPages, outputDirectory, 'ms')
    return buildItems(paper, markScheme, config, mergeFragments(questionRecords, 'fragments'), mergeFragments(answerRecords, 'answers'))
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true })
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const config = subjectConfig[args.subject]
  if (!config) throw new Error(`Unsupported subject: ${args.subject}`)
  const provider = providerConfig(args)
  const catalog = JSON.parse(fs.readFileSync(paperCatalogPath, 'utf8'))
  const byId = new Map(catalog.items.map((item) => [item.id, item]))
  const candidates = catalog.items
    .filter((item) => item.subject === args.subject && item.kind === 'qp' && item.markSchemeId && item.examProfile && (!args.components.length || args.components.includes(item.examProfile.paperNumber)) && (!args.files.length || args.files.includes(item.file)))
    .sort((left, right) => (right.year - left.year) || left.file.localeCompare(right.file))
  const papers = args.all ? candidates : candidates.slice(0, args.papers)
  if (args.dryRun) {
    console.log(JSON.stringify({ subject: args.subject, papers: papers.map((paper) => ({ file: paper.file, markScheme: byId.get(paper.markSchemeId)?.file })) }, null, 2))
    return
  }
  const imported = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
  const byBankId = new Map(joinStoredIndex(imported).map((item) => [item.bankId || item.questionId, item]))
  if (args.migrateOnly) {
    writeIndexAndRefreshSourceManifest([...byBankId.values()])
    console.log(`Migrated ${byBankId.size} question/answer bindings to schema v2.`)
    return
  }
  for (const paper of papers) {
    const markScheme = byId.get(paper.markSchemeId)
    if (!markScheme) continue
    const existingForPaper = [...byBankId.values()].filter((item) => item.sourceRef?.paperId === paper.id).length
    const expectedQuestions = minimumQuestionGroupsForImport(paper)
    const paperComplete = existingForPaper >= expectedQuestions
    if (paperComplete && !args.force) {
      console.log(`Skipping ${paper.file}; ${existingForPaper} verified questions are already indexed`)
      continue
    }
    console.log(`Indexing ${paper.file} with ${markScheme.file}`)
    const topics = topicsFor(config, paper)
    const items = await indexPaper(paper, markScheme, config, provider, topics)
    const protectedReviews = [...byBankId.values()].filter((item) => item.sourceRef?.paperId === paper.id && isHumanReviewedIndexItem(item)).length
    const refreshedItems = replaceMachineIndexedPaperItems([...byBankId.values()], paper.id, items)
    byBankId.clear()
    for (const item of refreshedItems) byBankId.set(item.bankId || item.questionId, item)
    console.log(`Indexed ${items.length} verified questions from ${paper.file}`)
    if (protectedReviews) console.log(`Preserved ${protectedReviews} human-reviewed question${protectedReviews === 1 ? '' : 's'} from reimport.`)
  }
  const items = [...byBankId.values()].sort((left, right) => left.bankId.localeCompare(right.bankId, undefined, { numeric: true }))
  writeIndexAndRefreshSourceManifest(items)
  const subjectCount = items.filter((item) => item.subjectCode === args.subject).length
  console.log(`Question index now contains ${subjectCount} ${args.subject} items (${items.length} total).`)
  if (subjectCount < args.minQuestions) process.exitCode = 2
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
