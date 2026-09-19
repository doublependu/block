/*
 *  Character library: loads character GLBs (bundled or external URLs),
 *  converts materials to cheap StandardMaterials, and creates animated
 *  instances with layered clips (locomotion + hold pose + upper-body action).
 *
 *  The glTF loader is imported lazily so it isn't part of the first load.
 */

import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { AnimationGroupMask, AnimationGroupMaskMode } from '@babylonjs/core/Animations/animationGroupMask'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import {
    BASE_CLIPS, UPPER_ACTIONS, FULL_ACTIONS, ARM_BONES, UPPER_BONES, FALLBACKS,
    ITEM_SOCKET, normaliseClipName, holdForItem, groundSpeeds, nextGait, gaitRate,
} from './contract.js'
import { alignQuaternionKeys } from './animFix.js'

const MODEL_BASE = './models/'
/**
 * Builds serve the bundled models gzipped (vite.config.js `gzipModels`): CDNs such as
 * Cloudflare don't compress model/gltf-binary, and gzip makes them ~7x smaller.
 */
const MODEL_EXT = import.meta.env.DEV ? '.glb' : '.glb.gz'
/** cross-fade between locomotion clips: blend weight gained per frame (~0.15 s at 60 fps) */
const BASE_BLEND_SPEED = 0.11

/** per-item attachment transform relative to the hand socket */
const ITEM_POSE = {
    sword: { pos: [0, 0, 0], rot: [-Math.PI / 2, 0, 0], scale: 1 },
    pickaxe: { pos: [0, 0, 0], rot: [-Math.PI / 2, 0, 0], scale: 1 },
    bow: { pos: [0, 0, 0], rot: [-Math.PI / 2, 0, 0], scale: 1 },
    gun: { pos: [0, 0, 0], rot: [-Math.PI / 2, 0, 0], scale: 1 },
    block: { pos: [0, -0.05, 0], rot: [0, 0, 0], scale: 1 },
}

let loaderPromise = null
function loadGltfLoader() {
    if (!loaderPromise) {
        loaderPromise = Promise.all([
            import('@babylonjs/loaders/glTF/2.0/glTFLoader.js'),
            import('@babylonjs/core/Loading/sceneLoader.js'),
        ]).then(([, sceneLoader]) => sceneLoader)
    }
    return loaderPromise
}

/** a model URL for the scene loader, or the inflated bytes of a .gz one */
async function modelSource(url) {
    if (!/\.gz(\?|$)/i.test(url)) return url
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    // a host that sends it with Content-Encoding: gzip has already inflated it
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes
    const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Uint8Array(await new Response(inflated).arrayBuffer())
}

export class CharacterLibrary {
    /** @param {import('noa-engine').Engine} noa */
    constructor(noa) {
        this.noa = noa
        this.scene = noa.rendering.getScene()
        /** @type {Map<string, Promise<any>>} */
        this.models = new Map()
        this.itemsPromise = null
        this.placeholderMat = noa.rendering.makeStandardMaterial('char-placeholder')
        this.placeholderMat.diffuseColor = new Color3(0.8, 0.8, 0.85)
        // one shared material for the hit flash (see CharacterInstance.flash)
        this.flashMat = noa.rendering.makeStandardMaterial('char-flash')
        this.flashMat.disableLighting = true
        this.flashMat.emissiveColor = new Color3(1, 0.72, 0.68)
        this.flashMat.diffuseColor = new Color3(0, 0, 0)
        this.flashMat.freeze()
        this._flashWarm = false
    }

    /** model name (bundled) or absolute/relative URL ending in .glb */
    urlFor(model) {
        return /\.glb(\?|$)/i.test(model) ? model : `${MODEL_BASE}${model}${MODEL_EXT}`
    }

    /** start loading a model; resolves to a prepared AssetContainer */
    load(model) {
        const url = this.urlFor(model)
        if (!this.models.has(url)) {
            const p = loadGltfLoader().then(async ({ LoadAssetContainerAsync }) => {
                const container = await LoadAssetContainerAsync(await modelSource(url), this.scene, {
                    pluginExtension: '.glb',
                    // no sRGB GPU buffers: StandardMaterial works in gamma space like the terrain
                    pluginOptions: { gltf: { animationStartMode: 0, useSRGBBuffers: false } },
                })
                this._prepareContainer(container)
                return container
            })
            p.catch((err) => console.warn('Character load failed:', url, err))
            this.models.set(url, p)
        }
        return this.models.get(url)
    }

    /** compile the flash material once, so the first hit of the night doesn't stutter */
    prewarmFlash(mesh) {
        if (this._flashWarm) return
        this._flashWarm = true
        try {
            this.flashMat.forceCompilation(mesh)
        } catch {
            // shader compilation is best-effort
        }
    }

    /** a frozen copy of an item material with its color multiplied (cached per tint) */
    tintedMaterial(mat, tint) {
        const key = `${mat ? mat.name : 'none'}|${tint.join(',')}`
        this.tinted = this.tinted || new Map()
        if (!this.tinted.has(key)) {
            const m = mat ? mat.clone(mat.name + '-tint') : new StandardMaterial('item-tint', this.scene)
            m.unfreeze()
            m.diffuseColor = new Color3(tint[0], tint[1], tint[2])
            m.freeze()
            this.tinted.set(key, m)
        }
        return this.tinted.get(key)
    }

    loadItems() {
        if (!this.itemsPromise) {
            this.itemsPromise = this.load('items').then((container) => {
                const sources = {}
                for (const mesh of container.meshes) {
                    if (!mesh.getTotalVertices()) continue
                    mesh.setEnabled(false)
                    sources[mesh.name] = mesh
                }
                container.addAllToScene()
                return sources
            })
        }
        return this.itemsPromise
    }

    _prepareContainer(container) {
        // swap PBR materials for flat StandardMaterials (cheaper, matches terrain lighting)
        const replaced = new Map()
        for (const mat of container.materials) {
            const std = new StandardMaterial(mat.name + '-std', this.scene)
            // @ts-ignore albedoTexture exists on PBR materials
            const tex = mat.albedoTexture || mat.diffuseTexture
            if (tex) {
                tex.gammaSpace = true
                tex.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE)
                std.diffuseTexture = tex
            }
            std.specularColor = new Color3(0, 0, 0)
            std.ambientColor = new Color3(1, 1, 1)
            replaced.set(mat, std)
        }
        for (const mesh of container.meshes) {
            if (mesh.material && replaced.has(mesh.material)) mesh.material = replaced.get(mesh.material)
        }
        for (const [pbr, std] of replaced) {
            container.materials.splice(container.materials.indexOf(pbr), 1)
            container.materials.push(std)
            pbr.dispose(false, false)
        }
        for (const mat of container.materials) mat.freeze()
        fixRotationFlips(container)
    }

    /**
     * Create a character instance immediately; the model is attached when loaded
     * (a simple box stands in until then).
     * @param {string} model
     * @param {{height?: number, width?: number}} [size]
     */
    create(model, size = {}) {
        const inst = new CharacterInstance(this, model, size)
        this.load(model).then(
            (container) => inst._attachModel(container),
            // a broken or unreachable model (e.g. an external avatar) falls back to the default player
            () => (model !== 'player' ? this.load('player').then((c) => inst._attachModel(c), () => { }) : null),
        )
        return inst
    }
}

/**
 * Rotation keys that flip quaternion sign between neighbours make a limb whip
 * through a wrong arc (Hermite blends components). The bundled GLBs are fixed
 * at build time; this catches external ones.
 * @returns {number} flipped keys
 */
export function fixRotationFlips(container) {
    let flips = 0
    for (const group of container.animationGroups) {
        for (const ta of group.targetedAnimations) {
            const anim = ta.animation
            if (anim.targetProperty !== 'rotationQuaternion') continue
            const keys = anim.getKeys()
            let bad = false
            for (let k = 1; k < keys.length && !bad; k++) bad = Quaternion.Dot(keys[k].value, keys[k - 1].value) < 0
            if (!bad) continue
            const cubic = !!(keys[0].inTangent && keys[0].outTangent)
            const curve = keys.map((k) => cubic ? { t: k.frame, v: k.value.asArray(), i: k.inTangent.asArray(), o: k.outTangent.asArray() } : { t: k.frame, v: k.value.asArray() })
            flips += alignQuaternionKeys(curve)
            keys.forEach((k, n) => {
                k.value = Quaternion.FromArray(curve[n].v)
                if (curve[n].i) k.inTangent = Quaternion.FromArray(curve[n].i)
                if (curve[n].o) k.outTangent = Quaternion.FromArray(curve[n].o)
            })
            anim.setKeys(keys)
        }
    }
    if (flips) console.info(`Fixed ${flips} flipped rotation keys in a character model`)
    return flips
}

let instanceCounter = 0

export class CharacterInstance {
    constructor(lib, model, size) {
        this.lib = lib
        this.noa = lib.noa
        this.model = model
        this.holder = new TransformNode('char-' + ++instanceCounter, lib.scene)
        this.holder.rotationQuaternion = null
        this.yaw = 0
        this.visible = true
        this.disposed = false
        /** @type {Record<string, any>} */
        this.groups = {}
        this.base = null
        this.hold = null
        this.action = null
        this.item = null
        this.tint = null
        this.tintKey = ''
        this.itemMesh = null
        this.meshes = []
        this.animateEnabled = true
        this._tipOver = 0
        this._flashT = 0
        this.height = size.height || 1.75
        /** @type {'idle'|'walk'|'run'} */
        this.gait = 'idle'

        const h = size.height || 1.75, w = size.width || 0.6
        const box = CreateBox('char-placeholder', { width: w, depth: w * 0.6, height: h }, lib.scene)
        box.position.y = h / 2
        box.material = lib.placeholderMat
        box.parent = this.holder
        box.isPickable = false
        this.placeholder = box
        this.noa.rendering.addMeshToScene(box)
    }

    get loaded() {
        return !!this.root
    }

    _attachModel(container) {
        if (this.disposed) return
        const entries = container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true })
        this.root = entries.rootNodes[0]
        this.root.parent = this.holder
        this.meshes = this.root.getChildMeshes(false)
        for (const m of this.meshes) {
            m.isPickable = false
            m.alwaysSelectAsActiveMesh = true
            this.noa.rendering.addMeshToScene(m)
        }
        this.placeholder.dispose()
        this.placeholder = null
        if (this.meshes.length) this.lib.prewarmFlash(this.meshes[0])
        this.socket = this.root.getChildTransformNodes(false).find((n) => n.name === ITEM_SOCKET) || null

        // resolve clips by contract name
        for (const g of entries.animationGroups) {
            const name = normaliseClipName(g.name)
            if (!this.groups[name]) this.groups[name] = g
            g.stop()
            if (BASE_CLIPS.has(name)) {
                g.enableBlending = true
                g.blendingSpeed = BASE_BLEND_SPEED
            }
        }
        this._maskArms = new AnimationGroupMask(ARM_BONES, AnimationGroupMaskMode.Exclude)
        this._maskUpper = new AnimationGroupMask(UPPER_BONES, AnimationGroupMaskMode.Exclude)
        this._maskArms.disabled = true
        this._maskUpper.disabled = true

        this.setVisible(this.visible)
        const base = this.base || 'idle'
        const hold = this.hold
        const item = this.item
        const tint = this.tint
        this.base = null
        this.hold = null
        this.item = null
        this.setBase(base)
        this.setItem(item, hold, tint)
    }

    _clip(name) {
        if (this.groups[name]) return this.groups[name]
        for (const alt of FALLBACKS[name] || []) if (this.groups[alt]) return this.groups[alt]
        return null
    }

    _applyMasks() {
        const g = this._clip(this.base)
        if (!g) return
        const upper = this.action && UPPER_ACTIONS.has(this.action)
        const arms = !!this.hold && !!this._clip(this.hold)
        g.mask = upper ? this._maskUpper : arms ? this._maskArms : null
    }

    /**
     * Pick idle / walk / run from horizontal speed (with hysteresis) and play it
     * at the rate that keeps the feet planted.
     * @param {number} speed m/s
     * @param {{falling?: boolean, cheer?: boolean}} [o]
     */
    locomote(speed, { falling = false, cheer = false } = {}) {
        const speeds = groundSpeeds(this.model, this.height)
        this.gait = nextGait(this.gait, speed, speeds)
        const base = falling ? 'fall' : this.gait === 'idle' && cheer ? 'cheer' : this.gait
        this.setBase(base, gaitRate(base, speed, speeds))
    }

    /** locomotion clip: idle | walk | run | fall | cheer */
    setBase(name, speed = 1) {
        if (!BASE_CLIPS.has(name)) name = 'idle'
        if (this.base === name) {
            const g = this._clip(name)
            if (g) g.speedRatio = speed
            return
        }
        const old = this._clip(this.base)
        this.base = name
        if (!this.root) return
        const g = this._clip(name)
        if (old && old !== g) old.stop()
        if (g && !(this.action && FULL_ACTIONS.has(this.action))) {
            g.speedRatio = speed
            this._applyMasks()
            if (!g.isPlaying) g.start(true, speed)
        }
    }

    /**
     * set held item (sword/bow/gun/pickaxe/block or null) and matching hold pose
     * @param {string|null} item
     * @param {string|null} [holdOverride]
     * @param {number[]|null} [tint] color multiplier (weapon tiers share one mesh)
     */
    setItem(item, holdOverride = undefined, tint = null) {
        const hold = holdOverride !== undefined ? holdOverride : holdForItem(item)
        const tintKey = tint ? tint.join(',') : ''
        if (this.item === item && this.hold === hold && this.tintKey === tintKey) return
        this.item = item
        this.tint = tint
        this.tintKey = tintKey
        this._setHold(hold)
        if (!this.root) return
        if (this.itemMesh) {
            this.itemMesh.dispose()
            this.itemMesh = null
        }
        if (!item || !this.socket) return
        this.lib.loadItems().then((sources) => {
            if (this.disposed || this.item !== item || this.tintKey !== tintKey || this.itemMesh) return
            const src = sources[item]
            if (!src) return
            let m
            if (tint) {
                m = src.clone(`${item}-${instanceCounter++}`, null, true)
                m.setEnabled(true)
                m.material = this.lib.tintedMaterial(src.material, tint)
            } else {
                m = src.createInstance(`${item}-${instanceCounter++}`)
            }
            const pose = ITEM_POSE[item] || ITEM_POSE.block
            m.parent = this.socket
            m.position = Vector3.FromArray(pose.pos)
            m.rotationQuaternion = Quaternion.FromEulerAngles(pose.rot[0], pose.rot[1], pose.rot[2])
            m.scaling.setAll(pose.scale)
            m.isPickable = false
            m.alwaysSelectAsActiveMesh = true
            this.noa.rendering.addMeshToScene(m)
            this.noa.rendering.setMeshVisibility(m, this.visible)
            this.itemMesh = m
        })
    }

    _setHold(hold) {
        const old = this.hold ? this._clip(this.hold) : null
        this.hold = hold
        if (!this.root) return
        const g = hold ? this._clip(hold) : null
        if (old && old !== g) old.stop()
        if (g && !(this.action && UPPER_ACTIONS.has(this.action))) g.start(true)
        this._applyMasks()
    }

    /**
     * One-shot action: mine | place | attack | shoot | hit | jump | die
     * @returns {boolean} whether a clip (or fallback) played
     */
    playAction(name, speed = 1, onEnd = null) {
        if (!this.root) {
            if (onEnd) onEnd()
            return false
        }
        if (this.action === 'die') return false
        const g = this._clip(name)
        if (!g) {
            if (name === 'die') this._tipOver = 0.0001
            if (onEnd) onEnd()
            return false
        }
        if (this._actionGroup && this._actionGroup !== g) this._actionGroup.stop()
        this.action = name
        this._actionGroup = g
        const full = FULL_ACTIONS.has(name)
        if (full) {
            const base = this._clip(this.base)
            if (base) base.stop()
        }
        if (UPPER_ACTIONS.has(name) && this.hold) {
            const hg = this._clip(this.hold)
            if (hg) hg.stop()
        }
        this._applyMasks()
        g.onAnimationGroupEndObservable.clear()
        g.onAnimationGroupEndObservable.addOnce(() => {
            if (this._actionGroup !== g) return
            if (name === 'die') {
                if (onEnd) onEnd()
                return
            }
            this.action = null
            this._actionGroup = null
            const hold = this.hold
            this.hold = null
            this._setHold(hold)
            const base = this.base
            this.base = null
            this.setBase(base)
            if (onEnd) onEnd()
        })
        g.start(false, speed)
        return true
    }

    get busy() {
        return !!this.action
    }

    /** flash white-red for a moment (took a hit) */
    flash(seconds = 0.12) {
        if (this.disposed || !this.meshes.length) return
        if (!(this._flashT > 0)) {
            for (const m of this.meshes) {
                m._baseMat = m.material
                m.material = this.lib.flashMat
            }
        }
        this._flashT = seconds
    }

    _endFlash() {
        for (const m of this.meshes) if (m._baseMat) m.material = m._baseMat
        this._flashT = 0
    }

    /** revive after death */
    reset() {
        if (this._actionGroup) this._actionGroup.stop()
        this.action = null
        this._actionGroup = null
        this._tipOver = 0
        this.holder.rotation.x = 0
        if (!this.root) return
        const base = this.base
        this.base = null
        this.setBase(base || 'idle')
        const hold = this.hold
        this.hold = null
        this._setHold(hold)
    }

    setVisible(v) {
        this.visible = v
        const r = this.noa.rendering
        if (this.placeholder) r.setMeshVisibility(this.placeholder, v)
        for (const m of this.meshes) r.setMeshVisibility(m, v)
        if (this.itemMesh) r.setMeshVisibility(this.itemMesh, v)
    }

    /** position = feet, yaw in radians (0 faces +Z) */
    setTransform(x, y, z, yaw) {
        this.holder.position.set(x, y, z)
        this.holder.rotation.y = yaw
        this.yaw = yaw
    }

    update(dt) {
        if (this._flashT > 0) {
            this._flashT -= dt
            if (this._flashT <= 0) this._endFlash()
        }
        if (this._tipOver > 0 && this._tipOver < 1) {
            this._tipOver = Math.min(1, this._tipOver + dt * 2.5)
            this.holder.rotation.x = -Math.PI / 2 * this._tipOver
        }
    }

    dispose() {
        this.disposed = true
        for (const g of Object.values(this.groups)) g.dispose()
        this.holder.dispose(false, false)
    }
}
