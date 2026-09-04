import fs from 'node:fs'
import path from 'node:path'

// A main question number is printed at the start of a visual text line. The
// line boundary is essential: a body value such as `2 A flowing ...` must not
// become a new question anchor.
const MAIN_QUESTION_LINE_PATTERN = /^(\d{1,2})\s+(?=\(a\)|A\s+(?!Level\b)|An\s+|The\s+|On\s+|By\s+|Let\s+|Find\s+|State\s+|Explain\s+)/i

function pageTextLines(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function firstContentLine(lines) {
  return lines.find((line) => !/^\d{1,3}$/.test(line) && !/^UCLES\s+20\d{2}\b/i.test(line) && !/^\[Turn over\]/i.test(line)) || ''
}

/**
 * Returns a main printed question number only when the page text has one
 * unambiguous candidate. `null` means the text layer is readable but the page
 * contains no main question number; `undefined` means the page is ambiguous.
 */
export function questionNumberFromPageText(value) {
  const lines = pageTextLines(value)
  if (!lines.length) return undefined
  const numbers = lines
    .map((line, index) => {
      const direct = line.match(MAIN_QUESTION_LINE_PATTERN)
      if (direct) return Number(direct[1])
      if (/^\d{1,2}$/.test(line) && /^\(a\)/i.test(lines[index + 1] || '')) return Number(line)
      return null
    })
    .filter((number) => Number.isInteger(number) && number > 0 && number <= 30)
  const unique = [...new Set(numbers)]
  if (unique.length === 1) return String(unique[0])
  if (unique.length > 1) return undefined
  if (lines.some((line) => /\bBLANK PAGE\b/i.test(line))) return null
  return /^(?:\([a-z]\)|\([ivxlcdm]+\))(?:\s|$)/i.test(firstContentLine(lines)) ? null : undefined
}

function textLinesFromPageItems(items) {
  const lines = []
  for (const item of items || []) {
    const text = String(item?.str || '').trim()
    if (!text) continue
    const y = Number(item?.transform?.[5])
    const current = lines.find((line) => Number.isFinite(y) && Number.isFinite(line.y) && Math.abs(line.y - y) <= 2)
    if (current) {
      current.items.push({ x: Number(item?.transform?.[4]) || 0, text })
    } else {
      lines.push({ y, items: [{ x: Number(item?.transform?.[4]) || 0, text }] })
    }
  }
  return lines
    .sort((left, right) => right.y - left.y)
    .map((line) => line.items.sort((left, right) => left.x - right.x).map((item) => item.text).join(' '))
}

/** Extract page-level anchors from a local PDF without sending the PDF anywhere. */
export async function extractQuestionPageAnchors(pdfPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(pdfPath)),
    disableWorker: true,
    standardFontDataUrl: `${path.resolve(import.meta.dirname, '../node_modules/pdfjs-dist/standard_fonts')}${path.sep}`,
  })
  const document = await task.promise
  const anchors = new Map()
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const anchor = questionNumberFromPageText(textLinesFromPageItems(content.items).join('\n'))
      if (anchor !== undefined) anchors.set(pageNumber, anchor)
    }
  } finally {
    if (typeof document.destroy === 'function') await document.destroy()
  }
  return anchors
}
