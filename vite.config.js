import { defineConfig } from 'vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createAiApi } from './server/aiApi.js'
import { createStemApi } from './server/stemApi.js'

const DEFAULT_LIBRARY_ROOT = 'D:/CodexWork/cie-fraft-fetcher/output/pdf'
const ALLOWED_SUBJECTS = new Set(['0580', '0606', '0610', '0625', '9231', '9700', '9701', '9702', '9708', '9709', 'bpho', 'amc12', 'esat', 'tmua'])
const CIE_SUBJECTS = new Set(['0580', '0606', '0610', '0625', '9231', '9700', '9701', '9702', '9708', '9709'])
let extraSourceCache = null

function extraSourceMap(libraryRoot) {
  if (extraSourceCache) return extraSourceCache
  extraSourceCache = new Map()
  const manifestPath = path.join(path.dirname(libraryRoot), 'extra-contests-manifest.json')
  if (!fs.existsSync(manifestPath)) return extraSourceCache
  for (const item of JSON.parse(fs.readFileSync(manifestPath, 'utf8'))) {
    if (item.url && item.downloaded !== 'missing') extraSourceCache.set(`${item.subject}/${item.file}`, item.url)
  }
  return extraSourceCache
}

function remotePdfUrl(libraryRoot, subject, fileName) {
  if (CIE_SUBJECTS.has(subject)) return `https://cie.fraft.cn/obj/Common/Fetch/redir/${encodeURIComponent(fileName)}`
  return extraSourceMap(libraryRoot).get(`${subject}/${fileName}`) || null
}

async function sendLocalPdf(request, response, next) {
  const requestUrl = new URL(request.url, 'http://127.0.0.1')
  const segments = requestUrl.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (segments[0] !== 'local-pdf') return next()

  const [, subject, fileName] = segments
  if (!ALLOWED_SUBJECTS.has(subject) || !fileName || path.basename(fileName) !== fileName || !fileName.endsWith('.pdf')) {
    response.statusCode = 400
    response.end('Invalid local PDF path')
    return
  }

  const libraryRoot = path.resolve(process.env.CIE_LIBRARY_ROOT || DEFAULT_LIBRARY_ROOT)
  const filePath = path.resolve(libraryRoot, subject, fileName)
  const subjectRoot = path.resolve(libraryRoot, subject)
  if (filePath.startsWith(`${subjectRoot}${path.sep}`) && fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath)
    const range = request.headers.range
    response.setHeader('Content-Type', 'application/pdf')
    response.setHeader('Accept-Ranges', 'bytes')
    response.setHeader('Content-Disposition', `inline; filename="${fileName}"`)
    response.setHeader('Cache-Control', 'private, max-age=3600')

    if (!range) {
      response.setHeader('Content-Length', stat.size)
      fs.createReadStream(filePath).pipe(response)
      return
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match) {
      response.statusCode = 416
      response.setHeader('Content-Range', `bytes */${stat.size}`)
      response.end()
      return
    }

    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= stat.size) {
      response.statusCode = 416
      response.setHeader('Content-Range', `bytes */${stat.size}`)
      response.end()
      return
    }

    response.statusCode = 206
    response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
    response.setHeader('Content-Length', end - start + 1)
    fs.createReadStream(filePath, { start, end }).pipe(response)
    return
  }

  const range = request.headers.range
  const remoteUrl = remotePdfUrl(libraryRoot, subject, fileName)
  if (!remoteUrl) {
    response.statusCode = 404
    response.end('PDF not found')
    return
  }
  const remoteResponse = await fetch(remoteUrl, range ? { headers: { Range: range } } : undefined)
  response.statusCode = remoteResponse.status
  response.setHeader('Content-Type', remoteResponse.headers.get('content-type') || 'application/pdf')
  response.setHeader('Accept-Ranges', remoteResponse.headers.get('accept-ranges') || 'bytes')
  response.setHeader('Content-Disposition', `inline; filename="${fileName}"`)
  response.setHeader('Cache-Control', remoteResponse.headers.get('cache-control') || 'private, max-age=3600')
  const contentLength = remoteResponse.headers.get('content-length')
  const contentRange = remoteResponse.headers.get('content-range')
  if (contentLength) response.setHeader('Content-Length', contentLength)
  if (contentRange) response.setHeader('Content-Range', contentRange)
  if (!remoteResponse.body) {
    response.end()
    return
  }
  Readable.fromWeb(remoteResponse.body).pipe(response)
}

function localCieLibrary(env) {
  const libraryRoot = path.resolve(env.CIE_LIBRARY_ROOT || DEFAULT_LIBRARY_ROOT)
  const aiApi = createAiApi({ env, libraryRoot, allowedSubjects: ALLOWED_SUBJECTS })
  const stemApi = createStemApi({ env })
  return {
    name: 'local-cie-library',
    configureServer(server) {
      server.middlewares.use(stemApi)
      server.middlewares.use(aiApi)
      server.middlewares.use(sendLocalPdf)
    },
    configurePreviewServer(server) {
      server.middlewares.use(stemApi)
      server.middlewares.use(aiApi)
      server.middlewares.use(sendLocalPdf)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  return {
    preview: {
      allowedHosts: ['stem.ieltsist.com'],
    },
    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          { src: 'node_modules/pdfjs-dist/wasm/*', dest: 'pdfjs/wasm', rename: { stripBase: true } },
          { src: 'node_modules/pdfjs-dist/cmaps/*', dest: 'pdfjs/cmaps', rename: { stripBase: true } },
          { src: 'node_modules/pdfjs-dist/standard_fonts/*', dest: 'pdfjs/standard_fonts', rename: { stripBase: true } },
        ],
      }),
      localCieLibrary(env),
    ],
  }
})
