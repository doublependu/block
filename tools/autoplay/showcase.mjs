/*
 *  The showcase: what the weapons and defences look like, on every change,
 *  without a person watching a game (plan 9 §5.4).
 *
 *    hands     every weapon tier and the pickaxe in first person, caught at
 *              set points of its motion (rest, wind-up, the blow, after):
 *              one contact sheet per family
 *    sparks    the pickaxe chopping stone, wood and dirt: chips and sparks
 *    trail     the builder's sword streak in third person, per tier
 *    poses     every model holding every item it can, measured against its body
 *              (poses.json) and on a contact sheet
 *    defences  one of every defence tier in a row (I · II · III per family),
 *              seen from three sides
 *
 *  Like the lab it writes game state directly (hands out items, freezes a
 *  motion at a point, places blocks), so it's a development tool, never a game.
 *
 *  Usage: node tools/autoplay/showcase.mjs [--no-build] [--out=<dir>] [--only=hands,sparks,trail,poses,defences]
 *  Output: <out>/ (default recordings/showcase10/): sheet-*.jpg and the frames they're made of
 */

import { chromium } from 'playwright-core'
import { execSync, execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { serveDist, DIST } from '../serve-dist.mjs'
import { skipToDay } from './lab.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const ROOT = new URL('../../', import.meta.url).pathname
const out = args.out || join(ROOT, 'recordings', 'showcase10')
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

// ---- poses: what everyone holds, measured ---------------------------------------
/**
 * Every model with every item it can hold, standing in a row: how each item
 * sits against the body (in the body's own frame: x right, y up, z forward),
 * at rest and part way through its action clip, and a contact sheet of them.
 * The same checks as tests/handPose.test.js makes for first person: a blade's
 * edge (its x) leads the cut, a pick's point (+x) leads the chop, a bow's
 * string (+z) is on the archer's side and its stave upright, a gun's barrel
 * (+z) points ahead. Writes <out>/poses.json; exits non-zero if one fails.
 */
if (want('poses')) {
    const CAST = [
        ['player', 'wood_sword', 'attack'], ['player', 'stone_sword', 'attack_heavy'], ['player', 'iron_sword', 'attack_flourish'],
        ['player', 'pickaxe', 'mine'], ['player', 'bow', 'shoot'], ['player', 'war_bow', 'shoot_draw'], ['player', 'gun', 'shoot'],
        ['defender_swordsman', 'sword', 'attack'], ['defender_archer', 'bow', 'shoot'], ['defender_gunner', 'gun', 'shoot'],
        ['attacker_archer', 'bow', 'shoot'], ['attacker_sapper', 'crude_pickaxe', 'attack'],
    ]
    // a level strip for the row: stone up to the ground line, air above it
    const base = await page.evaluate((n) => {
        const g = window.game
        const tc = g.world.townCenter
        const x0 = Math.floor(tc[0] - 20), z = Math.floor(tc[2] + 26)
        const y = g.world.surfaceY(x0, z)
        for (let x = x0 - 2; x < x0 + n * 3 + 2; x++) {
            for (let dz = -3; dz <= 5; dz++) {
                for (let cy = y - 3; cy < y + 5; cy++) g.sync.submit({ t: 'block', x, y: cy, z: z + dz, b: cy < y ? 'stone' : 'air' })
            }
        }
        return { x: x0, y, z }
    }, CAST.length)
    const results = await page.evaluate(async ({ CAST, base }) => {
        const g = window.game
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        // Babylon matrices are row-major with row vectors: v' = v·M, translation in m[12..14]
        const dirOf = (v, m) => {
            const x = v[0] * m[0] + v[1] * m[4] + v[2] * m[8], y = v[0] * m[1] + v[1] * m[5] + v[2] * m[9], z = v[0] * m[2] + v[1] * m[6] + v[2] * m[10]
            const l = Math.hypot(x, y, z) || 1
            return [x / l, y / l, z / l]
        }
        const pointOf = (v, m) => [0, 1, 2].map((i) => v[0] * m[i] + v[1] * m[4 + i] + v[2] * m[8 + i] + m[12 + i])
        const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
        const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
        const len = (a) => Math.hypot(a[0], a[1], a[2])
        const norm = (a) => a.map((v) => v / (len(a) || 1))
        const r2 = (a) => a.map((n) => Math.round(n * 100) / 100)
        /** a world direction in the body's frame (x right, y up, z forward: the holder's own axes) */
        const inBody = (c, d) => {
            const h = c.holder.getWorldMatrix().m
            const rx = norm([h[0], h[1], h[2]]), ry = norm([h[4], h[5], h[6]]), rz = norm([h[8], h[9], h[10]])
            return [dot(d, rx), dot(d, ry), dot(d, rz)]
        }
        const frameOf = (c) => {
            c.holder.computeWorldMatrix(true)
            c.root.computeWorldMatrix(true)
            for (const n of c.root.getChildTransformNodes(false)) n.computeWorldMatrix(true)
            const m = c.itemMesh.computeWorldMatrix(true).m
            return { m, long: inBody(c, dirOf([0, 1, 0], m)), side: inBody(c, dirOf([1, 0, 0], m)), face: inBody(c, dirOf([0, 0, 1], m)) }
        }
        const out = []
        g.control.view.setVisible(false)
        for (const [i, [model, item, clip]] of CAST.entries()) {
            const c = g.chars.create(model)
            const x = base.x + i * 3 + 0.5, z = base.z + 0.5
            c.setTransform(x, base.y, z, 0)
            c.setBase('idle')
            c.setItem(item)
            out.push({ model, item, clip, _c: c, x, z })
        }
        await wait(3000)
        for (const r of out) {
            const c = r._c
            if (!c.itemMesh) {
                r.error = 'no item mesh'
                continue
            }
            const rest = frameOf(c)
            r.rest = { long: r2(rest.long), side: r2(rest.side), face: r2(rest.face) }
            // part way through the action clip: which way does the working end move?
            if (c.playAction(r.clip)) {
                const grp = c._actionGroup
                grp.pause()
                const pick = r.item.includes('pickaxe')
                const tip = pick ? [0.45, 0.4, 0] : [0, 0.6, 0]
                const samples = []
                for (let k = 0; k <= 24; k++) {
                    grp.goToFrame(grp.from + (grp.to - grp.from) * k / 24)
                    const f = frameOf(c)
                    samples.push({ k, p: inBody(c, pointOf(tip, f.m)), f })
                }
                // the fastest stretch of the clip is the blow
                let best = null
                for (let k = 1; k < samples.length; k++) {
                    const v = sub(samples[k].p, samples[k - 1].p)
                    if (!best || len(v) > len(best.v)) best = { k, v, f: samples[k].f }
                }
                const v = norm(best.v)
                const across = norm(sub(v, best.f.long.map((x) => x * dot(v, best.f.long))))
                const deg = (a) => Math.round(Math.acos(Math.min(1, Math.abs(a))) * 180 / Math.PI)
                r.blow = {
                    at: best.k / 24,
                    motion: r2(v),
                    // blade: 0 = the edge leads, 90 = the flat; pick: the same for the head's plane
                    edgeAngle: deg(dot(across, best.f.side)),
                    // pick: does the point lead? It's out on +x, curving down (-y): > 0 yes
                    pointLeads: Math.round(dot(v, norm(best.f.side.map((x, i) => x - 0.5 * best.f.long[i]))) * 100) / 100,
                }
                grp.stop()
                c.action = null
                c._actionGroup = null
                const hold = c.hold
                c.hold = null
                c._setHold(hold)
            }
        }
        window.__posesCast = out
        return out.map(({ _c, ...rest }) => rest)
    }, { CAST, base })
    const files = [], labels = []
    for (const [i, r] of results.entries()) {
        // look at each one from the front right, in first person (the hands hidden)
        await page.evaluate(({ x, y, z }) => {
            const g = window.game
            const eye = [x + 1.7, y, z + 2.4]
            g.noa.entities.setPosition(g.player.entity, eye)
            g.noa.camera.heading = Math.atan2(x - eye[0], z - eye[2])
            g.noa.camera.pitch = 0.12
        }, { x: r.x, y: base.y, z: r.z })
        await page.waitForTimeout(500)
        files.push(await shot(`pose-${i}-${r.model}-${r.item}`, { x: 400, y: 100, width: 480, height: 540 }))
        labels.push(`${r.model.replace(/_/g, ' ')} ${r.item.replace(/_/g, ' ')}`)
    }
    tile(files, labels, 6, 'sheet-poses.jpg')
    const { writeFileSync } = await import('node:fs')
    /** what each kind of item must do in third person (body frame: x right, y up, z forward) */
    const rule = (r) => {
        if (r.error) return r.error
        const it = r.item
        if (it.endsWith('sword')) return r.blow && r.blow.edgeAngle <= 30 ? null : `the flat leads the ${r.clip} (${r.blow?.edgeAngle}° off the edge)`
        if (it.endsWith('pickaxe')) {
            if (!r.blow || r.blow.edgeAngle > 30) return `the head isn't in the plane of the chop (${r.blow?.edgeAngle}°)`
            return r.blow.pointLeads >= 0.5 ? null : `the point doesn't lead the chop (${r.blow.pointLeads})`
        }
        if (it.endsWith('bow')) return r.rest.long[1] > 0.8 && r.rest.face[2] < -0.5 ? null : `the string isn't on the archer's side (string side ${r.rest.face})`
        if (it === 'gun') return r.rest.face[2] > 0.8 ? null : `the barrel doesn't point ahead (${r.rest.face})`
        return null
    }
    let bad = 0
    for (const r of results) {
        r.problem = rule(r)
        if (r.problem) bad++
        console.log(`${r.problem ? 'FAIL' : 'ok  '} ${r.model} ${r.item}: rest long ${r.rest?.long} side ${r.rest?.side} face ${r.rest?.face}` + (r.blow ? ` | blow at ${r.blow.at.toFixed(2)}: ${r.blow.edgeAngle}° off the edge, point leads ${r.blow.pointLeads}` : '') + (r.problem ? ` — ${r.problem}` : ''))
    }
    writeFileSync(join(out, 'poses.json'), JSON.stringify(results, null, 1))
    if (bad) process.exitCode = 1
    await page.evaluate(() => {
        for (const r of window.__posesCast) r._c.dispose()
        window.game.control.view.setVisible(true)
    })
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
