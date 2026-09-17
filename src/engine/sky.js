/*
 *  Time-of-day visuals: sky/fog colour, ambient, sun/moon light and a
 *  sun/moon disc. One directional light only, no dynamic point lights.
 */

import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Scene } from '@babylonjs/core/scene'
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'

// keyframes over skyTime 0..1 (see DayCycle.skyTime)
const KEYS = [
    { t: 0.0, sky: [0.93, 0.72, 0.55], amb: [0.5, 0.45, 0.45], light: [0.9, 0.7, 0.55], li: 0.6 },
    { t: 0.05, sky: [0.62, 0.8, 0.97], amb: [0.62, 0.62, 0.66], light: [0.95, 0.93, 0.86], li: 1 },
    { t: 0.42, sky: [0.62, 0.8, 0.97], amb: [0.62, 0.62, 0.66], light: [0.95, 0.93, 0.86], li: 1 },
    { t: 0.5, sky: [0.95, 0.6, 0.4], amb: [0.5, 0.42, 0.42], light: [0.95, 0.6, 0.4], li: 0.7 },
    { t: 0.56, sky: [0.1, 0.12, 0.26], amb: [0.3, 0.33, 0.48], light: [0.45, 0.52, 0.78], li: 0.45 },
    { t: 0.94, sky: [0.1, 0.12, 0.26], amb: [0.3, 0.33, 0.48], light: [0.45, 0.52, 0.78], li: 0.45 },
    { t: 1.0, sky: [0.93, 0.72, 0.55], amb: [0.5, 0.45, 0.45], light: [0.9, 0.7, 0.55], li: 0.6 },
]

const lerp = (a, b, t) => a + (b - a) * t
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

export class Sky {
    /**
     * @param {import('noa-engine').Engine} noa
     * @param {{fogEnd: number}} tier
     */
    constructor(noa, tier) {
        this.noa = noa
        const scene = noa.rendering.getScene()
        this.scene = scene
        scene.fogMode = Scene.FOGMODE_LINEAR
        this.setFogEnd(tier.fogEnd)

        const mat = new StandardMaterial('sky-disc', scene)
        mat.disableLighting = true
        mat.emissiveColor = new Color3(1, 0.95, 0.7)
        mat.fogEnabled = false
        mat.backFaceCulling = false
        this.discMat = mat
        this.disc = CreateDisc('sun', { radius: 7, tessellation: 20 }, scene)
        this.disc.material = mat
        this.disc.infiniteDistance = true
        this.disc.isPickable = false
        this.disc.applyFog = false
        noa.rendering.addMeshToScene(this.disc, true)
        this._last = -1
    }

    setFogEnd(end) {
        this._fogEnd = end
        this._applyFog()
    }

    /**
     * Push the fog out by this many blocks. The aerial camera sits far behind the
     * point it looks at, so without this the town it frames would be in the fog.
     */
    setFogOffset(offset) {
        if (offset === this._fogOffset) return
        this._fogOffset = offset
        this._applyFog()
    }

    _applyFog() {
        const off = this._fogOffset || 0
        this.scene.fogStart = this._fogEnd * 0.55 + off
        this.scene.fogEnd = this._fogEnd + off
    }

    /** @param {number} time skyTime 0..1 */
    update(time) {
        if (Math.abs(time - this._last) < 0.0005) return
        this._last = time
        let i = 0
        while (i < KEYS.length - 2 && KEYS[i + 1].t <= time) i++
        const a = KEYS[i], b = KEYS[i + 1]
        const f = Math.max(0, Math.min(1, (time - a.t) / (b.t - a.t || 1)))
        const sky = lerp3(a.sky, b.sky, f)
        const amb = lerp3(a.amb, b.amb, f)
        const light = lerp3(a.light, b.light, f)
        const li = lerp(a.li, b.li, f)

        const scene = this.scene
        scene.clearColor = new Color4(sky[0], sky[1], sky[2], 1)
        scene.fogColor = new Color3(sky[0], sky[1], sky[2])
        scene.ambientColor = new Color3(amb[0], amb[1], amb[2])
        const L = this.noa.rendering.light
        L.diffuse = new Color3(light[0], light[1], light[2])
        L.intensity = li

        // sun arcs over the day half, moon over the night half
        const isNight = time > 0.53 && time < 0.97
        const arc = isNight ? (time - 0.53) / 0.44 : ((time + 0.03) % 1) / 0.56
        const angle = Math.PI * Math.max(0.02, Math.min(0.98, arc))
        const dir = new Vector3(-Math.cos(angle), -Math.sin(angle), 0.35).normalize()
        L.direction = dir
        this.disc.position = dir.scale(-120)
        this.disc.lookAt(Vector3.Zero())
        this.discMat.emissiveColor = isNight ? new Color3(0.85, 0.88, 1) : new Color3(1, 0.95, 0.7)
        this.disc.scaling.setAll(isNight ? 0.6 : 1)
    }
}
