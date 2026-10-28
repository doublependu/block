/*
 *  The showcase: what the weapons and defences look like, on every change,
 *  without a person watching a game (plan 9 §5.4).
 *
 *    sparks    the pickaxe chopping stone, wood and dirt: chips and sparks
 *    trail     the builder's sword streak in third person, per tier
 *    poses     every model holding every item it can, measured against its body
 *              (poses.json) and on a contact sheet
 *    defences  one of every defence tier in a row (I · II · III per family),
 *              seen from three sides
 *    match     plan 14: first person is the body. Every weapon at rest, wound up,
 *              at the blow and at the end, as first person shows it (the body
 *              carried by the camera) next to the same body from outside (the
 *              builder, each troop, each attacker)
 *    slash     plan 14 §3: the one sword slash in both views, a row per sword
 *              (wooden, stone, iron, the swordsman's)
 *    screens   plan 14 §2.3: first person at rest with each kind of item, on a
 *              desktop window, a phone held sideways and one held upright
 *    cheer     plan 13 §3: the winners of a lost creative night cheering at dawn
 *
 *  Like the lab it writes game state directly (hands out items, freezes a
 *  motion at a point, places blocks), so it's a development tool, never a game.
 *
 *  Usage: node --import ./tools/node-ext.mjs tools/autoplay/showcase.mjs [--no-build] [--out=<dir>] [--only=sparks,trail,poses,defences,match,slash,screens,cheer]
 *  Output: <out>/ (default recordings/showcase10/): sheet-*.jpg and the frames they're made of
 */

import { chromium } from 'playwright-core'
import { execSync, execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { serveDist, DIST } from '../serve-dist.mjs'
import { skipToDay } from './lab.mjs'
import { cases, modelFor, FPS } from '../fp-frame.mjs'

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
const tile = (files, labels, cols, sheet, crop, width = 640) => {
    const font = Math.round(22 * width / 640)
    const vf = (label) => `${crop ? `crop=${crop},` : ''}scale=${width}:-2,drawtext=text='${label}':x=8:y=8:fontsize=${font}:fontcolor=white:box=1:boxcolor=black@0.6`
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

/**
 * First person is the body (plan 14). These take it over for a shot: the
 * camera carries `window.__fpChar` (a body made for the row) instead of
 * whoever you control, or nothing at all.
 */
const carry = () => page.evaluate(() => {
    const c = window.game.control
    c._showcaseFP = c._showcaseFP || c._renderFirstPerson
    c._renderFirstPerson = (dt) => {
        c.fp.set(window.__fpChar || null)
        c.fp.render(dt)
    }
    window.game.player.char.setVisible(false)
})
const release = () => page.evaluate(() => {
    const c = window.game.control
    window.__fpChar = null
    c.fp.set(null)
    if (c._showcaseFP) c._renderFirstPerson = c._showcaseFP
    window.game.player.char.setVisible(true)
})

/**
 * In the page, `window.__holdAt(body, clip, frame, total)`: hold a body's clip at
 * `frame` (of `total`), or at rest with no clip. Seeking a playing or paused
 * group doesn't stick (and a paused one stops posing the bones), so it loops a
 * sliver of the clip at that frame.
 */
await page.evaluate(() => {
    window.__holdAt = (c, clip, frame, total) => {
        if (c._actionGroup) {
            c._actionGroup.onAnimationGroupEndObservable.clear()
            c._actionGroup.stop()
        }
        c.action = null
        c._actionGroup = null
        if (clip && c.playAction(clip)) {
            const grp = c._actionGroup
            const at = grp.from + (grp.to - grp.from) * frame / total
            grp.onAnimationGroupEndObservable.clear()
            grp.stop()
            grp.start(true, 1, at, at + 0.01)
            c.action = clip
            c._actionGroup = grp
            c._actionT = frame / 30
            c._actionSpeed = 1
        }
        c._syncHold()
        c._applyMasks()
        c.update(0)
    }
})

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
            const st = await page.evaluate(() => ({ a: window.game.player.char.action, m: window.game.control.mining?.progress, lock: !!document.pointerLockElement }))
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
 * The same checks as tests/fpFrame.test.js makes on the model files: a blade's
 * edge (its x) leads the cut, a pick's head (+x) is in the plane of the chop,
 * a bow's string (+z) is on the archer's side and its stave upright, a gun's
 * barrel (+z) points ahead. Writes <out>/poses.json; exits non-zero if one fails.
 */
if (want('poses')) {
    const CAST = [
        ['player', 'wood_sword', 'attack'], ['player', 'stone_sword', 'attack'], ['player', 'iron_sword', 'attack'],
        ['player', 'pickaxe', 'mine'], ['player', 'bow', 'shoot_draw'], ['player', 'war_bow', 'shoot_draw'], ['player', 'gun', 'shoot'],
        ['defender_swordsman', 'sword', 'attack'], ['defender_archer', 'bow', 'shoot_draw'], ['defender_gunner', 'gun', 'shoot'],
        ['attacker_archer', 'bow', 'shoot_draw'], ['attacker_sapper', 'crude_pickaxe', 'mine'],
        // the fire mage's staff (plan 12 §2): held up, the coal at the top
        ['attacker_pyro', 'fire_staff', 'cast'],
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
    // your own body put away: the camera looks from where it stands
    await carry()
    const files = [], labels = []
    for (const [i, r] of results.entries()) {
        // look at each one from the front right, in first person (your own hands put away)
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
        // the pick as before plan 13 (plan 14 §5): its head in the plane of the chop
        if (it.endsWith('pickaxe')) return !r.blow || r.blow.edgeAngle > 30 ? `the head isn't in the plane of the chop (${r.blow?.edgeAngle}°)` : null
        if (it.endsWith('bow')) return r.rest.long[1] > 0.8 && r.rest.face[2] < -0.5 ? null : `the string isn't on the archer's side (string side ${r.rest.face})`
        if (it === 'gun') return r.rest.face[2] > 0.8 ? null : `the barrel doesn't point ahead (${r.rest.face})`
        if (it === 'fire_staff') return r.rest.long[1] > 0.6 ? null : `the staff isn't held up (${r.rest.long})`
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
    })
    await release()
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

// ---- first person is the body (plan 14) -----------------------------------------------
/** the length of a model's clip, in frames */
const framesOf = (model, clip) => Math.round(modelFor(model).clips[clip].length * FPS)

/** a level patch of open ground away from the town, for the body to stand on */
const openGround = () => page.evaluate(() => {
    const g = window.game
    const tc = g.world.townCenter
    const x = Math.floor(tc[0] - 22), z = Math.floor(tc[2] + 34)
    const y = g.world.surfaceY(x, z)
    for (let dx = -3; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let cy = y - 2; cy < y + 5; cy++) g.sync.submit({ t: 'block', x: x + dx, y: cy, z: z + dz, b: cy < y ? 'stone' : 'air' })
    return { x: x + 0.5, y, z: z + 0.5 }
})

/** a body of the row's model, holding its item, standing on the spot */
const makeBody = (c, spot) => page.evaluate(({ c, spot }) => {
    const g = window.game
    if (window.__body) window.__body.dispose()
    const b = g.chars.create(c.model)
    b.setTransform(spot.x, spot.y, spot.z, 0)
    b.setBase('idle')
    b.setItem(c.item === 'fist' ? null : c.item, c.hold, null, c.item === 'block' ? 'cobble' : null)
    window.__body = b
}, { c, spot })

/**
 * One row per case (tools/fp-frame.mjs cases()): at rest, and at the wind-up,
 * the blow and the end of its strike (contract.js CLIP_KEYS). Each moment
 * twice: as first person shows it (the camera carries the body, seen from the
 * vantage) and from outside (the same body at the same frame, from the front
 * right). They're the one body, so they can't disagree.
 */
async function matchSheet(list, sheet, { moments = ['rest', 'windUp', 'blow', 'end'] } = {}) {
    const spot = await openGround()
    await carry()
    const files = [], labels = []
    const label = (c) => `${c.model.replace(/_/g, ' ')} ${c.item.replace(/_/g, ' ')}`
    for (const c of list) {
        await makeBody(c, spot)
        await page.waitForTimeout(1500)
        for (const m of moments) {
            const rest = m === 'rest' || !c.keys
            const pose = { clip: rest ? null : c.action, frame: rest ? 0 : c.keys[m], total: rest ? 1 : framesOf(c.model, c.action) }
            // first person: the camera carries the body, looking level at open ground
            await page.evaluate(({ pose, spot }) => {
                const g = window.game, b = window.__body
                window.__fpChar = b
                g.control.fp.set(b)
                g.noa.entities.setPosition(g.player.entity, [spot.x - 3, spot.y, spot.z - 3])
                g.noa.camera.heading = Math.PI + 0.6
                g.noa.camera.pitch = 0
                window.__holdAt(b, pose.clip, pose.frame, pose.total)
            }, { pose, spot })
            await frames()
            await frames()
            files.push(await shot(`match-${c.model}-${c.item}-${m}-fp`, { x: 200, y: 0, width: 1080, height: 720 }))
            labels.push(`${label(c)} ${m} - first person`)
            // from outside: the same body, back in the world, at the same frame
            await page.evaluate(({ spot }) => {
                const g = window.game, b = window.__body
                window.__fpChar = null
                g.control.fp.set(null)
                b.setTransform(spot.x, spot.y, spot.z, 0)
                const eye = [spot.x + 1.9, spot.y, spot.z + 2.2]
                g.noa.entities.setPosition(g.player.entity, eye)
                g.noa.camera.heading = Math.atan2(spot.x - eye[0], spot.z - eye[2])
                g.noa.camera.pitch = 0.18
            }, { spot })
            await page.waitForTimeout(250)
            files.push(await shot(`match-${c.model}-${c.item}-${m}-tp`, { x: 100, y: 0, width: 1080, height: 720 }))
            labels.push(`${label(c)} ${m} - third person`)
        }
    }
    await page.evaluate(() => {
        if (window.__body) window.__body.dispose()
        window.__body = null
    })
    await release()
    tile(files, labels, moments.length * 2, sheet, null, 320)
}

if (want('match')) await matchSheet(cases(), 'sheet-match.jpg')

if (want('slash')) {
    const order = ['wood_sword', 'stone_sword', 'iron_sword', 'sword']
    const swords = cases().filter((c) => c.item.endsWith('sword')).sort((a, b) => order.indexOf(a.item) - order.indexOf(b.item))
    await matchSheet(swords, 'sword-slash.jpg', { moments: ['rest', 'windUp', 'blow', 'end'] })
}

if (want('screens')) {
    // first person at rest with each kind of item, on three shapes of screen
    const pick = ['wood_sword', 'iron_sword', 'pickaxe', 'bow', 'gun', 'block', 'fist']
    const list = pick.map((item) => cases().find((c) => c.item === item))
    const spot = await openGround()
    await carry()
    const files = [], labels = []
    for (const [screen, size] of [['desktop', [1280, 720]], ['phone', [844, 390]], ['upright', [390, 844]]]) {
        await page.setViewportSize({ width: size[0], height: size[1] })
        for (const c of list) {
            await makeBody(c, spot)
            await page.waitForTimeout(1200)
            await page.evaluate(({ spot }) => {
                const g = window.game
                window.__fpChar = window.__body
                g.noa.entities.setPosition(g.player.entity, [spot.x - 3, spot.y, spot.z - 3])
                g.noa.camera.heading = Math.PI + 0.6
                g.noa.camera.pitch = 0
            }, { spot })
            await page.waitForTimeout(400)
            const path = join(out, 'frames', `screen-${screen}-${c.item}.png`)
            await page.screenshot({ path })
            // the same height in the sheet whatever the shape, centred in a frame wide enough for any
            const h = 540, w = Math.round(h * size[0] / size[1])
            execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path, '-vf', `scale=${w}:${h},pad=1170:${h}:(ow-iw)/2:0:black`, path.replace('.png', '-p.png')])
            files.push(path.replace('.png', '-p.png'))
            labels.push(`${screen} - ${c.model.replace(/_/g, ' ')} ${c.item.replace(/_/g, ' ')}`)
        }
    }
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.evaluate(() => {
        if (window.__body) window.__body.dispose()
        window.__body = null
    })
    await release()
    tile(files, labels, list.length, 'fp-screens.jpg', null, 320)
}

// ---- the winners cheer (plan 13 §3) ----------------------------------------------------
if (want('cheer')) {
    // a creative world of its own: a night, the Town Center knocked down, and dawn
    const cp = await context.newPage()
    cp.on('pageerror', (e) => console.error('page error:', e.message))
    await cp.goto(server.url + '?quality=high')
    await cp.click('[data-go="new"]')
    await cp.fill('.f-name', 'cheer')
    await cp.fill('.f-seed', 'cheer-13')
    await cp.selectOption('.f-mode', 'creative')
    await cp.click('[data-go="create"]')
    await cp.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 180000 })
    await cp.evaluate(() => {
        const g = window.game
        g.hud.closePanel()
        g.startNight(6)
    })
    await cp.waitForFunction(() => window.game.cycle.phase === 'night' && window.game.units.aliveAttackers() > 6, null, { timeout: 60000 })
    // let them come close, then the town falls
    await cp.waitForTimeout(20000)
    await cp.evaluate(() => {
        const g = window.game
        g.units.town.hp = 0
    })
    await cp.waitForFunction(() => window.game.cycle.phase === 'dawn', null, { timeout: 20000 })
    await cp.evaluate(() => {
        const g = window.game
        document.getElementById('hud').style.visibility = 'hidden'
        const c = g.control
        if (c.mode !== 'aerial') c.enterAerial()
        const tc = g.world.townCenter
        // close in on the attackers round the Town Center
        const out = g.units.units.filter((u) => u.alive && u.side === 'attacker').map((u) => g.units.posOf(u))
        const mx = out.reduce((a, p) => a + p[0], 0) / Math.max(1, out.length), mz = out.reduce((a, p) => a + p[2], 0) / Math.max(1, out.length)
        Object.assign(c.aerial, { x: (mx + tc[0] + 0.5) / 2, y: tc[1] + 1, z: (mz + tc[2] + 0.5) / 2, zoom: 13, shown: 13, pitch: 0.42, heading: Math.atan2(mx - tc[0], mz - tc[2]) + Math.PI })
        c.glide = c.orbit = null
    })
    const files = [], labels = []
    for (const t of [600, 1800, 3000, 4500]) {
        await cp.waitForTimeout(t === 600 ? 600 : t === 4500 ? 1500 : 1200)
        const st = await cp.evaluate(() => {
            const g = window.game
            const out = g.units.units.filter((u) => u.alive && u.side === 'attacker')
            return { phase: g.cycle.phase, t: g.cycle.t.toFixed(1), out: out.length, cheering: out.filter((u) => u.cheer).length, fallen: g.units.units.filter((u) => !u.alive && u.side === 'attacker').length }
        })
        const path = join(out, 'frames', `cheer-${t}.png`)
        await cp.screenshot({ path })
        files.push(path)
        labels.push(`${st.phase} ${st.t} s - ${st.cheering} of ${st.out} attackers cheering, ${st.fallen} fallen`)
        console.log('cheer', JSON.stringify(st))
    }
    tile(files, labels, 2, 'cheer.jpg')
    await cp.close()
}

await browser.close()
server.close()
console.log(`output: ${out}`)
