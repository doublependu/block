/*
 *  Load-time and frame-rate check against the CLAUDE.md spec.
 *
 *  Serves dist/ with brotli compression (like a real static host), then in
 *  Chrome with network + CPU throttling measures:
 *    - menu interactive       (target 1s)
 *    - first playable frame   (target 2.5s, spec max 4s) after a cold load + Play
 *    - frame rate and longest frame during the opening raid (--raid=<seconds>, default 60)
 *    - average FPS during a busy night (target >= 30 on the tested device)
 *
 *  Usage: npm run build && node tools/perf/load-test.mjs [--profile=desktop|mobile] [--quality=low|med|high] [--raid=60] [--params=hpbars=0] [--headless]
 *    --headless still renders on the GPU (ANGLE GL); the result's "gpu" line says which one was used.
 *    CHROME=/path/to/chrome to override the browser.
 */

import http2 from 'node:http2'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { brotliCompressSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const PROFILE = args.profile || 'desktop'
const DIST = new URL('../../dist/', import.meta.url).pathname

const PROFILES = {
    // deliberately slower than typical 2026 broadband / 4G+ medians
    desktop: { down: 10, up: 5, latency: 40, cpu: 1, viewport: { width: 1280, height: 720 }, touch: false, quality: null },
    // entry-level phone stand-in: slower network, 4x CPU throttle, touch, small screen
    mobile: { down: 10, up: 3, latency: 70, cpu: 4, viewport: { width: 412, height: 915 }, touch: true, quality: null },
}
const prof = { ...PROFILES[PROFILE] }
if (args.down) prof.down = Number(args.down)
if (args.latency) prof.latency = Number(args.latency)
if (args.cpu) prof.cpu = Number(args.cpu)
if (args.quality) prof.quality = args.quality

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' }
const cache = new Map()
// HTTP/2 + brotli, like typical static hosting (self-signed cert for localhost)
const keyFile = join(tmpdir(), 'block-perf-key.pem'), certFile = join(tmpdir(), 'block-perf-cert.pem')
if (!existsSync(certFile)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '365', '-subj', '/CN=localhost'], { stdio: 'ignore' })
}
const server = http2.createSecureServer({ key: readFileSync(keyFile), cert: readFileSync(certFile), allowHTTP1: true }, (req, res) => {
    let path = decodeURIComponent(req.url.split('?')[0])
    if (path.endsWith('/')) path += 'index.html'
    const file = join(DIST, path)
    if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404)
        return res.end()
    }
    if (!cache.has(file)) cache.set(file, brotliCompressSync(readFileSync(file)))
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'content-encoding': 'br', 'cache-control': 'no-store' })
    res.end(cache.get(file))
})
await new Promise((r) => server.listen(4180, r))

// pre-compress everything up front (real hosts serve pre-compressed files; compressing
// on the first request would add seconds of server time to the measurement)
function precompress(dir) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) precompress(full)
        else cache.set(full, brotliCompressSync(readFileSync(full)))
    }
}
precompress(DIST)

const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: !!args.headless,
    // --cold: disable the GPU driver's shader cache to measure a first-ever visit
    env: args.cold ? { ...process.env, MESA_SHADER_CACHE_DISABLE: 'true', MESA_GLSL_CACHE_DISABLE: 'true' } : process.env,
    // headless Chrome falls back to SwiftShader (software) unless told to use the GPU through ANGLE's GL backend
    args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--ignore-certificate-errors', ...(args.headless ? ['--use-angle=gl'] : [])],
})
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: prof.viewport, hasTouch: prof.touch, isMobile: prof.touch, deviceScaleFactor: prof.touch ? 2.6 : 1 })
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: prof.latency,
    downloadThroughput: (prof.down * 1024 * 1024) / 8, uploadThroughput: (prof.up * 1024 * 1024) / 8,
})
if (prof.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu })

let bytes = 0
cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength))

// --params=hpbars=0 adds query parameters, to compare settings in the same run
const url = `https://localhost:4180/?autoplay${prof.quality ? '&quality=' + prof.quality : ''}${args.params ? '&' + args.params : ''}`
await page.goto(url)
await page.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 30000 })
const t = await page.evaluate(() => window.__timings)
const bytesToPlayable = bytes

// opening raid: frame rate and the longest frame while the town is wrecked (explosions,
// collapses, remeshing), sampled from the start of the raid
await page.waitForFunction(() => window.game.opening && window.game.cycle.phase === 'night', null, { timeout: 10000 }).catch(() => {})
const raid = await page.evaluate(async (seconds) => {
    const g = window.game
    if (!g.opening) return null
    const eng = g.noa.rendering.engine
    const f = { max: 0, over50: 0, last: performance.now(), stop: false }
    const loop = (t) => {
        const d = t - f.last
        f.last = t
        f.max = Math.max(f.max, d)
        if (d > 50) f.over50++
        if (!f.stop) requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
    const samples = []
    for (let i = 0; i < seconds && g.cycle.phase === 'night'; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        samples.push(eng.getFps())
    }
    f.stop = true
    return {
        seconds: samples.length,
        fps: samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length),
        minFps: Math.min(...samples),
        maxFrame: f.max,
        over50: f.over50,
        destroyed: g.world.damageCount,
        towers: g.towers.activeCount,
    }
}, Number(args.raid || 60))

// busy night benchmark: skip the rest of the opening raid, start a strong night, and fill it up
// to the tier's attacker cap around the town so the whole crowd is on screen and animated
await page.evaluate(() => window.game.skipOpening())
await page.waitForFunction(() => window.game.cycle.phase === 'day', null, { timeout: 30000 })
await page.evaluate(() => {
    const g = window.game
    g.hud.closePanel()
    g.startNight(8)
    g.cycle.t = 100
})
await page.waitForTimeout(2000)
await page.evaluate(() => {
    const g = window.game
    const tc = g.world.townCenter
    const types = ['grunt', 'grunt', 'raider', 'brute']
    // the town must not fall mid-benchmark (that ends the night and clears the crowd)
    g.units.town.hp = g.units.town.maxHp = 1e9
    for (let i = g.units.aliveAttackers(); i < g.tier.maxAttackers; i++) {
        const a = Math.random() * Math.PI * 2, r = 16 + Math.random() * 14
        const pos = g.waves.spawnPointFor(a, [r, r + 2])
        g.units.spawn(types[i % types.length], pos, { hpMult: 6 }) // tough, so the crowd lasts the whole sample
    }
    g.control.enterAerial()
    Object.assign(g.control.aerial, { x: tc[0], z: tc[2], y: tc[1] + 1, zoom: 45, pitch: 0.9 })
})
await page.waitForTimeout(8000)
const bench = await page.evaluate(async () => {
    const g = window.game
    const eng = g.noa.rendering.engine
    const samples = []
    for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        samples.push(eng.getFps())
    }
    return {
        fps: samples.reduce((a, b) => a + b, 0) / samples.length,
        minFps: Math.min(...samples),
        units: g.units.units.length,
        attackers: g.units.aliveAttackers(),
        tier: g.tier.name,
        gpu: eng.getGlInfo().renderer,
    }
})

const r = (ms) => (ms / 1000).toFixed(2) + 's'
console.log(`\nProfile: ${PROFILE} (${prof.down} Mbps, ${prof.latency} ms RTT, CPU x${prof.cpu})`)
console.log(`  menu interactive:     ${r(t.menuInteractive)}   (target 1s)`)
console.log(`  first playable frame: ${r(t.playable)}   (target 2.5s, max 4s)`)
console.log(`    game code loaded ${r(t.codeLoaded)}, game created ${r(t.gameCreated)}, ground meshed ${r(t.playable)}`)
console.log(`  transferred:          ${(bytesToPlayable / 1024).toFixed(0)} KB`)
if (raid) console.log(`  opening raid:         ${raid.fps.toFixed(1)} fps avg, ${raid.minFps.toFixed(1)} min over ${raid.seconds}s, longest frame ${raid.maxFrame.toFixed(0)} ms (${raid.over50} over 50 ms), ${raid.destroyed} blocks destroyed, ${raid.towers} towers left`)
console.log(`  night benchmark:      ${bench.fps.toFixed(1)} fps avg, ${bench.minFps.toFixed(1)} min, ${bench.units} units (${bench.attackers} attackers alive at the end), tier ${bench.tier}`)
console.log(`  gpu:                  ${bench.gpu}\n`)

await browser.close()
server.close()
const ok = t.playable <= 4000
process.exit(ok ? 0 : 1)
