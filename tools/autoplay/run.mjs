/*
 *  Autoplay: a bot plays the game in Chrome, and (with --record) the whole game
 *  is recorded as one continuous video.
 *
 *  The bot (tools/autoplay/bot/) runs inside the page. It sees the game through a
 *  read-only view and acts only through input: keys, mouse buttons, mouse
 *  movement and clicks on the HUD. This harness does what the page can't do by
 *  itself: the trusted clicks the browser requires (Play, taking pointer lock),
 *  recording, logging and stopping.
 *
 *  Usage:
 *    npm run autoplay -- [--record] [--minutes=60] [--strategy=bot|idle] [--lab=<scenario>]
 *                        [--headed] [--no-build] [--out=<dir>] [--quality=low|med|high]
 *
 *    --record     tab capture from the menu to the end, written to <out>/game.webm (+ game.mp4)
 *    --minutes    stop after this many minutes (default: 60 recorded, 20 otherwise)
 *    --strategy   bot (default) plays to win and spends everything; towers is iteration 6's plan
 *                 (arrow towers, archers); idle builds nothing and watches from above
 *    --lab        a development scenario set up with debug writes (never recorded, see lab.mjs)
 *    --no-build   use the existing dist/
 *    --dist=<dir> serve another build (for example a copy of an older one, to compare), implies --no-build
 *    --shots=<s>  a screenshot every s seconds (<out>/shots/, not with --record)
 *    --diag       every 30 s: force a garbage collection and log the retained heap and scene object counts
 *    --save-town=<day>[:<name>]  when day <day> starts, save the town to tools/autoplay/towns/<name>.world.json
 *                 (for --lab=siege; the harness reads the game's snapshot, the bot never does)
 *
 *  Output: recordings/<date>-<label>/ (events.jsonl, telemetry.jsonl, report.md, game.*)
 */

import { chromium } from 'playwright-core'
import { build } from 'vite'
import { execSync } from 'node:child_process'
import { mkdirSync, createWriteStream, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveDist, DIST } from '../serve-dist.mjs'
import { serializeWorld } from '../../src/world/worldFile.js'
import { LAB, TOWNS } from './lab.mjs'
import { finishVideo } from './video.mjs'
import { writeReport } from './report.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const record = !!args.record
const lab = args.lab || null
const strategy = args.strategy || 'bot'
const minutes = Number(args.minutes || (record ? 60 : 20))
if (record && lab) {
    console.error('--record and --lab can\'t be combined: a recorded game is played by input only')
    process.exit(2)
}
if (lab && !LAB[lab.split(':')[0]]) {
    console.error(`unknown lab scenario "${lab}". Known: ${Object.keys(LAB).join(', ')}`)
    process.exit(2)
}

const ROOT = new URL('../../', import.meta.url).pathname
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
const label = lab ? 'lab-' + lab.replace(/[^\w]+/g, '-') : strategy + (record ? '-rec' : '')
const out = args.out || join(ROOT, 'recordings', `${stamp}-${label}`)
mkdirSync(out, { recursive: true })

const dist = args.dist ? join(process.cwd(), String(args.dist)) + '/' : DIST
if (!args.dist && (!args['no-build'] || !existsSync(join(DIST, 'index.html')))) {
    console.log('building…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}

// the bot: one script, injected into the page before any of the game's code runs
const bundle = await build({
    configFile: false,
    logLevel: 'warn',
    build: {
        write: false,
        minify: false,
        lib: { entry: join(ROOT, 'tools/autoplay/bot/index.js'), formats: ['iife'], name: 'Autoplay', fileName: 'bot' },
    },
})
const botCode = (Array.isArray(bundle) ? bundle[0] : bundle).output[0].code

const server = await serveDist({ port: Number(args.port || 4190), dir: dist })

const events = createWriteStream(join(out, 'events.jsonl'))
const telemetry = createWriteStream(join(out, 'telemetry.jsonl'))
const video = record ? createWriteStream(join(out, 'game.webm')) : null
let videoBytes = 0
const t0 = Date.now()
const elapsed = () => (Date.now() - t0) / 1000
const logEvent = (e) => events.write(JSON.stringify({ wall: +elapsed().toFixed(2), ...e }) + '\n')

const headless = !args.headed
const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless,
    args: [
        '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--ignore-certificate-errors',
        // headless Chrome renders on the GPU only through ANGLE's GL backend
        ...(headless ? ['--use-angle=gl'] : []),
        // tab capture without the picker, and sound without a gesture
        '--auto-accept-this-tab-capture', '--autoplay-policy=no-user-gesture-required',
        ...(args.diag ? ['--js-flags=--expose-gc'] : []),
    ],
})
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } })
const page = await context.newPage()

let crashed = false
page.on('crash', () => {
    crashed = true
    logEvent({ type: 'crash' })
})
page.on('pageerror', (e) => logEvent({ type: 'pageerror', message: e.message, stack: (e.stack || '').split('\n').slice(0, 6).join('\n') }))
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logEvent({ type: 'console', level: m.type(), text: m.text().slice(0, 500) })
})

await page.exposeBinding('__apChunk', (_src, b64) => {
    const buf = Buffer.from(b64, 'base64')
    videoBytes += buf.length
    video.write(buf)
})
await page.exposeBinding('__apEvents', (_src, list) => {
    for (const e of list) logEvent(e)
})
let lastTele = null
await page.exposeBinding('__apTelemetry', (_src, t) => {
    lastTele = t
    telemetry.write(JSON.stringify({ wall: +elapsed().toFixed(2), ...t }) + '\n')
})
await page.addInitScript({ content: `window.__AP_CONFIG = ${JSON.stringify({ strategy, lab, record, diag: !!args.diag })};\n${botCode}` })

const params = args.quality ? `?quality=${args.quality}` : ''
await page.goto(server.url + params)
await page.waitForSelector('[data-go="play"]', { state: 'visible', timeout: 30000 })

// ---- recording: starts at the menu, before pointer lock (starting it takes the lock away)
let capture = null
// the cap counts from the first frame of the video (the menu)
const recStart = Date.now()
const recSeconds = () => (Date.now() - recStart) / 1000
if (record) {
    capture = await page.evaluate(async () => window.__apCapture.start({ fps: 30, bitrate: 4_000_000 }))
    logEvent({ type: 'capture', ...capture })
    console.log(`recording: ${JSON.stringify(capture)}`)
    await page.waitForTimeout(2500)
}

// a lab scenario can start from a saved town instead (it's put where Continue finds it)
const labName = lab ? lab.split(':')[0] : null
const start = lab && LAB[labName].beforePlay ? await LAB[labName].beforePlay(page, lab.split(':').slice(1).join(':')) : '[data-go="play"]'
await page.click(start)
logEvent({ type: 'play' })
await page.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 180000 })
logEvent({ type: 'playable', timings: await page.evaluate(() => window.__timings) })

if (lab) {
    const [name, ...rest] = lab.split(':')
    const arg = rest.join(':')
    await LAB[name].setup(page, arg)
    logEvent({ type: 'lab', name, arg })
}

// ---- main loop: keep pointer lock, watch, stop
let lastClick = 0
let lastPrint = 0
let lastShot = 0
const shotEvery = !record && args.shots ? Number(args.shots) : 0
if (shotEvery) mkdirSync(join(out, 'shots'), { recursive: true })
let reason = 'time'
const [saveDay, saveName] = args['save-town'] ? String(args['save-town']).split(':') : []
let townSaved = false
// the last chunk is flushed after the stop: stop just short, so the video is never longer than the cap
const capSeconds = minutes * 60 - (record ? 1.5 : 0)
for (;;) {
    await new Promise((r) => setTimeout(r, 200))
    if (crashed) {
        reason = 'crash'
        break
    }
    let st
    try {
        st = await page.evaluate(() => window.__ap && window.__ap.status())
    } catch (err) {
        logEvent({ type: 'harness-error', message: String(err) })
        reason = 'page gone'
        break
    }
    if (!st) continue
    // the bot wants pointer lock (after a panel closed, or the lock was lost): a real click
    if (st.needLock && Date.now() - lastClick > 700) {
        lastClick = Date.now()
        await page.mouse.click(640, 360)
        logEvent({ type: 'lock-click' })
    }
    if (st.done) {
        reason = st.done
        break
    }
    if (saveDay && !townSaved && st.phase === 'day' && st.day >= Number(saveDay)) {
        townSaved = true
        const def = await page.evaluate(() => {
            const g = window.game
            return { ...g.snapshot(), name: `Saved town (day ${g.cycle.day})`, description: 'Saved by the autoplay harness for --lab=siege' }
        })
        const file = join(TOWNS, `${saveName || `day${saveDay}`}.world.json`)
        mkdirSync(TOWNS, { recursive: true })
        writeFileSync(file, serializeWorld(def))
        logEvent({ type: 'town-saved', file, day: def.day })
        console.log(`saved the town: ${file}`)
    }
    if (shotEvery && recSeconds() - lastShot >= shotEvery) {
        lastShot = recSeconds()
        const name = `${String(Math.round(lastShot)).padStart(5, '0')}-${st.phase}-${st.activity}.jpg`
        await page.screenshot({ path: join(out, 'shots', name), type: 'jpeg', quality: 70 }).catch(() => {})
    }
    if (recSeconds() - lastPrint >= 60) {
        lastPrint = recSeconds()
        const m = Math.floor(lastPrint / 60)
        const tl = lastTele || {}
        console.log(`[${String(m).padStart(2, '0')}:00] ${st.phase} day ${st.day} night ${st.level} · ${st.activity} · town ${tl.townHp ?? '-'} · attackers ${tl.attackers ?? '-'} · fps ${tl.fps ?? '-'} · survived ${st.survived}/${st.nights}` + (record ? ` · video ${(videoBytes / 1e6).toFixed(0)} MB` : ''))
    }
    if (recSeconds() >= capSeconds) {
        reason = 'time'
        break
    }
}

logEvent({ type: 'stop', reason, seconds: +recSeconds().toFixed(1) })
console.log(`stopping (${reason}) after ${(recSeconds() / 60).toFixed(1)} min`)
if (record && !crashed) {
    await page.evaluate(() => window.__apCapture.stop()).catch((e) => logEvent({ type: 'harness-error', message: 'capture stop: ' + e }))
}
// the last telemetry and events
await page.evaluate(() => window.__ap && window.__ap.flush()).catch(() => {})
await browser.close().catch(() => {})
server.close()
await Promise.all([events, telemetry, video].filter(Boolean).map((s) => new Promise((r) => s.end(r))))

writeFileSync(join(out, 'run.json'), JSON.stringify({ args, reason, minutes: recSeconds() / 60, record, strategy, lab, capture, started: new Date(t0).toISOString() }, null, 2))
if (record) {
    try {
        const v = finishVideo(out)
        console.log(`video: ${v.mp4} (${v.duration.toFixed(1)} s, largest gap ${v.maxGap.toFixed(3)} s, ${v.gaps} gaps over 0.25 s)`)
    } catch (err) {
        console.error('video post-processing failed:', err.message)
    }
}
const summary = writeReport(out)
console.log(summary)
console.log(`output: ${out}`)
