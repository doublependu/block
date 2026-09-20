/*
 *  What the bot can do with its hands: look, aim at a block, dig it, place a
 *  block or troop, walk a path (digging through what's in the way), craft in
 *  the Build panel and put items on the hotbar. Every action goes through
 *  Input; every fact comes from the read-only game view.
 */

import { RECIPES, ITEMS, REACH } from '../../../src/game/balance.js'
import { BLOCK_BY_ID } from '../../../src/world/blocks.js'
import { pathSearch, stepCells, passable, diggable, standable } from './nav.js'

const wrapPi = (a) => {
    a = (a + Math.PI) % (Math.PI * 2)
    if (a < 0) a += Math.PI * 2
    return a - Math.PI
}
const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
const center = (b) => [b[0] + 0.5, b[1] + 0.5, b[2] + 0.5]
const FACES = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]

export class Skills {
    /** @param {import('./bot.js').Bot} bot */
    constructor(bot) {
        this.bot = bot
        this.see = bot.see
        this.input = bot.input
        /** what the bot is doing, for the logs ('walking', 'mining', …) */
        this.activity = 'idle'
    }

    // ---- looking ---------------------------------------------------------------------

    /** heading and pitch from the eye to a point (noa: pitch > 0 looks down) */
    anglesTo(pt) {
        const e = this.see.eye()
        const dx = pt[0] - e[0], dy = pt[1] - e[1], dz = pt[2] - e[2]
        return { h: Math.atan2(dx, dz), p: Math.atan2(-dy, Math.hypot(dx, dz)) }
    }

    lookAt(pt, fast = false) {
        const a = this.anglesTo(pt)
        this.bot.look = { h: a.h, p: a.p, fast }
    }

    lookDir(h, p, fast = false) {
        this.bot.look = { h, p, fast }
    }

    /** error between where the camera looks and the look target */
    lookError() {
        const L = this.bot.look
        if (!L) return 0
        const c = this.see.cam()
        return Math.hypot(wrapPi(L.h - c.heading), L.p - c.pitch)
    }

    /** turn to a point and wait until the camera is on it */
    async aimPoint(pt, tol = 0.02, timeout = 1.5) {
        const t0 = this.bot.time
        let settled = 0
        while (this.bot.time - t0 < timeout) {
            this.lookAt(pt)
            await this.bot.frame()
            if (this.lookError() < tol) {
                if (++settled >= 2) return true
            } else settled = 0
        }
        return false
    }

    // ---- blocks ----------------------------------------------------------------------

    /**
     * Points on a block to aim at: its centre, then the middle of each face that
     * faces the eye and isn't covered.
     */
    aimPoints(b) {
        const e = this.see.eye()
        const pts = [center(b)]
        for (const n of FACES) {
            const toEye = (e[0] - (b[0] + 0.5 + n[0] * 0.5)) * n[0] + (e[1] - (b[1] + 0.5 + n[1] * 0.5)) * n[1] + (e[2] - (b[2] + 0.5 + n[2] * 0.5)) * n[2]
            if (toEye <= 0.02) continue
            if (!passable(this.see.block(b[0] + n[0], b[1] + n[1], b[2] + n[2]))) continue
            pts.push([b[0] + 0.5 + n[0] * 0.45, b[1] + 0.5 + n[1] * 0.45, b[2] + 0.5 + n[2] * 0.45])
        }
        return pts
    }

    /** aim until the game's targeted block is `b` (noa updates it on its 30 Hz tick) */
    async aimBlock(b) {
        for (const pt of this.aimPoints(b)) {
            if (!(await this.aimPoint(pt, 0.015, 1.2))) continue
            // two game ticks for the target to update
            await this.bot.wait(0.08)
            const t = this.see.targeted()
            if (t && same(t.position, b)) return true
        }
        return false
    }

    reachable(b, margin = 0.6) {
        const e = this.see.eye()
        const c = center(b)
        return Math.hypot(c[0] - e[0], c[1] - e[1], c[2] - e[2]) <= REACH - margin
    }

    /**
     * Dig one block from where the bot stands (it must be in reach). Clears what's
     * in front of it first if something natural is in the way.
     * @returns {Promise<boolean>} the block is gone
     */
    async mine(b, depth = 0) {
        const see = this.see
        const id = see.block(b[0], b[1], b[2])
        if (passable(id)) return true
        if (!diggable(id) && !(BLOCK_BY_ID[id] && BLOCK_BY_ID[id].built && this.bot.allowBuiltDig)) return false
        if (!see.canEdit) return false
        if (!this.reachable(b, 0.3)) return false
        const prev = this.activity
        this.activity = 'mining'
        try {
            if (!(await this.aimBlock(b))) {
                // something else is in the way: dig that first, if it's natural and close
                const t = see.targeted()
                if (depth < 2 && t && !same(t.position, b) && diggable(see.block(...t.position))) {
                    if (!(await this.mine(t.position, depth + 1))) return false
                    return this.mine(b, depth + 1)
                }
                return false
            }
            const def = BLOCK_BY_ID[id]
            const limit = this.bot.time + def.hardness * 1.6 + 1.5
            const aim = this.bot.look
            this.input.mouseDown(0)
            try {
                while (see.block(b[0], b[1], b[2]) === id) {
                    if (this.bot.time > limit || !see.canEdit) return false
                    this.bot.look = aim
                    await this.bot.frame()
                    const t = see.targeted()
                    // lost the block (bumped, or something moved in front): aim again
                    if (!t || !same(t.position, b)) {
                        this.input.mouseUp(0)
                        if (!(await this.aimBlock(b))) return false
                        this.input.mouseDown(0)
                    }
                }
            } finally {
                this.input.mouseUp(0)
            }
            this.bot.note('mined', { block: def.name })
            return true
        } finally {
            this.activity = prev
        }
    }

    // ---- hotbar ----------------------------------------------------------------------

    hotbar() {
        return [...this.see.g.inventory.hotbar]
    }

    async select(item) {
        const i = this.hotbar().indexOf(item)
        if (i < 0) {
            if (!(await this.toHotbar(item))) return false
            return this.select(item)
        }
        if (this.see.g.inventory.selected !== i) {
            this.input.tap('Digit' + (i + 1))
            await this.bot.until(() => this.see.g.inventory.selected === i, 0.5)
        }
        return this.see.g.inventory.selected === i
    }

    /** a hotbar slot to give up: empty, then junk, then the least useful */
    _freeSlot(keep) {
        const bar = this.hotbar()
        const inv = this.see.g.inventory
        let best = -1, bestScore = -Infinity
        bar.forEach((name, i) => {
            if (name === 'pickaxe' || keep.includes(name)) return
            let s = 0
            if (!name || inv.count(name) <= 0) s = 100
            else if (['dirt', 'sand', 'log'].includes(name)) s = 50
            else if (ITEMS[name].kind === 'weapon' && name !== inv.bestWeapon) s = 40
            else if (ITEMS[name].kind === 'resource') s = 30
            else s = 10 - inv.count(name) / 100
            if (s > bestScore) {
                bestScore = s
                best = i
            }
        })
        return best
    }

    /** put an item on the hotbar through the Build panel (click it, then a slot key) */
    async toHotbar(item, keep = []) {
        if (this.hotbar().includes(item)) return true
        if (this.see.g.inventory.count(item) <= 0) return false
        const slot = this._freeSlot([item, ...keep])
        if (slot < 0) return false
        if (!(await this.openBuild())) return false
        try {
            await this.bot.wait(0.25)
            if (!this.input.click(document.querySelector(`[data-panel="build"] [data-item="${item}"]`))) return false
            await this.bot.wait(0.3)
            this.input.tap('Digit' + (slot + 1))
            await this.bot.until(() => this.hotbar().includes(item), 0.6)
            this.bot.note('hotbar', { item, slot: slot + 1 })
            await this.bot.wait(0.3)
        } finally {
            await this.closePanel()
        }
        return this.hotbar().includes(item)
    }

    // ---- crafting ----------------------------------------------------------------------

    async openBuild() {
        this.bot.expectPanel = 'build'
        if (this.see.panel === 'build') return true
        if (this.see.panel) await this.closePanel()
        this.bot.expectPanel = 'build'
        this.input.tap('KeyB')
        return this.bot.until(() => this.see.panel === 'build', 1)
    }

    async closePanel() {
        const name = this.see.panel
        this.bot.expectPanel = null
        if (!name) return
        this.input.click(document.querySelector(`[data-panel="${name}"] [data-close]`))
        await this.bot.until(() => !this.see.panel, 0.5)
    }

    /**
     * Craft recipes in the Build panel, one click each.
     * @param {[string, number][]} list [output, times]
     * @returns {Promise<Record<string, number>>} how many of each were crafted
     */
    async craft(list) {
        const done = {}
        const inv = this.see.g.inventory
        const todo = list.filter(([out, n]) => n > 0 && inv.canAfford(RECIPES.find((r) => r.out === out).cost))
        if (!todo.length) return done
        const prev = this.activity
        this.activity = 'crafting'
        if (!(await this.openBuild())) return done
        try {
            await this.bot.wait(0.4)
            for (const [out, n] of todo) {
                const i = RECIPES.findIndex((r) => r.out === out)
                for (let k = 0; k < n; k++) {
                    if (!inv.canAfford(RECIPES[i].cost)) break
                    const before = inv.count(out)
                    this.input.click(document.querySelector(`[data-panel="build"] [data-recipe="${i}"]`))
                    await this.bot.wait(0.22)
                    if (inv.count(out) > before) {
                        done[out] = (done[out] || 0) + 1
                        this.bot.note('crafted', { item: out })
                    }
                }
            }
            await this.bot.wait(0.3)
        } finally {
            await this.closePanel()
            this.activity = prev
        }
        return done
    }

    // ---- placing -----------------------------------------------------------------------

    /** faces of solid neighbours a block at `cell` can be placed against, best first */
    supportFaces(cell) {
        const e = this.see.eye()
        const out = []
        for (const n of FACES) {
            const s = [cell[0] - n[0], cell[1] - n[1], cell[2] - n[2]]
            // only solid blocks can be aimed at
            if (!standable(this.see.block(s[0], s[1], s[2]))) continue
            // the face of s that touches the cell, and a point just inside s
            const face = [cell[0] + 0.5 - n[0] * 0.5, cell[1] + 0.5 - n[1] * 0.5, cell[2] + 0.5 - n[2] * 0.5]
            const facing = (e[0] - face[0]) * n[0] + (e[1] - face[1]) * n[1] + (e[2] - face[2]) * n[2]
            const pt = [face[0] - n[0] * 0.03, face[1] - n[1] * 0.03, face[2] - n[2] * 0.03]
            out.push({ support: s, pt, facing, dist: Math.hypot(pt[0] - e[0], pt[1] - e[1], pt[2] - e[2]) })
        }
        return out.sort((a, b) => (b.facing > 0.05) - (a.facing > 0.05) || a.dist - b.dist)
    }

    /** nothing solid on the straight line from an eye position to the middle of a cell */
    clearTo(eye, cell) {
        const c = center(cell)
        const n = Math.ceil(Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]) / 0.2)
        for (let i = 1; i < n; i++) {
            const t = i / n
            const x = Math.floor(eye[0] + (c[0] - eye[0]) * t), y = Math.floor(eye[1] + (c[1] - eye[1]) * t), z = Math.floor(eye[2] + (c[2] - eye[2]) * t)
            if (x === cell[0] && y === cell[1] && z === cell[2]) break
            if (standable(this.see.block(x, y, z))) return false
        }
        return true
    }

    /** the bot's body overlaps this cell */
    inCell(cell) {
        const p = this.see.me().pos
        const hw = 0.3 + 0.02
        return p[0] + hw > cell[0] && p[0] - hw < cell[0] + 1 && p[2] + hw > cell[2] && p[2] - hw < cell[2] + 1 &&
            p[1] + 1.75 > cell[1] && p[1] < cell[1] + 1
    }

    /**
     * Place `item` at `cell`. The bot must be within reach and not in the cell.
     * Cells above eye level are placed at the top of a jump.
     * @param {{night?: boolean}} [o] night: patching a hole (allowed at night with the same block)
     */
    async place(cell, item, { night = false } = {}) {
        const see = this.see
        const fail = (why) => {
            this.bot.note('place-failed', { item, at: cell, why })
            return false
        }
        if (!see.canEdit && !night) return false
        if (see.block(...cell) !== 0) return fail('not empty')
        // overshot into the cell: step back to the middle of the cell it stands in
        if (this.inCell(cell)) {
            await this.brakeAt(see.feetCell(), 1)
            if (this.inCell(cell)) return fail('standing in it')
        }
        // a unit in the way (troops wander by day): give it a moment to move on
        if (see.g.noa.entities.isTerrainBlocked(cell[0], cell[1], cell[2])) {
            if (!(await this.bot.until(() => !see.g.noa.entities.isTerrainBlocked(cell[0], cell[1], cell[2]), 3))) return fail('unit in the way')
        }
        const count = () => see.g.inventory.count(item)
        const before = count()
        if (before <= 0) return fail('none left')
        if (!(await this.select(item))) return fail('not on the hotbar')
        const prev = this.activity
        this.activity = 'placing'
        try {
            for (let attempt = 0; attempt < 4; attempt++) {
                const faces = this.supportFaces(cell).filter((f) => f.dist < REACH - 0.3)
                if (!faces.length) return fail('nothing to place against in reach')
                const visible = faces.find((f) => f.facing > 0.05)
                const f = visible || faces[0]
                const jump = !visible
                if (jump) {
                    // jump and place at the top, when the face comes into view
                    this.input.keyDown('Space')
                }
                // aim, and place as soon as the game targets that face (being jostled, the aim never settles exactly)
                const t0 = this.bot.time
                let placed = false
                while (this.bot.time - t0 < (jump ? 0.9 : 1.4)) {
                    this.lookAt(f.pt, true)
                    await this.bot.frame()
                    if (this.bot.time - t0 > 0.1) this.input.keyUp('Space')
                    const t = see.targeted()
                    if (t && same(t.position, f.support) && same(t.adjacent, cell) && this.lookError() < 0.03) {
                        this.input.tap('KeyE')
                        placed = true
                        break
                    }
                }
                this.input.keyUp('Space')
                if (placed) {
                    const ok = await this.bot.until(() => count() < before, 0.4)
                    if (ok) {
                        this.bot.note(night ? 'patched' : 'placed', { item, at: cell })
                        if (jump) await this.bot.until(() => this.see.onGround(), 1)
                        return true
                    }
                }
                if (jump) await this.bot.until(() => this.see.onGround(), 1)
            }
            if (see.g.noa.entities.isTerrainBlocked(cell[0], cell[1], cell[2])) return fail('unit in the way')
            // what it was looking at instead, to see why
            const t = see.targeted()
            this.bot.note('aim-debug', { at: cell, me: see.feetCell(), target: t && t.position, adjacent: t && t.adjacent, err: +this.lookError().toFixed(3), faces: this.supportFaces(cell).map((f) => [f.support, +f.facing.toFixed(2), +f.dist.toFixed(1)]) })
            return fail('no aim')
        } finally {
            this.input.keyUp('Space')
            this.activity = prev
        }
    }

    // ---- moving ------------------------------------------------------------------------

    /**
     * Walk until isGoal holds for the feet cell, digging through natural blocks
     * on the way (by day). Replans when stuck.
     * @param {(x: number, y: number, z: number) => boolean} isGoal
     * @param {number[]} toward a point near the goal
     * @returns {Promise<boolean>}
     */
    async walkTo(isGoal, toward, { dig = null, avoid = null, maxNodes = 30000, tries = 4, maxSteps = Infinity } = {}) {
        const see = this.see
        const canDig = dig === null ? see.canEdit : dig && see.canEdit
        const prev = this.activity
        this.activity = 'walking'
        try {
            for (let attempt = 0; attempt < tries; attempt++) {
                // plan from the ground, not mid-jump
                await this.bot.until(() => see.onGround(), 1.2)
                const start = see.feetCell()
                if (isGoal(...start)) return true
                const search = pathSearch({ getBlock: see.block, start, isGoal, toward, dig: canDig, avoid, maxNodes, half: see.half, sliceMs: 4 })
                let step, frames = 0
                const t0 = performance.now()
                while (!(step = this.bot.timed('findPath', () => search.next())).done) {
                    frames++
                    await this.bot.frame()
                }
                const path = step.value
                if (frames > 3) this.bot.note('long-search', { frames, ms: Math.round(performance.now() - t0), found: !!path })
                if (!path) {
                    this.bot.note('nopath', { from: start, toward })
                    return false
                }
                const r = await this.followPath(path.slice(0, maxSteps), start)
                if (r === 'ok') return path.length <= maxSteps ? true : isGoal(...see.feetCell())
            }
            return false
        } finally {
            this.stop()
            this.activity = prev
        }
    }

    stop() {
        this.input.setMoveKeys(new Set())
    }

    /** the body can walk in a straight line from p to the step's cell on one level (corners checked) */
    clearWalk(p, s) {
        const get = this.see.block
        const tx = s.x + 0.5, tz = s.z + 0.5
        const dx = tx - p[0], dz = tz - p[2]
        const len = Math.hypot(dx, dz)
        const n = Math.ceil(len / 0.3)
        for (let i = 1; i <= n; i++) {
            const x = p[0] + (dx * i) / n, z = p[2] + (dz * i) / n
            for (const [ox, oz] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]]) {
                const cx = Math.floor(x + ox), cz = Math.floor(z + oz)
                if (!standable(get(cx, s.y - 1, cz)) || !passable(get(cx, s.y, cz)) || !passable(get(cx, s.y + 1, cz))) return false
            }
        }
        return true
    }

    /** cells in the way of a step that aren't open yet */
    _blockers(from, s) {
        return stepCells(from, s).filter((c) => !passable(this.see.block(c[0], c[1], c[2])))
    }

    /**
     * Steer toward a point on the ground: W toward it, strafe out sideways error,
     * and (when it's where the bot must stop) brake so it arrives without overshooting.
     * @returns {number} horizontal distance left
     */
    _steer(tx, tz, stop, pitch = 0.12) {
        const see = this.see
        const p = see.me().pos
        const dx = tx - p[0], dz = tz - p[2]
        const d = Math.hypot(dx, dz)
        const keys = new Set()
        if (d > 0.08) {
            const h = Math.atan2(dx, dz)
            // close in, keep the heading (turning on the spot just circles the point)
            if (d > 0.7 || !this.bot.look) this.lookDir(h, pitch, true)
            const c = see.cam()
            const rel = wrapPi(h - c.heading)
            const fwd = Math.cos(rel) * d, side = Math.sin(rel) * d
            const v = see.speed()
            const vmax = stop ? Math.sqrt(2 * 11 * Math.max(0, d - 0.12)) : Infinity
            if (fwd > 0.1 && Math.abs(rel) < 0.8 && v <= vmax) keys.add('KeyW')
            if (fwd < -0.15 || (stop && v > vmax + 2.5)) keys.add('KeyS')
            if (side > 0.14 && d < 2.5) keys.add('KeyD')
            else if (side < -0.14 && d < 2.5) keys.add('KeyA')
        }
        this.input.setMoveKeys(keys)
        return d
    }

    /** come to a stop near a cell's centre (to dig from it) */
    async brakeAt(cell, timeout = 1.5) {
        const t0 = this.bot.time
        while (this.bot.time - t0 < timeout) {
            const d = this._steer(cell[0] + 0.5, cell[2] + 0.5, true)
            if (d < 0.6 && this.see.speed() < 1.5) break
            await this.bot.frame()
        }
        this.stop()
    }

    /**
     * Walk a planned path. On flat stretches it heads for the farthest point it
     * can reach in a straight line; it stops only to dig, and at the end.
     * @returns {Promise<'ok'|'blocked'|'stuck'>}
     */
    async followPath(path, start) {
        const see = this.see
        const at = (i) => (i < 0 ? { x: start[0], y: start[1], z: start[2], kind: 'walk' } : path[i])
        let i = 0
        let aimJ = 0, aimT = -1
        let bestD = Infinity, bestT = this.bot.time, jumps = 0
        while (i < path.length) {
            const s = path[i]
            const prev = at(i - 1)
            // dig what's in the way, standing still, top first
            const blockers = this._blockers([prev.x, prev.y, prev.z], s)
            if (blockers.length) {
                await this.brakeAt([prev.x, prev.y, prev.z])
                for (const c of blockers) {
                    const id = see.block(c[0], c[1], c[2])
                    if (BLOCK_BY_ID[id] && BLOCK_BY_ID[id].fluid) continue
                    if (!diggable(id) || !(await this.mine(c))) return 'blocked'
                }
                bestT = this.bot.time
                continue
            }
            if (s.kind !== 'drop' && !standable(see.block(s.x, s.y - 1, s.z))) return 'blocked'
            const p = see.me().pos
            // the farthest waypoint on this level in a straight line (rechecked a few times a second)
            if (this.bot.time - aimT > 0.15 || aimJ < i) {
                aimT = this.bot.time
                let j = i
                if (s.kind === 'walk' && Math.abs(p[1] - s.y) < 0.3) {
                    for (let k = i + 1; k < Math.min(path.length, i + 14); k++) {
                        const q = path[k]
                        if (q.kind !== 'walk' || q.y !== s.y || this._blockers([path[k - 1].x, path[k - 1].y, path[k - 1].z], q).length) break
                        if (this.clearWalk(p, q)) j = k
                    }
                }
                aimJ = j
            }
            const tgt = path[aimJ]
            const next = path[aimJ + 1]
            const stopHere = !next || this._blockers([tgt.x, tgt.y, tgt.z], next).length > 0
            const d = this._steer(tgt.x + 0.5, tgt.z + 0.5, stopHere, s.kind === 'down' || s.kind === 'drop' ? 0.35 : 0.12)
            // a step up that autostep didn't take
            if (s.kind === 'up' && p[1] < s.y - 0.4 && d < 1.2 && see.speed() < 1.5 && see.onGround()) this.input.keyDown('Space')
            else if (this.bot.time - bestT > 0.8 && jumps < 3 && see.onGround()) {
                this.input.keyDown('Space')
                jumps++
                bestT = this.bot.time
            }
            await this.bot.frame()
            this.input.keyUp('Space')
            // passed waypoints
            const q = see.me().pos
            for (let k = aimJ; k >= i; k--) {
                const w = path[k]
                if (Math.hypot(w.x + 0.5 - q[0], w.z + 0.5 - q[2]) < (k === path.length - 1 ? 0.3 : 0.6) && Math.abs(q[1] - w.y) < 0.7) {
                    i = k + 1
                    bestD = Infinity
                    break
                }
            }
            const left = i < path.length ? Math.hypot(path[i].x + 0.5 - q[0], path[i].z + 0.5 - q[2]) + Math.abs(path[i].y - q[1]) : 0
            if (left < bestD - 0.05) {
                bestD = left
                bestT = this.bot.time
            }
            if (this.bot.time - bestT > 2.5) {
                this.stop()
                this.bot.note('stuck', { at: see.feetCell(), step: [s.x, s.y, s.z] })
                return 'stuck'
            }
        }
        this.stop()
        return 'ok'
    }

    // ---- composite ---------------------------------------------------------------------

    /** go where a block is in reach, then dig it */
    async goMine(b) {
        const see = this.see
        if (passable(see.block(...b))) return true
        const c = center(b)
        const ok = await this.walkTo((x, y, z) => {
            const d = Math.hypot(x + 0.5 - c[0], y + 1.6 - c[1], z + 0.5 - c[2])
            if (d > REACH - 1.4) return false
            // not standing under or inside it
            return !(x === b[0] && z === b[2] && (y === b[1] - 2 || y === b[1] - 1 || y === b[1] || y === b[1] + 1))
        }, b)
        if (!ok) return false
        return this.mine(b)
    }

    /** stand where `cell` is in reach and the bot isn't in it, then place */
    /**
     * @param {{standOn?: number[] | null, night?: boolean, avoid?: (x: number, y: number, z: number) => boolean}} [o]
     *   night: patching a hole (no digging on the way); avoid: cells not to walk through
     */
    async goPlace(cell, item, { standOn = null, night = false, avoid = undefined } = {}) {
        const c = center(cell)
        const ok = await this.walkTo((x, y, z) => {
            if (standOn && !(x === standOn[0] && y === standOn[1] && z === standOn[2])) return false
            const d = Math.hypot(x + 0.5 - c[0], y + 1.6 - c[1], z + 0.5 - c[2])
            if (d > REACH - 1.8 || d < 1.3) return false
            // not in the cell, nor right under or over it
            if (x === cell[0] && z === cell[2]) return false
            // and nothing in the way (in reach from outside the wall is no good)
            return this.clearTo([x + 0.5, y + 1.6, z + 0.5], cell)
        }, cell, night ? { dig: false, tries: 1, maxNodes: 8000, avoid } : undefined)
        if (!ok) return false
        return this.place(cell, item, { night })
    }
}
