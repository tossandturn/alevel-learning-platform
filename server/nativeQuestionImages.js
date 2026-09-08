import crypto from 'node:crypto'
import { isStudentReleasedAiStudyItem } from '../src/data/questionBank.js'
import { readVerifiedSourcePage } from './nativeSourcePages.js'

const HASH = /^[a-f0-9]{64}$/
const fail = (statusCode, code) => { throw Object.assign(new Error('题目原图暂时不可用，请重新加载。'), { statusCode, code }) }

function pixelBounds({ region: [x0, y0, x1, y1], imageSize: [width, height] }) {
  const left = Math.floor(x0 * width), top = Math.floor(y0 * height)
  return { left, top, width: Math.ceil(x1 * width) - left, height: Math.ceil(y1 * height) - top }
}

async function sourceRegionPixels(page, descriptor) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  // Only source-verified bytes are decoded. Never accept image URLs or crop
  // coordinates from the client; the descriptor is resolved from the bank.
  const image = await loadImage(page.bytes)
  if (image.width !== descriptor.imageSize[0] || image.height !== descriptor.imageSize[1]) fail(422, 'native_question_image_invalid')
  const box = pixelBounds(descriptor), canvas = createCanvas(box.width, box.height)
  canvas.getContext('2d').drawImage(image, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height)
  const bytes = await canvas.encode('png')
  return { bytes, contentType: 'image/png', sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    sourcePageSha256: descriptor.spec.expectedPageImageSha256, imageSize: [box.width, box.height] }
}

function regionsFor(question, isReleased) {
  if (!isReleased(question) || question.sourceContent?.schemaVersion !== 'ai-verified-coordinate-source-v1' ||
    question.sourceContent.complete !== true || question.sourceContent.fileComplete !== true) return []
  const hash = String(question.sourceRef?.sha256 || '').replace(/^sha256:/i, '').toLowerCase()
  if (!HASH.test(hash) || !/^\d{4}$/.test(question.subjectCode) || !/^\d{4}_[msw]\d{2}_qp_\d{2}\.pdf$/.test(question.sourceRef?.paper || '')) return []
  const records = [...(question.parts || []).flatMap(part => part.sourceEvidence || []), ...(question.diagramRegions || [])]
  if (!records.length || records.length > 200) return []
  const unique = new Map()
  for (const record of records) {
    const { region, imageSize } = record, page = Number(record.page), pageHash = String(record.pageImageSha256 || '').toLowerCase()
    if (record.coordinateSpace !== 'normalized-xyxy' || record.documentSha256 !== hash || !HASH.test(pageHash) ||
      !Number.isInteger(page) || page < 1 || page > 1000 || !Array.isArray(region) || region.length !== 4 ||
      !region.every(Number.isFinite) || region[0] < 0 || region[1] < 0 || region[2] > 1 || region[3] > 1 || region[0] >= region[2] || region[1] >= region[3] ||
      !Array.isArray(imageSize) || imageSize.length !== 2 || !imageSize.every(n => Number.isInteger(n) && n > 0 && n <= 10000) || imageSize[0] * imageSize[1] > 24000000) return []
    unique.set(JSON.stringify([page, region, pageHash]), { page, region, imageSize, pageHash, hash })
  }
  const all = [...unique.values()]
  const visible = all.filter((item, index) => !all.some((other, j) => j !== index && other.page === item.page && other.pageHash === item.pageHash &&
    other.region[0] <= item.region[0] && other.region[1] <= item.region[1] && other.region[2] >= item.region[2] && other.region[3] >= item.region[3]))
  if (visible.length > 20) return []
  return visible.sort((a, b) => a.page - b.page || a.region[1] - b.region[1] || a.region[0] - b.region[0])
}

export function createNativeQuestionImages({ getQuestionBank, libraryRoot, env = {}, pageReader = readVerifiedSourcePage, isReleased = isStudentReleasedAiStudyItem } = {}) {
  const cache = new Map(), pending = new Map(), queue = []
  let cachedBytes = 0, active = false
  function resolve(routeId, sourceQuestionId) {
    const matches = (getQuestionBank() || []).filter(q => q.routeId === routeId && q.sourceQuestionId === sourceQuestionId)
    if (matches.length !== 1) return []
    const question = matches[0]
    return regionsFor(question, isReleased).map((region, index) => {
      const v = crypto.createHash('sha256').update(JSON.stringify([routeId, sourceQuestionId, question.sourceContent.bindingSignature, question.sourceRef, region])).digest('hex')
      const url = '/api/stem/practice-source-image?routeId=' + encodeURIComponent(routeId) + '&sourceQuestionId=' + encodeURIComponent(sourceQuestionId) + '&region=' + index + '&v=' + v
      return { url, schemaVersion: 'native-source-region-v1', page: region.page, region: region.region, imageSize: region.imageSize, v,
        spec: { libraryRoot, cacheRoot: env.STEM_SOURCE_PAGE_CACHE_ROOT, subject: question.subjectCode, fileName: question.sourceRef.paper,
          expectedPdfSha256: region.hash, page: region.page, expectedPageImageSha256: region.pageHash, imageSize: region.imageSize, role: 'question-paper' } }
    })
  }
  const publicDescriptor = (descriptor, { view = 'page' } = {}) => {
    const { url, schemaVersion, page, region, imageSize } = descriptor
    if (view !== 'region') return { url, schemaVersion, page, region, imageSize }
    const box = pixelBounds(descriptor)
    return { url: url + '&view=region', schemaVersion: 'native-source-region-v2', page, region, imageSize,
      renderedImageSize: [box.width, box.height] }
  }
  function projectSet(result, options) {
    return { ...result, questionGroups: result.questionGroups.map(group => {
      if (group.sourceContent?.assetUrls?.length) return group
      const descriptors = resolve(group.routeId, group.id)
      return descriptors.length ? { ...group, nativeSourceImages: descriptors.map(d => publicDescriptor(d, options)) } : group
    }) }
  }
  async function drain() {
    if (active || !queue.length) return
    active = true
    const job = queue.shift()
    try {
      const page = await pageReader(job.descriptor.spec)
      if (resolve(job.routeId, job.sourceQuestionId)[job.region]?.v !== job.v) fail(409, 'native_question_image_changed')
      if (!Buffer.isBuffer(page.bytes) || !page.bytes.length || page.bytes.length > 8 * 1024 * 1024 || page.contentType !== 'image/png' ||
        crypto.createHash('sha256').update(page.bytes).digest('hex') !== job.descriptor.spec.expectedPageImageSha256) fail(422, 'native_question_image_invalid')
      const value = job.view === 'region' ? await sourceRegionPixels(page, job.descriptor) : page
      if (resolve(job.routeId, job.sourceQuestionId)[job.region]?.v !== job.v) fail(409, 'native_question_image_changed')
      while (cache.size >= 40 || cachedBytes + value.bytes.length > 8 * 1024 * 1024) {
        const first = cache.keys().next().value
        if (first === undefined) break
        cachedBytes -= cache.get(first).bytes.length; cache.delete(first)
      }
      cache.set(job.cacheKey, value); cachedBytes += value.bytes.length; job.resolve(value)
    } catch (error) { job.reject(error) }
    finally { pending.delete(job.cacheKey); active = false; drain() }
  }
  function image(input) {
    const routeId = String(input.routeId || ''), sourceQuestionId = String(input.sourceQuestionId || ''), region = Number(input.region), v = String(input.v || ''), view = input.view === undefined ? 'page' : String(input.view)
    if (!/^[a-z0-9-]{1,100}$/.test(routeId) || !/^[-A-Za-z0-9_:]{1,200}$/.test(sourceQuestionId) ||
      !/^\d{1,2}$/.test(String(input.region)) || !Number.isInteger(region) || region < 0 || region >= 20 || !HASH.test(v) || !['page', 'region'].includes(view)) fail(400, 'native_question_image_scope')
    const descriptor = resolve(routeId, sourceQuestionId)[region]
    if (!descriptor) fail(404, 'native_question_image_not_found')
    if (descriptor.v !== v) fail(409, 'native_question_image_changed')
    const cacheKey = v + ':' + view
    if (cache.has(cacheKey)) {
      const value = cache.get(cacheKey); cache.delete(cacheKey); cache.set(cacheKey, value); return Promise.resolve(value)
    }
    if (pending.has(cacheKey)) return pending.get(cacheKey)
    if (queue.length >= 4) fail(503, 'native_question_image_busy')
    const promise = new Promise((resolve, reject) => queue.push({ routeId, sourceQuestionId, region, v, cacheKey, view, descriptor, resolve, reject }))
    pending.set(cacheKey, promise); drain(); return promise
  }
  return { projectSet, image, descriptors: (routeId, id, options) => resolve(routeId, id).map(d => publicDescriptor(d, options)) }
}
