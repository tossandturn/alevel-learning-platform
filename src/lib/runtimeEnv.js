import fs from 'node:fs'
import path from 'node:path'

function parseEnvLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
  if (!match) return null
  const key = match[1]
  let value = match[2].trim()
  if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1)
  } else if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  } else {
    const commentIndex = value.search(/\s+#/)
    if (commentIndex >= 0) value = value.slice(0, commentIndex).trim()
  }
  return [key, value]
}

export function readEnvFile(filePath) {
  if (!filePath) return {}
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return {}
  const env = {}
  for (const line of fs.readFileSync(resolved, 'utf8').split(/\r?\n/)) {
    const entry = parseEnvLine(line)
    if (!entry) continue
    const [key, value] = entry
    if (value === '') continue
    env[key] = value
  }
  return env
}

export function findSharedEnvFile(cwd = process.cwd(), env = process.env) {
  const explicit = String(env?.STEM_SHARED_ENV_FILE || '').trim()
  if (explicit && fs.existsSync(explicit)) return path.resolve(explicit)
  let current = path.resolve(cwd)
  while (true) {
    const candidate = path.join(current, 'shared', '.env')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) return ''
    current = parent
  }
}

export function findProjectEnvFile(cwd = process.cwd()) {
  const candidate = path.join(path.resolve(cwd), '.env')
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : ''
}

export function mergeRuntimeEnv({ cwd = process.cwd(), env = process.env } = {}) {
  const merged = {
    ...readEnvFile(findSharedEnvFile(cwd, env)),
    ...readEnvFile(findProjectEnvFile(cwd)),
  }
  for (const [key, value] of Object.entries(env || {})) {
    if (value == null || value === '') continue
    merged[key] = value
  }
  return merged
}
