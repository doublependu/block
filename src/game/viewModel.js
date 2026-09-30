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
import { armColors, companionItem } from '../characters/contract.js'
import { TILE_INDEX, TILE_NAMES } from '../world/atlas.js'
import { RENDER_GROUP } from '../core/constants.js'
import { SCALE, ARM, MOTIONS, stepMotion, strikes, ITEM_POSE, NOCK, poseFor, armPose, itemRotation, wristRoll, drawPull, drawOffset } from './handPose.js'

/** hex string to a Color3 */
const col = (hex) => Color3.FromHexString(hex)

/**
 * The trail a sword leaves on the slash: `samples` points along the curve over
 * the last `span` of the swing (a share of its time), from the blade tip to
 * `inner` of the way down the blade, fading and narrowing toward the tail.
 * The shape is the same for every tier; how long, how wide and what colour is
 * not (a wooden sword barely streaks, an iron one carries a bright edge).
 */
const TRAIL = { samples: 14, fade: 0.06 }
const TRAIL_TIER = {
    swing: { span: 0.18, inner: 0.5, alpha: 0.38, color: [0.95, 0.9, 0.78] },
    swing_heavy: { span: 0.26, inner: 0.25, alpha: 0.42, color: [0.78, 0.8, 0.84] },
    swing_flourish: { span: 0.3, inner: 0.4, alpha: 0.6, color: [0.85, 0.95, 1] },
}

/** the tiers are their own meshes, and all of them streak */
const isBlade = (item) => !!item && item.endsWith('sword')
const isBow = (item) => !!item && item.endsWith('bow')

/**
 * The iron sword's gleam: every `every` seconds of holding it still, a glint
 * runs up the blade (item space: from `from` to `to` along the blade) in `time`.
 */
const GLEAM = { every: 3.2, time: 0.4, from: 0.2, to: 1.0, alpha: 0.75 }

/** a bow string after the loose: how far it shivers (m), how fast, and how quickly it dies */
const SHIVER = { amp: 0.008, freq: 70, decay: 14 }

/** the war bow's bolt glows, which is also what says it pierces armour */
const BOLT_TINT = [1.3, 1.5, 1.8]

const REST = {}
const ONE = new Vector3(1, 1, 1)
const tmpPos = new Vector3()
const tmpRot = new Vector3()
const tmpQ = new Quaternion()
const tmpM = new Matrix()
const tmpM2 = new Matrix()
const tmpA = new Vector3()
const tmpB = new Vector3()


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

        // the iron sword's gleam: a glint that runs up the blade now and then while it's held still
        this.gleam = CreatePlane('vm-gleam', { width: 0.15, height: 0.035 }, scene)
        // a slanted streak rather than a band
        this.gleam.rotation.z = 0.7
        this.gleamMat = this._material('vm-gleam-mat', '#ffffff')
        this.gleamMat.disableLighting = true
        this.gleamMat.emissiveColor = new Color3(1, 1, 1)
        this.gleamMat.backFaceCulling = false
        this.gleamMat.alpha = 0
        this.gleam.material = this.gleamMat
        this.gleamIn = GLEAM.every
        this.gleamT = -1

        for (const m of [...this.parts, ...this.offParts, this.trail, this.flash, this.gleam]) this._register(m)

        this.model = 'player'
        this.item = null
        this.tintKey = ''
        /** @type {number[]|null} */
        this.tint = null
        this.itemMesh = null
        /** a bow's string, and the arrow sitting on it: both move with the draw */
        this.stringMesh = null
        this.nockMesh = null
        this.blockMesh = null
        this.blockTile = null
        this.visible = false
        this.bob = 0
        /** the loop of the mining motion keeps going only while this is set */
        this.digging = false
        /** chops that have landed so far (the mining motion passing its impact): what the dig sound keeps time with */
        this.strikes = 0
        /** @type {import('./handPose.js').Motion | null} */
        this.action = null
        this.flashTime = 0
        /** idle sway and walking bob of this frame, applied to every arm pose */
        this._sway = { aspect: 1, x: 0, y: 0, rx: 0, rz: 0 }
        /** the sword's transform relative to the arm, and its tip, for the trail */
        this._blade = null
        /** the wrist roll the held blade is turned to now (see wristRoll) */
        this._roll = 0
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
        this._roll = 0
        this._buildItem(tint)
        if (changed && this.visible && !quiet) this.play('equip')
    }

    _buildItem(tint) {
        // the gleam rides on the blade: take it off before the old item goes (disposing takes the children)
        this.gleam.parent = this.hand
        for (const key of ['itemMesh', 'stringMesh', 'nockMesh']) {
            if (this[key]) {
                this[key].dispose()
                this[key] = null
            }
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
            this.itemMesh = this._cloneItem(src, item, poseFor(item), tint)
            // a bow's string and the arrow on it move with the draw, not with the stave
            const string = companionItem(item)
            if (string && sources[string]) this.stringMesh = this._cloneItem(sources[string], string, poseFor(string), tint)
            if (string && sources.arrow) {
                const home = poseFor(item)
                this.nockMesh = this._cloneItem(sources.arrow, 'nock',
                    { ...NOCK, pos: [home.pos[0] + NOCK.side, home.pos[1] + NOCK.lift, home.pos[2] + NOCK.ahead] }, item === 'war_bow' ? BOLT_TINT : null)
                this.noa.rendering.setMeshVisibility(this.nockMesh, false)
            }
        })
    }

    /** one item mesh, cloned out of items.glb and parked on the hand */
    _cloneItem(src, name, pose, tint) {
        const mesh = src.clone(`vm-${name}`, null, true)
        mesh.setEnabled(true)
        if (tint) mesh.material = this.chars.tintedMaterial(src.material, tint)
        mesh.parent = this.hand
        mesh.position.set(pose.pos[0], pose.pos[1], pose.pos[2])
        // replaces the rotation quaternion a mesh loaded from glTF carries (see itemRotation)
        mesh.rotationQuaternion = itemRotation(pose)
        mesh.scaling.setAll(pose.scale)
        this._register(mesh)
        this.noa.rendering.setMeshVisibility(mesh, this.visible)
        return mesh
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
        const spec = MOTIONS[name]
        if (!spec) return
        if (name === 'mine' && this.action && this.action.name === 'mine') return
        // a mirroring swing alternates, so holding the button reads as a combo
        const mirror = !!spec.mirror && !(this.action && this.action.name === name && this.action.mirror)
        this.action = { name, t: 0, mirror }
        if (name === 'recoil') this.flashTime = 0.06
    }

    /** hold a motion at progress p (0..1), or rest with null: for tools/autoplay/showcase.mjs */
    pose(name, p = 0) {
        this.action = name && MOTIONS[name] ? { name, t: p * MOTIONS[name].time, mirror: false } : null
    }

    /** while set, the mining motion keeps chopping; once cleared it finishes the chop and stops */
    setDigging(on) {
        this.digging = on
    }

    /** where a projectile should start from: the tip of what you're holding */
    muzzle() {
        const node = this.itemMesh || this.hand
        const m = node.getWorldMatrix()
        const local = this.item === 'gun' ? new Vector3(0, 0.05, 0.45) : isBow(this.item) ? new Vector3(0, 0, -0.15) : new Vector3(0, 0, 0.1)
        const w = Vector3.TransformCoordinates(local, m)
        return [w.x, w.y, w.z]
    }

    setVisible(on) {
        this.visible = on
        const r = this.noa.rendering
        for (const m of this.parts) r.setMeshVisibility(m, on)
        const twoHands = on && (!this.item || isBow(this.item) || this.item === 'gun')
        for (const m of this.offParts) r.setMeshVisibility(m, twoHands)
        if (this.itemMesh) r.setMeshVisibility(this.itemMesh, on)
        if (this.stringMesh) r.setMeshVisibility(this.stringMesh, on)
        if (this.nockMesh && !on) r.setMeshVisibility(this.nockMesh, false)
        if (!on) {
            r.setMeshVisibility(this.trail, false)
            r.setMeshVisibility(this.flash, false)
            r.setMeshVisibility(this.gleam, false)
        }
    }

    /**
     * @param {number} dtMs
     * @param {{visible: boolean, speed?: number, grounded?: boolean}} state
     */
    render(dtMs, state) {
        const dt = dtMs / 1000
        if (state.visible !== this.visible) this.setVisible(state.visible)
        const was = this.action && this.action.name === 'mine' ? this.action.t / MOTIONS.mine.time : -1
        this.action = stepMotion(this.action, dt, this.digging)
        if (was >= 0) {
            const now = this.action && this.action.name === 'mine' ? this.action.t / MOTIONS.mine.time : 1
            if (strikes(was, now, MOTIONS.mine.impact)) this.strikes++
        }
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
        const o = a ? MOTIONS[a.name].f(a.t / MOTIONS[a.name].time) : REST
        this._armPose(o, this.pivot.position, this.pivot.rotation, a && a.mirror)
        // a blade turns in the wrist as it swings, so the edge leads the cut
        if (this.itemMesh && this.itemMesh.rotationQuaternion && isBlade(this.item)) {
            const roll = wristRoll(o, a && a.mirror)
            if (roll !== this._roll) {
                this._roll = roll
                itemRotation(poseFor(this.item), roll, this.itemMesh.rotationQuaternion)
            }
        }
        const pp = this.pivot.position
        this.offPivot.position.set(-pp.x - 0.04 * w.aspect, pp.y, pp.z - 0.04)
        this.offPivot.rotation.set(this.pivot.rotation.x, 0.25, -this.pivot.rotation.z)

        this._renderTrail()
        this._renderBow()
        this._renderGleam(dt)
        const r = this.noa.rendering
        this.flashTime = Math.max(0, this.flashTime - dt)
        this.flashMat.alpha = this.flashTime > 0 ? 0.9 : 0
        r.setMeshVisibility(this.flash, this.flashTime > 0)
        if (this.flashTime > 0) this.flash.position.set(0, 0.04, 0.42)
    }

    /** the arm's pose for a motion offset, with this frame's sway and bob (see armPose) */
    _armPose(o, pos, rot, mirror = false) {
        armPose(o, this._sway, mirror, pos, rot)
    }

    /**
     * A bow being drawn: an arrow appears on the string, and the string (with
     * the arrow on it) comes back with the hand and snaps forward on the loose.
     * Nothing else about the stave moves, which is what makes the pull read.
     */
    _renderBow() {
        const string = this.stringMesh
        if (!string) return
        const r = this.noa.rendering
        const a = this.action
        const spec = a ? MOTIONS[a.name] : null
        const k = spec && spec.draw && isBow(this.item) ? spec.draw : null
        const pull = k ? k.pull * drawPull(k, a.t / spec.time) : 0
        const home = poseFor(this.item).pos
        // loosed: the string shivers back and forth and settles
        const since = k ? a.t - k.hold * spec.time : -1
        const shiver = since > 0 ? SHIVER.amp * Math.exp(-since * SHIVER.decay) * Math.sin(since * SHIVER.freq) : 0
        string.position.z = home[2] + drawOffset(pull) + shiver
        // a drawn string spans a little less of the stave
        string.scaling.y = string.scaling.x * (1 - 0.1 * (pull / (k ? k.pull : 1) || 0))
        if (!this.nockMesh) return
        const drawn = !!k && pull > 0.001
        r.setMeshVisibility(this.nockMesh, drawn && this.visible)
        if (drawn) this.nockMesh.position.z = home[2] + NOCK.ahead + drawOffset(pull)
    }

    /** the glint up the iron blade, between swings */
    _renderGleam(dt) {
        const r = this.noa.rendering
        const blade = this.item === 'iron_sword' && this.itemMesh && this.visible && !this.action
        if (!blade) {
            this.gleamIn = GLEAM.every
            this.gleamT = -1
            r.setMeshVisibility(this.gleam, false)
            return
        }
        if (this.gleam.parent !== this.itemMesh) this.gleam.parent = this.itemMesh
        if (this.gleamT < 0) {
            this.gleamIn -= dt
            if (this.gleamIn <= 0) this.gleamT = 0
            r.setMeshVisibility(this.gleam, false)
            return
        }
        this.gleamT += dt
        const p = this.gleamT / GLEAM.time
        if (p >= 1) {
            this.gleamT = -1
            this.gleamIn = GLEAM.every
            r.setMeshVisibility(this.gleam, false)
            return
        }
        // just off the face of the blade, turned to lie along it
        this.gleam.position.set(0, GLEAM.from + (GLEAM.to - GLEAM.from) * p, -0.03)
        this.gleamMat.alpha = GLEAM.alpha * Math.sin(Math.PI * p)
        r.setMeshVisibility(this.gleam, true)
    }

    /**
     * The streak behind a sword's tip while it slashes. Its points are the tip
     * (and a point down the blade) at earlier moments of the same swing curve,
     * so it's smooth at any frame rate and always ends at the blade.
     */
    _renderTrail() {
        const a = this.action
        const r = this.noa.rendering
        const spec = a ? MOTIONS[a.name] : null
        const tier = a ? TRAIL_TIER[a.name] : null
        if (!spec || !spec.swing || !tier || !this.itemMesh || !isBlade(this.item)) {
            r.setMeshVisibility(this.trail, false)
            return
        }
        const k = spec.swing
        const p = a.t / spec.time
        const head = Math.min(p, k.slashEnd)
        // after the slash the tail catches up with the head, and it fades
        const tail = Math.max(k.windUp, p - tier.span)
        const show = p > k.windUp && tail < head - 1e-3
        r.setMeshVisibility(this.trail, show)
        if (!show) return
        const fade = Math.max(0, 1 - ((p - k.slashEnd) * spec.time) / TRAIL.fade)
        const blade = this._bladeFrame(tier.inner)
        const color = tier.color
        const n = TRAIL.samples
        const pos = this._trailPos, col = this._trailCol
        for (let i = 0; i < n; i++) {
            const k = i / (n - 1)
            this._armPose(spec.f(tail + (head - tail) * k), tmpPos, tmpRot, a.mirror)
            Quaternion.RotationYawPitchRollToRef(tmpRot.y, tmpRot.x, tmpRot.z, tmpQ)
            Matrix.ComposeToRef(ONE, tmpQ, tmpPos, tmpM)
            blade.rel.multiplyToRef(tmpM, tmpM2)
            Vector3.TransformCoordinatesToRef(blade.tip, tmpM2, tmpA)
            Vector3.TransformCoordinatesToRef(blade.inner, tmpM2, tmpB)
            // narrows to a point at the tail
            Vector3.LerpToRef(tmpA, tmpB, k, tmpB)
            tmpA.toArray(pos, i * 6)
            tmpB.toArray(pos, i * 6 + 3)
            const alpha = tier.alpha * Math.pow(k, 1.5) * fade
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

    /**
     * The held sword relative to the arm, its tip, and a point `innerShare` of
     * the way down the blade (the trail's inner edge). Built once per item: the
     * tier decides both the mesh and the share, so it never changes under us.
     */
    _bladeFrame(innerShare) {
        if (this._blade) return this._blade
        const mesh = this.itemMesh
        const q = mesh.rotationQuaternion || Quaternion.RotationYawPitchRoll(mesh.rotation.y, mesh.rotation.x, mesh.rotation.z)
        const rel = Matrix.Compose(mesh.scaling, q, mesh.position).multiply(Matrix.Translation(this.hand.position.x, this.hand.position.y, this.hand.position.z))
        const bb = mesh.getBoundingInfo().boundingBox
        const cx = (bb.minimum.x + bb.maximum.x) / 2, cz = (bb.minimum.z + bb.maximum.z) / 2
        const tip = new Vector3(cx, bb.maximum.y, cz)
        const inner = new Vector3(cx, bb.maximum.y - (bb.maximum.y - bb.minimum.y) * innerShare, cz)
        this._blade = { rel, tip, inner }
        return this._blade
    }

    dispose() {
        this.root.dispose(false, true)
    }
}
