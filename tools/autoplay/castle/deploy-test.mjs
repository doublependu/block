/*
 *  Tries a world as the game's starting point before it's deployed (plan 10
 *  §3.9.5): a scratch copy of the game, outside this checkout, with the world
 *  in place of worlds/default.world.json, built and measured like a release.
 *
 *    1. the build and its load budget (check-budget.mjs: the default world gets
 *       50 KB compressed)
 *    2. the load benchmark, median of 5, desktop and mobile (4× CPU) profiles
 *    3. the opening raid against it, recorded (raid.mp4), with its frame rate
 *
 *  Nothing in this checkout changes. What your branch then needs is printed.
 *
 *    4. with --palace (plan 12 §6.11): the frame rate inside the hall, up the stairs and from
 *       the air with the whole palace in view
 *
 *  Usage: node tools/autoplay/castle/deploy-test.mjs <world file> [--out=<dir>] [--runs=5] [--no-raid] [--palace]
 */

import { execFileSync, execSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, symlinkSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { parseWorld } from '../../../src/world/worldFile.js'
import { createGenerator } from '../../../src/world/gen/index.js'
import { buildPalace, FLOOR, L2_Y, HALL } from './palace.js'

const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const file = resolve(process.argv[2])
const ROOT = new URL('../../../', import.meta.url).pathname
const out = resolve(args.out || join(ROOT, 'recordings', 'deploy-test'))
const copy = join(out, 'game')
const runs = Number(args.runs || 5)

const text = readFileSync(file, 'utf8')
const def = parseWorld(text)
console.log(`world: ${def.name}, seed ${def.seed}, ${def.edits.length} edits, ${def.units.length} troops, kit ${JSON.stringify(def.player.inventory)}`)
const size = { raw: text.length, gzip: gzipSync(text).length, brotli: brotliCompressSync(text).length }
console.log(`file: ${(size.raw / 1024).toFixed(1)} KB raw, ${(size.gzip / 1024).toFixed(1)} KB gzip, ${(size.brotli / 1024).toFixed(1)} KB brotli`)

// the scratch copy: sources only, node_modules linked
rmSync(copy, { recursive: true, force: true })
mkdirSync(copy, { recursive: true })
for (const p of ['index.html', 'package.json', 'jsconfig.json', 'vite.config.js', 'src', 'public', 'worlds', 'vendor', 'tools']) {
    if (existsSync(join(ROOT, p))) cpSync(join(ROOT, p), join(copy, p), { recursive: true })
}
symlinkSync(join(ROOT, 'node_modules'), join(copy, 'node_modules'))
copyFileSync(file, join(copy, 'worlds', 'default.world.json'))

console.log('building the scratch copy…')
let budget = ''
try {
    budget = execSync('npx vite build && node tools/check-budget.mjs', { cwd: copy, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
} catch (err) {
    budget = String(err.stdout || '') + String(err.stderr || '')
    console.log('the build or its budget failed:')
}
const budgetLines = budget.split('\n').filter((l) => /Load budget|✓|✗|total|default world/.test(l))
console.log(budgetLines.join('\n'))

const results = { world: file, size, budget: budgetLines }
// --palace: where to stand and look from (first person: heading π looks to the back, pitch < 0 up)
let views = []
if (args.palace) {
    const gen = createGenerator(def.generator.version, def.seed, def.size)
    const palace = buildPalace({ groundAt: (x, z) => gen.surfaceY(x, z), blockAt: (x, y, z) => gen.blockAt(x, y, z) })
    views = [
        { name: 'the hall from the door', mode: 'first', pos: [0.5, FLOOR, HALL.z1 - 1.5], heading: Math.PI, pitch: -0.22 },
        { name: 'the hall, looking up', mode: 'first', pos: [0.5, FLOOR, HALL.z1 - 1.5], heading: Math.PI, pitch: -0.75 },
        { name: 'both flights from level 2', mode: 'first', pos: [0.5, L2_Y + 1, 7.5], heading: Math.PI, pitch: 0.95 },
        { name: 'the palace from the air', mode: 'aerial', ...palace.views.reference },
        { name: 'the palace from above', mode: 'aerial', ...palace.views.above },
    ]
    writeFileSync(join(out, 'views.json'), JSON.stringify(views))
}
for (const profile of ['desktop', 'mobile']) {
    console.log(`load benchmark (${profile}, ${runs} runs)…`)
    const r = execFileSync('node', ['tools/perf/load-test.mjs', `--profile=${profile}`, `--runs=${runs}`, '--headless', `--dist=${join(copy, 'dist')}`, '--port=4181', ...(views.length ? [`--views=${join(out, 'views.json')}`] : [])], { cwd: ROOT }).toString()
    const lines = r.split('\n').filter((l) => /playable|median|raid|fps|Menu|first/i.test(l)).slice(-12 - views.length)
    console.log(lines.join('\n'))
    results[profile] = lines
}
if (!args['no-raid']) {
    console.log('recording the opening raid against it…')
    // (run.mjs takes the build relative to the checkout)
    execFileSync('node', ['tools/autoplay/run.mjs', '--record', '--strategy=idle', '--minutes=6', `--dist=${relative(ROOT, join(copy, 'dist'))}`, `--out=${join(out, 'raid')}`, '--port=4182'], { cwd: ROOT, stdio: 'inherit' })
    results.raid = join(out, 'raid', 'game.mp4')
}
writeFileSync(join(out, 'deploy-test.json'), JSON.stringify(results, null, 2))
console.log(`
What your branch needs to make this world the starting point:
  1. cp ${file} worlds/default.world.json
  2. delete the test "committed default world matches its generator script" (tests/worldfile.test.js),
     and the "the default world starts exactly as before" block, which describe the old default world
  3. if the default world is over its 50 KB (compressed) budget above, raise it in tools/check-budget.mjs
output: ${out}`)
