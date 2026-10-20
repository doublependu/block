/*
 *  The crosshair lands on everything you build (plan 13 §4), in the running
 *  game, by mouse: spikes and a gate with stone behind them are mined (the
 *  spikes or the gate go, and come back to you; the stone stays), spikes are
 *  upgraded with a click, and a spike block has no top face to look at.
 *
 *  Plan 16 adds "seen from both sides" (§1): every face of spikes and gates is
 *  there, read from the page's terrain meshes (a face at a cell's side, and the
 *  tile on it; no picture is judged):
 *    edges    placed on a chunk's last row in x, y and z, and on a first row: all
 *             their faces. Mined there: none left. Upgraded there in place (spikes
 *             to iron spikes, an arrow tower to a crossbow tower): the new tile
 *    pairs    each spike kind in front of a gate, two kinds of spikes side by side,
 *             two kinds of gate side by side: both faces between them
 *    alone    a spike in the middle of a chunk: its four sides, and a gate's
 *  and wherever a spike faces air, that side also drawn facing in, so its far
 *  sides show through its near ones (`doubleSided`); a gate never is
 *  and a sheet of the edge row and the pairs, each from both sides (--faces-out,
 *  default recordings/faces16). --only=faces runs just this part.
 *
 *  Usage: node tools/autoplay/target-check.mjs [--no-build | --dist=<a build>] [--only=faces] [--out=recordings/target13]
 *  Exits non-zero when one fails.
 */

import { chromium } from 'playwright-core'
import { execSync, execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serveDist, DIST } from '../serve-dist.mjs'
import { skipToDay } from './lab.mjs'
import { blockId, BLOCK_BY_NAME } from '../../src/world/blocks.js'
import { TILE_INDEX } from '../../src/world/atlas.js'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const ROOT = new URL('../../', import.meta.url).pathname
const out = args.out || join(ROOT, 'recordings', 'target13')
mkdirSync(out, { recursive: true })
// --dist: another build (an older one, to see a check fail on what it fixes)
const dist = args.dist ? resolve(String(args.dist)) + '/' : DIST
if (!args.dist && (!args['no-build'] || !existsSync(join(DIST, 'index.html')))) {
    console.log('building…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}
const server = await serveDist({ port: Number(args.port || 4195), dir: dist })
const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: true,
    args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--ignore-certificate-errors'],
})
const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } })).newPage()
page.on('pageerror', (e) => console.error('page error:', e.message))
await page.goto(server.url + '?quality=high')
await page.click('[data-go="play"]')
await page.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 180000 })
await skipToDay(page)
// the game takes the pointer on a real click
await page.mouse.click(640, 360)
await page.waitForTimeout(500)

let bad = 0
const report = (ok, what) => {
    if (!ok) bad++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

/**
 * Clear ground away from the town, the builder on it, `front` placed one and
 * two cells ahead, and the crosshair on the nearer one. Returns the cells.
 */
async function scene(front, { x = 22, z = -14 } = {}) {
    return page.evaluate(({ front, x, z }) => {
        const g = window.game
        const tc = g.world.townCenter
        const bx = Math.floor(tc[0] + x), bz = Math.floor(tc[2] + z)
        const y = g.world.surfaceY(bx, bz)
        for (let dx = -2; dx <= 2; dx++) for (let dz = -1; dz <= 5; dz++) for (let cy = y - 2; cy < y + 4; cy++) {
            g.sync.submit({ t: 'block', x: bx + dx, y: cy, z: bz + dz, b: cy < y ? 'stone' : 'air' })
        }
        for (const [dz, dy, b] of front) g.sync.submit({ t: 'block', x: bx, y: y + dy, z: bz + 2 + dz, b })
        g.noa.entities.setPosition(g.player.entity, [bx + 0.5, y, bz + 0.5])
        return { x: bx, y, z: bz }
    }, { front, x, z }).then(async (at) => {
        // the camera follows the builder a frame or two later
        await page.waitForTimeout(400)
        return at
    })
}

/** look at the middle of a cell from the eye */
const aim = (cell) => page.evaluate((c) => {
    const g = window.game
    const e = g.noa.camera.getTargetPosition()
    const dx = c[0] + 0.5 - e[0], dy = c[1] + 0.5 - e[1], dz = c[2] + 0.5 - e[2]
    g.noa.camera.heading = Math.atan2(dx, dz)
    g.noa.camera.pitch = -Math.atan2(dy, Math.hypot(dx, dz))
}, cell)
const target = () => page.evaluate(() => {
    const t = window.game.noa.targetedBlock
    return t ? t.position.slice() : null
})
const count = (item) => page.evaluate((item) => window.game.inventory.count(item), item)
const ID = Object.fromEntries(['stone', 'spikes', 'iron_spikes', 'gate'].map((n) => [n, blockId(n)]))

/** hold the left button until the cell is mined (or give up) */
async function mine(cell, ms = 4000) {
    await page.evaluate(() => window.game.inventory.selectTool())
    await aim(cell)
    await page.waitForTimeout(150)
    await page.mouse.down()
    const from = Date.now()
    while (Date.now() - from < ms) {
        await page.waitForTimeout(100)
        if (await page.evaluate((c) => window.game.noa.getBlock(c[0], c[1], c[2]) === 0, cell)) break
    }
    await page.mouse.up()
    await page.waitForTimeout(200)
}

if (args.only !== 'faces') {
    // ---- spikes with stone behind them ----
    for (const [label, b, h] of [['spikes', 'spikes', 1], ['a gate', 'gate', 2]]) {
        const at = await scene([...Array.from({ length: h }, (_, i) => [0, i, b]), [1, 0, 'stone'], [1, 1, 'stone']])
        const cell = [at.x, at.y, at.z + 2], behind = [at.x, at.y, at.z + 3]
        await aim(cell)
        await page.waitForTimeout(200)
        const t = await target()
        report(!!t && t.join() === cell.join(), `${label}: the crosshair lands on it, not on the stone behind (${t ? t.join(',') : 'nothing'})`)
        const had = await count(b)
        await mine(cell)
        const gone = await page.evaluate((c) => window.game.noa.getBlock(c[0], c[1], c[2]) === 0, cell)
        const stone = await page.evaluate(({ c, id }) => window.game.noa.getBlock(c[0], c[1], c[2]) === id, { c: behind, id: ID.stone })
        report(gone, `${label}: mined, it goes`)
        report(stone, `${label}: the stone behind it stays`)
        report((await count(b)) === had + 1, `${label}: you get it back (${had} -> ${await count(b)})`)
        await page.screenshot({ path: join(out, `mined-${b}.png`) })
    }

    // ---- spikes upgraded with a click ----
    {
        const at = await scene([[0, 0, 'spikes']])
        const cell = [at.x, at.y, at.z + 2]
        await page.evaluate(() => {
            const inv = window.game.inventory
            inv.add('iron_spikes', 1)
            inv.assign(2, 'iron_spikes')
            inv.select(2)
        })
        await aim(cell)
        await page.waitForTimeout(200)
        await page.mouse.click(640, 360, { button: 'right' })
        await page.waitForTimeout(400)
        const now = await page.evaluate((c) => window.game.noa.getBlock(c[0], c[1], c[2]), cell)
        report(now === ID.iron_spikes, `spikes: a click with iron spikes in hand upgrades them in place (${now === ID.iron_spikes ? 'iron spikes' : now})`)
        // from above: no top face, the ground shows between the spikes
        await page.evaluate((c) => {
            const g = window.game
            g.noa.entities.setPosition(g.player.entity, [c[0] + 0.5, c[1] + 1, c[2] - 2.5])
            // a second row of plain spikes beside them, to see both from above
            g.sync.submit({ t: 'block', x: c[0] + 1, y: c[1], z: c[2], b: 'spikes' })
            g.sync.submit({ t: 'block', x: c[0] - 1, y: c[1], z: c[2], b: 'steel_spikes' })
            g.inventory.selectTool()
        }, cell)
        await page.waitForTimeout(400)
        await aim([cell[0], cell[1] - 1, cell[2] + 0.5])
        await page.waitForTimeout(600)
        await page.screenshot({ path: join(out, 'spikes-from-above.png') })
    }
}

// ---- seen from both sides (plan 16 §1) ----
{
    const facesOut = args['faces-out'] || join(ROOT, 'recordings', 'faces16')
    mkdirSync(facesOut, { recursive: true })
    const CHUNK = 24
    const SPIKES = ['spikes', 'iron_spikes', 'steel_spikes', 'ice_spikes']
    const GATES = ['gate', 'iron_gate', 'steel_gate']
    const KINDS = [...SPIKES, ...GATES]
    const AXES = ['x', 'y', 'z']
    const SIDES = [[0, 1], [0, -1], [2, 1], [2, -1]]
    const side = (axis, dir) => `${dir > 0 ? '+' : '-'}${AXES[axis]}`
    /** the tile a block shows on a side (blocks.js: one, [top, bottom, sides], or six [+x, -x, +y, -y, +z, -z]) */
    const tileOf = (name, axis, dir) => {
        const t = BLOCK_BY_NAME[name].tiles
        if (typeof t === 'string') return t
        if (t.length === 3) return axis === 1 ? t[dir > 0 ? 0 : 1] : t[2]
        return t[axis * 2 + (dir > 0 ? 0 : 1)]
    }
    const TILE_NAME = Object.fromEntries(Object.entries(TILE_INDEX).map(([n, i]) => [i, n]))

    // the faces the terrain meshes have on one side of a cell, facing `normal` (out, or -dir: in): the tile of each
    await page.evaluate(() => {
        window.__faces = (cell, axis, dir, normal) => {
            const noa = window.game.noa
            const p = cell.slice()
            if (dir > 0) p[axis] += 1
            // the face between two cells is meshed by the chunk of the one on its + side
            const chunk = noa.world._getChunkByCoords(p[0], p[1], p[2])
            if (!chunk) return null
            const loc = [cell[0] - chunk.x, cell[1] - chunk.y, cell[2] - chunk.z]
            const plane = p[axis] - chunk.pos[axis]
            const found = []
            for (const mesh of chunk._terrainMeshes) {
                const pos = mesh.getVerticesData('position'), nrm = mesh.getVerticesData('normal'), atl = mesh.getVerticesData('texAtlasIndices')
                if (!pos || !nrm) continue
                for (let f = 0; f < pos.length / 12; f++) {
                    if (nrm[f * 12 + axis] !== normal) continue
                    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
                    for (let v = 0; v < 4; v++) for (let a = 0; a < 3; a++) {
                        const c = pos[f * 12 + v * 3 + a]
                        lo[a] = Math.min(lo[a], c)
                        hi[a] = Math.max(hi[a], c)
                    }
                    if (lo[axis] !== plane || hi[axis] !== plane) continue
                    if ([0, 1, 2].every((a) => a === axis || (lo[a] <= loc[a] && loc[a] + 1 <= hi[a]))) found.push(atl ? atl[f * 4] : -1)
                }
            }
            return found
        }
    })
    const faces = (cell, axis, dir, normal = dir) => page.evaluate(([c, a, d, n]) => window.__faces(c, a, d, n), [cell, axis, dir, normal])
    const tiles = (f) => (f === null ? 'no chunk' : f.length ? f.map((i) => TILE_NAME[i] || i).join(' + ') : 'none')
    const put = (list) => page.evaluate((list) => {
        for (const [c, b] of list) window.game.sync.submit({ t: 'block', x: c[0], y: c[1], z: c[2], b })
    }, list)
    // noa remeshes a few chunks a frame
    const settle = () => page.waitForTimeout(900)
    /** the cell's side shows `name`'s tile, and only that */
    async function expectFace(cell, name, axis, dir, what) {
        const f = await faces(cell, axis, dir)
        const want = TILE_INDEX[tileOf(name, axis, dir)]
        const ok = !!f && f.length === 1 && f[0] === want
        report(ok, `${what}: ${name} at ${cell.join(',')} shows its ${side(axis, dir)} face (${tiles(f)})`)
    }
    /** a side against air, seen from the far side through the block: a spike's tile facing in, and a gate's nothing */
    async function expectInward(cell, name, axis, dir, what) {
        const f = await faces(cell, axis, dir, -dir)
        const ds = !!BLOCK_BY_NAME[name].doubleSided
        const ok = !!f && (ds ? f.length === 1 && f[0] === TILE_INDEX[tileOf(name, axis, dir)] : f.length === 0)
        report(ok, `${what}: ${name} at ${cell.join(',')} ${ds ? 'shows' : 'has nothing on'} its ${side(axis, dir)} side facing in (${tiles(f)})`)
    }
    /** all four sides, against air: out, and in for a spike */
    async function expectSides(cell, name, what) {
        for (const [a, d] of SIDES) {
            await expectFace(cell, name, a, d, what)
            await expectInward(cell, name, a, d, what)
        }
    }
    async function expectNone(cell, axis, dir, what) {
        for (const normal of [dir, -dir]) {
            const f = await faces(cell, axis, dir, normal)
            report(!!f && f.length === 0, `${what}: nothing left on the ${side(axis, dir)} side of ${cell.join(',')}, facing ${normal === dir ? 'out' : 'in'} (${tiles(f)})`)
        }
    }
    async function shot(file, pos, look) {
        await page.evaluate((pos) => {
            const g = window.game
            g.noa.entities.setPosition(g.player.entity, pos)
        }, pos)
        await page.waitForTimeout(300)
        await aim([look[0] - 0.5, look[1] - 0.5, look[2] - 0.5])
        await page.waitForTimeout(500)
        const f = join(facesOut, file)
        await page.screenshot({ path: f })
        return f
    }

    // a flat stone floor, away from the town, round the corner of four chunks: ex is a last row in x, ez in z
    const mod = (n) => ((n % CHUNK) + CHUNK) % CHUNK
    const area = await page.evaluate(() => {
        const g = window.game
        const tc = g.world.townCenter
        return { x: Math.floor(tc[0] + 34), z: Math.floor(tc[2] - 30) }
    })
    const ex = area.x - mod(area.x) + CHUNK - 1, ez = area.z - mod(area.z) + CHUNK - 1
    const y = await page.evaluate(([ex, ez]) => {
        const g = window.game
        const y = g.world.surfaceY(ex - 8, ez - 10)
        g.noa.entities.setPosition(g.player.entity, [ex - 8.5, y + 6, ez - 10.5])
        for (let x = ex - 22; x <= ex + 6; x++) for (let z = ez - 28; z <= ez + 8; z++) for (let cy = y - 2; cy < y + 5; cy++) {
            g.sync.submit({ t: 'block', x, y: cy, z, b: cy < y ? 'stone' : 'air' })
        }
        return y
    }, [ex, ez])
    await page.waitForTimeout(2000)
    const sheet = []

    // 1. on a last row: a column of every kind on x = ex, a row of every kind on z = ez
    const colX = KINDS.map((k, i) => [[ex, y, ez - 14 + 2 * i], k])
    const rowZ = KINDS.map((k, i) => [[ex - 16 + 2 * i, y, ez], k])
    await put([...colX, ...rowZ])
    await settle()
    for (const [c, k] of [...colX, ...rowZ]) await expectSides(c, k, 'last row')
    sheet.push([await shot('edge-from-minus-z.png', [ex - 10, y, ez - 4.5], [ex - 10, y + 0.3, ez + 0.5]), 'A last row of a chunk, from inside'])
    sheet.push([await shot('edge-from-plus-z.png', [ex - 10, y, ez + 5.5], [ex - 10, y + 0.3, ez + 0.5]), 'The same row from outside: every face there'])

    // 2. upgraded in place on a last row: the new tile on the outer side
    const up = [[[ex, y, ez - 14], 'spikes', 'iron_spikes'], [[ex, y, ez - 16], 'arrow_tower', 'crossbow_tower']]
    await put(up.map(([c, from]) => [c, from]))
    await settle()
    await put(up.map(([c, , to]) => [c, to]))
    await settle()
    for (const [c, from, to] of up) await expectFace(c, to, 0, 1, `${from} upgraded on a last row`)

    // 3. mined on a last row: nothing left behind. The tower goes after: taking an opaque block
    // away remeshes the next chunk even without the fix, and would hide what this is for
    await put([...colX, ...rowZ].map(([c]) => [c, 'air']))
    await settle()
    for (const [c] of colX) await expectNone(c, 0, 1, 'mined on a last row')
    for (const [c] of rowZ) await expectNone(c, 2, 1, 'mined on a last row')
    await put(up.map(([c]) => [c, 'air']))

    // 4. each spike kind in front of a gate: both faces between them
    const pairs = SPIKES.map((k, i) => [[[ex - 18 + 3 * i, y, ez - 22], k], [[ex - 18 + 3 * i, y, ez - 21], GATES[i % GATES.length]]])
    await put(pairs.flat())
    await settle()
    for (const [[sc, sk], [gc, gk]] of pairs) {
        await expectFace(sc, sk, 2, 1, 'spikes in front of a gate')
        await expectFace(gc, gk, 2, -1, 'a gate behind spikes')
    }
    sheet.push([await shot('pairs-from-minus-z.png', [ex - 13.5, y, ez - 26.5], [ex - 13.5, y + 0.5, ez - 21]), 'Spikes in front of gates: the gates show through'])
    sheet.push([await shot('pairs-from-plus-z.png', [ex - 13.5, y, ez - 16.5], [ex - 13.5, y + 0.5, ez - 21.5]), 'From behind the gates: the spikes show through'])

    // 5. two kinds side by side: spikes, then gates
    for (const [what, kinds, z] of [['two kinds of spikes side by side', SPIKES, ez - 17], ['two kinds of gate side by side', GATES, ez - 19]]) {
        const row = kinds.map((k, i) => [[ex - 18 + i, y, z], k])
        await put(row)
        await settle()
        for (let i = 0; i + 1 < row.length; i++) {
            await expectFace(row[i][0], row[i][1], 0, 1, what)
            await expectFace(row[i + 1][0], row[i + 1][1], 0, -1, what)
        }
    }

    // 6. on a first row (x = ex + 1, z = ez + 1), alone in the middle of a chunk, and on a last row in y
    const firstX = KINDS.map((k, i) => [[ex + 1, y, ez - 13 + 2 * i], k])
    const firstZ = KINDS.map((k, i) => [[ex - 15 + 2 * i, y, ez + 1], k])
    const alone = [[[ex - 10, y, ez - 10], 'ice_spikes'], [[ex - 7, y, ez - 10], 'gate']]
    const top = y + (CHUNK - 1 - mod(y))
    const gatesY = GATES.map((k, i) => [[ex - 18 + 2 * i, top, ez - 6], k])
    const gatesY0 = GATES.map((k, i) => [[ex - 11 + 2 * i, top + 1, ez - 6], k])
    // room round the high gates
    await page.evaluate(([cells, y]) => {
        const g = window.game
        for (const [c] of cells) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let cy = y + 5; cy <= c[1] + 2; cy++) {
            g.sync.submit({ t: 'block', x: c[0] + dx, y: cy, z: c[2] + dz, b: 'air' })
        }
    }, [[...gatesY, ...gatesY0], y])
    await put([...firstX, ...firstZ, ...alone, ...gatesY, ...gatesY0])
    await settle()
    for (const [c, k] of [...firstX, ...firstZ]) await expectSides(c, k, 'first row')
    for (const [c, k] of alone) await expectSides(c, k, 'alone')
    const [lone] = alone[0]
    const mid = [lone[0] + 0.5, lone[1] + 0.45, lone[2] + 0.5]
    sheet.push([await shot('alone-front.png', [lone[0] + 0.5, y, lone[2] - 1.6], mid), 'A spike alone, from the front: the far row shows through'])
    sheet.push([await shot('alone-corner.png', [lone[0] - 0.7, y, lone[2] - 0.7], mid), 'From a corner: all four sides'])
    for (const [c, k] of gatesY) await expectFace(c, k, 1, 1, 'a gate on a last row in y')
    for (const [c, k] of gatesY0) await expectFace(c, k, 1, -1, 'a gate on a first row in y')

    if (existsSync('/usr/bin/ffmpeg')) {
        const vf = (label) => `scale=960:-2,drawtext=text='${label.replace(/:/g, ' -').replace(/'/g, '')}':x=10:y=10:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6`
        const tmp = sheet.map(([f, label]) => {
            const o = f.replace(/\.png$/, '-t.png')
            execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f, '-vf', vf(label), o])
            return o
        })
        execFileSync('ffmpeg', ['-v', 'error', '-y', ...tmp.flatMap((f) => ['-i', f]), '-filter_complex', `xstack=inputs=${tmp.length}:layout=${tmp.map((_, i) => `${i % 2 ? 'w0' : '0'}_${Math.floor(i / 2) ? Array.from({ length: Math.floor(i / 2) }, () => 'h0').join('+') : '0'}`).join('|')}:fill=black`, '-q:v', '3', join(facesOut, 'sheet-faces.jpg')])
        console.log(`sheet: ${join(facesOut, 'sheet-faces.jpg')}`)
    }
}

await browser.close()
server.close()
console.log(`output: ${out}`)
if (bad) process.exitCode = 1
