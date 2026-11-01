import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { sha256DirectoryTree } from '../server/admissionsPreviewRenderer.js'

const root = path.resolve(process.argv[2] || '')
if (!process.argv[2] || !fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw Error('Usage: node scripts/hash-admissions-preview-runtime.mjs <runtime-directory>')
const hash = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')
console.log(JSON.stringify({
  packageSha256: hash('playwright-core-1.64.1.tgz'),
  packageTreeSha256: sha256DirectoryTree(path.join(root, 'package')),
  rendererSha256: hash('renderer.cjs'),
  seccompSha256: hash('seccomp_profile.json'),
}, null, 2))
