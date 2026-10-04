/*
 *  The opening raid's frame rate over time, with noa's chunk queues, on the
 *  mobile profile (4x CPU): where the slow frames are, and whether chunk
 *  loading is behind them (plan b2_0 §4).
 *
 *  Usage: node tools/perf/raid-trace.mjs [--quality=med] [--seconds=20] [--dist=<dir>] [--port=4183]
 */

import { chromium } from 'playwright-core'
import { serveDist } from '../serve-dist.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const server = await serveDist({ port: Number(args.port || 4183), ...(args.dist ? { dir: String(args.dist).replace(/\/?$/, '/') } : {}) })
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] })
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 })
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
await page.goto(server.url + `?quality=${args.quality || 'med'}&tips=0`)
await page.click('[data-go="play"]')
await page.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 180000 })
await page.waitForFunction(() => window.game.opening && window.game.cycle.phase === 'night', null, { timeout: 30000 })
const trace = await page.evaluate(async (seconds) => {
    const w = window.game.noa.world
    const out = []
    let worst = 0, last = performance.now(), frames = 0
    const loop = (t) => {
        worst = Math.max(worst, t - last)
        last = t
        frames++
        if (out.length < seconds * 2) requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
    for (let i = 0; i < seconds * 2; i++) {
        await new Promise((r) => setTimeout(r, 500))
        out.push({ t: (i + 1) / 2, fps: frames * 2, worst: Math.round(worst), known: w._chunksKnown.count(), request: w._chunksToRequest.count(), mesh: w._chunksToMesh.count() + w._chunksToMeshFirst.count() })
        worst = 0
        frames = 0
    }
    return out
}, Number(args.seconds || 20))
for (const s of trace) console.log(`${String(s.t).padStart(5)}s  ${String(s.fps).padStart(3)} fps  worst ${String(s.worst).padStart(4)} ms  chunks ${s.known} (to request ${s.request}, to mesh ${s.mesh})`)
await browser.close()
server.close()
