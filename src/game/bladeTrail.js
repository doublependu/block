/*
 *  The builder's blade trail seen from outside (third person, and from
 *  above): the streak a sword leaves while its body clip swings it.
 *
 *  First person has its own (viewModel.js), drawn from the motion's curve.
 *  Here there's no curve to read, so the blade's tip and a point down it are
 *  taken from the rendered sword every frame, and the strip is made of the
 *  last few of them: a streak that follows exactly what the clip did.
 */

import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Material } from '@babylonjs/core/Materials/material'

/** per sword tier: how long the streak lasts (s), how far down the blade it reaches, its strength and colour */
const TIER = {
    wood_sword: { span: 0.1, inner: 0.5, alpha: 0.42, color: [0.95, 0.9, 0.78] },
    stone_sword: { span: 0.14, inner: 0.3, alpha: 0.5, color: [0.78, 0.8, 0.84] },
    iron_sword: { span: 0.17, inner: 0.4, alpha: 0.55, color: [0.85, 0.95, 1] },
}
/** samples the strip is made of, at most */
const N = 16
/** the body clips that swing a sword (see WEAPONS[*].clip) */
const SWINGS = new Set(['attack', 'attack_heavy', 'attack_flourish'])

export class BladeTrail {
    constructor(noa) {
        this.noa = noa
        const mesh = new Mesh('blade-trail', noa.rendering.getScene())
        const indices = []
        for (let i = 0; i < N - 1; i++) {
            const a = i * 2
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
        this.pos = new Float32Array(N * 2 * 3)
        this.col = new Float32Array(N * 2 * 4)
        mesh.setVerticesData(VertexBuffer.PositionKind, this.pos, true)
        mesh.setVerticesData(VertexBuffer.ColorKind, this.col, true, 4)
        mesh.setIndices(indices)
        mesh.hasVertexAlpha = true
        mesh.isPickable = false
        mesh.alwaysSelectAsActiveMesh = true
        const mat = noa.rendering.makeStandardMaterial('blade-trail-mat')
        mat.disableLighting = true
        // with lighting off, emissive white passes the vertex colours through as they are
        mat.emissiveColor = new Color3(1, 1, 1)
        mat.specularColor = new Color3(0, 0, 0)
        mat.backFaceCulling = false
        mat.disableDepthWrite = true
        mat.transparencyMode = Material.MATERIAL_ALPHABLEND
        mesh.material = mat
        noa.rendering.addMeshToScene(mesh)
        noa.rendering.setMeshVisibility(mesh, false)
        this.mesh = mesh
        /** @type {{t: number, tip: Vector3, inner: Vector3}[]} */
        this.samples = []
        this.t = 0
    }

    /**
     * @param {any} char the builder's CharacterInstance
     * @param {string | null} item the item in its hand
     * @param {boolean} shown the body is on screen (not first person)
     * @param {number} dt seconds
     */
    update(char, item, shown, dt) {
        this.t += dt
        const tier = TIER[item]
        const m = char && char.itemMesh
        if (shown && tier && m && SWINGS.has(char.action)) {
            const bb = m.getBoundingInfo().boundingBox
            const cx = (bb.minimum.x + bb.maximum.x) / 2, cz = (bb.minimum.z + bb.maximum.z) / 2
            const len = bb.maximum.y - bb.minimum.y
            const w = m.getWorldMatrix()
            this.samples.push({
                t: this.t,
                tip: Vector3.TransformCoordinates(new Vector3(cx, bb.maximum.y, cz), w),
                inner: Vector3.TransformCoordinates(new Vector3(cx, bb.maximum.y - len * tier.inner, cz), w),
            })
        }
        // older samples fall off the tail, so the streak shrinks away after the blow
        const span = tier ? tier.span : 0
        while (this.samples.length && (this.t - this.samples[0].t > span || this.samples.length > N)) this.samples.shift()
        const r = this.noa.rendering
        const n = this.samples.length
        const on = shown && !!tier && n >= 2
        r.setMeshVisibility(this.mesh, on)
        if (!on) return
        const pos = this.pos, col = this.col
        const c = tier.color
        for (let i = 0; i < N; i++) {
            // unused vertices sit on the newest sample (zero-size quads)
            const s = this.samples[Math.min(i, n - 1)]
            const k = Math.min(i, n - 1) / (n - 1)
            s.tip.toArray(pos, i * 6)
            Vector3.Lerp(s.tip, s.inner, k).toArray(pos, i * 6 + 3)
            const alpha = tier.alpha * Math.pow(k, 1.5)
            for (let e = 0; e < 2; e++) {
                const o = i * 8 + e * 4
                col[o] = c[0]
                col[o + 1] = c[1]
                col[o + 2] = c[2]
                col[o + 3] = e === 0 ? alpha : alpha * 0.4
            }
        }
        this.mesh.updateVerticesData(VertexBuffer.PositionKind, pos)
        this.mesh.updateVerticesData(VertexBuffer.ColorKind, col)
    }
}
