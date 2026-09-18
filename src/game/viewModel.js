/*
 *  First-person view model: the arm you hold things with, the item in it, and
 *  the motion of whatever you're doing (swing, mine, place, draw, recoil).
 *
 *  Everything is parented to the Babylon camera and drawn in rendering group 1
 *  with the depth buffer cleared, so it never clips into walls or units. The
 *  motions are procedural (no clips): each one is a curve over its own time.
 */

import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { armColors } from '../characters/contract.js'
import { TILE_INDEX, TILE_NAMES } from '../world/atlas.js'

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

/**
 * Motions: each returns an offset from the resting pose for progress p (0..1).
 * dx/dy/dz are camera-space metres, rx/ry/rz radians.
 */
const MOTIONS = {
    /** melee: wind up over the shoulder, slash down across the view */
    swing: { time: 0.3, f: (p) => (p < 0.3
        ? { dx: 0.05 * s(p / 0.3), dy: 0.1 * s(p / 0.3), dz: -0.12 * s(p / 0.3), rx: -0.7 * s(p / 0.3), rz: 0.5 * s(p / 0.3) }
        : { dx: 0.05 - 0.3 * s((p - 0.3) / 0.7), dy: 0.1 - 0.26 * s((p - 0.3) / 0.7), dz: -0.12 + 0.24 * s((p - 0.3) / 0.7), rx: -0.7 + 1.5 * s((p - 0.3) / 0.7), rz: 0.5 - 1.2 * s((p - 0.3) / 0.7) }) },
    /** mining: a shorter chop, played over and over while you dig */
    mine: { time: 0.42, loop: true, f: (p) => (p < 0.35
        ? { dy: 0.07 * s(p / 0.35), dz: -0.06 * s(p / 0.35), rx: -0.5 * s(p / 0.35) }
        : { dy: 0.07 - 0.13 * s((p - 0.35) / 0.65), dz: -0.06 + 0.12 * s((p - 0.35) / 0.65), rx: -0.5 + 0.9 * s((p - 0.35) / 0.65) }) },
    /** placing a block: a short push forward */
    place: { time: 0.22, f: (p) => ({ dz: 0.13 * bump(p), dy: -0.03 * bump(p), rx: 0.2 * bump(p) }) },
    /** bow: pull back, then snap forward on release */
    draw: { time: 0.32, f: (p) => (p < 0.7
        ? { dz: -0.16 * s(p / 0.7), dx: -0.03 * s(p / 0.7), rx: -0.12 * s(p / 0.7) }
        : { dz: -0.16 + 0.2 * s((p - 0.7) / 0.3), dx: -0.03 + 0.03 * s((p - 0.7) / 0.3), rx: -0.12 + 0.12 * s((p - 0.7) / 0.3) }) },
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
        // group 1 with its own depth clear: the hands never poke into a wall
        scene.setRenderingAutoClearDepthStencil(1, true, true, false)

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

        // slash arc, flashed during a melee swing
        this.arc = CreatePlane('vm-arc', { width: 0.7, height: 0.09 }, scene)
        this.arcMat = this._material('vm-arc-mat', '#ffffff')
        this.arcMat.alpha = 0
        this.arcMat.disableLighting = true
        this.arcMat.emissiveColor = new Color3(1, 1, 1)
        this.arc.material = this.arcMat
        this.arc.parent = this.root
        this.arc.position.set(0.12, -0.12, 0.95)
        this.arc.rotation.z = 0.7

        // muzzle flash for guns
        this.flash = CreatePlane('vm-flash', { size: 0.26 }, scene)
        this.flashMat = this._material('vm-flash-mat', '#ffe08a')
        this.flashMat.disableLighting = true
        this.flashMat.emissiveColor = col('#ffe08a')
        this.flashMat.alpha = 0
        this.flash.material = this.flashMat
        this.flash.parent = this.hand

        for (const m of [...this.parts, ...this.offParts, this.arc, this.flash]) this._register(m)

        this.model = 'player'
        this.item = null
        this.tintKey = ''
        this.itemMesh = null
        this.blockMesh = null
        this.blockTile = null
        this.visible = false
        this.bob = 0
        /** @type {{name: string, t: number} | null} */
        this.action = null
        this.arcTime = 0
        this.flashTime = 0
        this.setVisible(false)
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
        mesh.renderingGroupId = 1
        this.noa.rendering.addMeshToScene(mesh)
    }

    /**
     * Whose arm and what's in it.
     * @param {string} model character model name
     * @param {string|null} item items.glb node name, or 'block'
     * @param {number[]|null} [tint] weapon tier tint
     * @param {string|null} [blockTile] atlas tile name when the item is a block
     */
    setHand(model, item, tint = null, blockTile = null) {
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
        this.blockTile = blockTile
        this._buildItem(tint)
        if (changed && this.visible) this.play('equip')
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
        if (name === 'swing') this.arcTime = 0.16
        if (name === 'recoil') this.flashTime = 0.06
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
            r.setMeshVisibility(this.arc, false)
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
        if (!this.visible) return
        const speed = state.speed || 0
        this.bob += dt * Math.min(12, speed * 2.2)
        const moving = speed > 0.5 ? Math.min(1, speed / 6) : 0
        let o = { dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0 }
        const a = this.action
        if (a) {
            const spec = MOTIONS[a.name]
            a.t += dt
            const p = a.t / spec.time
            if (p >= 1) {
                if (spec.loop) a.t -= spec.time
                else this.action = null
            }
            if (this.action) Object.assign(o, spec.f(Math.min(1, a.t / spec.time)))
        }
        // idle sway plus a walking bob
        const idle = Math.sin(performance.now() / 900)
        // on a narrow (portrait) screen the hand would sit off to the side
        const aspect = Math.max(0.4, Math.min(1, (window.innerWidth / window.innerHeight) / 1.4))
        const x = (HOME.x + (o.dx || 0)) * aspect + Math.sin(this.bob) * 0.022 * moving
        const y = HOME.y + (o.dy || 0) + idle * 0.006 - Math.abs(Math.cos(this.bob)) * 0.02 * moving
        const z = HOME.z + (o.dz || 0)
        this.pivot.position.set(x, y, z)
        this.pivot.rotation.set(-0.3 + (o.rx || 0) + idle * 0.012, (o.ry || 0) - 0.25, (o.rz || 0) + Math.sin(this.bob) * 0.03 * moving)
        this.offPivot.position.set(-x - 0.04 * aspect, y, z - 0.04)
        this.offPivot.rotation.set(this.pivot.rotation.x, 0.25, -this.pivot.rotation.z)

        const r = this.noa.rendering
        this.arcTime = Math.max(0, this.arcTime - dt)
        this.arcMat.alpha = this.arcTime > 0 ? Math.min(0.45, this.arcTime * 3) : 0
        r.setMeshVisibility(this.arc, this.arcTime > 0)
        if (this.arcTime > 0) this.arc.rotation.z = 1.0 - (1 - this.arcTime / 0.16) * 1.7
        this.flashTime = Math.max(0, this.flashTime - dt)
        this.flashMat.alpha = this.flashTime > 0 ? 0.9 : 0
        r.setMeshVisibility(this.flash, this.flashTime > 0)
        if (this.flashTime > 0) this.flash.position.set(0, 0.04, 0.42)
    }

    dispose() {
        this.root.dispose(false, true)
    }
}
