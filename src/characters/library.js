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
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { SubMesh } from '@babylonjs/core/Meshes/subMesh'
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { AnimationGroupMask, AnimationGroupMaskMode } from '@babylonjs/core/Animations/animationGroupMask'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import {
    BASE_CLIPS, UPPER_ACTIONS, FULL_ACTIONS, ARM_BONES, UPPER_BONES, FP_BONES, FALLBACKS,
    ITEM_SOCKET, normaliseClipName, holdForItem, companionItem, groundSpeeds, nextGait, gaitRate, reaches, CLIP_FPS, CLIP_KEYS,
} from './contract.js'
import { alignQuaternionKeys } from './animFix.js'
import { poseFor, itemRotation, NOCK, BLOCK_SIZE } from './itemPose.js'
import { MUZZLE } from '../game/fpView.js'
import { RENDER_GROUP } from '../core/constants.js'
import { TILE_INDEX, TILE_NAMES } from '../world/atlas.js'

const MODEL_BASE = './models/'
/**
 * Builds serve the bundled models gzipped (vite.config.js `gzipModels`): CDNs such as
 * Cloudflare don't compress model/gltf-binary, and gzip makes them ~7x smaller.
 */
const MODEL_EXT = import.meta.env.DEV ? '.glb' : '.glb.gz'
/** cross-fade between locomotion clips: blend weight gained per frame (~0.15 s at 60 fps) */
const BASE_BLEND_SPEED = 0.11
/** locomotion clips that move the arms themselves, over any hold: the winners' cheer, a fall */
const BASE_OWNS_ARMS = new Set(['cheer', 'fall'])
/** how far a full draw pulls the bow string back (m, item space) */
const STRING_PULL = 0.07
/** the war bow's bolt glows, which is also what says it pierces armour */
const BOLT_TINT = [1.3, 1.5, 1.8]
/** the musket's flash: how long it shows from the clip's blow (s) */
const FLASH_TIME = 0.07
/**
 * The iron sword's gleam (the body you play): every `every` seconds of holding
 * it still, a glint runs up the blade (item space: from `from` to `to` along
 * it) in `time`
 */
const GLEAM = { every: 3.2, time: 0.4, from: 0.2, to: 1.0, alpha: 0.75 }
const tmpPull = new Vector3()
const tmpPullM = new Matrix()
const smooth = (x) => {
    const k = Math.max(0, Math.min(1, x))
    return k * k * (3 - 2 * k)
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
        // and one for a frozen attacker (plan 12 §3): pale ice, lit, glowing a little so it reads at night
        this.frostMat = noa.rendering.makeStandardMaterial('char-frost')
        this.frostMat.diffuseColor = new Color3(0.42, 0.68, 0.92)
        this.frostMat.emissiveColor = new Color3(0.08, 0.16, 0.26)
        this.frostMat.specularColor = new Color3(0.55, 0.65, 0.75)
        this.frostMat.specularPower = 32
        this.frostMat.freeze()
        this._flashWarm = false
        /** the block texture atlas, for a block in the hand (set by the session) */
        this.atlasURL = null
        this._blockMat = null
        this._glowMats = new Map()
    }

    /** the atlas as a material, for a block held in the hand */
    blockMaterial() {
        if (!this._blockMat) {
            const m = this.noa.rendering.makeStandardMaterial('held-block')
            m.diffuseColor = new Color3(1, 1, 1)
            m.specularColor = new Color3(0, 0, 0)
            m.ambientColor = new Color3(1, 1, 1)
            if (this.atlasURL) {
                const tex = new Texture(this.atlasURL, this.scene, true, false, Texture.NEAREST_SAMPLINGMODE)
                tex.hasAlpha = true
                m.diffuseTexture = tex
            }
            this._blockMat = m
        }
        return this._blockMat
    }

    /** an unlit, see-through material of one colour (the musket's flash, the iron sword's glint), shared */
    glowMaterial(hex) {
        if (!this._glowMats.has(hex)) {
            const m = this.noa.rendering.makeStandardMaterial('glow-' + hex)
            m.disableLighting = true
            m.emissiveColor = Color3.FromHexString(hex)
            m.diffuseColor = new Color3(0, 0, 0)
            m.specularColor = new Color3(0, 0, 0)
            m.backFaceCulling = false
            m.fogEnabled = false
            m.alpha = 0.9
            this._glowMats.set(hex, m)
        }
        return this._glowMats.get(hex)
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
            this.frostMat.forceCompilation(mesh)
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
        container.metadata = { ...(container.metadata || {}), arms: armsLast(container), head: headHeight(container) }
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

/**
 * First person draws only a body's forearms and hands (plan 14 §2.1,
 * contract.js FP_BONES). So that it can, with the one mesh and one draw call it
 * already has, each skinned mesh's triangles are sorted once at load: those
 * that move with those bones last. A mesh with several materials is left alone
 * (and not drawn in first person); every bundled model has one.
 * @returns {Map<string, {start: number, count: number}>} by mesh name: the arms' index range
 */
export function armsLast(container) {
    const ranges = new Map()
    const arm = new Set(FP_BONES)
    for (const mesh of container.meshes) {
        const sk = mesh.skeleton
        const indices = mesh.getIndices && mesh.getIndices()
        if (!sk || !indices || mesh.subMeshes?.length !== 1) continue
        const joints = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind)
        const weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind)
        if (!joints || !weights) continue
        const names = new Map(sk.bones.map((b) => [b.getIndex(), b.name]))
        const n = joints.length / mesh.getTotalVertices()
        const isArm = (v) => {
            let best = 0
            for (let i = 1; i < n; i++) if (weights[v * n + i] > weights[v * n + best]) best = i
            return arm.has(names.get(joints[v * n + best]))
        }
        const rest = [], arms = []
        for (let t = 0; t < indices.length; t += 3) {
            const tri = [indices[t], indices[t + 1], indices[t + 2]]
            ;(tri.every(isArm) ? arms : rest).push(...tri)
        }
        if (!arms.length) continue
        mesh.setIndices([...rest, ...arms], mesh.getTotalVertices())
        ranges.set(mesh.name, { start: rest.length, count: arms.length })
    }
    return ranges
}

/** a model's head bone above its feet (m), at rest: how big the body is (fpView.js vantage) */
function headHeight(container) {
    const head = container.transformNodes.find((n) => n.name === 'head')
    if (!head) return null
    // root first: each node's world matrix is built on its parent's
    const chain = []
    for (let n = head; n; n = n.parent) chain.unshift(n)
    for (const n of chain) n.computeWorldMatrix(true)
    return head.getAbsolutePosition().y
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
        /** everything the model instance made that dispose() must free (set when the model attaches) */
        this._skeletons = null
        this._allGroups = null
        this.base = null
        this.hold = null
        this.action = null
        this.item = null
        this.tint = null
        this.tintKey = ''
        this.itemMesh = null
        /** a bow's string: its own node, so it can be pulled back (see companionItem) */
        this.itemExtra = null
        this.meshes = []
        this.animateEnabled = true
        this._tipOver = 0
        this._flashT = 0
        /** frozen (plan 12 §3): in the frost material, every clip held where it is */
        this._frozen = false
        this.height = size.height || 1.75
        /** @type {'idle'|'walk'|'run'} */
        this.gait = 'idle'
        /** the block's tile when the item is a block */
        this.tile = null
        /**
         * First person (plan 14 §2): the node on the camera this body hangs from,
         * or null in the world. Then only its arms and the item are drawn, over
         * the world (the hands' render group).
         */
        this.fpAnchor = null
        /** where it stands in the world (kept while the camera carries it) */
        this._at = new Vector3()
        /** the body's head bone above its feet (m), once loaded: its size */
        this.head = null
        /** the arms-only and the whole draw of each mesh (see armsLast) */
        this._armSubs = new Map()
        this._allSubs = new Map()
        /** chops landed so far (the mine clip passing its blow): what the dig sound keeps time with */
        this.chops = 0
        this._chopF = -1
        /** the arrow on a bow's string while it's drawn */
        this.nock = null
        /** the musket's flash, and how long it has left to show */
        this.flashMesh = null
        this._flashLeft = 0
        this._shotF = -1
        /** the iron sword's glint between swings (the body you play, see GLEAM) */
        this.gleams = false
        this._gleam = null
        this._gleamIn = GLEAM.every
        this._gleamT = -1

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
        // everything the instance made, for dispose(): its skeleton (with its bone texture) isn't
        // under the root node, and clips with a name already taken aren't kept in this.groups
        this._skeletons = entries.skeletons
        this._allGroups = entries.animationGroups
        this.root = entries.rootNodes[0]
        this.root.parent = this.holder
        this.meshes = this.root.getChildMeshes(false)
        const arms = (container.metadata && container.metadata.arms) || new Map()
        for (const m of this.meshes) {
            m.isPickable = false
            m.alwaysSelectAsActiveMesh = true
            this.noa.rendering.addMeshToScene(m)
            this._allSubs.set(m, m.subMeshes.slice())
            const r = arms.get(m.name)
            if (r) this._armSubs.set(m, [new SubMesh(0, 0, m.getTotalVertices(), r.start, r.count, m, undefined, false, false)])
        }
        this.head = (container.metadata && container.metadata.head) || null
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
        // (until plan 14 both were made disabled, so they masked nothing: locomotion and the hold
        // fought over the arms, and a troop's hold lost; its arms hung whatever it held)
        this._maskArms = new AnimationGroupMask(ARM_BONES, AnimationGroupMaskMode.Exclude)
        this._maskUpper = new AnimationGroupMask(UPPER_BONES, AnimationGroupMaskMode.Exclude)

        this.setVisible(this.visible)
        this._applyView()
        const base = this.base || 'idle'
        const hold = this.hold
        const item = this.item
        const tint = this.tint
        this.base = null
        this.hold = null
        this.item = null
        this.setBase(base)
        this.setItem(item, hold, tint, this.tile)
    }

    /**
     * First person (plan 14 §2): hang the body from `anchor`, a node on the
     * camera, facing where it looks, and draw only its arms and the item, over
     * the world. Null puts it back in the world, whole.
     * @param {TransformNode | null} anchor
     */
    setFirstPerson(anchor) {
        if (this.fpAnchor === anchor) return
        this.fpAnchor = anchor
        this.holder.parent = anchor
        if (anchor) {
            this.holder.position.set(0, 0, 0)
            this.holder.rotation.set(0, 0, 0)
        } else {
            // back where it stands in the world, not at the origin until its next move
            this.holder.position.copyFrom(this._at)
            this.holder.rotation.y = this.yaw
        }
        this._applyView()
        // an instance is drawn in its source's render group: the item becomes a copy of its own
        if (this.itemMesh && (this.itemMesh instanceof InstancedMesh) === !!anchor) this._rebuildItem()
    }

    /** the draw for this view: arms only and over the world in first person, the whole body in the world otherwise */
    _applyView() {
        const fp = !!this.fpAnchor
        const group = fp ? RENDER_GROUP.hands : RENDER_GROUP.world
        for (const m of this.meshes) {
            m.renderingGroupId = group
            const arms = this._armSubs.get(m)
            if (fp && !arms) this.noa.rendering.setMeshVisibility(m, false)
            else {
                m.subMeshes = (fp ? arms : this._allSubs.get(m)) || m.subMeshes
                this.noa.rendering.setMeshVisibility(m, this.visible)
            }
        }
        for (const m of [this.itemMesh, this.itemExtra, this.nock, this.flashMesh, this._gleam]) {
            if (m && !(m instanceof InstancedMesh)) m.renderingGroupId = group
        }
        if (this.placeholder) this.noa.rendering.setMeshVisibility(this.placeholder, this.visible && !fp)
    }

    _clip(name) {
        if (this.groups[name]) return this.groups[name]
        for (const alt of FALLBACKS[name] || []) if (this.groups[alt]) return this.groups[alt]
        return null
    }

    /**
     * The layers (plan 14): locomotion has the whole body but what's masked off
     * it; an upper-body action has the upper body; otherwise the hold pose has
     * the arms, except while a base that moves them plays (a cheer, a fall).
     */
    _applyMasks() {
        const g = this._clip(this.base)
        if (!g) return
        const upper = this.action && UPPER_ACTIONS.has(this.action)
        g.mask = upper ? this._maskUpper : this._holdPlays() ? this._maskArms : null
    }

    /** the hold pose has the arms now (see _applyMasks) */
    _holdPlays() {
        return !!this.hold && !!this._clip(this.hold) && !(this.action && UPPER_ACTIONS.has(this.action)) && !BASE_OWNS_ARMS.has(this.base)
    }

    /** start or stop the hold pose as the layers say (see _applyMasks) */
    _syncHold() {
        const g = this.hold ? this._clip(this.hold) : null
        if (!g) return
        const on = this._holdPlays()
        if (on && !g.isPlaying) g.start(true)
        else if (!on && g.isPlaying) g.stop()
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
        this._syncHold()
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
     * @param {string|null} [tile] atlas tile name when the item is a block
     */
    setItem(item, holdOverride = undefined, tint = null, tile = null) {
        const hold = holdOverride !== undefined ? holdOverride : holdForItem(item)
        const tintKey = (tint ? tint.join(',') : '') + '|' + (item === 'block' ? tile || '' : '')
        if (this.item === item && this.hold === hold && this.tintKey === tintKey) return
        this.item = item
        this.tint = tint
        this.tile = item === 'block' ? tile : null
        this.tintKey = tintKey
        this._setHold(hold)
        this._rebuildItem()
    }

    /** the item's meshes, made again (a new item, or a view that needs copies instead of instances) */
    _rebuildItem() {
        if (!this.root) return
        // the glint rides on the blade: take it off before the old item goes (disposing takes the children)
        if (this._gleam) this._gleam.parent = null
        for (const key of ['itemMesh', 'itemExtra', 'nock', 'flashMesh']) {
            if (this[key]) {
                this[key].dispose()
                this[key] = null
            }
        }
        const item = this.item, tint = this.tint, tintKey = this.tintKey
        if (!item || !this.socket) return
        if (item === 'block') {
            this.itemMesh = this._attachItem(this._blockMesh(), item)
            return
        }
        this.lib.loadItems().then((sources) => {
            if (this.disposed || this.item !== item || this.tintKey !== tintKey || this.itemMesh) return
            const src = sources[item]
            if (!src) return
            // an instance is drawn in its source's render group, so first person holds copies
            const copy = (source, name, t) => {
                if (!t && !this.fpAnchor) return source.createInstance(`${name}-${instanceCounter++}`)
                const m = source.clone(`${name}-${instanceCounter++}`, null, true)
                m.setEnabled(true)
                if (t) m.material = this.lib.tintedMaterial(source.material, t)
                return m
            }
            this.itemMesh = this._attachItem(copy(src, item, tint), item)
            const extra = companionItem(item)
            if (extra && sources[extra]) {
                this.itemExtra = this._attachItem(copy(sources[extra], extra, tint), extra)
                // the arrow on the string while it's drawn: it comes back with the string (see _pullString)
                if (sources.arrow) {
                    const nock = copy(sources.arrow, 'nock', item === 'war_bow' ? BOLT_TINT : null)
                    nock.parent = this.itemExtra
                    nock.position = Vector3.FromArray(NOCK.pos)
                    nock.rotationQuaternion = Quaternion.FromEulerAngles(NOCK.rot[0], NOCK.rot[1], NOCK.rot[2])
                    this._park(nock)
                    this.noa.rendering.setMeshVisibility(nock, false)
                    this.nock = nock
                }
            }
            this._applyView()
        })
    }

    /** the block in your hand: a little cube in its own tile from the atlas */
    _blockMesh() {
        const m = CreateBox(`held-block-${instanceCounter++}`, { size: BLOCK_SIZE }, this.lib.scene)
        m.material = this.lib.blockMaterial()
        // every face shows the block's tile from the atlas strip (tile 0 at the top; Babylon flips textures on upload)
        const i = TILE_INDEX[this.tile] ?? 0
        const n = TILE_NAMES.length
        const v0 = i / n, v1 = (i + 1) / n
        const uvs = []
        for (let face = 0; face < 6; face++) uvs.push(0, v0, 1, v0, 1, v1, 0, v1)
        m.setVerticesData(VertexBuffer.UVKind, uvs)
        return m
    }

    /** park a freshly built item mesh on the hand socket */
    _attachItem(m, item) {
        const pose = poseFor(item)
        m.parent = this.socket
        m.position = Vector3.FromArray(pose.pos)
        m.rotationQuaternion = itemRotation(pose)
        m.scaling.setAll(pose.scale)
        this._park(m)
        return m
    }

    /** a mesh that rides on the body: never picked, drawn with it in the view it's in */
    _park(m) {
        m.isPickable = false
        m.alwaysSelectAsActiveMesh = true
        this.noa.rendering.addMeshToScene(m)
        if (!(m instanceof InstancedMesh)) m.renderingGroupId = this.fpAnchor ? RENDER_GROUP.hands : RENDER_GROUP.world
        this.noa.rendering.setMeshVisibility(m, this.visible)
    }

    /**
     * Where a shot leaves the item in the hand, in the world (fpView.js MUZZLE),
     * or null when it has no muzzle or isn't loaded. In first person that is
     * where it shows on the screen.
     * @returns {number[] | null}
     */
    muzzle() {
        const at = this.itemMesh && MUZZLE[this.item]
        if (!at) return null
        const w = Vector3.TransformCoordinates(Vector3.FromArray(at), this.itemMesh.getWorldMatrix())
        return [w.x, w.y, w.z]
    }

    _setHold(hold) {
        const old = this.hold ? this._clip(this.hold) : null
        this.hold = hold
        if (!this.root) return
        const g = hold ? this._clip(hold) : null
        if (old && old !== g) old.stop()
        this._syncHold()
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
        // frozen stiff: nothing new starts (a death thaws it first)
        if (this._frozen && name !== 'die') return false
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
        this._actionT = 0
        this._actionSpeed = speed
        return true
    }

    get busy() {
        return !!this.action
    }

    /** flash white-red for a moment (took a hit) */
    flash(seconds = 0.12) {
        if (this.disposed || !this.meshes.length) return
        this._flashT = seconds
        this._applyMaterial()
    }

    _endFlash() {
        this._flashT = 0
        this._applyMaterial()
    }

    /**
     * Frozen stiff (plan 12 §3) or free again: the frost material, and every
     * clip held at its current frame.
     */
    setFrozen(on) {
        if (this._frozen === on || this.disposed) return
        this._frozen = on
        for (const g of this._allGroups || Object.values(this.groups)) {
            if (on) {
                g._thawRatio = g.speedRatio
                g.speedRatio = 0
            } else if (g._thawRatio !== undefined) {
                g.speedRatio = g._thawRatio
                g._thawRatio = undefined
            }
        }
        this._applyMaterial()
    }

    /** the hit flash over the frost over the model's own materials */
    _applyMaterial() {
        const over = this._flashT > 0 ? this.lib.flashMat : this._frozen ? this.lib.frostMat : null
        for (const m of this.meshes) {
            if (over) {
                if (m._baseMat === undefined) m._baseMat = m.material
                m.material = over
            } else if (m._baseMat !== undefined) {
                m.material = m._baseMat
                m._baseMat = undefined
            }
        }
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
        if (this.placeholder) r.setMeshVisibility(this.placeholder, v && !this.fpAnchor)
        for (const m of this.meshes) r.setMeshVisibility(m, v && (!this.fpAnchor || this._armSubs.has(m)))
        if (this.itemMesh) r.setMeshVisibility(this.itemMesh, v)
        if (this.itemExtra) r.setMeshVisibility(this.itemExtra, v)
        if (!v) for (const m of [this.nock, this.flashMesh, this._gleam]) if (m) r.setMeshVisibility(m, false)
        // the arrow on the string is shown again by the next frame of a draw, if one is under way
        if (this.nock) this.nock._shown = undefined
    }

    /** position = feet, yaw in radians (0 faces +Z). In first person the camera carries the body */
    setTransform(x, y, z, yaw) {
        this.yaw = yaw
        this._at.set(x, y, z)
        if (this.fpAnchor) return
        this.holder.position.set(x, y, z)
        this.holder.rotation.y = yaw
    }

    update(dt) {
        if (this.action) this._actionT += dt
        if (this.itemExtra) this._pullString()
        if (this._flashT > 0) {
            this._flashT -= dt
            if (this._flashT <= 0) this._endFlash()
        }
        if (this._tipOver > 0 && this._tipOver < 1) {
            this._tipOver = Math.min(1, this._tipOver + dt * 2.5)
            this.holder.rotation.x = -Math.PI / 2 * this._tipOver
        }
        this._countChops()
        this._renderNock()
        this._renderMuzzleFlash(dt)
        this._renderGleam(dt)
    }

    /** the frame the action's clip is at now */
    get actionFrame() {
        return this.action ? this._actionT * (this._actionSpeed || 1) * CLIP_FPS : -1
    }

    /** a chop lands when the mine clip passes its blow, in either view (plan 14 §2.2) */
    _countChops() {
        const f = this.action === 'mine' ? this.actionFrame : -1
        if (reaches(this._chopF, f, CLIP_KEYS.mine.blow)) this.chops++
        this._chopF = f
    }

    /** the arrow sits on the string from the start of a full draw to the loose */
    _renderNock() {
        if (!this.nock) return
        const f = this.action === 'shoot_draw' ? this.actionFrame : -1
        const on = this.visible && f >= 1 && f < CLIP_KEYS.shoot_draw.blow
        if (on === this.nock._shown) return
        this.nock._shown = on
        this.noa.rendering.setMeshVisibility(this.nock, on)
    }

    /** the musket's flash, at the blow of its shot */
    _renderMuzzleFlash(dt) {
        if (this.item !== 'gun' || !this.itemMesh) return
        const f = this.action === 'shoot' ? this.actionFrame : -1
        const k = CLIP_KEYS.shoot.blow
        if (reaches(this._shotF, f, k)) this._flashLeft = FLASH_TIME
        this._shotF = f
        if (this._flashLeft <= 0 && !this.flashMesh) return
        if (!this.flashMesh) {
            // a small hexagon of light rather than a square
            const m = CreateDisc(`muzzle-flash-${instanceCounter++}`, { radius: 0.08, tessellation: 6 }, this.lib.scene)
            m.material = this.lib.glowMaterial('#ffc65a')
            m.billboardMode = Mesh.BILLBOARDMODE_ALL
            m.parent = this.itemMesh
            m.position = Vector3.FromArray(MUZZLE.gun)
            this._park(m)
            this.flashMesh = m
        }
        this._flashLeft -= dt
        this.noa.rendering.setMeshVisibility(this.flashMesh, this.visible && this._flashLeft > 0)
    }

    /** the glint up the iron blade, while it's held still (the body you play) */
    _renderGleam(dt) {
        const r = this.noa.rendering
        const on = this.gleams && this.item === 'iron_sword' && !!this.itemMesh && this.visible && !this.action
        if (!on) {
            this._gleamIn = GLEAM.every
            this._gleamT = -1
            if (this._gleam) r.setMeshVisibility(this._gleam, false)
            return
        }
        if (this._gleamT < 0) {
            this._gleamIn -= dt
            if (this._gleamIn > 0) return
            this._gleamT = 0
        }
        if (!this._gleam) {
            const m = CreatePlane(`gleam-${instanceCounter++}`, { width: 0.15, height: 0.035 }, this.lib.scene)
            m.material = this.lib.glowMaterial('#ffffff').clone('gleam-mat')
            m.material.alpha = 0
            // a slanted streak rather than a band
            m.rotation.z = 0.7
            this._park(m)
            this._gleam = m
        }
        const g = this._gleam
        if (g.parent !== this.itemMesh) g.parent = this.itemMesh
        this._gleamT += dt
        const p = this._gleamT / GLEAM.time
        if (p >= 1) {
            this._gleamT = -1
            this._gleamIn = GLEAM.every
            r.setMeshVisibility(g, false)
            return
        }
        // just off the face of the blade, turned to lie along it
        g.position.set(0, GLEAM.from + (GLEAM.to - GLEAM.from) * p, -0.045)
        g.material.alpha = GLEAM.alpha * Math.sin(Math.PI * p)
        r.setMeshVisibility(g, true)
    }

    /**
     * A full draw pulls the bow's string back with the drawing hand (plan 13
     * §2.2): it comes back as the hand draws, is held, and snaps home at the
     * loose (shoot_draw's frames). The arrow on it comes back with it.
     */
    _pullString() {
        const m = this.itemExtra
        const pose = poseFor(this.item + '_string')
        let pull = 0
        if (this.action === 'shoot_draw') {
            const f = this._actionT * (this._actionSpeed || 1) * CLIP_FPS
            const k = CLIP_KEYS.shoot_draw
            pull = f < 9 ? smooth(f / 9) : f < k.blow ? 1 : f < k.end ? 1 - smooth((f - k.blow) / (k.end - k.blow)) : 0
        }
        if (pull === this._pull) return
        this._pull = pull
        // the string is on the archer's side of the stave (+z in items.glb): further that way
        tmpPull.set(0, 0, STRING_PULL * pull)
        Vector3.TransformNormalToRef(tmpPull, Matrix.FromQuaternionToRef(m.rotationQuaternion, tmpPullM), tmpPull)
        m.position.set(pose.pos[0] + tmpPull.x, pose.pos[1] + tmpPull.y, pose.pos[2] + tmpPull.z)
    }

    dispose() {
        this.disposed = true
        if (this._gleam) {
            this._gleam.material.dispose()
            this._gleam.dispose()
        }
        for (const g of this._allGroups || Object.values(this.groups)) g.dispose()
        this.holder.dispose(false, false)
        // one skeleton and one bone texture per unit, left behind before
        for (const sk of this._skeletons || []) sk.dispose()
    }
}
