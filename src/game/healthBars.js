/*
 *  Health bars over units: one thin-instanced quad pool (one draw call), drawn
 *  facing the camera. Blue for defenders and your builder, red for attackers.
 *  They flash on a hit and keep a pale chip where the health just went, so you
 *  can see how big the hit was. Switched off in the pause menu (settings).
 */

import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import '@babylonjs/core/Meshes/thinInstanceMesh'

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
        const mesh = CreatePlane('hp-bars', { width: 1, height: 1 }, scene)
        const mat = noa.rendering.makeStandardMaterial('hp-bars-mat')
        mat.disableLighting = true
        mat.diffuseColor = new Color3(1, 1, 1)
        mat.emissiveColor = new Color3(0, 0, 0)
        mat.fogEnabled = false
        mat.backFaceCulling = false
        mesh.material = mat
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
        const right = Vector3.TransformNormal(Vector3.Right(), cam.getWorldMatrix())
        const maxDist = this.tier.name === 'low' ? 32 : 48
        const ents = this.noa.entities
        let n = 0
        for (const u of this.units.units) {
            if (!u.alive || !u.active || n + 3 > this.capacity) continue
            if (this._hidden(u, control)) continue
            if (!ents.hasComponent(u.entity, 'position')) continue
            const rp = ents.getPositionData(u.entity)._renderPosition
            const dx = rp[0] - camPos[0], dy = rp[1] - camPos[1], dz = rp[2] - camPos[2]
            const dist = Math.hypot(dx, dy, dz)
            if (dist > maxDist) continue
            const st = this._track(u, dt)
            const frac = Math.max(0, Math.min(1, u.hp / u.maxHp))
            const far = Math.max(0, Math.min(1, (dist - BAR.nearDistance) / (BAR.farDistance - BAR.nearDistance)))
            const scale = 1 + (BAR.farScale - 1) * far
            const w = BAR.width * (u.width > 0.7 ? 1.3 : 1) * scale
            const h = BAR.height * scale
            const y = rp[1] + u.height + BAR.above * scale
            const fill = st.flash > 0 ? BAR.colors.flash : u.side === 'attacker' ? BAR.colors.attacker : BAR.colors.defender
            // back plate, the chip left where health just went, then the fill
            this._bar(n++, rp[0], y, rp[2], w + h * 0.35, h + h * 0.35, 1, right, BAR.colors.back)
            if (st.chip > frac + 0.005) this._bar(n++, rp[0], y, rp[2], w, h, st.chip, right, BAR.colors.chip)
            if (frac > 0) this._bar(n++, rp[0], y, rp[2], w, h, frac, right, fill)
        }
        this.mesh.thinInstanceCount = Math.max(1, n)
        if (n === 0) this.matrices.fill(0, 0, 16)
        this.mesh.thinInstanceBufferUpdated('matrix')
        this.mesh.thinInstanceBufferUpdated('color')
    }

    /** one quad, `frac` of the full width, anchored on the left edge */
    _bar(i, x, y, z, w, h, frac, right, color) {
        const width = w * frac
        const shift = -(w - width) / 2
        tmpS.set(width, h, 1)
        tmpP.set(x + right.x * shift, y + right.y * shift, z + right.z * shift)
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
