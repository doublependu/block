/*
 *  Load-time and frame-rate check against the CLAUDE.md spec.
 *
 *  Serves dist/ with brotli compression (like a real static host), then in
 *  Chrome with network + CPU throttling measures:
 *    - menu interactive       (target 1s)
 *    - first playable frame   (target 2.5s, spec max 4s) after a cold load + Play
 *    - average FPS during a busy night (target >= 30 on the tested device)
 *
 *  Usage: npm run build && node tools/perf/load-test.mjs [--profile=desktop|mobile] [--headless]
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
    args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--ignore-certificate-errors'],
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

const url = `https://localhost:4180/?autoplay${prof.quality ? '&quality=' + prof.quality : ''}`
await page.goto(url)
await page.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 30000 })
const t = await page.evaluate(() => window.__timings)
const bytesToPlayable = bytes

// busy night benchmark
await page.evaluate(() => {
    const g = window.game
    g.startNight(8)
    g.cycle.t = 100
})
await page.waitForTimeout(15000)
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
console.log(`  night benchmark:      ${bench.fps.toFixed(1)} fps avg, ${bench.minFps.toFixed(1)} min, ${bench.units} units, tier ${bench.tier}`)
console.log(`  gpu:                  ${bench.gpu}\n`)

await browser.close()
server.close()
const ok = t.playable <= 4000
process.exit(ok ? 0 : 1)
