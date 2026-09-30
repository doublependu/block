/*
 *  Building from the aerial view, the way a player does it: the camera over
 *  the work, the cursor on the face of a block, a right click to build against
 *  it (plan 10 §3.6). There is no reach limit up there, so the builder's body
 *  can stay where it is (at the quarry) while the castle goes up.
 *
 *  Where a face shows on screen comes from the aerial camera's own maths
 *  (aerialCam.js screenPoint); before every click the bot checks that the
 *  game's aim under the cursor is that face, so nothing is built by guesswork.
 */

import { cameraPos, screenPoint, viewDir } from '../../../src/game/aerialCam.js'
import { BLOCK_BY_ID, blockId } from '../../../src/world/blocks.js'
import { standable } from './nav.js'

const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
/** normals from a support block to the cell built against it; the top face first */
const FACES = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]

export class Aerial {
    /** @param {import('./bot.js').Bot} bot */
    constructor(bot) {
        this.bot = bot
        this.see = bot.see
        this.input = bot.input
        /** blocks built from up here so far */
        this.built = 0
    }

    get on() {
        return this.see.mode === 'aerial'
    }

    /** the aerial camera's state (read-only) */
    get cam() {
        return this.see.g.control.aerial
    }

    async enter() {
        if (!this.on) {
            this.input.releaseAll()
            this.input.tap('KeyM')
            await this.bot.until(() => this.on, 2)
            await this.bot.wait(0.6)
        }
        return this.on
    }

    async leave() {
        if (this.on) {
            this.input.tap('KeyM')
            await this.bot.until(() => this.see.mode === 'self', 2)
        }
    }

    /** the camera has stopped moving (no glide, no click-pan, zoom caught up) */
    settled() {
        const c = this.see.g.control
        const a = c.aerial
        return !c.glide && !c.orbit && a.tx === undefined && Math.abs(a.zoom - a.shown) < 0.15
    }

    async settle(timeout = 3) {
        await this.bot.until(() => this.settled(), timeout)
        // the camera is placed after the control's frame: one more
        await this.bot.frame()
        await this.bot.frame()
    }

    /** where a world point shows on the screen (client pixels), or null if not on it */
    toScreen(p) {
        const a = this.cam
        const canvas = this.input.canvas
        const r = canvas.getBoundingClientRect()
        const fov = this.see.g.noa.rendering.camera.fov
        const s = screenPoint(a.heading, a.pitch, fov, r.width / r.height, cameraPos(a), p)
        if (!(s.depth > 1)) return null
        // keep off the edges, where the HUD sits (hotbar at the bottom, the bars on top)
        if (Math.abs(s.nx) > 0.9 || s.ny > 0.82 || s.ny < -0.72) return null
        return { x: r.left + ((s.nx + 1) / 2) * r.width, y: r.top + ((1 - s.ny) / 2) * r.height }
    }

    /** the block face the game aims at under the cursor now */
    aim() {
        const h = this.see.g.control._aim.hit
        return h ? { position: [...h.position], adjacent: [...h.adjacent] } : null
    }

    /** the cursor to a point, and what the game aims at there (a frame later) */
    async pointAt(x, y) {
        this.input.pointerAt(x, y)
        await this.bot.frame()
        await this.bot.frame()
        return this.aim()
    }

    /** the faces a block could be built at `cell` against, the ones facing the camera first */
    supports(cell) {
        const eye = cameraPos(this.cam)
        const out = []
        for (const n of FACES) {
            const s = [cell[0] - n[0], cell[1] - n[1], cell[2] - n[2]]
            if (!standable(this.see.block(s[0], s[1], s[2]))) continue
            // the middle of the face of s that touches the cell, a hair inside s
            const face = [cell[0] + 0.5 - n[0] * 0.5, cell[1] + 0.5 - n[1] * 0.5, cell[2] + 0.5 - n[2] * 0.5]
            const facing = (eye[0] - face[0]) * n[0] + (eye[1] - face[1]) * n[1] + (eye[2] - face[2]) * n[2]
            if (facing <= 0.05) continue
            out.push({ support: s, pt: [face[0] - n[0] * 0.02, face[1] - n[1] * 0.02, face[2] - n[2] * 0.02], facing })
        }
        return out.sort((a, b) => b.facing - a.facing)
    }

    /**
     * Can the cell be built from the camera where it is now: a support face on
     * screen, unhidden. Why not is kept in `why` (for the logs).
     */
    async canSee(cell) {
        const faces = this.supports(cell)
        this.why = faces.length ? 'off screen' : 'no face toward the camera'
        for (const s of faces) {
            const scr = this.toScreen(s.pt)
            if (!scr) {
                const a = this.cam
                const r = this.input.canvas.getBoundingClientRect()
                const raw = screenPoint(a.heading, a.pitch, this.see.g.noa.rendering.camera.fov, r.width / r.height, cameraPos(a), s.pt)
                this.why = `off screen (${raw.nx.toFixed(2)}, ${raw.ny.toFixed(2)}, depth ${raw.depth.toFixed(1)}; view at ${a.x.toFixed(1)},${a.y.toFixed(1)},${a.z.toFixed(1)} zoom ${a.zoom.toFixed(0)})`
                continue
            }
            const hit = await this.pointAt(scr.x, scr.y)
            if (hit && same(hit.position, s.support) && same(hit.adjacent, cell)) return scr
            this.why = hit ? `aim on ${hit.position.join(',')} (${BLOCK_BY_ID[this.see.block(...hit.position)]?.name || 'air'})` : 'aim on nothing'
        }
        return null
    }

    /**
     * Build `item` (selected already) at `cell` against whatever face of a
     * neighbour is on screen and not hidden; `at` is where it ends up.
     * @returns {Promise<boolean>} the block is there
     */
    async place(cell, item, at = cell) {
        const id = blockId(item)
        if (this.see.block(at[0], at[1], at[2]) === id) return true
        const scr = await this.canSee(cell)
        if (!scr) return false
        await this.input.clickAt(scr.x, scr.y, 2)
        // (`at`: where the block ends up, if not in the cell clicked: a tower on its column)
        const ok = await this.bot.until(() => this.see.block(at[0], at[1], at[2]) === id, 0.6)
        if (ok) {
            this.built++
            this.bot.note('placed', { item, at: cell, aerial: true })
        } else this.why = 'clicked, but the game refused it'
        return ok
    }

    /**
     * Click a higher tier (selected already) onto a standing block, which
     * upgrades it in place (a tower on a click: placing.js upgradeGesture).
     * @returns {Promise<boolean>} the block is now `item`
     */
    async upgrade(cell, item) {
        const id = blockId(item)
        if (this.see.block(cell[0], cell[1], cell[2]) === id) return true
        const eye = cameraPos(this.cam)
        for (const n of FACES) {
            // the face of the block itself that looks at the camera
            const face = [cell[0] + 0.5 + n[0] * 0.49, cell[1] + 0.5 + n[1] * 0.49, cell[2] + 0.5 + n[2] * 0.49]
            if ((eye[0] - face[0]) * n[0] + (eye[1] - face[1]) * n[1] + (eye[2] - face[2]) * n[2] <= 0.05) continue
            const scr = this.toScreen(face)
            if (!scr) continue
            const hit = await this.pointAt(scr.x, scr.y)
            if (!hit || !same(hit.position, cell)) continue
            await this.input.clickAt(scr.x, scr.y, 2)
            if (await this.bot.until(() => this.see.block(cell[0], cell[1], cell[2]) === id, 0.6)) {
                this.bot.note('upgraded', { item, at: cell, aerial: true })
                return true
            }
        }
        this.why = 'no face of it to click'
        return false
    }

    /**
     * Glide the camera over a point: a left click on a block near it (the view
     * pans there, at that block's height). If nothing near it is on screen,
     * first pan with the keys until it is.
     * @param {number[]} target the point to look at
     * @param {{heading?: number, zoom?: number}} [o] turn to a heading and zoom first
     */
    async lookAt(target, { heading = null, zoom = null } = {}) {
        if (!(await this.enter())) return false
        const a = () => this.cam
        if (heading !== null) await this.turnTo(heading)
        if (zoom !== null) await this.zoomTo(zoom)
        // the keys first, if the target is far from the middle of the view
        for (let i = 0; i < 40; i++) {
            const dx = target[0] - a().x, dz = target[2] - a().z
            if (Math.hypot(dx, dz) < 6) break
            const h = a().heading
            // WASD in the aerial view pans along (sin h, cos h) and (cos h, -sin h)
            const f = dx * Math.sin(h) + dz * Math.cos(h), r = dx * Math.cos(h) - dz * Math.sin(h)
            const want = new Set()
            if (f > 3) want.add('KeyW')
            else if (f < -3) want.add('KeyS')
            if (r > 3) want.add('KeyD')
            else if (r < -3) want.add('KeyA')
            this.input.setMoveKeys(want)
            await this.bot.wait(0.12)
        }
        this.input.setMoveKeys(new Set())
        // then a click on the solid block nearest the target that's on screen
        const b = this._blockNear(target)
        if (b) {
            const scr = this.toScreen([b[0] + 0.5, b[1] + 1, b[2] + 0.5])
            if (scr) {
                const hit = await this.pointAt(scr.x, scr.y)
                if (hit && Math.abs(hit.position[0] - b[0]) + Math.abs(hit.position[2] - b[2]) <= 3) {
                    await this.input.clickAt(scr.x, scr.y, 0)
                    await this.settle()
                    return true
                }
            }
        }
        await this.settle()
        return false
    }

    /** a solid block at or under a point, whose top shows */
    _blockNear([x, y, z]) {
        const bx = Math.floor(x), bz = Math.floor(z)
        for (let cy = Math.floor(y); cy > y - 30; cy--) {
            const id = this.see.block(bx, cy, bz)
            if (standable(id) && !standable(this.see.block(bx, cy + 1, bz))) return [bx, cy, bz]
        }
        return null
    }

    /** turn the view (Z / C) until it faces `heading` */
    async turnTo(heading) {
        const wrap = (v) => Math.atan2(Math.sin(v), Math.cos(v))
        for (let i = 0; i < 80; i++) {
            const d = wrap(heading - this.cam.heading)
            if (Math.abs(d) < 0.06) break
            const key = d > 0 ? 'KeyC' : 'KeyZ'
            this.input.keyDown(key)
            await this.bot.wait(Math.min(0.25, Math.abs(d) / 1.6))
            this.input.keyUp(key)
            await this.bot.frame()
        }
        this.input.keyUp('KeyC')
        this.input.keyUp('KeyZ')
    }

    /** zoom (the mouse wheel) until the view is about `zoom` blocks back */
    async zoomTo(zoom) {
        const canvas = this.input.canvas
        const r = canvas.getBoundingClientRect()
        for (let i = 0; i < 30; i++) {
            const z = this.cam.zoom
            if (Math.abs(z - zoom) / zoom < 0.1) break
            canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: z < zoom ? 100 : -100, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }))
            await this.bot.wait(0.08)
        }
        await this.settle(2)
    }

    /** the heading the camera looks along now */
    get heading() {
        return this.cam.heading
    }

    /** the direction the view looks (for choosing which side to build from) */
    get dir() {
        return viewDir(this.cam.heading, this.cam.pitch)
    }
}

/** the block id a cell should become (names from the blueprint) */
export const idOf = (name) => blockId(name)
export const isBuilt = (id) => !!BLOCK_BY_ID[id] && !!BLOCK_BY_ID[id].built
