/*
 *  Player control modes:
 *
 *    self     you control your builder: mine and build by day, fight with your
 *             weapon at night
 *    aerial   detached overhead camera: watch, place from above, pick a unit
 *    possess  play as a defender or attacker NPC (dusk and night only)
 *    dead     controlled unit died: waiting for a role choice
 *
 *  Whenever you're not in self mode during a fight, the builder fights on its
 *  own (autopilot, see UnitManager._thinkHero). From dawn on you're always
 *  brought back to your builder.
 *
 *  Handles keyboard/mouse bindings and touch buttons for all modes.
 */

import { EventEmitter } from 'events'
import { Matrix } from '@babylonjs/core/Maths/math.vector'
// side effect: adds scene.createPickingRay
import '@babylonjs/core/Culling/ray'
import { REACH, PLAYER_MINE_SPEED, PLAYER_SPEED, PLAYER_GAIT, ITEMS, WEAPONS } from './balance.js'
import { getSetting, setSetting } from '../core/settings.js'
import { ViewModel } from './viewModel.js'
import { ITEM_TILE } from '../world/atlas.js'
import { BLOCK_BY_ID, dustColor } from '../world/blocks.js'
import { HOTBAR_SIZE } from './inventory.js'
import { soundMaterial } from '../audio/audio.js'
import { lerpAngle, meleeClear, chest } from './units.js'
import { canChooseRole } from './cycle.js'
import { pressAction } from './placing.js'
import { AERIAL, cameraPos, screenDir, viewDir, reanchor, zoomStep, panAxis, liftFrame, motionFrom } from './aerialCam.js'

/** what the touch fire button does with each item in hand (any tier of it) */
const FIRE_ICON = { sword: '⚔', bow: '🏹', gun: '✷', pickaxe: '⛏', block: '⛏' }
const fireIcon = (item) => (item == null ? '✊'
    : FIRE_ICON[item] || (item.endsWith('sword') ? FIRE_ICON.sword : item.endsWith('bow') ? FIRE_ICON.bow : '⛏'))

/** digging shows the pickaxe in your hand, and keeps it there this long after (s) */
const DIG_SHOW = 0.35

/** a possessed NPC walks and runs at these multiples of its own speed */
const POSSESSED_GAIT = { walk: 0.55, run: 1.25 }

/** a second W within this long latches the run on (ms) */
const DOUBLE_TAP = 280

/** running widens the view by this much, over this long (s) */
const RUN_FOV = 0.05
const RUN_FOV_EASE = 0.15

/**
 * a noa pick result as blocks (copied: noa reuses its result object)
 * @returns {null | {position: number[], adjacent: number[], normal: number[]}}
 */
function blockHit(hit) {
    if (!hit) return null
    const p = hit.position, n = hit.normal
    // the hit point is nudged off the face it struck, so it floors to the air block in front
    const adjacent = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])]
    return { adjacent, normal: [n[0], n[1], n[2]], position: [adjacent[0] - n[0], adjacent[1] - n[1], adjacent[2] - n[2]] }
}

export class Control extends EventEmitter {
    /** @param {any} s session */
    constructor(s) {
        super()
        this.s = s
        const noa = s.noa
        this.noa = noa
        /** @type {'self'|'aerial'|'possess'|'dead'} */
        this.mode = 'self'
        this.controlled = s.player
        this.thirdPerson = false
        this.mining = null
        /** a chop is playing (on a block, or at thin air) */
        this.chopping = false
        /** aerial camera: see aerialCam.js. tx/tz: where a click-pan is heading */
        this.aerial = { x: 0.5, y: 10, z: 0.5, zoom: 40, shown: 40, lift: 0, liftV: 0, heading: 0.6, pitch: 0.95, tx: undefined, tz: undefined }
        /** the aerial pivot sits on what's in the middle of the screen (until the camera pans or glides) */
        this._anchored = false
        /** the aerial rig last frame (for how it's moving; see liftFrame) */
        this._camPrev = motionFrom(this.aerial)
        this._groundAt = (x, z) => s.world.surfaceY(x, z)
        this._solidAt = (x, y, z) => noa.world.getBlockSolidity(x, y, z)
        /** the white square on a block face (see _updateHighlight) */
        this._hl = { on: false, p: [0, 0, 0], n: [0, 0, 0], dist: 0 }
        /** the aerial build target under the cursor, and what it was worked out from */
        this._aim = { key: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN], hit: null }
        s.world.on('blockChanged', () => (this._aim.key[0] = NaN))
        /** automatic aerial camera move (framing an attack), cancelled by player input */
        this.glide = null
        /** slow circle around the town center (opening raid aftermath) */
        this.orbit = null
        /** when the player last moved the aerial camera (ms) */
        this.cameraTouched = -Infinity
        this.cursor = { x: window.innerWidth / 2, y: window.innerHeight / 2, over: false }
        this.dragging = null
        this.touchFire = false
        this.uiOpen = false
        /** the builder was knocked out while you controlled it: take it back when it gets up */
        this.autoReturn = false
        this.shakeT = 0
        this._shakeH = 0
        this._shakeP = 0
        /** what you see in your own hands in first person */
        this.view = new ViewModel({ noa, chars: s.chars, atlasURL: s._atlasURL })
        this._fireIcon = ''
        this._digShow = 0
        /** walking is the default; Shift, a double-tapped W or a touch stick at the rim runs */
        this.run = { latched: false, tapAt: -Infinity }
        this.touchRun = false
        this.running = false
        this.alwaysRun = getSetting('alwaysRun')
        /** eased 0..1 run feedback on the camera */
        this._runEase = 0
        this._baseFov = noa.rendering.camera.fov

        const inputs = noa.inputs
        inputs.unbind('mid-fire')
        inputs.bind('sprint', 'ShiftLeft', 'ShiftRight')
        inputs.bind('swap', 'KeyQ', 'Mouse2')
        inputs.bind('view', 'KeyV')
        inputs.bind('aerial', 'KeyM')
        inputs.bind('inventory', 'KeyB', 'KeyI')
        inputs.bind('pause', 'KeyP', 'Escape')
        inputs.bind('ready', 'KeyN')
        inputs.bind('role', 'KeyR')
        inputs.bind('help', 'KeyH')
        inputs.bind('rotl', 'KeyZ')
        inputs.bind('rotr', 'KeyC')
        for (let i = 1; i <= HOTBAR_SIZE; i++) inputs.bind('slot' + i, 'Digit' + i)

        inputs.down.on('fire', () => this._firePressed())
        inputs.down.on('alt-fire', () => this._altFire())
        inputs.down.on('view', () => this.toggleView())
        inputs.down.on('aerial', () => this.toggleAerial())
        inputs.down.on('inventory', () => s.hud.togglePanel('build'))
        inputs.down.on('pause', () => s.hud.openPanel('pause'))
        inputs.down.on('ready', () => s.requestNight())
        inputs.down.on('role', () => s.openRolePicker())
        inputs.down.on('help', () => s.hud.togglePanel('help'))
        inputs.down.on('swap', () => {
            if (this.mode === 'self' && !this.uiOpen) s.inventory.swapTool()
        })
        // a second W in quick succession latches the run on, until W is let go
        inputs.down.on('forward', () => {
            const now = performance.now()
            if (now - this.run.tapAt < DOUBLE_TAP) this.run.latched = true
            this.run.tapAt = now
        })
        inputs.up.on('forward', () => (this.run.latched = false))
        for (let i = 1; i <= HOTBAR_SIZE; i++) inputs.down.on('slot' + i, () => s.inventory.select(i - 1))

        // aerial mouse handling (cursor visible, no pointer lock)
        const canvas = noa.container.canvas
        this.canvas = canvas
        canvas.addEventListener('pointermove', (e) => {
            this.cursor.x = e.clientX
            this.cursor.y = e.clientY
            this.cursor.over = true
            if (this.dragging && this.mode === 'aerial' && e.pointerType === 'mouse') {
                const dx = e.clientX - this.dragging.x, dy = e.clientY - this.dragging.y
                if (Math.abs(dx) + Math.abs(dy) > 3) this.dragging.moved = true
                if (this.dragging.moved) this._cameraInput()
                this.dragging.x = e.clientX
                this.dragging.y = e.clientY
                if (this.dragging.moved) this.lookDelta(dx, dy)
            }
        })
        canvas.addEventListener('pointerdown', (e) => {
            if (this.mode === 'aerial' && e.pointerType === 'mouse') this.dragging = { x: e.clientX, y: e.clientY, moved: false, button: e.button }
        })
        window.addEventListener('pointerup', (e) => {
            if (this.dragging && this.mode === 'aerial' && e.pointerType === 'mouse' && !this.dragging.moved) {
                if (this.dragging.button === 0) this.aerialClick(e.clientX, e.clientY)
                else if (this.dragging.button === 2) this.aerialPlace(e.clientX, e.clientY)
            }
            this.dragging = null
        })
        canvas.addEventListener('pointerleave', () => (this.cursor.over = false))
        this._rect = canvas.getBoundingClientRect()
        window.addEventListener('resize', () => {
            this._rect = canvas.getBoundingClientRect()
            this._aim.key[0] = NaN
        })
        canvas.addEventListener('contextmenu', (e) => e.preventDefault())

        // keep pointer lock only where it makes sense
        noa.container.on('lostPointerLock', () => {
            if (this.mode !== 'aerial' && !this.uiOpen && !s.touch.enabled) s.hud.openPanel('pause')
        })
    }

    get canPointerLock() {
        return this.mode !== 'aerial' && !this.uiOpen
    }

    /**
     * Whether whoever you control should be running. Shift is the one that the
     * `alwaysRun` setting flips: latching W and the touch stick always mean run.
     */
    get sprinting() {
        const shift = !!this.noa.inputs.state.sprint
        if (this.alwaysRun) return !shift
        return shift || this.run.latched || this.touchRun
    }

    /** from the settings checkbox: remembered for next time */
    setAlwaysRun(on) {
        this.alwaysRun = on
        setSetting('alwaysRun', on)
    }

    /** true when game (not UI) should react to mouse buttons */
    get inputActive() {
        const c = this.noa.container
        if (this.uiOpen) return false
        if (this.s.touch.enabled) return true
        return !c.supportsPointerLock || c.hasPointerLock
    }

    setUiOpen(open) {
        this.uiOpen = open
        this.noa.container._shell.stickyPointerLock = !open && this.mode !== 'aerial'
        if (open && document.pointerLockElement) document.exitPointerLock()
        // closed with a key or a click: take the mouse back in the same event, so there's
        // no extra click on the game (the browser only allows it during a user action)
        const act = /** @type {any} */ (navigator).userActivation
        if (!open && (this.mode === 'self' || this.mode === 'possess') && !this.s.touch.enabled && (!act || act.isActive)) {
            this.noa.container.setPointerLock(true)
        }
        if (open) {
            const st = this.noa.inputs.state
            st.fire = st['alt-fire'] = false
        }
    }

    // ---- mode switching ----------------------------------------------------------

    _setInputsOn(entity) {
        const ents = this.noa.entities
        for (const u of this.s.units.units) {
            if (ents.hasComponent(u.entity, ents.names.receivesInputs) && u.entity !== entity) {
                ents.removeComponent(u.entity, ents.names.receivesInputs)
                const mv = ents.getMovement(u.entity)
                if (mv) mv.running = mv.jumping = false
            }
        }
        if (entity >= 0 && !ents.hasComponent(entity, ents.names.receivesInputs)) ents.addComponent(entity, ents.names.receivesInputs)
    }

    _follow(entity, height) {
        const ents = this.noa.entities
        const target = this.noa.camera.cameraTarget
        if (ents.hasComponent(target, 'followsEntity')) ents.removeComponent(target, 'followsEntity')
        ents.addComponent(target, 'followsEntity', { entity, offset: [0, height * 0.9, 0] })
    }

    /** control your own builder (safe to call in any mode) */
    returnToSelf() {
        const s = this.s
        // the aerial camera looks steeply down; don't start first person staring at the ground
        if (this.mode === 'aerial') this.noa.camera.pitch = 0.1
        this._releaseUnit()
        this.mode = 'self'
        const p = s.player
        this.controlled = p
        p.possessed = true
        p.active = true
        p.moveTo = p.target = p.attackBlock = p.walk = null
        p.moveSpeed = null
        p.char.setVisible(true)
        const mv = this.noa.entities.getMovement(p.entity)
        if (mv) {
            mv.maxSpeed = PLAYER_SPEED
            mv.running = mv.jumping = false
        }
        this._setInputsOn(p.entity)
        this._follow(p.entity, 1.75)
        this.noa.camera.zoomDistance = this.thirdPerson ? 5 : 0
        this.noa.camera.keepOutOfTerrain = true
        this.noa.container._shell.stickyPointerLock = !this.uiOpen
        this.orbit = null
        this.glide = null
        this.autoReturn = false
        this.emit('mode', 'self')
    }

    enterAerial() {
        const s = this.s
        const noa = this.noa
        const from = this.controlled && this.controlled.alive ? s.units.posOf(this.controlled) : s.world.townCenter
        this._releaseUnit()
        this.mode = 'aerial'
        this.controlled = null
        this._setInputsOn(-1)
        const ents = noa.entities
        const target = noa.camera.cameraTarget
        if (ents.hasComponent(target, 'followsEntity')) ents.removeComponent(target, 'followsEntity')
        // the pivot's height is set here, at chest height of whoever you were, and from
        // then on it doesn't follow the ground: the camera flies at a fixed height
        const a = this.aerial
        a.x = from[0]
        a.z = from[2]
        a.y = Math.max(from[1] + 1, 2)
        a.heading = noa.camera.heading
        a.pitch = 0.9
        a.zoom = 38
        // pull back out from where the camera is now
        a.shown = noa.camera.currentZoom
        a.lift = a.liftV = 0
        a.tx = a.tz = undefined
        this._anchored = false
        this._camPrev = motionFrom(a)
        this.glide = null
        // noa would pull the camera in (tens of blocks in one frame) whenever the pivot is
        // inside a roof, a tree or a hill, or one is in between; the lift keeps it clear instead
        noa.camera.keepOutOfTerrain = false
        // the builder is visible from above (first person hid it)
        s.player.char.setVisible(true)
        noa.container._shell.stickyPointerLock = false
        if (document.pointerLockElement) document.exitPointerLock()
        this.emit('mode', 'aerial')
    }

    _cameraInput() {
        this.cameraTouched = performance.now()
        this.glide = null
        this.orbit = null
    }

    /**
     * Swing the aerial camera to show an attack front and the town center:
     * looking from behind the town toward where the attackers come from.
     * Skipped when the player moved the camera in the last few seconds.
     * @param {number} angle front direction (heading convention)
     * @param {boolean} [force]
     * @param {{ahead?: number, zoom?: number, pitch?: number}} [o]
     */
    frameFront(angle, force = false, { ahead = 14, zoom = 50, pitch = 0.7 } = {}) {
        if (this.mode !== 'aerial') return
        if (!force && performance.now() - this.cameraTouched < 5000) return
        const tc = this.s.world.townCenter
        this._glideLevel(tc[1] + 1)
        this.glide = {
            x: tc[0] + 0.5 + Math.sin(angle) * ahead,
            z: tc[2] + 0.5 + Math.cos(angle) * ahead,
            heading: angle,
            zoom,
            pitch,
        }
    }

    /**
     * Before an automatic glide: put the pivot on the level of what the glide
     * frames (the camera doesn't move), so the glide's targets mean the same
     * wherever you entered aerial view from.
     */
    _glideLevel(y) {
        const a = this.aerial
        a.tx = a.tz = undefined
        reanchor(a, y)
        this._anchored = false
    }

    /** circle the town center slowly from above for a few seconds */
    orbitTown(seconds) {
        if (this.mode !== 'aerial') this.enterAerial()
        const tc = this.s.world.townCenter
        this._glideLevel(tc[1] + 1)
        this.orbit = { left: seconds }
        this.glide = { x: tc[0] + 0.5, z: tc[2] + 0.5, heading: this.aerial.heading, zoom: 34, pitch: 0.72 }
    }

    /** camera shake (explosions), 0..1 */
    shake(amount) {
        this.shakeT = Math.min(1, Math.max(this.shakeT, amount))
    }

    /** @param {import('./units.js').Unit} unit */
    possess(unit) {
        if (!unit || !unit.alive) return false
        if (unit.isPlayer) {
            this.returnToSelf()
            return true
        }
        if (!canChooseRole(this.s.cycle.phase)) return false
        this._releaseUnit()
        this.autoReturn = false
        const s = this.s
        this.mode = 'possess'
        this.controlled = unit
        unit.possessed = true
        unit.moveTo = null
        unit.target = null
        unit.walk = null
        this._setInputsOn(unit.entity)
        const mv = this.noa.entities.getMovement(unit.entity)
        if (mv) mv.maxSpeed = unit.def.speed * 1.25
        this._follow(unit.entity, unit.height)
        this.noa.camera.zoomDistance = this.thirdPerson ? 4.5 : 0
        this.noa.camera.keepOutOfTerrain = true
        this.noa.camera.heading = unit.yaw
        this.noa.camera.pitch = 0.1
        this.noa.container._shell.stickyPointerLock = true
        s.hud.toast(`You are now a ${unit.type} (${unit.side}). Your builder fights on its own — press R to switch back.`)
        this.emit('mode', 'possess', unit)
        return true
    }

    _releaseUnit() {
        const u = this.controlled
        if (u && !u.isPlayer) {
            u.possessed = false
            const mv = this.noa.entities.getMovement(u.entity)
            if (mv) {
                mv.running = mv.jumping = false
                mv.maxSpeed = u.def.speed
            }
            u.char.setVisible(true)
        }
        const p = this.s.player
        if (p) {
            p.possessed = false
            // the autopilot walks; controlled, the builder runs
            const mv = this.noa.entities.getMovement(p.entity)
            if (mv) mv.running = mv.jumping = false
        }
        this.mining = null
    }

    toggleView() {
        this.thirdPerson = !this.thirdPerson
        if (this.mode === 'self') this.noa.camera.zoomDistance = this.thirdPerson ? 5 : 0
        if (this.mode === 'possess') this.noa.camera.zoomDistance = this.thirdPerson ? 4.5 : 0
    }

    toggleAerial() {
        const s = this.s
        if (this.mode === 'aerial') {
            if (s.player.alive) this.returnToSelf()
            else s.openRolePicker()
        } else {
            this.enterAerial()
        }
    }

    // ---- look / camera -------------------------------------------------------------

    lookDelta(dx, dy) {
        const cam = this.noa.camera
        const k = 0.005
        if (this.mode === 'aerial') {
            // turn and tilt around what's in the middle of the screen
            this._cameraInput()
            this._anchorView()
            this.aerial.heading += dx * k
            this.aerial.pitch = Math.max(0.35, Math.min(1.45, this.aerial.pitch + dy * k))
        } else {
            cam.heading += dx * k
            cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch + dy * k))
        }
    }

    zoomBy(scale) {
        if (this.mode === 'aerial') this._zoomAerial(1 / scale)
    }

    /** aerial zoom: toward or away from what's in the middle of the screen */
    _zoomAerial(factor) {
        this._cameraInput()
        this._anchorView()
        this.aerial.zoom = zoomStep(this.aerial.zoom, factor)
    }

    /**
     * Put the aerial pivot on whatever is in the middle of the screen, sliding it
     * along the line of sight, so the camera doesn't move. Zooming, turning and
     * tilting then work around what you're looking at, not around a point in
     * the air or under a hill. Once until the camera next pans or glides.
     */
    _anchorView() {
        if (this._anchored) return
        this._anchored = true
        const a = this.aerial
        const eye = cameraPos(a)
        const hit = this.noa.pick(eye, viewDir(a.heading, a.pitch), a.shown + 200)
        if (!hit) return
        const g = hit.position
        // too close to anchor on (the camera is still pulling out)
        if (Math.hypot(g[0] - eye[0], g[1] - eye[1], g[2] - eye[2]) < 4) return
        reanchor(a, g[1])
    }

    /** world ray through a screen point */
    screenRay(x, y) {
        const scene = this.noa.rendering.getScene()
        const rect = this.canvas.getBoundingClientRect()
        // CSS pixels: createPickingRay applies the hardware scaling level itself
        const ray = scene.createPickingRay(x - rect.left, y - rect.top, Matrix.Identity(), scene.activeCamera)
        return { origin: [ray.origin.x, ray.origin.y, ray.origin.z], dir: [ray.direction.x, ray.direction.y, ray.direction.z] }
    }

    aerialClick(x, y) {
        const s = this.s
        const { origin, dir } = this.screenRay(x, y)
        const hit = s.units.unitOnRay(origin, dir, 150)
        if (hit && hit.unit.isPlayer) {
            this.returnToSelf()
            s.hud.closeRolePicker()
            return
        }
        if (hit && canChooseRole(s.cycle.phase)) {
            this.possess(hit.unit)
            s.hud.closeRolePicker()
            return
        }
        if (hit) {
            s.hud.toast(`${hit.unit.type}: ${Math.ceil(hit.unit.hp)}/${hit.unit.maxHp} hp`)
            return
        }
        // pan to the clicked block at the same height: put the pivot on the block's
        // level (the camera doesn't move), then slide sideways until it's in the middle
        const b = blockHit(this.noa.pick(origin, dir, 200))
        if (b) {
            this._cameraInput()
            const a = this.aerial
            reanchor(a, b.position[1] + 1)
            a.tx = b.position[0] + 0.5
            a.tz = b.position[2] + 0.5
        }
    }

    aerialPlace(x, y) {
        const t = this._aerialTarget(x, y)
        if (t) this.s.placeSelected(t.adjacent, t.position)
    }

    /**
     * The block face under a screen point in aerial view, and the air block a
     * build there fills. Worked out from the aerial camera's own state, so it
     * matches this frame (Babylon's camera is updated after this runs). Kept
     * until the point or the camera moves.
     * @returns {null | {position: number[], adjacent: number[], normal: number[]}}
     */
    _aerialTarget(x, y) {
        const a = this.aerial
        const aim = this._aim
        const k = aim.key
        if (k[0] === x && k[1] === y && k[2] === a.x && k[3] === a.y + a.lift && k[4] === a.z
            && k[5] === a.shown && k[6] === a.heading && k[7] === a.pitch) return aim.hit
        k[0] = x; k[1] = y; k[2] = a.x; k[3] = a.y + a.lift; k[4] = a.z
        k[5] = a.shown; k[6] = a.heading; k[7] = a.pitch
        const r = this._rect
        const w = r.width || window.innerWidth, h = r.height || window.innerHeight
        const nx = ((x - r.left) / w) * 2 - 1, ny = 1 - ((y - r.top) / h) * 2
        const dir = screenDir(a.heading, a.pitch, this.noa.rendering.camera.fov, w / h, nx, ny)
        aim.hit = blockHit(this.noa.pick(cameraPos(a), dir, a.shown + 200))
        return aim.hit
    }

    // ---- actions ---------------------------------------------------------------------

    _firePressed() {
        if (!this.inputActive) return
        const s = this.s
        if (this.mode === 'self' && s.cycle.phase === 'day') {
            // pick up own troops
            const eye = this.noa.camera.getTargetPosition()
            const dir = this.noa.camera.getDirection()
            const hit = s.units.unitOnRay(eye, dir, REACH, (u) => !u.isPlayer)
            if (hit && hit.unit.side === 'defender' && hit.unit.placementId) {
                s.pickUpUnit(hit.unit)
                return
            }
        }
        // start it now rather than on the next fixed tick, so the first frame
        // after the click already moves (dt 0: nothing gets dug by the press)
        if (this.mode === 'self' && s.player && s.player.alive) this._selfFire(0)
        else if (this.mode === 'possess' && this.controlled && this.controlled.alive && this.controlled.cooldown <= 0) this._unitAttack(this.controlled)
    }

    _altFire() {
        if (!this.inputActive) return
        const s = this.s
        if (this.mode === 'self') {
            const t = this.noa.targetedBlock
            if (t) s.placeSelected(t.adjacent, t.position)
        } else if (this.mode === 'aerial') {
            this.aerialPlace(this.cursor.x, this.cursor.y)
        }
    }

    /** touch button bridge */
    touchButton(name, down) {
        const st = this.noa.inputs.state
        if (name === 'jump') st.jump = down
        if (name === 'fire') {
            this.touchFire = down
            if (down) this._firePressed()
        }
        if (name === 'alt' && down) {
            if (this.mode === 'aerial') this.aerialPlace(window.innerWidth / 2, window.innerHeight / 2)
            else this._altFire()
        }
    }

    touchTap(x, y) {
        if (this.mode === 'aerial') {
            const s = this.s
            const { origin, dir } = this.screenRay(x, y)
            const hit = s.units.unitOnRay(origin, dir, 150)
            if (hit || s.cycle.phase !== 'day') this.aerialClick(x, y)
            else this.aerialPlace(x, y)
        }
    }

    /**
     * The weapon the builder fights with: the selected hotbar item if it's a
     * weapon; when there's no building to do, the best weapon owned.
     */
    get selfWeapon() {
        const inv = this.s.inventory
        return inv.selectedWeapon || (this.s.canEdit ? 'none' : inv.bestWeapon)
    }

    /** @param {number} dt seconds (fixed tick) */
    tick(dt) {
        const s = this.s
        const noa = this.noa
        const firing = this.inputActive && (noa.inputs.state.fire || this.touchFire)
        const u = this.controlled

        // from dawn on you're always your builder again
        if (!canChooseRole(s.cycle.phase) && (this.mode === 'possess' || this.mode === 'dead')) {
            this.returnToSelf()
            return
        }

        this.running = this.sprinting
        if (this.mode === 'self') {
            if (!s.player.alive) {
                this.mining = null
                this.chopping = false
                return
            }
            this._setSpeed(s.player, this.running ? PLAYER_GAIT.run : PLAYER_GAIT.walk)
            s.units.setPlayerWeapon(this.selfWeapon)
            if (firing) this._selfFire(dt)
            else {
                this.mining = null
                this.chopping = false
            }
        } else if (this.mode === 'possess') {
            if (!u || !u.alive) {
                this.mining = null
                this.chopping = false
                this.mode = 'dead'
                this._setInputsOn(-1)
                s.onControlledDied(u)
                return
            }
            this._setSpeed(u, u.def.speed * (this.running ? POSSESSED_GAIT.run : POSSESSED_GAIT.walk))
            if (firing && u.cooldown <= 0) this._unitAttack(u)
        }
    }

    /**
     * The gait comes from the body's actual speed (see nextGait), so walking and
     * running is a matter of what the movement component is allowed to reach.
     * @param {import('./units.js').Unit} u
     */
    _setSpeed(u, maxSpeed) {
        const mv = this.noa.entities.getMovement(u.entity)
        if (mv) mv.maxSpeed = maxSpeed
    }

    /**
     * The left button, held or just pressed. Always does something (see
     * pressAction): a swing or a chop plays even at thin air, and only a blow
     * that lands makes dust, damage or noise beyond the swoosh.
     * @param {number} dt seconds; 0 on the press itself, so the motion starts
     *   on the frame you clicked instead of on the next fixed tick
     */
    _selfFire(dt) {
        const s = this.s
        const noa = this.noa
        const p = s.player
        const eye = noa.camera.getTargetPosition()
        const dir = noa.camera.getDirection()
        const wname = this.selfWeapon
        const w = WEAPONS[wname]
        const hit = w.attack === 'melee' ? this._meleeTarget(p, w.range, eye, dir, (x) => x.side === 'attacker') : null
        const t = s.canEdit ? noa.targetedBlock : null
        const id = t ? noa.getBlock(t.position[0], t.position[1], t.position[2]) : 0
        const def = t ? BLOCK_BY_ID[id] : null
        const mineable = !!def && isFinite(def.hardness)
        const item = s.inventory.selectedItem
        const action = pressAction({
            kind: item ? ITEMS[item].kind : null,
            attack: w.attack,
            canEdit: s.canEdit,
            enemyInReach: !!hit,
            blockTargeted: mineable,
        })

        if (action === 'shoot') {
            this.mining = null
            this.chopping = false
            if (p.cooldown <= 0) {
                p.cooldown = w.cooldown
                this._shoot(p, w.attack, w.damage, 0, eye, dir)
            }
            return
        }
        if (action === 'attack') {
            this.mining = null
            this.chopping = false
            if (p.cooldown <= 0) {
                p.cooldown = w.cooldown
                this._playAction(p, 'attack')
                s.audio.swing(eye, hit ? 1 : 0.55)
                if (hit) {
                    s.units.damage(hit, w.damage, p)
                    // a heavier blade lands harder: the view jolts and it strikes chips
                    if (w.impact) {
                        this.shake(w.impact.shake)
                        s.effects.spray(chest(hit), w.impact.chips, [-dir[0], 0.5, -dir[2]], 5, 2.2, 0.07, 0.3)
                    }
                }
            }
            return
        }
        // mining: the chop loops whether or not there's a block under it
        this.chopping = true
        if (!mineable) {
            this.mining = null
            this._chop(p)
            return
        }
        const [x, y, z] = t.position
        const key = `${x},${y},${z}`
        if (!this.mining || this.mining.key !== key) {
            this.mining = { key, x, y, z, id, progress: 0, sound: 0 }
        }
        const m = this.mining
        const time = s.inventory.creative ? 0.12 : Math.max(0.1, def.hardness / PLAYER_MINE_SPEED)
        m.progress += dt / time
        m.sound -= dt
        this._chop(p)
        if (m.sound <= 0) {
            m.sound = 0.25
            s.audio.dig([x + 0.5, y + 0.5, z + 0.5], soundMaterial(def.name))
            // chips fly toward you while you dig
            s.effects.spray([x + 0.5, y + 0.5, z + 0.5], dustColor(def.name), [-dir[0], 0.4, -dir[2]], 3, 2, 0.09, 0.35)
        }
        if (m.progress >= 1) {
            this.mining = null
            s.breakBlock(x, y, z, id)
        }
    }

    /** the looping chop: the same motion on a block or at thin air */
    _chop(u) {
        if (!u.char.busy) this._playAction(u, 'mine', 1.2)
        else if (this.view.visible) this.view.play('mine')
    }

    /**
     * Play an action on the character, and the matching motion in first person.
     * @param {import('./units.js').Unit} u
     * @param {string} name mine | place | attack | shoot
     */
    _playAction(u, name, speed = 1) {
        // only the builder carries weapon tiers, and only the tiers have their
        // own clip and motion; everyone else plays the plain attack or shot
        const w = u.isPlayer ? WEAPONS[this.selfWeapon] : null
        const tiered = !!w && (name === 'attack' || name === 'shoot')
        u.char.playAction(tiered && w.clip ? w.clip : name, speed)
        if (!this.view.visible || u !== this.controlled) return
        const item = this.view.item
        this.view.play(name === 'mine' ? 'mine' : name === 'place' ? 'place'
            : tiered && w.motion ? w.motion
                : name === 'shoot' ? (item && item.endsWith('bow') ? 'draw' : 'recoil') : 'swing')
    }

    /**
     * enemy in front of the camera within melee range: on the crosshair, or close
     * and roughly ahead. Never through a wall (see meleeClear).
     */
    _meleeTarget(u, range, eye, dir, filter) {
        const s = this.s
        const noa = this.noa
        const pick = s.units._pick
        const from = chest(s.units.posOf(u), u.height)
        const hit = s.units.unitOnRay(eye, dir, range + 1.3 + noa.camera.currentZoom, filter)
        if (hit && meleeClear(pick, from, chest(s.units.posOf(hit.unit), hit.unit.height))) return hit.unit
        const p = s.units.posOf(u)
        const near = s.units.nearestEnemy(u, range + 0.8)
        if (!near || !filter(near)) return null
        const q = s.units.posOf(near)
        const ang = Math.atan2(q[0] - p[0], q[2] - p[2])
        let d = Math.abs(ang - noa.camera.heading) % (Math.PI * 2)
        if (d > Math.PI) d = Math.PI * 2 - d
        return d < 0.9 && meleeClear(pick, from, chest(q, near.height)) ? near : null
    }

    /** fire a projectile from a unit toward what the camera looks at */
    _shoot(u, kind, damage, blockDamage, eye, dir) {
        const s = this.s
        const p = s.units.posOf(u)
        this._playAction(u, 'shoot')
        // in first person the shot comes out of the weapon you can see, not out of the camera
        const from = this.view.visible && u === this.controlled
            ? this.view.muzzle()
            : [p[0], p[1] + u.height * 0.8, p[2]]
        // aim where the camera looks
        const b = this.noa.pick(eye, dir, 80)
        const dist = b ? Math.hypot(b.position[0] + 0.5 - eye[0], b.position[1] + 0.5 - eye[1], b.position[2] + 0.5 - eye[2]) : 60
        const aim = [eye[0] + dir[0] * dist, eye[1] + dir[1] * dist, eye[2] + dir[2] * dist]
        const v = [aim[0] - from[0], aim[1] - from[1], aim[2] - from[2]]
        const len = Math.hypot(v[0], v[1], v[2]) || 1
        s.effects.fireDir(kind, from, [v[0] / len, v[1] / len, v[2] / len], { damage, side: u.side, owner: u, blockDamage })
        s.audio.shoot(from, kind)
    }

    _unitAttack(u) {
        const s = this.s
        const noa = this.noa
        const def = u.def
        const eye = noa.camera.getTargetPosition()
        const dir = noa.camera.getDirection()
        const p = s.units.posOf(u)
        u.cooldown = def.cooldown
        const enemy = (x) => x.side !== u.side && !x.isPlayer
        if (def.attack === 'melee') {
            this._playAction(u, def.digs ? 'mine' : 'attack')
            s.audio.swing(p)
            const hit = this._meleeTarget(u, def.range + 1.2, eye, dir, enemy)
            if (hit) {
                s.units.damage(hit, def.damage, u)
                return
            }
            if (u.side === 'attacker') {
                const tc = s.units.town.pos
                if (Math.hypot(tc[0] - p[0], tc[2] - p[2]) < 3.4) {
                    s.units.damageTown(def.damage * Math.max(1, def.blockDamage), u)
                    return
                }
                const b = noa.pick(eye, dir, 3 + noa.camera.currentZoom)
                if (b) {
                    const [x, y, z] = b.position
                    const id = noa.getBlock(x, y, z)
                    const bd = BLOCK_BY_ID[id]
                    if (bd && isFinite(bd.hardness) && (bd.built || def.digs)) {
                        const destroyed = s.world.damageBlock(x, y, z, def.damage * Math.max(0.3, def.blockDamage))
                        s.effects.spray([x + 0.5, y + 0.5, z + 0.5], dustColor(bd.name), [-dir[0], 0.5, -dir[2]], destroyed ? 12 : 4)
                        s.audio.dig([x + 0.5, y + 0.5, z + 0.5], soundMaterial(bd.name))
                    }
                }
            }
        } else {
            u.cooldown = def.cooldown
            this._shoot(u, def.attack, def.damage, def.blockDamage, eye, dir)
        }
    }

    /** @param {number} dtMs */
    render(dtMs) {
        const dt = dtMs / 1000
        const noa = this.noa
        const s = this.s
        const ps = noa.inputs.pointerState
        const cam = noa.camera
        // undo last frame's shake offset before anything reads or moves the camera
        cam.heading -= this._shakeH
        cam.pitch -= this._shakeP
        this._shakeH = this._shakeP = 0

        if (this.mode === 'aerial') {
            const a = this.aerial
            const st = noa.inputs.state
            const f = (st.forward ? 1 : 0) - (st.backward ? 1 : 0)
            const r = (st.right ? 1 : 0) - (st.left ? 1 : 0)
            if (ps.scrolly || st.rotl || st.rotr || f || r) this._cameraInput()
            if (ps.scrolly) this._zoomAerial(ps.scrolly > 0 ? 1.12 : 0.89)
            if (st.rotl || st.rotr) {
                this._anchorView()
                a.heading += ((st.rotr ? 1 : 0) - (st.rotl ? 1 : 0)) * dt * 1.6
            }
            const speed = Math.max(AERIAL.minZoom, Math.min(AERIAL.maxZoom, a.zoom)) * 0.9 * dt
            if (this.orbit) {
                this.orbit.left -= dt
                a.heading += dt * 0.35
                if (this.glide) this.glide.heading = a.heading
                if (this.orbit.left <= 0) this.orbit = null
            }
            const g = this.glide
            if (g) {
                const k = Math.min(1, dt * 2)
                a.x += (g.x - a.x) * k
                a.z += (g.z - a.z) * k
                a.zoom += (g.zoom - a.zoom) * k
                a.pitch += (g.pitch - a.pitch) * k
                a.heading = lerpAngle(a.heading, g.heading, k)
                if (!this.orbit && Math.hypot(g.x - a.x, g.z - a.z) < 0.3 && Math.abs(g.zoom - a.zoom) < 0.3) this.glide = null
                this._anchored = false
            }
            // panning moves the pivot sideways only: the camera keeps its height
            if (f || r) {
                a.tx = a.tz = undefined
                const sin = Math.sin(a.heading), cos = Math.cos(a.heading)
                const half = s.world.half
                a.x = panAxis(a.x, (sin * f + cos * r) * speed, half)
                a.z = panAxis(a.z, (cos * f - sin * r) * speed, half)
                this._anchored = false
            } else if (a.tx !== undefined) {
                a.x += (a.tx - a.x) * Math.min(1, dt * 5)
                a.z += (a.tz - a.z) * Math.min(1, dt * 5)
                this._anchored = false
                if (Math.abs(a.tx - a.x) + Math.abs(a.tz - a.z) < 0.01) a.tx = a.tz = undefined
            }
            a.shown += (a.zoom - a.shown) * (1 - Math.exp(-dt * AERIAL.zoomRate))
            // hills: rise smoothly over anything that would come up through the camera
            liftFrame(a, this._camPrev, this._groundAt, this._solidAt, dt)
            noa.entities.setPosition(cam.cameraTarget, [a.x, a.y + a.lift, a.z])
            cam.heading = a.heading
            cam.pitch = a.pitch
            // set directly: noa's own easing would lag the pivot, and a re-anchor moves both at once
            cam.zoomDistance = cam.currentZoom = a.shown
            s.sky.setFogOffset(Math.round(Math.min(a.shown, AERIAL.maxZoom) * 0.8))
        } else if (ps.scrolly && this.mode === 'self' && this.inputActive) {
            s.inventory.select(s.inventory.selected + (ps.scrolly > 0 ? 1 : -1))
        }
        if (this.mode !== 'aerial') s.sky.setFogOffset(0)

        // running opens the view up a little, and eases back when you stop
        const wantRun = this.running && this.mode !== 'aerial' ? 1 : 0
        this._runEase += (wantRun - this._runEase) * Math.min(1, dt / RUN_FOV_EASE)
        noa.rendering.camera.fov = this._baseFov * (1 + RUN_FOV * this._runEase)

        if (this.shakeT > 0) {
            this.shakeT = Math.max(0, this.shakeT - dt * 1.6)
            const j = this.shakeT * this.shakeT * 0.05
            this._shakeH = (Math.random() - 0.5) * j
            this._shakeP = (Math.random() - 0.5) * j
            cam.heading += this._shakeH
            cam.pitch += this._shakeP
        }

        // hide the controlled character in first person; you see your own hands instead
        const u = this.controlled
        if (u && u.char) u.char.setVisible(cam.currentZoom > 1.2 || !u.alive)
        let held = null
        this._digShow = this.chopping && this.mode === 'self' ? DIG_SHOW : Math.max(0, this._digShow - dt)
        if (this.mode === 'self' && s.player && s.player.alive) {
            const inv = s.inventory
            const item = inv.selectedItem
            const kind = item ? ITEMS[item].kind : null
            const w = WEAPONS[this.selfWeapon]
            // you always dig with the pickaxe, whatever is selected; it comes out without the equip motion
            if (this._digShow > 0) held = { item: 'pickaxe', quiet: true }
            else if (kind === 'weapon' || !s.canEdit) held = { item: w.item, tint: w.tint || null }
            else held = { item: kind === 'block' ? 'block' : kind === 'unit' ? null : 'pickaxe', tile: kind === 'block' ? ITEM_TILE[item] : null }
            s.player.char.setItem(held.item, undefined, held.tint || null)
        } else if (this.mode === 'possess' && u) {
            held = { item: u.def.item }
        }
        this._renderViewModel(dtMs, u, held)
        this._updateHighlight()

        // audio listener follows the camera
        const cp = cam.getPosition()
        s.audio.setListener([cp[0], cp[1], cp[2]], cam.getDirection())
    }

    /**
     * The white square on a block face (noa's highlight mesh; the engine's own
     * default is off, see createEngine). Aerial view: where a build would go,
     * under the mouse cursor (the middle of the screen on touch, for ▣), by day
     * only: at night there's nothing to build. Otherwise the block you aim at,
     * as noa's default did.
     */
    _updateHighlight() {
        let t = null
        if (this.mode !== 'aerial') t = this.noa.targetedBlock
        else if (this.s.canEdit && !this.uiOpen && !(this.dragging && this.dragging.moved)) {
            if (this.s.touch.enabled) t = this._aerialTarget(window.innerWidth / 2, window.innerHeight / 2)
            else if (this.cursor.over) t = this._aerialTarget(this.cursor.x, this.cursor.y)
        }
        const h = this._hl
        if (!t) {
            if (h.on) this.noa.rendering.highlightBlockFace(false)
            h.on = false
            return
        }
        const p = t.position, n = t.normal
        // it's pushed off the face by more the farther the camera is: redo it when that changes a lot
        const dist = this.noa.camera.currentZoom
        if (h.on && p[0] === h.p[0] && p[1] === h.p[1] && p[2] === h.p[2] && n[0] === h.n[0] && n[1] === h.n[1] && n[2] === h.n[2]
            && Math.abs(dist - h.dist) <= 0.25 * Math.max(4, h.dist)) return
        h.on = true
        for (let i = 0; i < 3; i++) {
            h.p[i] = p[i]
            h.n[i] = n[i]
        }
        h.dist = dist
        this.noa.rendering.highlightBlockFace(true, h.p, h.n)
    }

    /** your hands and what's in them (first person only) */
    _renderViewModel(dtMs, u, held) {
        const firstPerson = !!held && !!u && u.alive && this.noa.camera.currentZoom <= 1.2
        if (firstPerson) {
            const model = u.isPlayer ? u.char.model : u.def.model
            this.view.setHand(model, held.item, held.tint || null, held.tile || null, !!held.quiet)
        }
        const body = u ? this.noa.entities.getPhysics(u.entity)?.body : null
        const speed = body ? Math.hypot(body.velocity[0], body.velocity[2]) : 0
        // the chop keeps going only while the button is down
        this.view.setDigging(!!this.chopping)
        this.view.render(dtMs, { visible: firstPerson, speed })
        if (this.s.touch.enabled) {
            const icon = !held ? '' : fireIcon(held.item)
            if (icon && icon !== this._fireIcon) {
                this._fireIcon = icon
                this.s.touch.setFireIcon(icon)
            }
        }
    }
}
