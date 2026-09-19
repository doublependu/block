/*
 *  Health bars over units: one thin-instanced quad pool (one draw call), drawn
 *  facing the camera. Blue for defenders and your builder, red for attackers.
 *  They flash on a hit and keep a pale chip where the health just went, so you
 *  can see how big the hit was. Switched off in the pause menu (settings).
 *
 *  A bar's layers (back plate, chip, fill) lie in one plane, so they can't be
 *  told apart by depth: the pool is drawn after the world without writing
 *  depth, bars far to near and each bar's layers back to front. A later quad
 *  simply covers an earlier one, whatever the depth precision.
 */

import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import { RENDER_GROUP } from '../core/constants.js'

export const BAR = {
    /** bar size in blocks, and how far above the head it floats */
    width: 0.9,
    height: 0.12,
    above: 0.32,
    /** grown with distance so they stay readable from the aerial camera */
    farScale: 2.5,
    nearDistance: 15,
    farDistance: 60,
    /** seconds */
    flash: 0.12,
    chipHold: 0.35,
    chipFade: 0.5,
    colors: {
        back: [0.05, 0.05, 0.07],
        chip: [0.95, 0.92, 0.85],
        defender: [0.24, 0.55, 1],
        attacker: [0.91, 0.25, 0.17],
        flash: [1, 1, 1],
    },
    maxUnits: 96,
}

/** sort order for bars: farthest first, so nearer bars are drawn over them */
export const farToNear = (a, b) => b.dist - a.dist

/**
 * pure: one bar's quads in drawing order, through `emit(frac, color, back)`:
 * the back plate, the chip left where health just went, then the fill.
 * @param {number} frac health left (0..1)
 * @param {number} chip where the recent-damage chip reaches (0..1)
 * @param {boolean} flash just hit
 * @param {string} side 'attacker' | 'defender'
 * @param {(frac: number, color: number[], back: boolean) => void} emit
 */
export function barLayers(frac, chip, flash, side, emit) {
    emit(1, BAR.colors.back, true)
    if (chip > frac + 0.005) emit(chip, BAR.colors.chip, false)
    if (frac > 0) emit(frac, flash ? BAR.colors.flash : side === 'attacker' ? BAR.colors.attacker : BAR.colors.defender, false)
}

const tmpM = new Matrix()
const tmpQ = new Quaternion()
const tmpS = new Vector3()
const tmpP = new Vector3()

export class HealthBars {
    /**
     * @param {object} ctx
     * @param {import('noa-engine').Engine} ctx.noa
     * @param {import('./units.js').UnitManager} ctx.units
     * @param {{name: string}} ctx.tier
     */
    constructor({ noa, units, tier }) {
        this.noa = noa
        this.units = units
        this.tier = tier
        this.enabled = true
        /** @type {WeakMap<any, {chip: number, chipAge: number, flash: number, hp: number}>} */
        this.state = new WeakMap()
        const scene = noa.rendering.getScene()
        // drawn after the world, keeping its depth: hills still hide the bars
        scene.setRenderingAutoClearDepthStencil(RENDER_GROUP.overlay, false, false, false)
        const mesh = CreatePlane('hp-bars', { width: 1, height: 1 }, scene)
        const mat = noa.rendering.makeStandardMaterial('hp-bars-mat')
        mat.disableLighting = true
        mat.diffuseColor = new Color3(1, 1, 1)
        // with lighting off the shader outputs (ambient + emissive) x colour: emissive
        // white gives exactly the bar colour, by day and at night
        mat.emissiveColor = new Color3(1, 1, 1)
        mat.fogEnabled = false
        mat.backFaceCulling = false
        // layers are drawn in order, not depth-tested against each other (see top)
        mat.disableDepthWrite = true
        mesh.material = mat
        mesh.renderingGroupId = RENDER_GROUP.overlay
        mesh.isPickable = false
        mesh.alwaysSelectAsActiveMesh = true
        this.capacity = BAR.maxUnits * 3
        this.matrices = new Float32Array(16 * this.capacity)
        this.colors = new Float32Array(4 * this.capacity).fill(1)
        mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false)
        mesh.thinInstanceSetBuffer('color', this.colors, 4, false)
        // Babylon only compiles per-instance colours if the mesh has an instance when first drawn
        mesh.thinInstanceCount = 1
        mat.freeze()
        noa.rendering.addMeshToScene(mesh)
        this.mesh = mesh
        /** this frame's bars (reused objects), and the same sorted far to near */
        this._bars = []
        this._order = []
        this._n = 0
        this._cur = null
        this._right = new Vector3()
        /** writes one quad of the bar being drawn (see barLayers) */
        this._emit = (frac, color, back) => {
            const b = this._cur
            const pad = back ? b.h * 0.35 : 0
            this._quad(this._n++, b, b.w + pad, b.h + pad, frac, color)
        }
    }

    setEnabled(on) {
        this.enabled = on
        if (!on) {
            this.matrices.fill(0, 0, 16)
            this.mesh.thinInstanceCount = 1
            this.mesh.thinInstanceBufferUpdated('matrix')
        }
    }

    /** the controlled unit in first person has no bar (the HUD chip shows it) */
    _hidden(u, control) {
        if (u === control.controlled && this.noa.camera.currentZoom < 1.2) return true
        return false
    }

    /** @param {number} dtMs */
    render(dtMs, control) {
        if (!this.enabled) return
        const dt = dtMs / 1000
        const scene = this.noa.rendering.getScene()
        const cam = scene.activeCamera
        const camPos = this.noa.camera.getPosition()
        Quaternion.FromRotationMatrixToRef(cam.getWorldMatrix(), tmpQ)
        Vector3.TransformNormalToRef(Vector3.Right(), cam.getWorldMatrix(), this._right)
        const maxDist = this.tier.name === 'low' ? 32 : 48
        const ents = this.noa.entities
        const bars = this._bars
        const order = this._order
        order.length = 0
        for (const u of this.units.units) {
            if (!u.alive || !u.active || order.length >= BAR.maxUnits) continue
            if (this._hidden(u, control)) continue
            if (!ents.hasComponent(u.entity, 'position')) continue
            const rp = ents.getPositionData(u.entity)._renderPosition
            const dx = rp[0] - camPos[0], dy = rp[1] - camPos[1], dz = rp[2] - camPos[2]
            const dist = Math.hypot(dx, dy, dz)
            if (dist > maxDist) continue
            const st = this._track(u, dt)
            const far = Math.max(0, Math.min(1, (dist - BAR.nearDistance) / (BAR.farDistance - BAR.nearDistance)))
            const scale = 1 + (BAR.farScale - 1) * far
            const b = bars[order.length] || (bars[order.length] = { x: 0, y: 0, z: 0, dist: 0, w: 0, h: 0, frac: 0, chip: 0, flash: false, side: '' })
            b.x = rp[0]
            b.y = rp[1] + u.height + BAR.above * scale
            b.z = rp[2]
            b.dist = dist
            b.w = BAR.width * (u.width > 0.7 ? 1.3 : 1) * scale
            b.h = BAR.height * scale
            b.frac = Math.max(0, Math.min(1, u.hp / u.maxHp))
            b.chip = st.chip
            b.flash = st.flash > 0
            b.side = u.side
            order.push(b)
        }
        order.sort(farToNear)
        this._n = 0
        for (const b of order) {
            this._cur = b
            barLayers(b.frac, b.chip, b.flash, b.side, this._emit)
        }
        const n = this._n
        this.mesh.thinInstanceCount = Math.max(1, n)
        if (n === 0) this.matrices.fill(0, 0, 16)
        this.mesh.thinInstanceBufferUpdated('matrix')
        this.mesh.thinInstanceBufferUpdated('color')
    }

    /** one quad, `frac` of the full width, anchored on the left edge */
    _quad(i, b, w, h, frac, color) {
        const width = w * frac
        const shift = -(w - width) / 2
        const right = this._right
        tmpS.set(width, h, 1)
        tmpP.set(b.x + right.x * shift, b.y + right.y * shift, b.z + right.z * shift)
        Matrix.ComposeToRef(tmpS, tmpQ, tmpP, tmpM)
        tmpM.copyToArray(this.matrices, i * 16)
        this.colors[i * 4] = color[0]
        this.colors[i * 4 + 1] = color[1]
        this.colors[i * 4 + 2] = color[2]
        this.colors[i * 4 + 3] = 1
    }

    /** per-unit flash and damage chip, driven by the unit's health */
    _track(u, dt) {
        let st = this.state.get(u)
        const frac = Math.max(0, u.hp / u.maxHp)
        if (!st) {
            st = { chip: frac, chipAge: 0, flash: 0, hp: u.hp }
            this.state.set(u, st)
        }
        if (u.hp < st.hp) {
            st.flash = BAR.flash
            st.chipAge = 0
        }
        if (u.hp > st.hp) st.chip = frac
        st.hp = u.hp
        st.flash = Math.max(0, st.flash - dt)
        st.chipAge += dt
        if (st.chipAge > BAR.chipHold && st.chip > frac) {
            st.chip = Math.max(frac, st.chip - dt / BAR.chipFade)
        }
        return st
    }

    dispose() {
        this.mesh.dispose()
    }
}
