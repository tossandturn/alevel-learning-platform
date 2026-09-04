import fs from 'node:fs'
import crypto from 'node:crypto'

// Source identity is based on semantic UTF-8 text, not checkout-specific bytes.
export function canonicalUtf8LfText(value) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '')
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

export function canonicalUtf8LfBytes(value) {
  return Buffer.from(canonicalUtf8LfText(value), 'utf8')
}

export function canonicalTextSha256(value) {
  return crypto.createHash('sha256').update(canonicalUtf8LfBytes(value)).digest('hex')
}

export function canonicalTextFileSha256(filePath) {
  return canonicalTextSha256(fs.readFileSync(filePath, 'utf8'))
}
