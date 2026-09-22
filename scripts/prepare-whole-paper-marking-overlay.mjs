import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const runtimeFiles = Object.freeze([
  'server/aiApi.js',
  'server/stemApi.js',
  'server/wholePaperAi.js',
  'server/wholePaperArtifacts.js',
  'server/wholePaperMarking.js',
  'server/wholePaperReport.js',
  'package.json',
  'package-lock.json',
])
const dependencyPackages = Object.freeze([
  'pdf-lib',
  '@pdf-lib/standard-fonts',
  '@pdf-lib/upng',
  'pako',
  'tslib',
])

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function filesBelow(root) {
  const result = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    const parent = entry.parentPath || entry.path
    const absolute = path.join(parent, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Overlay dependency must not contain symlinks: ${absolute}`)
    if (entry.isFile()) result.push(absolute)
  }
  return result.sort()
}

function safeOutputPath(value) {
  const output = path.resolve(String(value || ''))
  if (!value || output === repositoryRoot || output.startsWith(`${repositoryRoot}${path.sep}server${path.sep}`)) {
    throw new Error('Provide a dedicated empty overlay output directory.')
  }
  if (fs.existsSync(output)) throw new Error('Overlay output already exists; refusing to overwrite it.')
  return output
}

export function prepareWholePaperMarkingOverlay({ outputDirectory } = {}) {
  const output = safeOutputPath(outputDirectory)
  fs.mkdirSync(output, { recursive: true })
  for (const relative of runtimeFiles) {
    const source = path.join(repositoryRoot, relative)
    if (!fs.statSync(source).isFile()) throw new Error(`Missing runtime file: ${relative}`)
    const destination = path.join(output, 'runtime', relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
  }

  const dependencies = []
  for (const packageName of dependencyPackages) {
    const source = path.join(repositoryRoot, 'node_modules', ...packageName.split('/'))
    const packageJson = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
    const lifecycleScripts = ['preinstall', 'install', 'postinstall'].filter((name) => packageJson.scripts?.[name])
    if (packageJson.gypfile || lifecycleScripts.length) throw new Error(`Dependency ${packageName} is not a prebuilt pure-JS overlay package.`)
    const destination = path.join(output, 'node_modules', ...packageName.split('/'))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.cpSync(source, destination, { recursive: true, dereference: false, preserveTimestamps: true })
    dependencies.push({ name: packageName, version: String(packageJson.version), license: String(packageJson.license || '') })
  }

  const manifestFiles = filesBelow(output).map((absolute) => ({
    path: path.relative(output, absolute).split(path.sep).join('/'),
    bytes: fs.statSync(absolute).size,
    sha256: sha256(absolute),
  }))
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()
  const manifest = {
    schemaVersion: 'stem-whole-paper-overlay-v1',
    sourceCommit,
    baseCommit: '47ddea876aaaeec47a2fa3ca75fb92745cc01070',
    overlayOnly: true,
    requiresServerBuild: false,
    requiresDependencyInstall: false,
    privateDataIncluded: false,
    runtimeFiles,
    dependencies,
    files: manifestFiles,
    totalBytes: manifestFiles.reduce((sum, file) => sum + file.bytes, 0),
  }
  const manifestPath = path.join(output, 'manifest.json')
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return Object.freeze({ output, manifestPath, manifest })
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const outputIndex = process.argv.indexOf('--output')
  const outputDirectory = outputIndex >= 0 ? process.argv[outputIndex + 1] : ''
  const result = prepareWholePaperMarkingOverlay({ outputDirectory })
  console.log(JSON.stringify({ output: result.output, manifestPath: result.manifestPath, totalBytes: result.manifest.totalBytes, dependencies: result.manifest.dependencies }))
}
