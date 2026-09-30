/*
 *  The reach of a tower you're about to build, drawn on the ground around the
 *  spot you aim at. The reach grows with the tower's height over the ground
 *  (balance.js reachAt), so the ring bulges out over low ground and pulls in
 *  where the land rises: each segment sits where a shot from this tower lands
 *  on the terrain in that direction.
 */

import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Material } from '@babylonjs/core/Materials/material'
import { reachAt } from './balance.js'
import { RENDER_GROUP } from '../core/constants.js'

export const RING = { segments: 72, width: 0.22, lift: 0.08, alpha: 0.55, color: [1, 0.85, 0.35] }

/**
 * pure: the ring's radius in each direction. `feet` is where a tower built at
 * the centre would have its feet on the ground (see towers.js towerTarget);
 * `groundAt(x, z)` the height attackers stand at there.
 * @returns {{x: number, z: number, y: number}[]} one point per segment
 */
export function ringPoints(cx, cz, feet, range, groundAt, segments = RING.segments) {
    const out = []
    for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2
        const dx = Math.sin(a), dz = Math.cos(a)
        // the reach depends on the ground where the shot lands: settle it in a few steps
        let r = range, y = feet
        for (let k = 0; k < 3; k++) {
            y = groundAt(Math.floor(cx + dx * r), Math.floor(cz + dz * r))
            r = reachAt(range, feet - y)
        }
        out.push({ x: cx + dx * r, z: cz + dz * r, y })
    }
    return out
}

export class RangeRing {
    /** @param {import('noa-engine').Engine} noa */
    constructor(noa) {
        this.noa = noa
        const scene = noa.rendering.getScene()
        const n = RING.segments
        const mesh = new Mesh('range-ring', scene)
        this.pos = new Float32Array(n * 2 * 3)
        const indices = []
        for (let i = 0; i < n; i++) {
            const a = i * 2, b = ((i + 1) % n) * 2
            indices.push(a, a + 1, b, a + 1, b + 1, b)
        }
        mesh.setVerticesData(VertexBuffer.PositionKind, this.pos, true)
        mesh.setIndices(indices)
        const mat = noa.rendering.makeStandardMaterial('range-ring-mat')
        mat.disableLighting = true
        mat.emissiveColor = new Color3(...RING.color)
        mat.alpha = RING.alpha
        mat.backFaceCulling = false
        mat.fogEnabled = false
        mat.disableDepthWrite = true
        mat.transparencyMode = Material.MATERIAL_ALPHABLEND
        mesh.material = mat
        mesh.renderingGroupId = RENDER_GROUP.overlay
        mesh.isPickable = false
        mesh.alwaysSelectAsActiveMesh = true
        noa.rendering.addMeshToScene(mesh)
        noa.rendering.setMeshVisibility(mesh, false)
        this.mesh = mesh
        this.key = ''
        this.shown = false
    }

    /**
     * Show the ring for a tower of `range` whose feet would be at `feet`, built
     * at cell (x, z); null hides it.
     * @param {{x: number, z: number, feet: number, range: number} | null} at
     * @param {(x: number, z: number) => number} [groundAt]
     */
    show(at, groundAt = null) {
        if (!at) {
            if (this.shown) this.noa.rendering.setMeshVisibility(this.mesh, false)
            this.shown = false
            return
        }
        const key = `${at.x},${at.z},${at.feet},${at.range}`
        if (key !== this.key) {
            this.key = key
            const pts = ringPoints(at.x + 0.5, at.z + 0.5, at.feet, at.range, groundAt)
            const cx = at.x + 0.5, cz = at.z + 0.5
            const w = RING.width / 2
            pts.forEach((p, i) => {
                // a flat band across the ring's line
                const dx = p.x - cx, dz = p.z - cz, l = Math.hypot(dx, dz) || 1
                const ux = dx / l, uz = dz / l
                const y = p.y + RING.lift
                this.pos.set([p.x - ux * w, y, p.z - uz * w, p.x + ux * w, y, p.z + uz * w], i * 6)
            })
            this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.pos)
            this.mesh.refreshBoundingInfo()
        }
        if (!this.shown) this.noa.rendering.setMeshVisibility(this.mesh, true)
        this.shown = true
    }
}
