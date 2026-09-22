import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const PAGE_MARGIN = 48
const CONTENT_WIDTH = PAGE_WIDTH - (PAGE_MARGIN * 2)
const CONTENT_BOTTOM = PAGE_HEIGHT - 62
const REPORT_FONT_ALIAS = 'STEM Whole Paper Report'
const REPORT_FONT_STACK = `"${REPORT_FONT_ALIAS}", sans-serif`
const registeredReportFonts = new Map()
const REPORT_RASTER_SCALE = 2
const REPORT_JPEG_QUALITY = 0.88
const MAX_REPORT_PAGES = 60
const MAX_REPORT_BYTES = 10 * 1024 * 1024
const DEFAULT_LINUX_CJK_FONT_PATH = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'

const COLORS = Object.freeze({
  ink: '#172033',
  muted: '#59657a',
  faint: '#8b95a8',
  line: '#dce2ea',
  paper: '#ffffff',
  panel: '#f4f7fb',
  accent: '#2456d6',
  accentSoft: '#eaf0ff',
  warning: '#9a5a00',
  warningSoft: '#fff4dc',
  danger: '#9b2c2c',
})

export const WHOLE_PAPER_REPORT_STUDENT_COPY = Object.freeze({
  guidanceTitle: 'AI-generated feedback',
  guidanceBody: 'This is the completed AI assessment. Any score shown is an AI estimate, not an official grade. Uncertain or incomplete items are labelled so you can add clearer pages or references and retry.',
  uncertaintyTitle: 'AI uncertainty noted',
  uncertaintyBody: 'Some findings are uncertain or incomplete. Check the highlighted items, add clearer or missing pages or references if available, then retry for an updated report.',
  questionUncertainty: 'AI uncertainty: this item may be incomplete or unclear. Add a clearer answer or reference page and retry if needed.',
  completenessAction: 'To update these findings, add clearer or missing pages or references and retry the AI assessment.',
})

const REFERENCE_BACKED_MODES = new Set([
  'ai-provisional',
  'reference-backed',
  'mark-scheme',
  'mark-scheme-backed',
  'verified-reference',
  'with-reference',
  'official-reference',
])

const UNREFERENCED_MODES = new Set([
  'ai-advisory-unscored',
  'unreferenced',
  'no-reference',
  'without-reference',
  'feedback-only',
  'qualitative-only',
])

const SECRET_PATTERNS = Object.freeze([
  /\bsk-[a-z0-9_-]{12,}\b/giu,
  /\bBearer\s+[^\s,;]+/giu,
  /\b(?:api[_-]?key|access[_-]?token|provider[_-]?key|secret)\s*[:=]\s*[^\s,;]+/giu,
])

const MATH_SYMBOLS = Object.freeze({
  times: '×', cdot: '·', pm: '±', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', approx: '≈',
  to: '→', rightarrow: '→', leftarrow: '←', degree: '°', infty: '∞', therefore: '∴',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', omega: 'ω',
  Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω',
})

function readableMath(value) {
  let result = String(value || '')
  for (let pass = 0; pass < 4; pass += 1) {
    result = result.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/gu, '($1)/($2)')
      .replace(/\\sqrt\s*\{([^{}]*)\}/gu, '√($1)')
      .replace(/\\(?:mathrm|mathbf|text|operatorname)\s*\{([^{}]*)\}/gu, '$1')
  }
  result = result.replace(/\\([A-Za-z]+)/gu, (match, command) => MATH_SYMBOLS[command] || command)
    .replace(/\$+/gu, '')
    .replace(/[{}]/gu, '')
  return result
}

function reportFontError(message) {
  return Object.assign(new Error(message), { code: 'report_font_unavailable', statusCode: 503, retryable: true })
}

function reportOutputError(code, message, statusCode = 413) {
  return Object.assign(new Error(message), { code, statusCode, retryable: false })
}

function containsCjk(value) {
  return /[\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u.test(JSON.stringify(value))
}

function ensureReportFont(report, {
  fontPath = process.env.STEM_WHOLE_PAPER_CJK_FONT_PATH
    || (process.platform === 'linux' && fs.existsSync(DEFAULT_LINUX_CJK_FONT_PATH) ? DEFAULT_LINUX_CJK_FONT_PATH : ''),
  fontSha256 = process.env.STEM_WHOLE_PAPER_CJK_FONT_SHA256 || '',
} = {}) {
  if (!containsCjk(report)) return
  const resolved = path.resolve(String(fontPath || ''))
  if (!fontPath || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile() || !/\.(?:otf|ttf|ttc)$/iu.test(resolved)) {
    throw reportFontError('A configured CJK-capable report font is required for non-ASCII report text.')
  }
  const bytes = fs.readFileSync(resolved)
  if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw reportFontError('The configured report font is invalid or too large.')
  const digest = crypto.createHash('sha256').update(bytes).digest('hex')
  const expected = String(fontSha256 || '').trim().toLowerCase().replace(/^sha256:/u, '')
  if (expected && (!/^[a-f0-9]{64}$/u.test(expected) || expected !== digest)) throw reportFontError('The configured report font failed its checksum contract.')
  const previous = registeredReportFonts.get(REPORT_FONT_ALIAS)
  if (previous && previous !== digest) throw reportFontError('A different report font is already registered in this process.')
  if (!previous) {
    const registered = GlobalFonts.registerFromPath(resolved, REPORT_FONT_ALIAS)
    if (!registered) throw reportFontError('The configured report font could not be registered.')
    registeredReportFonts.set(REPORT_FONT_ALIAS, digest)
  }
}

function boundedText(value, maxLength, fallback = '') {
  if (typeof value !== 'string') return fallback
  let result = Array.from(readableMath(value)
    .replace(/\r\n?/gu, '\n')
    .replace(/\t/gu, ' '))
    .filter((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint === 10 || (codePoint >= 32 && codePoint !== 127)
    })
    .join('')
    .replace(/[\u202a-\u202e\u2066-\u2069]/giu, '')
    .replace(/ {3,}/gu, '  ')
    .replace(/\n{4,}/gu, '\n\n\n')
    .trim()
  for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, '[redacted]')
  return Array.from(result).slice(0, maxLength).join('') || fallback
}

function selfServiceAiText(value, maxLength, fallback = '') {
  let result = boundedText(value, maxLength, fallback)
  if (!result) return result
  const replacement = /[\u2e80-\u9fff\uf900-\ufaff]/u.test(result)
    ? 'AI 已标注此处存在不确定性；请补充更清晰或缺失的材料后重试。'
    : 'AI uncertainty is noted; add clearer or missing material and retry.'
  return result
    .replace(/\bhuman review (?:is )?required\b/giu, replacement)
    .replace(/\b(?:a )?(?:human|teacher|examiner) (?:must|should|needs? to) review(?: this| the)?(?: response| answer| work)?\b/giu, replacement)
    .replace(/\bneeds? (?:a )?(?:human|teacher|examiner) review\b/giu, replacement)
    .replace(/(?:需要|必须)(?:人工|老师|教师|考官)(?:审核|复核)/gu, replacement)
}

function shortLabel(value, maxLength = 100) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return boundedText(value, maxLength)
}

function normalizeMode(value) {
  const raw = boundedText(value, 80).toLowerCase().replace(/[\s_]+/gu, '-')
  if (REFERENCE_BACKED_MODES.has(raw)) {
    return Object.freeze({
      key: 'reference-backed',
      label: 'Uploaded-reference AI estimate',
      hasUploadedReference: true,
    })
  }
  if (UNREFERENCED_MODES.has(raw)) {
    return Object.freeze({
      key: 'unreferenced',
      label: 'Qualitative AI feedback (no uploaded reference)',
      hasUploadedReference: false,
    })
  }
  return Object.freeze({
    key: 'unknown',
    label: 'AI-assisted review (reference status unverified)',
    hasUploadedReference: false,
  })
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function scorePair(score, maximum) {
  const normalizedScore = finiteNumber(score)
  const normalizedMaximum = finiteNumber(maximum)
  if (normalizedScore === null || normalizedMaximum === null
    || normalizedScore < 0 || normalizedMaximum <= 0
    || normalizedScore > normalizedMaximum || normalizedMaximum > 100_000) return null
  return Object.freeze({ score: normalizedScore, maximum: normalizedMaximum })
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

function confidenceLabel(value) {
  let confidence = finiteNumber(value)
  if (confidence === null || confidence < 0) return ''
  if (confidence <= 1) confidence *= 100
  if (confidence > 100) return ''
  if (confidence >= 85) return 'High'
  if (confidence >= 60) return 'Moderate'
  return 'Low'
}

function uniqueList(values, { maxItems = 100, maxLength = 100, numeric = false } = {}) {
  if (!Array.isArray(values)) return []
  const seen = new Set()
  const result = []
  for (const value of values) {
    let item = ''
    if (numeric) {
      const number = Number(value)
      if (Number.isInteger(number) && number > 0 && number <= 100_000) item = String(number)
    } else {
      item = shortLabel(value, maxLength)
    }
    if (!item || seen.has(item)) continue
    seen.add(item)
    result.push(item)
    if (result.length >= maxItems) break
  }
  return result
}

function evidenceText(value) {
  if (typeof value === 'string') return selfServiceAiText(value, 1_200)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const page = Number(value.page)
  const prefix = Number.isInteger(page) && page > 0 && page <= 100_000 ? `Page ${page}` : ''
  const label = boundedText(value.label ?? value.title, 120)
  const detail = boundedText(value.description ?? value.quote ?? value.text, 1_000)
  return selfServiceAiText([prefix, label, detail].filter(Boolean).join(' — '), 1_200)
}

function criterionText(value) {
  if (typeof value === 'string') return boundedText(value, 1_200)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const label = boundedText(value.label ?? value.name ?? value.title, 160)
  const detail = boundedText(value.detail ?? value.description ?? value.reason ?? value.comment, 1_000)
  let outcome = ''
  if (value.met === true) outcome = 'Met'
  if (value.met === false) outcome = 'Not met'
  if (!outcome) outcome = boundedText(value.outcome ?? value.status, 80)
  return selfServiceAiText([label, outcome, detail].filter(Boolean).join(' — '), 1_200)
}

function normalizedDetails(values, normalizer) {
  const source = Array.isArray(values) ? values : (values === undefined || values === null ? [] : [values])
  return source.slice(0, 40).map(normalizer).filter(Boolean)
}

function normalizeQuestions(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 200).map((entry, index) => {
    const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}
    return Object.freeze({
      questionNumber: shortLabel(source.questionNumber ?? source.questionLabel ?? source.number, 60) || String(index + 1),
      score: scorePair(
        source.provisionalScore ?? source.estimatedScore ?? source.awardedMarks,
        source.maxScore ?? source.maximumScore ?? source.maxMarks,
      ),
      confidence: confidenceLabel(source.confidence),
      reviewRequired: source.reviewRequired === true || (finiteNumber(source.confidence) !== null && Number(source.confidence) < 0.7),
      reason: selfServiceAiText(source.reason ?? source.rationale, 4_000),
      evidence: Object.freeze(normalizedDetails(source.evidence, evidenceText)),
      criteria: Object.freeze(normalizedDetails(source.criteria, criterionText)),
    })
  })
}

export function normalizeWholePaperReportInput(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const mode = normalizeMode(source.assessmentMode)
  return Object.freeze({
    title: boundedText(source.title, 100, 'Whole-paper AI marking report'),
    studentLabel: boundedText(source.studentLabel, 120),
    instructions: selfServiceAiText(source.instructions, 2_000),
    mode,
    score: mode.hasUploadedReference ? scorePair(source.provisionalScore, source.maxScore) : null,
    reviewRequired: source.reviewRequired === true,
    missingPages: Object.freeze(uniqueList(source.missingPages, { numeric: true })),
    missingQuestions: Object.freeze(uniqueList(source.missingQuestions, { maxLength: 80 })),
    summary: selfServiceAiText(source.summary, 12_000),
    questions: Object.freeze(normalizeQuestions(source.questionResults)),
  })
}

function splitLongToken(context, token, maxWidth) {
  const lines = []
  let line = ''
  for (const character of Array.from(token)) {
    const candidate = `${line}${character}`
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = character
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

function wrapParagraph(context, paragraph, maxWidth) {
  if (!paragraph) return ['']
  const tokens = paragraph.match(/\S+\s*/gu) || []
  const lines = []
  let line = ''
  for (const token of tokens) {
    const candidate = `${line}${token}`
    if (!line || context.measureText(candidate.trimEnd()).width <= maxWidth) {
      line = candidate
      if (context.measureText(line.trimEnd()).width <= maxWidth) continue
    }

    if (line && line !== token) {
      lines.push(line.trimEnd())
      line = ''
    }

    const cleanToken = token.trimEnd()
    if (context.measureText(cleanToken).width <= maxWidth) {
      line = token
      continue
    }
    const fragments = splitLongToken(context, cleanToken, maxWidth)
    lines.push(...fragments.slice(0, -1))
    line = fragments.at(-1) || ''
    if (/\s$/u.test(token)) line += ' '
  }
  if (line.trimEnd()) lines.push(line.trimEnd())
  return lines.length ? lines : ['']
}

function wrappedLines(context, value, maxWidth) {
  const paragraphs = String(value ?? '').split('\n')
  return paragraphs.flatMap((paragraph, index) => [
    ...(index > 0 ? [''] : []),
    ...wrapParagraph(context, paragraph, maxWidth),
  ])
}

class ReportWriter {
  constructor(title) {
    this.titleValue = title
    this.pageImages = []
    this.canvas = null
    this.context = null
    this.pageNumber = 0
    this.y = 0
    this.beginPage(true)
  }

  beginPage(firstPage = false) {
    this.finalizePage()
    if (this.pageImages.length >= MAX_REPORT_PAGES) throw reportOutputError('report_page_limit', `The report exceeds the ${MAX_REPORT_PAGES}-page limit.`)
    this.pageNumber += 1
    this.canvas = createCanvas(Math.ceil(PAGE_WIDTH * REPORT_RASTER_SCALE), Math.ceil(PAGE_HEIGHT * REPORT_RASTER_SCALE))
    this.context = this.canvas.getContext('2d')
    this.context.scale(REPORT_RASTER_SCALE, REPORT_RASTER_SCALE)
    const context = this.context
    context.fillStyle = COLORS.paper
    context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
    context.fillStyle = COLORS.accent
    context.fillRect(0, 0, PAGE_WIDTH, firstPage ? 12 : 7)

    if (firstPage) {
      this.y = 42
    } else {
      context.font = `700 9px ${REPORT_FONT_STACK}`
      context.fillStyle = COLORS.accent
      context.textBaseline = 'top'
      context.fillText('WHOLE-PAPER AI REVIEW · CONTINUED', PAGE_MARGIN, 28)
      context.strokeStyle = COLORS.line
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(PAGE_MARGIN, 47)
      context.lineTo(PAGE_WIDTH - PAGE_MARGIN, 47)
      context.stroke()
      this.y = 62
    }
    this.drawFooter()
  }

  finalizePage() {
    if (!this.canvas) return
    this.pageImages.push(this.canvas.toBuffer('image/jpeg', { quality: REPORT_JPEG_QUALITY, chromaSubsampling: true }))
    this.canvas = null
    this.context = null
  }

  drawFooter() {
    const context = this.context
    const footerY = PAGE_HEIGHT - 43
    context.strokeStyle = COLORS.line
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(PAGE_MARGIN, footerY - 8)
    context.lineTo(PAGE_WIDTH - PAGE_MARGIN, footerY - 8)
    context.stroke()
    context.font = `400 8px ${REPORT_FONT_STACK}`
    context.fillStyle = COLORS.faint
    context.textBaseline = 'top'
    context.fillText(
      `AI-generated guidance · Provisional and unofficial · Page ${this.pageNumber}`,
      PAGE_MARGIN,
      footerY,
    )
  }

  ensureSpace(height) {
    if (this.y + height <= CONTENT_BOTTOM) return
    this.beginPage(false)
  }

  estimatedTextHeight(value, { font = `400 10.5px ${REPORT_FONT_STACK}`, width = CONTENT_WIDTH, lineHeight = 15 } = {}) {
    if (!value) return 0
    this.context.font = font
    return wrappedLines(this.context, value, width).length * lineHeight
  }

  gap(height = 10) {
    this.y += height
  }

  rule() {
    this.ensureSpace(14)
    this.context.strokeStyle = COLORS.line
    this.context.lineWidth = 1
    this.context.beginPath()
    this.context.moveTo(PAGE_MARGIN, this.y + 5)
    this.context.lineTo(PAGE_WIDTH - PAGE_MARGIN, this.y + 5)
    this.context.stroke()
    this.y += 14
  }

  text(value, {
    x = PAGE_MARGIN,
    width = CONTENT_WIDTH,
    font = `400 10.5px ${REPORT_FONT_STACK}`,
    color = COLORS.ink,
    lineHeight = 15,
    gapAfter = 0,
  } = {}) {
    if (!value) return
    this.context.font = font
    const lines = wrappedLines(this.context, value, width)
    for (const line of lines) {
      this.ensureSpace(lineHeight)
      this.context.font = font
      this.context.fillStyle = color
      this.context.textBaseline = 'top'
      if (line) this.context.fillText(line, x, this.y)
      this.y += lineHeight
    }
    this.y += gapAfter
  }

  title(value) {
    this.text('WHOLE-PAPER AI REVIEW', {
      font: `700 9px ${REPORT_FONT_STACK}`,
      color: COLORS.accent,
      lineHeight: 13,
      gapAfter: 7,
    })
    this.text(value, {
      font: `700 23px ${REPORT_FONT_STACK}`,
      color: COLORS.ink,
      lineHeight: 28,
      gapAfter: 7,
    })
  }

  section(value) {
    this.ensureSpace(34)
    this.context.fillStyle = COLORS.accent
    this.context.fillRect(PAGE_MARGIN, this.y + 1, 4, 16)
    this.context.font = `700 13px ${REPORT_FONT_STACK}`
    this.context.fillStyle = COLORS.ink
    this.context.textBaseline = 'top'
    this.context.fillText(value, PAGE_MARGIN + 12, this.y)
    this.y += 27
  }

  notice(title, body, { warning = false } = {}) {
    const font = `400 10px ${REPORT_FONT_STACK}`
    this.context.font = font
    const lines = wrappedLines(this.context, body, CONTENT_WIDTH - 28)
    const height = 42 + (lines.length * 14)
    this.ensureSpace(height + 8)
    const startY = this.y
    this.context.fillStyle = warning ? COLORS.warningSoft : COLORS.accentSoft
    this.context.fillRect(PAGE_MARGIN, startY, CONTENT_WIDTH, height)
    this.context.font = `700 11px ${REPORT_FONT_STACK}`
    this.context.fillStyle = warning ? COLORS.warning : COLORS.accent
    this.context.textBaseline = 'top'
    this.context.fillText(title, PAGE_MARGIN + 14, startY + 12)
    this.y = startY + 33
    for (const line of lines) {
      this.context.font = font
      this.context.fillStyle = COLORS.ink
      if (line) this.context.fillText(line, PAGE_MARGIN + 14, this.y)
      this.y += 14
    }
    this.y = startY + height + 10
  }

  score(pair) {
    this.ensureSpace(76)
    const startY = this.y
    this.context.fillStyle = COLORS.panel
    this.context.fillRect(PAGE_MARGIN, startY, CONTENT_WIDTH, 66)
    this.context.font = `700 10px ${REPORT_FONT_STACK}`
    this.context.fillStyle = COLORS.accent
    this.context.textBaseline = 'top'
    this.context.fillText('AI ESTIMATED SCORE · NOT AN OFFICIAL GRADE', PAGE_MARGIN + 14, startY + 11)
    this.context.font = `700 23px ${REPORT_FONT_STACK}`
    this.context.fillStyle = COLORS.ink
    this.context.fillText(
      `${formatNumber(pair.score)} / ${formatNumber(pair.maximum)}`,
      PAGE_MARGIN + 14,
      startY + 29,
    )
    this.y = startY + 76
  }

  bullets(items) {
    for (const item of items) {
      this.context.font = `400 10.5px ${REPORT_FONT_STACK}`
      const lines = wrappedLines(this.context, item, CONTENT_WIDTH - 18)
      this.ensureSpace(Math.min(30, lines.length * 15))
      for (const [index, line] of lines.entries()) {
        this.ensureSpace(15)
        this.context.font = `400 10.5px ${REPORT_FONT_STACK}`
        this.context.fillStyle = COLORS.ink
        this.context.textBaseline = 'top'
        if (index === 0) {
          this.context.fillStyle = COLORS.accent
          this.context.fillText('•', PAGE_MARGIN + 1, this.y)
        }
        this.context.fillStyle = COLORS.ink
        if (line) this.context.fillText(line, PAGE_MARGIN + 16, this.y)
        this.y += 15
      }
      this.y += 3
    }
  }

  async close() {
    this.finalizePage()
    const document = await PDFDocument.create()
    document.setTitle(this.titleValue)
    document.setAuthor('STEM Learning Platform')
    document.setSubject('AI-generated whole-paper feedback; provisional and unofficial; rasterized for portable font coverage')
    document.setCreator('STEM Learning Platform')
    document.setProducer('STEM Learning Platform')
    for (const bytes of this.pageImages) {
      const image = await document.embedJpg(bytes).catch(() => null)
      if (!image?.width || !image?.height) throw reportOutputError('report_page_invalid', 'A report page could not be encoded.', 500)
      const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      page.drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT })
    }
    const pdf = Buffer.from(await document.save({ useObjectStreams: true, addDefaultPage: false }))
    if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') throw reportOutputError('report_pdf_invalid', 'The report PDF could not be generated.', 500)
    if (pdf.length > MAX_REPORT_BYTES) throw reportOutputError('report_pdf_size_limit', 'The report PDF exceeds the 10 MiB download limit.')
    return pdf
  }
}

function renderQuestion(writer, question, mode) {
  const bodyFont = `400 10.5px ${REPORT_FONT_STACK}`
  const estimatedHeight = 17 + 3
    + (mode.hasUploadedReference && question.score ? 15 : 0)
    + (question.confidence ? 14 : 0)
    + (question.reviewRequired ? 18 : 0)
    + (question.reason ? 15 + writer.estimatedTextHeight(question.reason, { font: bodyFont, lineHeight: 15 }) + 5 : 0)
    + (question.evidence.length ? 15 + question.evidence.reduce((sum, item) => sum + writer.estimatedTextHeight(item, { font: bodyFont, width: CONTENT_WIDTH - 18, lineHeight: 15 }) + 3, 0) : 0)
    + (question.criteria.length ? 15 + question.criteria.reduce((sum, item) => sum + writer.estimatedTextHeight(item, { font: bodyFont, width: CONTENT_WIDTH - 18, lineHeight: 15 }) + 3, 0) : 0)
    + 14
  const onePageCapacity = CONTENT_BOTTOM - 62
  writer.ensureSpace(estimatedHeight <= onePageCapacity ? estimatedHeight : 58)
  writer.text(`Question ${question.questionNumber}`, {
    font: `700 12px ${REPORT_FONT_STACK}`,
    color: COLORS.accent,
    lineHeight: 17,
    gapAfter: 3,
  })

  if (mode.hasUploadedReference && question.score) {
    writer.text(
      `AI estimated score: ${formatNumber(question.score.score)} / ${formatNumber(question.score.maximum)} · Not an official grade`,
      { font: `700 10px ${REPORT_FONT_STACK}`, color: COLORS.ink, lineHeight: 15 },
    )
  }
  if (question.confidence) {
    writer.text(`AI confidence: ${question.confidence}`, {
      font: `400 9.5px ${REPORT_FONT_STACK}`,
      color: COLORS.muted,
      lineHeight: 14,
    })
  }
  if (question.reviewRequired) {
    writer.text(WHOLE_PAPER_REPORT_STUDENT_COPY.questionUncertainty, {
      font: `700 9.5px ${REPORT_FONT_STACK}`,
      color: COLORS.danger,
      lineHeight: 14,
      gapAfter: 4,
    })
  }
  if (question.reason) {
    writer.text('Reason', { font: `700 10px ${REPORT_FONT_STACK}`, lineHeight: 15 })
    writer.text(question.reason, { color: COLORS.muted, lineHeight: 15, gapAfter: 5 })
  }
  if (question.evidence.length) {
    writer.text('Evidence used', { font: `700 10px ${REPORT_FONT_STACK}`, lineHeight: 15 })
    writer.bullets(question.evidence)
  }
  if (question.criteria.length) {
    writer.text('Criteria feedback', { font: `700 10px ${REPORT_FONT_STACK}`, lineHeight: 15 })
    writer.bullets(question.criteria)
  }
  writer.rule()
}

export async function renderWholePaperReport(input, fontOptions) {
  const report = normalizeWholePaperReportInput(input)
  ensureReportFont(report, fontOptions)
  const writer = new ReportWriter(report.title)

  writer.title(report.title)
  if (report.studentLabel) {
    writer.text(`Student: ${report.studentLabel}`, {
      font: `600 10.5px ${REPORT_FONT_STACK}`,
      color: COLORS.muted,
      lineHeight: 15,
      gapAfter: 2,
    })
  }
  writer.text(`Assessment mode: ${report.mode.label}`, {
    font: `400 10px ${REPORT_FONT_STACK}`,
    color: COLORS.muted,
    lineHeight: 15,
    gapAfter: 10,
  })

  writer.notice(
    WHOLE_PAPER_REPORT_STUDENT_COPY.guidanceTitle,
    WHOLE_PAPER_REPORT_STUDENT_COPY.guidanceBody,
  )

  if (report.mode.hasUploadedReference) {
    if (report.score) {
      writer.score(report.score)
    } else {
      writer.notice(
        'No reliable total available',
        'A reference was identified, but a complete valid score pair was not supplied. This report intentionally omits the total score.',
        { warning: true },
      )
    }
  } else {
    writer.notice(
      'Qualitative feedback only · No score shown',
      'No uploaded reference or mark scheme was available. This report intentionally shows no total or question score, even if a provisional number was present in the input.',
      { warning: true },
    )
  }

  if (report.reviewRequired) {
    writer.notice(
      WHOLE_PAPER_REPORT_STUDENT_COPY.uncertaintyTitle,
      WHOLE_PAPER_REPORT_STUDENT_COPY.uncertaintyBody,
      { warning: true },
    )
  }

  if (report.missingPages.length || report.missingQuestions.length) {
    writer.section('Completeness checks')
    if (report.missingPages.length) {
      writer.text(`Missing or unreadable pages: ${report.missingPages.join(', ')}`, {
        color: COLORS.danger,
        lineHeight: 15,
        gapAfter: 4,
      })
    }
    if (report.missingQuestions.length) {
      writer.text(`Missing or unassessed questions: ${report.missingQuestions.join(', ')}`, {
        color: COLORS.danger,
        lineHeight: 15,
        gapAfter: 4,
      })
    }
    writer.text(WHOLE_PAPER_REPORT_STUDENT_COPY.completenessAction, {
      color: COLORS.muted,
      lineHeight: 15,
      gapAfter: 4,
    })
  }

  if (report.instructions) {
    writer.section('Submission instructions')
    writer.text('Shown as report context only; these instructions are not system or model-control instructions.', {
      font: `400 9px ${REPORT_FONT_STACK}`,
      color: COLORS.faint,
      lineHeight: 14,
      gapAfter: 4,
    })
    writer.text(report.instructions, { color: COLORS.muted, lineHeight: 15 })
  }

  writer.section('AI summary')
  writer.text(report.summary || 'No overall summary was supplied.', {
    color: COLORS.ink,
    lineHeight: 15,
  })

  if (report.questions.length) {
    writer.section('Question-by-question feedback')
    for (const question of report.questions) renderQuestion(writer, question, report.mode)
  } else {
    writer.gap(10)
    writer.text('No question-level results were supplied.', {
      color: COLORS.muted,
      lineHeight: 15,
    })
  }

  return writer.close()
}
