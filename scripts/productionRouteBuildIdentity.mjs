import { execFileSync } from 'node:child_process'

const FULL_COMMIT_PATTERN = /^[a-f0-9]{40}$/

function configuredCommit(env) {
  return String(env?.STEM_BUILD_COMMIT || '').trim().toLowerCase()
}

function gitCommit(cwd) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().toLowerCase()
  } catch {
    return ''
  }
}

export function resolveProductionBuildIdentity({ cwd, env = process.env } = {}) {
  const declaredCommit = configuredCommit(env)
  const repositoryCommit = gitCommit(cwd)

  if (repositoryCommit) {
    if (!FULL_COMMIT_PATTERN.test(repositoryCommit)) throw new Error('Git HEAD did not resolve to a full commit.')
    if (declaredCommit && !FULL_COMMIT_PATTERN.test(declaredCommit)) {
      throw new Error('STEM_BUILD_COMMIT must be a full lowercase Git commit.')
    }
    if (declaredCommit && declaredCommit !== repositoryCommit) {
      throw new Error('STEM_BUILD_COMMIT does not match the actual Git HEAD.')
    }
    const sourceState = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return { commit: repositoryCommit, sourceState: sourceState ? 'dirty' : 'clean' }
  }

  if (!FULL_COMMIT_PATTERN.test(declaredCommit)) {
    throw new Error('A full Git commit is required; set STEM_BUILD_COMMIT for an archive release.')
  }
  return { commit: declaredCommit, sourceState: 'clean' }
}
