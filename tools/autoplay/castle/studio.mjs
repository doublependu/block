/*
 *  The finished castle, staged for posting: the world export loaded into a fresh
 *  world (creative, so no night comes), the HUD hidden, the light held at one
 *  time of day, and the aerial camera placed by hand.
 *
 *    --stills          candidate thumbnail frames from around the castle (stills/)
 *    --stills="h,p,z[,x,y,z,sky];…"   those views instead (heading, pitch, zoom,
 *                      the point looked at, the time of day)
 *    --orbit=WxH       one slow turn round the castle, rendered frame by frame so
 *                      it is smooth whatever the machine (orbit-WxH.mp4)
 *
 *  Usage: node tools/autoplay/castle/studio.mjs [world file] [--stills [--size=1280x720]] [--orbit=1080x1920]
 *                [--sky=0.36] [--secs=12] [--out=<dir>] [--headed]
 *  Output: <out>/ (default recordings/castle10/social/)
 */

import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serveDist } from '../../serve-dist.mjs'

const argv = process.argv.slice(2)
const args = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')).map(([k, v]) => [k, v ?? true]))
const ROOT = new URL('../../../', import.meta.url).pathname
const file = resolve(argv.find((a) => !a.startsWith('--')) || join(ROOT, 'recordings', 'castle10', 'castle-on-the-rock.world.json'))
const out = resolve(args.out || join(ROOT, 'recordings', 'castle10', 'social'))
mkdirSync(out, { recursive: true })
const world = JSON.parse(readFileSync(file, 'utf8'))

/** the castle's middle, where the camera looks (its blocks span x -32..26, z -14..13, y 7..37) */
const AT = { x: -3, y: 18, z: -0.5 }

const server = await serveDist({ port: Number(args.port || 4196) })
const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: !args.headed,
    args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--ignore-certificate-errors', ...(args.headed ? [] : ['--use-angle=gl'])],
})

/** the world's seed from the menu, the export's edits on top, the HUD hidden, the light held */
async function openCastle(width, height, dpr) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height }, deviceScaleFactor: dpr })
    const page = await context.newPage()
    page.on('pageerror', (e) => console.error('page error:', e.message))
    await page.goto(server.url + '?quality=high&intro=0&tips=0&hpbars=0')
    await page.click('[data-go="new"]')
    await page.fill('.f-seed', world.seed)
    await page.fill('.f-name', world.name)
    await page.selectOption('.f-mode', 'creative')
    await page.click('[data-go="create"]')
    await page.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 180000 })
    await page.evaluate(({ edits, sky }) => {
        const g = window.game
        for (const [x, y, z, b] of edits) g.sync.submit({ t: 'block', x, y, z, b })
        document.getElementById('hud').style.visibility = 'hidden'
        // the camera may stand back past a hill or a tree: nobody plays from here
        g.control.noa.camera.keepOutOfTerrain = false
        // and the fog stands back with it (the game holds it at the 70-block zoom limit)
        const fog = g.sky.setFogOffset.bind(g.sky)
        g.sky.setFogOffset = (offset) => fog(window.__fog ?? offset)
        window.__sky = sky
        Object.defineProperty(g.cycle, 'skyTime', { get: () => window.__sky, configurable: true })
    }, { edits: world.edits, sky: Number(args.sky ?? 0.36) })
    await page.waitForTimeout(5000)
    return page
}

/** the aerial camera on the castle from `heading`, `zoom` blocks back, `pitch` down */
async function look(page, { heading, zoom, pitch, x = AT.x, y = AT.y, z = AT.z, sky }) {
    await page.evaluate(({ x, y, z, heading, zoom, pitch, sky }) => {
        const c = window.game.control
        if (c.mode !== 'aerial') c.enterAerial()
        Object.assign(c.aerial, { x, y, z, tx: x, tz: z, zoom, shown: zoom, pitch, heading })
        c.glide = null
        c.orbit = null
        if (sky !== undefined && !Number.isNaN(sky)) window.__sky = sky
        window.__fog = Math.round(zoom * 0.8)
        // two frames: one to move the camera, one drawn from there
        return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    }, { x, y, z, heading, zoom, pitch, sky })
}

// ---- stills: thumbnail candidates ------------------------------------------------------
if (args.stills) {
    const [sw, sh] = String(args.size || '1280x720').split('x').map(Number)
    const page = await openCastle(sw, sh, 2)
    const dir = join(out, 'stills')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const views = []
    if (typeof args.stills === 'string') {
        for (const spec of args.stills.split(';')) {
            const [heading, pitch, zoom, x = AT.x, y = AT.y, z = AT.z, sky] = spec.split(',').map(Number)
            views.push({ heading, pitch, zoom, x, y, z, sky, name: spec.replace(/,/g, '_') })
        }
    } else {
        for (const heading of [0, 0.5, 1.2, 2.2, 3.14, 4.2, 5.2]) {
            for (const [pitch, zoom] of [[0.22, 58], [0.38, 66]]) views.push({ heading, pitch, zoom })
        }
    }
    for (const v of views) {
        await look(page, v)
        await page.waitForTimeout(1200)
        const name = `${v.name || `h${v.heading.toFixed(1)}-p${v.pitch}-z${v.zoom}`}.png`
        await page.screenshot({ path: join(dir, name) })
        console.log(name)
    }
    for (const sky of typeof args.stills === 'string' ? [] : [0.12, 0.25, 0.42, 0.46]) {
        await look(page, { heading: 0.5, pitch: 0.22, zoom: 58, sky })
        await page.waitForTimeout(1500)
        await page.screenshot({ path: join(dir, `sky${sky}.png`) })
        console.log(`sky ${sky}`)
    }
    await page.close()
}

// ---- the orbit: one turn, frame by frame ----------------------------------------------
if (args.orbit) {
    const [W, H] = String(args.orbit).split('x').map(Number)
    const portrait = H > W
    // the page at 2/3 of the output size, drawn at 1.5× (the recordings' own layout)
    const page = await openCastle(Math.round(W / 1.5), Math.round(H / 1.5), 1.5)
    const fps = 30
    const secs = Number(args.secs || 12)
    const n = Math.round(fps * secs)
    const h0 = Number(args.heading ?? 0.5)
    const pitch = Number(args.pitch ?? (portrait ? 0.42 : 0.34))
    const zoom = Number(args.zoom ?? (portrait ? 92 : 64))
    const frames = join(out, `orbit-${W}x${H}`)
    rmSync(frames, { recursive: true, force: true })
    mkdirSync(frames, { recursive: true })
    await look(page, { heading: h0, pitch, zoom })
    await page.waitForTimeout(2000)
    // the camera rides over hills: per frame, the lowest pitch with a clear line from the
    // castle's edge back to the camera, then eased so it starts rising before the hill
    const lowest = await page.evaluate(({ n, h0, pitch, zoom, at }) => {
        const noa = window.game.control.noa
        const edge = 34
        const out = []
        for (let i = 0; i < n; i++) {
            const h = h0 + (2 * Math.PI * i) / n
            let p = pitch
            const clear = (q) => {
                const c = Math.cos(q)
                const back = [-c * Math.sin(h), Math.sin(q), -c * Math.cos(h)]
                const from = [at.x + back[0] * edge, at.y + back[1] * edge, at.z + back[2] * edge]
                return !noa.pick(from, back, zoom - edge + 4)
            }
            // clear with room to spare: a hill just under the line of sight fills the frame
            for (; p < 1.3; p += 0.01) if (clear(p) && clear(p - 0.07) && clear(p - 0.14)) break
            out.push(p)
        }
        return out
    }, { n, h0, pitch, zoom, at: AT })
    const w = Math.round(n / 16)
    const around = (arr, i, f) => f(...Array.from({ length: 2 * w + 1 }, (_, k) => arr[(i + k - w + n) % n]))
    const peaks = lowest.map((_, i) => around(lowest, i, Math.max))
    const pitches = peaks.map((_, i) => around(peaks, i, (...v) => v.reduce((s, x) => s + x, 0) / v.length))
    console.log(`pitch ${Math.min(...pitches).toFixed(2)}–${Math.max(...pitches).toFixed(2)}`)
    for (let i = 0; i < n; i++) {
        await look(page, { heading: h0 + (2 * Math.PI * i) / n, pitch: pitches[i], zoom })
        await page.screenshot({ path: join(frames, `f${String(i).padStart(4, '0')}.png`) })
        if (i % 60 === 0) console.log(`frame ${i}/${n}`)
    }
    await page.close()
    const mp4 = join(out, `orbit-${W}x${H}.mp4`)
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', join(frames, 'f%04d.png'),
        '-vf', `scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-tune', 'animation', mp4])
    console.log(`${mp4}: ${n} frames, ${secs} s`)
}

await browser.close()
server.close()
console.log(`output: ${out}`)
