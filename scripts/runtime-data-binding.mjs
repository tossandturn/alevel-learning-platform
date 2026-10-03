import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { validRuntimeDataBinding } from './release-manifest-contract.mjs'

export function runtimeDataBindingDeclaration(expectedRoot) {
  const requestedRoot = String(expectedRoot || '').trim()
  assert.ok(requestedRoot && path.isAbsolute(requestedRoot), 'explicit absolute runtime data root required')
  const target = path.resolve(requestedRoot)
  assert.equal(fs.realpathSync(target), target, 'runtime data target must be canonical')
  assert.ok(fs.statSync(target).isDirectory(), 'runtime data target must be a directory')
  return Object.freeze({
    schemaVersion: 'stem-runtime-data-binding.v1',
    relativePath: 'data',
    target,
  })
}

export function assertRuntimeDataBinding(releaseRoot, declaration, expectedRoot) {
  const resolvedReleaseRoot = fs.realpathSync(path.resolve(releaseRoot))
  const bindingPath = path.join(resolvedReleaseRoot, 'data')
  const bindingStats = fs.lstatSync(bindingPath, { throwIfNoEntry: false })
  if (declaration === undefined) {
    assert.equal(bindingStats, undefined, 'undeclared runtime data binding')
    assert.equal(String(expectedRoot || '').trim(), '', 'unexpected runtime data argument')
    return []
  }
  assert.ok(validRuntimeDataBinding(declaration), 'runtime data declaration is invalid')
  const expected = runtimeDataBindingDeclaration(expectedRoot)
  assert.deepEqual(declaration, expected, 'runtime data declaration differs from deployment target')
  assert.ok(bindingStats?.isSymbolicLink(), 'runtime data must be a link, never copied database contents')
  assert.equal(fs.realpathSync(bindingPath), expected.target, 'runtime data link changed')
  const relative = path.relative(resolvedReleaseRoot, expected.target)
  assert.ok(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'persistent data cannot reside inside the release')
  return ['data']
}

export function verifiedRuntimeDataBinding(releaseRoot, expectedRoot = '') {
  if (!String(expectedRoot || '').trim()) {
    assertRuntimeDataBinding(releaseRoot, undefined, '')
    return null
  }
  const declaration = runtimeDataBindingDeclaration(expectedRoot)
  assertRuntimeDataBinding(releaseRoot, declaration, expectedRoot)
  return declaration
}
