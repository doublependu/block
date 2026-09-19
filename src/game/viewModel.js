/*
 *  First-person view model: the arm you hold things with, the item in it, and
 *  the motion of whatever you're doing (swing, mine, place, draw, recoil).
 *
 *  Everything is parented to the Babylon camera and drawn in the last rendering
 *  group with the depth buffer cleared, so it never clips into walls or units. The
 *  motions are procedural (no clips): each one is a curve over its own time.
 *  A sword swing leaves a short trail behind the blade tip, built from the
 *  same curve, so it stays on the blade at any frame rate.
 */

import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Material } from '@babylonjs/core/Materials/material'
import { armColors } from '../characters/contract.js'
import { TILE_INDEX, TILE_NAMES } from '../world/atlas.js'
import { RENDER_GROUP } from '../core/constants.js'

/**
 * Where the hand sits in camera space and how big it is. Everything hangs off
 * `root`, which is scaled down: the camera sits very close to it, so full-size
 * items would fill the screen.
 */
const SCALE = 0.42
const HOME = { x: 0.5, y: -0.52, z: 1.15 }
const ARM = { length: 0.34, width: 0.1 }

/** hex string to a Color3 */
const col = (hex) => Color3.FromHexString(hex)

/** a melee swing: wind up over the shoulder, slash across the view, come back */
const SWING = {
    windUp: 0.25,
    /** end of the slash; the trail shows from windUp to here */
    slashEnd: 0.6,
    up: { dx: 0.05, dy: 0.1, dz: -0.12, rx: -0.7, rz: 0.5 },
    down: { dx: -0.25, dy: -0.16, dz: 0.12, rx: 0.8, rz: -0.7 },
}

/** mining: wind up, chop down, come back up */
const CHOP = {
    up: { dy: 0.07, dz: -0.06, rx: -0.5 },
    down: { dy: -0.06, dz: 0.06, rx: 0.4 },
}

/** bow: drawn back, then just past rest on release */
const DRAW = {
    back: { dz: -0.16, dx: -0.03, rx: -0.12 },
    release: { dz: 0.04, dx: 0, rx: 0 },
}

/** a * (1 - k) + b * k over the keys of `a` (missing keys in b count as 0) */
const mix = (a, b, k) => {
    const o = {}
    for (const key of Object.keys(a)) o[key] = a[key] + ((b ? b[key] || 0 : 0) - a[key]) * k
    return o
}
const scaled = (a, k) => mix(a, null, 1 - k)

/**
 * Motions: each returns an offset from the resting pose for progress p (0..1).
 * dx/dy/dz are camera-space metres, rx/ry/rz radians. Each one ends at rest
 * (and all but equip start there), so nothing snaps when it ends or loops.
 */
export const MOTIONS = {
    swing: { time: 0.36, f: (p) => (p < SWING.windUp ? scaled(SWING.up, s(p / SWING.windUp))
        : p < SWING.slashEnd ? mix(SWING.up, SWING.down, s((p - SWING.windUp) / (SWING.slashEnd - SWING.windUp)))
            : scaled(SWING.down, 1 - s((p - SWING.slashEnd) / (1 - SWING.slashEnd)))) },
    /** played over and over while you dig (see stepMotion) */
    mine: { time: 0.42, loop: true, f: (p) => (p < 0.3 ? scaled(CHOP.up, s(p / 0.3))
        : p < 0.7 ? mix(CHOP.up, CHOP.down, s((p - 0.3) / 0.4))
            : scaled(CHOP.down, 1 - s((p - 0.7) / 0.3))) },
    /** placing a block: a short push forward */
    place: { time: 0.22, f: (p) => ({ dz: 0.13 * bump(p), dy: -0.03 * bump(p), rx: 0.2 * bump(p) }) },
    /** bow: pull back, snap forward on release, settle */
    draw: { time: 0.32, f: (p) => (p < 0.7 ? scaled(DRAW.back, s(p / 0.7))
        : p < 0.85 ? mix(DRAW.back, DRAW.release, s((p - 0.7) / 0.15))
            : scaled(DRAW.release, 1 - s((p - 0.85) / 0.15))) },
    /** musket / gun: kick back and settle */
    recoil: { time: 0.34, f: (p) => (p < 0.18
        ? { dz: -0.14 * (p / 0.18), dy: 0.05 * (p / 0.18), rx: -0.4 * (p / 0.18) }
        : { dz: -0.14 * (1 - s((p - 0.18) / 0.82)), dy: 0.05 * (1 - s((p - 0.18) / 0.82)), rx: -0.4 * (1 - s((p - 0.18) / 0.82)) }) },
    /** changing item: swing the new one up into view */
    equip: { time: 0.24, f: (p) => ({ dy: -0.45 * (1 - s(p)), rx: 0.9 * (1 - s(p)) }) },
    /** you took a hit */
    hit: { time: 0.2, f: (p) => ({ dy: -0.09 * bump(p), rz: 0.18 * bump(p), rx: 0.15 * bump(p) }) },
}

/** smoothstep and a there-and-back bump */
const s = (p) => {
    const x = Math.max(0, Math.min(1, p))
    return x * x * (3 - 2 * x)
}
const bump = (p) => Math.sin(Math.PI * Math.max(0, Math.min(1, p)))

/**
 * pure: move a motion on by `dt` seconds. A looping motion (mining) only goes
 * round again while `keepLooping` is set; otherwise it finishes the cycle it's
 * in and ends, so the chop never outlasts the digging.
 * @param {{name: string, t: number} | null} action advanced in place
 * @param {number} dt seconds
 * @param {boolean} keepLooping
 * @returns {{name: string, t: number} | null} the action, or null once it's over
 */
export function stepMotion(action, dt, keepLooping) {
    const spec = action && MOTIONS[action.name]
    if (!spec) return null
    action.t += dt
    if (action.t < spec.time) return action
    if (spec.loop && keepLooping) {
        action.t %= spec.time
        return action
    }
    return null
}

/**
 * The trail a sword leaves on the slash: `samples` points along the curve over
 * the last `span` of the swing (a share of its time), from the blade tip to
 * `inner` of the way down the blade, fading and narrowing toward the tail.
 */
const TRAIL = { samples: 10, span: 0.22, inner: 0.45, alpha: 0.45, fade: 0.06 }

const REST = {}
const ONE = new Vector3(1, 1, 1)
const tmpPos = new Vector3()
const tmpRot = new Vector3()
const tmpQ = new Quaternion()
const tmpM = new Matrix()
const tmpM2 = new Matrix()
const tmpA = new Vector3()
const tmpB = new Vector3()

/** how an item sits in the hand: position, rotation, scale */
/** items.glb meshes point along +Y, so they're tilted forward out of the fist */
const ITEM_POSE = {
    sword: { pos: [0, 0.03, 0.04], rot: [-1.1, 0.25, 0.15], scale: 0.6 },
    pickaxe: { pos: [0, 0.03, 0.04], rot: [-1.0, 0.3, 0.15], scale: 0.6 },
    bow: { pos: [0.01, 0.02, 0.06], rot: [-1.5, 0, 0.1], scale: 0.7 },
    gun: { pos: [0, 0.02, 0.05], rot: [-1.5, 0, 0.05], scale: 0.6 },
    block: { pos: [0.02, 0.03, 0.08], rot: [0.3, 0.6, 0], scale: 1 },
}

export class ViewModel {
    /**
     * @param {object} ctx
     * @param {import('noa-engine').Engine} ctx.noa
     * @param {import('../characters/library.js').CharacterLibrary} ctx.chars
     * @param {string} ctx.atlasURL block texture atlas (for the block in your hand)
     */
    constructor({ noa, chars, atlasURL }) {
        this.noa = noa
        this.chars = chars
        this.atlasURL = atlasURL
        const scene = noa.rendering.getScene()
        this.scene = scene
        // last group, with its own depth clear: the hands never poke into a wall
        scene.setRenderingAutoClearDepthStencil(RENDER_GROUP.hands, true, true, false)

        this.root = new TransformNode('viewmodel', scene)
        this.root.parent = noa.rendering.camera
        this.root.scaling.setAll(SCALE)
        this.pivot = new TransformNode('viewmodel-arm', scene)
        this.pivot.parent = this.root
        this.hand = new TransformNode('viewmodel-hand', scene)
        this.hand.parent = this.pivot
        this.hand.position.z = ARM.length / 2 + 0.04

        this.sleeveMat = this._material('vm-sleeve', '#3d8fd6')
        this.skinMat = this._material('vm-skin', '#e0ac7e')
        const arm = CreateBox('vm-arm', { width: ARM.width, height: ARM.width, depth: ARM.length }, scene)
        arm.material = this.sleeveMat
        arm.parent = this.pivot
        const fist = CreateBox('vm-hand', { size: ARM.width * 1.05 }, scene)
        fist.material = this.skinMat
        fist.parent = this.hand
        fist.position.z = -0.02
        this.parts = [arm, fist]

        // left hand, shown when you fight bare-handed or hold a bow
        this.offPivot = new TransformNode('viewmodel-arm2', scene)
        this.offPivot.parent = this.root
        const arm2 = CreateBox('vm-arm2', { width: ARM.width, height: ARM.width, depth: ARM.length }, scene)
        arm2.material = this.sleeveMat
        arm2.parent = this.offPivot
        const fist2 = CreateBox('vm-hand2', { size: ARM.width * 1.05 }, scene)
        fist2.material = this.skinMat
        fist2.parent = this.offPivot
        fist2.position.z = ARM.length / 2 + 0.04
        this.offParts = [arm2, fist2]

        this.trail = this._buildTrail()

        // muzzle flash for guns
        this.flash = CreatePlane('vm-flash', { size: 0.26 }, scene)
        this.flashMat = this._material('vm-flash-mat', '#ffe08a')
        this.flashMat.disableLighting = true
        this.flashMat.emissiveColor = col('#ffe08a')
        this.flashMat.alpha = 0
        this.flash.material = this.flashMat
        this.flash.parent = this.hand

        for (const m of [...this.parts, ...this.offParts, this.trail, this.flash]) this._register(m)

        this.model = 'player'
        this.item = null
        this.tintKey = ''
        /** @type {number[]|null} */
        this.tint = null
        this.itemMesh = null
        this.blockMesh = null
        this.blockTile = null
        this.visible = false
        this.bob = 0
        /** the loop of the mining motion keeps going only while this is set */
        this.digging = false
        /** @type {{name: string, t: number} | null} */
        this.action = null
        this.flashTime = 0
        /** idle sway and walking bob of this frame, applied to every arm pose */
        this._sway = { aspect: 1, x: 0, y: 0, rx: 0, rz: 0 }
        /** the sword's transform relative to the arm, and its tip, for the trail */
        this._blade = null
        this.setVisible(false)
    }

    /** a strip of quads whose vertices are rewritten every frame of a slash */
    _buildTrail() {
        const n = TRAIL.samples
        const mesh = new Mesh('vm-trail', this.scene)
        const indices = []
        for (let i = 0; i < n - 1; i++) {
            const a = i * 2
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
        this._trailPos = new Float32Array(n * 2 * 3)
        this._trailCol = new Float32Array(n * 2 * 4)
        mesh.setVerticesData(VertexBuffer.PositionKind, this._trailPos, true)
        mesh.setVerticesData(VertexBuffer.ColorKind, this._trailCol, true, 4)
        mesh.setIndices(indices)
        mesh.hasVertexAlpha = true
        const mat = this._material('vm-trail-mat', '#ffffff')
        mat.disableLighting = true
        // with lighting off, emissive white passes the vertex colours through as they are
        mat.emissiveColor = new Color3(1, 1, 1)
        mat.backFaceCulling = false
        mat.disableDepthWrite = true
        mat.transparencyMode = Material.MATERIAL_ALPHABLEND
        mesh.material = mat
        mesh.parent = this.root
        return mesh
    }

    _material(name, hex) {
        const m = this.noa.rendering.makeStandardMaterial(name)
        m.diffuseColor = col(hex)
        m.specularColor = new Color3(0, 0, 0)
        m.fogEnabled = false
        return m
    }

    _register(mesh) {
        mesh.isPickable = false
        mesh.alwaysSelectAsActiveMesh = true
        mesh.renderingGroupId = RENDER_GROUP.hands
        this.noa.rendering.addMeshToScene(mesh)
    }

    /**
     * Whose arm and what's in it.
     * @param {string} model character model name
     * @param {string|null} item items.glb node name, or 'block'
     * @param {number[]|null} [tint] weapon tier tint
     * @param {string|null} [blockTile] atlas tile name when the item is a block
     * @param {boolean} [quiet] change it without the equip motion
     */
    setHand(model, item, tint = null, blockTile = null, quiet = false) {
        const tintKey = (tint ? tint.join(',') : '') + '|' + (blockTile || '')
        if (this.model === model && this.item === item && this.tintKey === tintKey) return
        const changed = this.item !== item || this.tintKey !== tintKey
        if (this.model !== model) {
            const c = armColors(model)
            this.sleeveMat.diffuseColor = col(c.sleeve)
            this.skinMat.diffuseColor = col(c.skin)
            this.model = model
        }
        this.item = item
        this.tintKey = tintKey
        this.tint = tint
        this.blockTile = blockTile
        this._blade = null
        this._buildItem(tint)
        if (changed && this.visible && !quiet) this.play('equip')
    }

    _buildItem(tint) {
        if (this.itemMesh) {
            this.itemMesh.dispose()
            this.itemMesh = null
        }
        const item = this.item
        if (!item) return
        if (item === 'block') {
            this._buildBlock()
            return
        }
        this.chars.loadItems().then((sources) => {
            if (this.item !== item || this.itemMesh) return
            const src = sources[item]
            if (!src) return
            const mesh = src.clone(`vm-${item}`, null, true)
            mesh.setEnabled(true)
            if (tint) mesh.material = this.chars.tintedMaterial(src.material, tint)
            const pose = ITEM_POSE[item] || ITEM_POSE.sword
            mesh.parent = this.hand
            mesh.position.set(pose.pos[0], pose.pos[1], pose.pos[2])
            mesh.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2])
            mesh.scaling.setAll(pose.scale)
            this._register(mesh)
            this.noa.rendering.setMeshVisibility(mesh, this.visible)
            this.itemMesh = mesh
        })
    }

    /** the block you're about to place, with its own texture */
    _buildBlock() {
        if (!this.blockMat) {
            this.blockMat = this._material('vm-block', '#ffffff')
            const tex = new Texture(this.atlasURL, this.scene, true, false, Texture.NEAREST_SAMPLINGMODE)
            tex.hasAlpha = true
            this.blockMat.diffuseTexture = tex
            this.blockMat.ambientColor = new Color3(1, 1, 1)
        }
        const mesh = CreateBox('vm-block', { size: 0.16 }, this.scene)
        mesh.material = this.blockMat
        const pose = ITEM_POSE.block
        mesh.parent = this.hand
        mesh.position.set(pose.pos[0], pose.pos[1], pose.pos[2])
        mesh.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2])
        // every face shows the block's own tile from the atlas strip
        const index = TILE_INDEX[this.blockTile] ?? 0
        const n = TILE_NAMES.length
        // the atlas is a vertical strip, tile 0 at the top; Babylon flips textures on upload
        const v0 = index / n, v1 = (index + 1) / n
        const uvs = []
        for (let face = 0; face < 6; face++) uvs.push(0, v0, 1, v0, 1, v1, 0, v1)
        mesh.setVerticesData('uv', uvs)
        this._register(mesh)
        this.noa.rendering.setMeshVisibility(mesh, this.visible)
        this.itemMesh = mesh
    }

    /** start a motion (see MOTIONS) */
    play(name) {
        if (!MOTIONS[name]) return
        if (name === 'mine' && this.action && this.action.name === 'mine') return
        this.action = { name, t: 0 }
        if (name === 'recoil') this.flashTime = 0.06
    }

    /** while set, the mining motion keeps chopping; once cleared it finishes the chop and stops */
    setDigging(on) {
        this.digging = on
    }

    /** where a projectile should start from: the tip of what you're holding */
    muzzle() {
        const node = this.itemMesh || this.hand
        const m = node.getWorldMatrix()
        const local = this.item === 'gun' ? new Vector3(0, 0.05, 0.45) : this.item === 'bow' ? new Vector3(0, 0, 0.15) : new Vector3(0, 0, 0.1)
        const w = Vector3.TransformCoordinates(local, m)
        return [w.x, w.y, w.z]
    }

    setVisible(on) {
        this.visible = on
        const r = this.noa.rendering
        for (const m of this.parts) r.setMeshVisibility(m, on)
        const twoHands = on && (!this.item || this.item === 'bow' || this.item === 'gun')
        for (const m of this.offParts) r.setMeshVisibility(m, twoHands)
        if (this.itemMesh) r.setMeshVisibility(this.itemMesh, on)
        if (!on) {
            r.setMeshVisibility(this.trail, false)
            r.setMeshVisibility(this.flash, false)
        }
    }

    /**
     * @param {number} dtMs
     * @param {{visible: boolean, speed?: number, grounded?: boolean}} state
     */
    render(dtMs, state) {
        const dt = dtMs / 1000
        if (state.visible !== this.visible) this.setVisible(state.visible)
        this.action = stepMotion(this.action, dt, this.digging)
        if (!this.visible) return
        const speed = state.speed || 0
        this.bob += dt * Math.min(12, speed * 2.2)
        const moving = speed > 0.5 ? Math.min(1, speed / 6) : 0
        // idle sway plus a walking bob
        const idle = Math.sin(performance.now() / 900)
        const w = this._sway
        // on a narrow (portrait) screen the hand would sit off to the side
        w.aspect = Math.max(0.4, Math.min(1, (window.innerWidth / window.innerHeight) / 1.4))
        w.x = Math.sin(this.bob) * 0.022 * moving
        w.y = idle * 0.006 - Math.abs(Math.cos(this.bob)) * 0.02 * moving
        w.rx = idle * 0.012
        w.rz = Math.sin(this.bob) * 0.03 * moving
        const a = this.action
        this._armPose(a ? MOTIONS[a.name].f(a.t / MOTIONS[a.name].time) : REST, this.pivot.position, this.pivot.rotation)
        const pp = this.pivot.position
        this.offPivot.position.set(-pp.x - 0.04 * w.aspect, pp.y, pp.z - 0.04)
        this.offPivot.rotation.set(this.pivot.rotation.x, 0.25, -this.pivot.rotation.z)

        this._renderTrail()
        const r = this.noa.rendering
        this.flashTime = Math.max(0, this.flashTime - dt)
        this.flashMat.alpha = this.flashTime > 0 ? 0.9 : 0
        r.setMeshVisibility(this.flash, this.flashTime > 0)
        if (this.flashTime > 0) this.flash.position.set(0, 0.04, 0.42)
    }

    /** the arm's pose for a motion offset, with this frame's sway and bob */
    _armPose(o, pos, rot) {
        const w = this._sway
        pos.set((HOME.x + (o.dx || 0)) * w.aspect + w.x, HOME.y + (o.dy || 0) + w.y, HOME.z + (o.dz || 0))
        rot.set(-0.3 + (o.rx || 0) + w.rx, (o.ry || 0) - 0.25, (o.rz || 0) + w.rz)
    }

    /**
     * The streak behind a sword's tip while it slashes. Its points are the tip
     * (and a point down the blade) at earlier moments of the same swing curve,
     * so it's smooth at any frame rate and always ends at the blade.
     */
    _renderTrail() {
        const a = this.action
        const r = this.noa.rendering
        const swinging = !!a && a.name === 'swing' && this.item === 'sword' && !!this.itemMesh
        const p = swinging ? a.t / MOTIONS.swing.time : 0
        const head = Math.min(p, SWING.slashEnd)
        // after the slash the tail catches up with the head, and it fades
        const tail = Math.max(SWING.windUp, p - TRAIL.span)
        const show = swinging && p > SWING.windUp && tail < head - 1e-3
        r.setMeshVisibility(this.trail, show)
        if (!show) return
        const fade = Math.max(0, 1 - ((p - SWING.slashEnd) * MOTIONS.swing.time) / TRAIL.fade)
        const blade = this._bladeFrame()
        const color = this.tint ? this.tint.map((v) => Math.min(1, 0.55 + 0.45 * v)) : [0.92, 0.95, 1]
        const n = TRAIL.samples
        const pos = this._trailPos, col = this._trailCol
        for (let i = 0; i < n; i++) {
            const k = i / (n - 1)
            this._armPose(MOTIONS.swing.f(tail + (head - tail) * k), tmpPos, tmpRot)
            Quaternion.RotationYawPitchRollToRef(tmpRot.y, tmpRot.x, tmpRot.z, tmpQ)
            Matrix.ComposeToRef(ONE, tmpQ, tmpPos, tmpM)
            blade.rel.multiplyToRef(tmpM, tmpM2)
            Vector3.TransformCoordinatesToRef(blade.tip, tmpM2, tmpA)
            Vector3.TransformCoordinatesToRef(blade.inner, tmpM2, tmpB)
            // narrows to a point at the tail
            Vector3.LerpToRef(tmpA, tmpB, k, tmpB)
            tmpA.toArray(pos, i * 6)
            tmpB.toArray(pos, i * 6 + 3)
            const alpha = TRAIL.alpha * Math.pow(k, 1.5) * fade
            for (let e = 0; e < 2; e++) {
                const o = i * 8 + e * 4
                col[o] = color[0]
                col[o + 1] = color[1]
                col[o + 2] = color[2]
                col[o + 3] = e === 0 ? alpha : alpha * 0.4
            }
        }
        this.trail.updateVerticesData(VertexBuffer.PositionKind, pos)
        this.trail.updateVerticesData(VertexBuffer.ColorKind, col)
    }

    /** the held sword relative to the arm, its tip, and a point down the blade (built once per item) */
    _bladeFrame() {
        if (this._blade) return this._blade
        const mesh = this.itemMesh
        const q = mesh.rotationQuaternion || Quaternion.RotationYawPitchRoll(mesh.rotation.y, mesh.rotation.x, mesh.rotation.z)
        const rel = Matrix.Compose(mesh.scaling, q, mesh.position).multiply(Matrix.Translation(this.hand.position.x, this.hand.position.y, this.hand.position.z))
        const bb = mesh.getBoundingInfo().boundingBox
        const cx = (bb.minimum.x + bb.maximum.x) / 2, cz = (bb.minimum.z + bb.maximum.z) / 2
        const tip = new Vector3(cx, bb.maximum.y, cz)
        const inner = new Vector3(cx, bb.maximum.y - (bb.maximum.y - bb.minimum.y) * TRAIL.inner, cz)
        this._blade = { rel, tip, inner }
        return this._blade
    }

    dispose() {
        this.root.dispose(false, true)
    }
}
