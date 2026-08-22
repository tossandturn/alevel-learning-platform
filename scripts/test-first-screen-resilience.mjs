import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.jsx'), 'utf8')
const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8')
const questionSearchSource = fs.readFileSync(path.join(root, 'src', 'lib', 'questionSearch.js'), 'utf8')
const indexCssSource = fs.readFileSync(path.join(root, 'src', 'index.css'), 'utf8')
const packageSource = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

assert.match(mainSource, /class AppErrorBoundary extends Component/, 'the root must render through a recoverable error boundary')
assert.match(mainSource, /function AppLoadingFallback\(\)/, 'the initial module loading state must have a bounded failure path')
assert.match(mainSource, /setTimeout\(\(\) => setTimedOut\(true\), 8000\)/, 'a stalled app module must reach recovery instead of waiting forever')
assert.match(mainSource, /vite:preloadError/, 'Vite chunk preload failures must be handled before React renders a blank page')
assert.match(mainSource, /Try again|Reload STEM/, 'the root failure state must expose an actionable recovery control')
assert.match(mainSource, /retry = \(\) =>[\s\S]*window\.location\.reload\(\)/, 'retry must reload the module graph instead of reusing a rejected lazy promise')
assert.match(mainSource, /lazy\(\(\) => import\('\.\/App\.jsx'\)/, 'the app shell must load behind a guarded dynamic import')
assert.match(appSource, /const \[coachMounted, setCoachMounted\] = useState\(false\)/, 'AI Coach must not mount its heavy chunk on the first screen')
assert.match(appSource, /setCoachMounted\(true\)/, 'opening Coach must mount it on demand')
assert.match(appSource, /view === 'dashboard' && !coachMounted && !accountDialogMode && !accountPopoverOpen/, 'Dashboard must keep a lightweight Coach launch control without mounting the heavy Coach chunk')
assert.match(appSource, /initialOpen=\{coachOpenPending\}/, 'the lazy Coach mount must carry the user open intent across the async chunk load')
assert.match(appSource, /onInitialOpenHandled=\{\(\) => setCoachOpenPending\(false\)\}/, 'the lazy Coach mount must acknowledge its open intent after mounting')
assert.match(appSource, /view !== 'dashboard' \|\| coachMounted/, 'the delayed dashboard preload must not mount Coach')
assert.match(appSource, /if \(view === 'dashboard'\) return undefined/, 'the heavy practice runtime must stay unloaded on the dashboard')
assert.doesNotMatch(questionSearchSource, /from ['"]\.\/questionContent['"]/, 'search helpers must not pull the source manifest into the first screen')
assert.match(questionSearchSource, /from ['"]\.\/questionText\.js['"]/, 'search helpers must use the lightweight question text helper')
assert.match(indexCssSource, /\.app-recovery__actions \.primary-action/, 'the recovery action styles must work before App.css loads')
assert.match(indexCssSource, /background: #f4f7fb/, 'the recovery surface must have standalone fallback colors')
assert.equal(packageSource.scripts['test:first-screen'], 'node scripts/test-first-screen-resilience.mjs')

console.log('first-screen resilience checks passed')
