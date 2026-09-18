/*
 *  Cracks on damaged blocks: you can see what's being broken and how close it
 *  is to going. One thin-instance cube per damage stage (4 draw calls at most,
 *  only while something is damaged); the crack texture is drawn at startup, so
 *  there's nothing to download.
 */

import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Engine } from '@babylonjs/core/Engines/engine'
import '@babylonjs/core/Meshes/thinInstanceMesh'

/** health left at which each stage starts showing */
export const STAGES = [0.75, 0.5, 0.25, 0]
const TILE = 16
export const MAX_CRACKS = 256

/** which stage a block at this health fraction shows (-1 = none) */
export function crackStage(fraction) {
    if (fraction >= STAGES[0]) return -1
    for (let i = STAGES.length - 1; i >= 0; i--) if (fraction <= STAGES[i]) return i
    return 0
}

/** a strip of `STAGES.length` crack tiles, each more broken than the last */
function crackTexture(scene) {
    const n = STAGES.length
    const data = new Uint8Array(TILE * TILE * n * 4)
    const put = (stage, x, y, a) => {
        if (x < 0 || y < 0 || x >= TILE || y >= TILE) return
        const i = ((stage * TILE + y) * TILE + x) * 4
        data[i] = data[i + 1] = data[i + 2] = 10
        data[i + 3] = Math.max(data[i + 3], a)
    }
    // a few jagged lines, growing with each stage
    const lines = [
        [[8, 0], [7, 4], [9, 8], [8, 12], [9, 15]],
        [[0, 6], [4, 7], [7, 5], [11, 8], [15, 7]],
        [[3, 15], [4, 11], [2, 8], [3, 4], [1, 0]],
        [[15, 2], [12, 5], [13, 9], [11, 12], [12, 15]],
        [[8, 8], [12, 11], [15, 13]],
        [[7, 6], [4, 3], [1, 2]],
    ]
    for (let stage = 0; stage < n; stage++) {
        const count = Math.min(lines.length, 1 + stage * 2)
        for (let l = 0; l < count; l++) {
            const pts = lines[l]
            for (let k = 1; k < pts.length; k++) {
                const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]
                const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2
                for (let t = 0; t <= steps; t++) {
                    const x = Math.round(x0 + ((x1 - x0) * t) / steps)
                    const y = Math.round(y0 + ((y1 - y0) * t) / steps)
                    put(stage, x, y, 235)
                    if (stage >= 2) put(stage, x + (t % 2 ? 1 : 0), y, 120)
                }
            }
        }
    }
    const tex = new RawTexture(data, TILE, TILE * n, Engine.TEXTUREFORMAT_RGBA, scene, false, false, Texture.NEAREST_SAMPLINGMODE)
    tex.hasAlpha = true
    return tex
}

const tmpM = new Matrix()
const tmpQ = Quaternion.Identity()
const tmpS = new Vector3(1.004, 1.004, 1.004)
const tmpP = new Vector3()

export class Cracks {
    /** @param {import('noa-engine').Engine} noa */
    constructor(noa) {
        this.noa = noa
        const scene = noa.rendering.getScene()
        const tex = crackTexture(scene)
        const mat = noa.rendering.makeStandardMaterial('cracks-mat')
        mat.diffuseTexture = tex
        mat.diffuseColor = new Color3(1, 1, 1)
        mat.disableLighting = true
        mat.emissiveColor = new Color3(1, 1, 1)
        mat.useAlphaFromDiffuseTexture = true
        mat.transparencyMode = 2
        mat.zOffset = -1
        mat.fogEnabled = false
        mat.freeze()
        /** one mesh per stage: same material, different rows of the strip */
        this.buffers = STAGES.map(() => new Float32Array(16 * MAX_CRACKS))
        this.meshes = STAGES.map((_, stage) => {
            const mesh = CreateBox('cracks-' + stage, { size: 1 }, scene)
            const n = STAGES.length
            const uvs = []
            for (let face = 0; face < 6; face++) uvs.push(0, stage / n, 1, stage / n, 1, (stage + 1) / n, 0, (stage + 1) / n)
            mesh.setVerticesData('uv', uvs)
            mesh.material = mat
            mesh.isPickable = false
            mesh.alwaysSelectAsActiveMesh = true
            mesh.thinInstanceSetBuffer('matrix', this.buffers[stage], 16, false)
            mesh.thinInstanceCount = 0
            noa.rendering.addMeshToScene(mesh)
            return mesh
        })
        /** "x,y,z" -> stage */
        this.damaged = new Map()
        this.dirty = false
    }

    /** @param {number} fraction health left, 0..1 */
    set(x, y, z, fraction) {
        const key = `${x},${y},${z}`
        const stage = crackStage(fraction)
        if (stage < 0) return this.clear(x, y, z)
        if (this.damaged.get(key) === stage) return
        if (!this.damaged.has(key) && this.damaged.size >= MAX_CRACKS) return
        this.damaged.set(key, stage)
        this.dirty = true
    }

    clear(x, y, z) {
        if (this.damaged.delete(`${x},${y},${z}`)) this.dirty = true
    }

    clearAll() {
        if (!this.damaged.size) return
        this.damaged.clear()
        this.dirty = true
    }

    /** rebuild the instance buffers (only when something changed) */
    render() {
        if (!this.dirty) return
        this.dirty = false
        const counts = this.meshes.map(() => 0)
        for (const [key, stage] of this.damaged) {
            const buf = this.buffers[stage]
            if (!buf || counts[stage] >= MAX_CRACKS) continue
            const [x, y, z] = key.split(',').map(Number)
            tmpP.set(x + 0.5, y + 0.5, z + 0.5)
            Matrix.ComposeToRef(tmpS, tmpQ, tmpP, tmpM)
            tmpM.copyToArray(buf, counts[stage] * 16)
            counts[stage]++
        }
        this.meshes.forEach((mesh, stage) => {
            mesh.thinInstanceCount = counts[stage]
            if (counts[stage]) mesh.thinInstanceBufferUpdated('matrix')
        })
    }

    dispose() {
        for (const m of this.meshes) m.dispose()
    }
}
