/*
 *  Load budget check (runs after `vite build`).
 *
 *  Walks the Vite manifest to find what each stage of startup downloads,
 *  measures brotli sizes (the player model ships gzipped, so its file size),
 *  and fails the build when a budget is exceeded.
 *  Budgets follow ai/plan_0.md section 4.1.
 */

import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'

const DIST = new URL('../dist/', import.meta.url).pathname
const manifest = JSON.parse(readFileSync(join(DIST, '.vite/manifest.json'), 'utf8'))

const KB = 1024
const BUDGETS = {
    'menu (html + boot js)': 30 * KB,
    'game code (session chunk + static deps)': 550 * KB,
    'worldgen worker': 25 * KB,
    'default world file': 50 * KB,
    'player model': 150 * KB,
}

const br = (buf) => brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length
const sizeOf = (file) => br(readFileSync(join(DIST, file)))

/** static-import closure of a manifest entry */
function closure(key, seen = new Set()) {
    if (seen.has(key)) return seen
    seen.add(key)
    for (const dep of manifest[key].imports || []) closure(dep, seen)
    return seen
}

const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry && k.endsWith('index.html'))
const sessionKey = Object.keys(manifest).find((k) => k.endsWith('src/game/session.js'))
if (!entryKey || !sessionKey) {
    console.error('check-budget: could not find entry or session chunk in manifest')
    process.exit(1)
}

const menuFiles = new Set(['index.html'])
for (const k of closure(entryKey)) {
    menuFiles.add(manifest[k].file)
    for (const css of manifest[k].css || []) menuFiles.add(css)
}
const gameFiles = new Set()
for (const k of closure(sessionKey)) {
    const f = manifest[k].file
    if (!menuFiles.has(f)) gameFiles.add(f)
    for (const css of manifest[k].css || []) gameFiles.add(css)
}
const assets = readdirSync(join(DIST, 'assets')).map((f) => 'assets/' + f)
const workerFile = assets.find((f) => /\/worker-.*\.js$/.test(f))
const worldFile = assets.find((f) => /\/default\.world-.*\.json$/.test(f))
// Babylon loads the standard material shaders with dynamic imports at first render
for (const f of assets) if (/\/default\.(vertex|fragment)-.*\.js$/.test(f)) gameFiles.add(f)

const sum = (files) => [...files].reduce((n, f) => n + sizeOf(f), 0)
const results = {
    'menu (html + boot js)': sum(menuFiles),
    'game code (session chunk + static deps)': sum(gameFiles),
    'worldgen worker': workerFile ? sizeOf(workerFile) : 0,
    'default world file': worldFile ? sizeOf(worldFile) : 0,
    // served pre-gzipped (vite.config.js gzipModels): hosts don't compress it again
    'player model': existsSync(join(DIST, 'models/player.glb.gz')) ? statSync(join(DIST, 'models/player.glb.gz')).size : 0,
}

let failed = false
let total = 0
console.log('\nLoad budget (compressed):')
for (const [name, size] of Object.entries(results)) {
    total += size
    const budget = BUDGETS[name]
    const ok = size <= budget
    if (!ok) failed = true
    console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(42)} ${(size / KB).toFixed(1).padStart(7)} KB / ${(budget / KB).toFixed(0)} KB`)
}
console.log(`    ${'total to first playable frame'.padEnd(42)} ${(total / KB).toFixed(1).padStart(7)} KB`)
const raw = [...gameFiles].reduce((n, f) => n + statSync(join(DIST, f)).size, 0)
console.log(`    (game code uncompressed: ${(raw / KB).toFixed(0)} KB, ${gameFiles.size} files)\n`)
if (failed) {
    console.error('Load budget exceeded.')
    process.exit(1)
}
