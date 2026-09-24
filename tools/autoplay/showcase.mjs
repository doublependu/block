/*
 *  The showcase: what the weapons and defences look like, on every change,
 *  without a person watching a game (plan 9 §5.4).
 *
 *    hands     every weapon tier and the pickaxe in first person, caught at
 *              set points of its motion (rest, wind-up, the blow, after):
 *              one contact sheet per family
 *    sparks    the pickaxe chopping stone, wood and dirt: chips and sparks
 *    trail     the builder's sword streak in third person, per tier
 *    defences  one of every defence tier in a row (I · II · III per family),
 *              seen from three sides
 *
 *  Like the lab it writes game state directly (hands out items, freezes a
 *  motion at a point, places blocks), so it's a development tool, never a game.
 *
 *  Usage: node tools/autoplay/showcase.mjs [--no-build] [--out=<dir>] [--only=hands,sparks,defences]
 *  Output: <out>/ (default recordings/showcase9/): sheet-*.jpg and the frames they're made of
 */

import { chromium } from 'playwright-core'
import { execSync, execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { serveDist, DIST } from '../serve-dist.mjs'
import { skipToDay } from './lab.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const ROOT = new URL('../../', import.meta.url).pathname
const out = args.out || join(ROOT, 'recordings', 'showcase9')
const only = args.only ? new Set(String(args.only).split(',')) : null
const want = (part) => !only || only.has(part)
rmSync(join(out, 'frames'), { recursive: true, force: true })
mkdirSync(join(out, 'frames'), { recursive: true })

if (!args['no-build'] || !existsSync(join(DIST, 'index.html'))) {
    console.log('building…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}
const server = await serveDist({ port: Number(args.port || 4191) })
const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: !args.headed,
    args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--ignore-certificate-errors', ...(args.headed ? [] : ['--use-angle=gl'])],
})
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 })
const page = await context.newPage()
page.on('pageerror', (e) => console.error('page error:', e.message))
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()))
await page.goto(server.url + '?quality=high')
await page.click('[data-go="play"]')
await page.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 180000 })
await skipToDay(page)
// first person needs the pointer (a real click)
await page.mouse.click(640, 360)
await page.waitForTimeout(500)

const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const shot = async (name, clip) => {
    const path = join(out, 'frames', `${name}.png`)
    await page.screenshot({ path, clip })
    return path
}
const tile = (files, labels, cols, sheet, crop) => {
    const vf = (label) => `${crop ? `crop=${crop},` : ''}scale=640:-2,drawtext=text='${label}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6`
    const tmp = files.map((f, i) => {
        const o = f.replace(/\.png$/, '-t.png')
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f, '-vf', vf(labels[i]), o])
        return o
    })
    const rows = Math.ceil(tmp.length / cols)
    const layout = tmp.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => 'w0').join('+') : '0'}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+') : '0'}`).join('|')
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...tmp.flatMap((f) => ['-i', f]),
        '-filter_complex', tmp.length > 1 ? `xstack=inputs=${tmp.length}:layout=${layout}:fill=black` : 'null', '-q:v', '3', join(out, sheet)])
    for (const f of tmp) rmSync(f)
    console.log(`${sheet}: ${files.length} frames, ${cols}×${rows}`)
}

// a clean view: no HUD, looking over the town toward the outcrop
await page.evaluate(() => {
    const g = window.game
    document.getElementById('hud').style.visibility = 'hidden'
    g.noa.camera.heading = 0.6
    g.noa.camera.pitch = 0.05
})

// ---- hands -----------------------------------------------------------------------
if (want('hands')) {
    const families = [
        { sheet: 'sheet-pickaxe.jpg', items: [['pickaxe', 'mine', [0, 0.2, 0.34, 0.45, 0.52, 0.57, 0.62, 0.8]]] },
        { sheet: 'sheet-swords.jpg', items: [['wood_sword', 'swing', [0, 0.25, 0.42, 0.6]], ['stone_sword', 'swing_heavy', [0, 0.34, 0.46, 0.64]], ['iron_sword', 'swing_flourish', [0, 0.22, 0.44, 0.66]]] },
        { sheet: 'sheet-bows.jpg', items: [['bow', 'draw', [0, 0.35, 0.7, 0.8]], ['recurve_bow', 'draw_deep', [0, 0.36, 0.72, 0.82]], ['war_bow', 'draw_full', [0, 0.37, 0.74, 0.84]]] },
    ]
    // the motion stands still at whatever point is set
    await page.evaluate(() => {
        const v = window.game.control.view
        v._showcaseRender = v.render
        v.render = (dtMs, st) => v._showcaseRender.call(v, 0, st)
    })
    for (const fam of families) {
        const files = [], labels = []
        for (const [item, motion, points] of fam.items) {
            await page.evaluate((item) => {
                const inv = window.game.inventory
                if (item !== 'pickaxe') inv.add(item, 1)
                inv.assign(1, item)
                inv.select(1)
            }, item)
            await page.waitForTimeout(400)
            for (const p of points) {
                await page.evaluate(({ motion, p }) => window.game.control.view.pose(p === 0 ? null : motion, p), { motion, p })
                await frames()
                // the hand sits in the lower right
                files.push(await shot(`${item}-${p}`, { x: 440, y: 180, width: 840, height: 540 }))
                labels.push(`${item.replace(/_/g, ' ')} ${p === 0 ? 'rest' : p}`)
            }
            if (item === 'iron_sword') {
                // between swings: the glint halfway up the blade
                await page.evaluate(() => {
                    const v = window.game.control.view
                    v.pose(null)
                    v.gleamT = 0.2
                })
                await frames()
                files.push(await shot('iron_sword-gleam', { x: 440, y: 180, width: 840, height: 540 }))
                labels.push('iron sword gleam')
            }
        }
        tile(files, labels, fam.items.length === 1 ? 4 : fam.items[0][2].length, fam.sheet)
    }
    await page.evaluate(() => {
        const v = window.game.control.view
        v.render = v._showcaseRender
        v.action = null
    })
}

/** the ground at (dx, dz) from the town center: the first empty cell's height */
const flatSpot = (dx, dz) => page.evaluate(({ dx, dz }) => {
    const g = window.game
    const tc = g.world.townCenter
    const x = Math.floor(tc[0] + dx), z = Math.floor(tc[2] + dz)
    return { x, z, y: g.world.surfaceY(x, z) }
}, { dx, dz })
const put = (cells) => page.evaluate((cells) => {
    for (const [x, y, z, b] of cells) window.game.sync.submit({ t: 'block', x, y, z, b })
}, cells)

/** when the chop is caught, ms after the button goes down */
const SPARK_AT = [80, 160, 240, 320, 400, 480]

// ---- sparks ----------------------------------------------------------------------
if (want('sparks')) {
    const files = [], labels = []
    for (const [i, block] of ['cobble', 'iron_ore', 'planks', 'dirt'].entries()) {
        const at = await flatSpot(16, -10 + i * 4)
        // a block at eye height, one step in front of the builder
        await put([[at.x, at.y + 1, at.z + 2, block]])
        await page.evaluate(({ at }) => {
            const g = window.game
            g.noa.entities.setPosition(g.player.entity, [at.x + 0.5, at.y, at.z + 0.5])
            g.noa.camera.heading = 0
            g.noa.camera.pitch = 0.25
            g.inventory.selectTool()
        }, { at })
        await page.waitForTimeout(500)
        await page.mouse.down()
        const t0 = Date.now()
        for (const t of SPARK_AT) {
            await page.waitForTimeout(Math.max(0, t - (Date.now() - t0)))
            files.push(await shot(`spark-${block}-${t}`, { x: 320, y: 90, width: 960, height: 540 }))
            const st = await page.evaluate(() => ({ a: window.game.control.view.action?.name, m: window.game.control.mining?.progress, lock: !!document.pointerLockElement }))
            labels.push(`${block} ${t} ms ${st.a || 'rest'}${st.m ? ' dug ' + Math.round(st.m * 100) + ' pc' : ''}`)
        }
        await page.mouse.up()
        await page.waitForTimeout(300)
    }
    tile(files, labels, SPARK_AT.length, 'sheet-sparks.jpg')
}

// ---- the blade trail from outside ---------------------------------------------------
if (want('trail')) {
    const files = [], labels = []
    for (const item of ['wood_sword', 'stone_sword', 'iron_sword']) {
        await page.evaluate((item) => {
            const g = window.game
            g.inventory.add(item, 1)
            g.inventory.assign(1, item)
            g.inventory.select(1)
            if (g.noa.camera.zoomDistance < 2) g.control.toggleView()
            g.noa.camera.heading = 2.2
            g.noa.camera.pitch = 0.2
        }, item)
        await page.waitForTimeout(700)
        await page.evaluate(() => window.game.control._playAction(window.game.player, 'attack'))
        for (const t of [120, 200, 280]) {
            await page.waitForTimeout(t === 120 ? 120 : 80)
            files.push(await shot(`trail-${item}-${t}`, { x: 240, y: 60, width: 1040, height: 585 }))
            labels.push(`${item.replace(/_/g, ' ')} third person ${t} ms`)
        }
    }
    await page.evaluate(() => window.game.control.toggleView())
    tile(files, labels, 3, 'sheet-trail.jpg')
}

// ---- defences --------------------------------------------------------------------
if (want('defences')) {
    const families = ['wall', 'gate', 'spikes', 'arrow_tower', 'cannon_tower']
    const FAM = {
        wall: ['stone_wall', 'iron_wall', 'steel_wall'], gate: ['gate', 'iron_gate', 'steel_gate'], spikes: ['spikes', 'iron_spikes', 'steel_spikes'],
        arrow_tower: ['arrow_tower', 'crossbow_tower', 'ballista_tower'], cannon_tower: ['cannon_tower', 'mortar_tower', 'bombard_tower'],
    }
    // a level strip outside the town for the row: stone up to the ground line, air above it
    const at = await page.evaluate(() => {
        const g = window.game
        const tc = g.world.townCenter
        const x0 = Math.floor(tc[0] - 16), z = Math.floor(tc[2] + 30)
        const y = g.world.surfaceY(x0 + 16, z)
        for (let x = x0 - 3; x < x0 + 36; x++) {
            for (let dz = -8; dz <= 2; dz++) {
                for (let cy = y - 4; cy < y + 7; cy++) g.sync.submit({ t: 'block', x, y: cy, z: z + dz, b: cy < y ? 'stone' : 'air' })
            }
        }
        return { x: x0, y, z }
    })
    const cells = []
    families.forEach((f, fi) => FAM[f].forEach((b, ti) => {
        const x = at.x + fi * 7 + ti * 2
        if (f.endsWith('tower')) cells.push([x, at.y, at.z, 'cobble'], [x, at.y + 1, at.z, 'cobble'], [x, at.y + 2, at.z, b])
        else if (f === 'spikes') cells.push([x, at.y, at.z, b])
        else cells.push([x, at.y, at.z, b], [x, at.y + 1, at.z, b])
    }))
    await put(cells)
    await page.waitForTimeout(1500)
    const cx = at.x + 16, files = [], labels = []
    // from the -z side, where the ground was checked clear
    for (const [name, heading] of [['left', 0.5], ['front', 0], ['right', -0.5]]) {
        await page.evaluate(({ cx, at, heading }) => {
            const c = window.game.control
            if (c.mode !== 'aerial') c.enterAerial()
            Object.assign(c.aerial, { x: cx, z: at.z, y: at.y + 1, zoom: 21, pitch: 0.32, heading })
            c.glide = null
            c.orbit = null
        }, { cx, at, heading })
        await page.waitForTimeout(1800)
        files.push(await shot(`defences-${name}`))
        labels.push(`walls gates spikes arrow and cannon towers I II III - ${name}`)
    }
    tile(files, labels, 1, 'sheet-defences.jpg')
}

await browser.close()
server.close()
console.log(`output: ${out}`)
