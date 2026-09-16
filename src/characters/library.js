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
    ITEM_SOCKET, normaliseClipName, holdForItem,
} from './contract.js'

const MODEL_BASE = './models/'

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
    }

    /** model name (bundled) or absolute/relative URL ending in .glb */
    urlFor(model) {
        return /\.glb(\?|$)/i.test(model) ? model : `${MODEL_BASE}${model}.glb`
    }

    /** start loading a model; resolves to a prepared AssetContainer */
    load(model) {
        const url = this.urlFor(model)
        if (!this.models.has(url)) {
            const p = loadGltfLoader().then(async ({ LoadAssetContainerAsync }) => {
                const container = await LoadAssetContainerAsync(url, this.scene, {
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
        this.itemMesh = null
        this.meshes = []
        this.animateEnabled = true
        this._tipOver = 0

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
        this.socket = this.root.getChildTransformNodes(false).find((n) => n.name === ITEM_SOCKET) || null

        // resolve clips by contract name
        for (const g of entries.animationGroups) {
            const name = normaliseClipName(g.name)
            if (!this.groups[name]) this.groups[name] = g
            g.stop()
        }
        this._maskArms = new AnimationGroupMask(ARM_BONES, AnimationGroupMaskMode.Exclude)
        this._maskUpper = new AnimationGroupMask(UPPER_BONES, AnimationGroupMaskMode.Exclude)
        this._maskArms.disabled = true
        this._maskUpper.disabled = true

        this.setVisible(this.visible)
        const base = this.base || 'idle'
        const hold = this.hold
        const item = this.item
        this.base = null
        this.hold = null
        this.item = null
        this.setBase(base)
        this.setItem(item, hold)
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

    /** set held item (sword/bow/gun/pickaxe/block or null) and matching hold pose */
    setItem(item, holdOverride = undefined) {
        const hold = holdOverride !== undefined ? holdOverride : holdForItem(item)
        if (this.item === item && this.hold === hold) return
        this.item = item
        this._setHold(hold)
        if (!this.root) return
        if (this.itemMesh) {
            this.itemMesh.dispose()
            this.itemMesh = null
        }
        if (!item || !this.socket) return
        this.lib.loadItems().then((sources) => {
            if (this.disposed || this.item !== item || this.itemMesh) return
            const src = sources[item]
            if (!src) return
            const m = src.createInstance(`${item}-${instanceCounter++}`)
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
