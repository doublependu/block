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
import { REACH, PLAYER_MINE_SPEED, PLAYER_SPEED, ITEMS, WEAPONS } from './balance.js'
import { BLOCK_BY_ID } from '../world/blocks.js'
import { HOTBAR_SIZE } from './inventory.js'
import { soundMaterial } from '../audio/audio.js'
import { lerpAngle } from './units.js'
import { canChooseRole } from './cycle.js'

const AERIAL_MIN_ZOOM = 12
const AERIAL_MAX_ZOOM = 70

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
        this.aerial = { x: 0.5, y: 10, z: 0.5, zoom: 40, heading: 0.6, pitch: 0.95 }
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

        const inputs = noa.inputs
        inputs.unbind('mid-fire')
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
        canvas.addEventListener('contextmenu', (e) => e.preventDefault())

        // keep pointer lock only where it makes sense
        noa.container.on('lostPointerLock', () => {
            if (this.mode !== 'aerial' && !this.uiOpen && !s.touch.enabled) s.hud.openPanel('pause')
        })
    }

    get canPointerLock() {
        return this.mode !== 'aerial' && !this.uiOpen
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
        this.aerial.x = from[0]
        this.aerial.z = from[2]
        this.aerial.y = Math.max(from[1], 2)
        this.aerial.heading = noa.camera.heading
        this.aerial.pitch = 0.9
        this.aerial.zoom = 38
        this.glide = null
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
        this.aerial.tx = undefined
        this.glide = {
            x: tc[0] + 0.5 + Math.sin(angle) * ahead,
            z: tc[2] + 0.5 + Math.cos(angle) * ahead,
            heading: angle,
            zoom,
            pitch,
        }
    }

    /** circle the town center slowly from above for a few seconds */
    orbitTown(seconds) {
        if (this.mode !== 'aerial') this.enterAerial()
        const tc = this.s.world.townCenter
        this.aerial.tx = undefined
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
            this._cameraInput()
            this.aerial.heading += dx * k
            this.aerial.pitch = Math.max(0.35, Math.min(1.45, this.aerial.pitch + dy * k))
        } else {
            cam.heading += dx * k
            cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch + dy * k))
        }
    }

    zoomBy(scale) {
        if (this.mode === 'aerial') {
            this._cameraInput()
            this.aerial.zoom = Math.max(AERIAL_MIN_ZOOM, Math.min(AERIAL_MAX_ZOOM, this.aerial.zoom / scale))
        }
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
        // pan to the clicked point
        const b = this.noa.pick(origin, dir, 200)
        if (b) {
            this._cameraInput()
            this.aerial.tx = b.position[0] + 0.5
            this.aerial.tz = b.position[2] + 0.5
        }
    }

    aerialPlace(x, y) {
        const { origin, dir } = this.screenRay(x, y)
        const b = this.noa.pick(origin, dir, 200)
        if (b) this.s.placeSelected(b.adjacent, b.position)
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

        if (this.mode === 'self') {
            if (!s.player.alive) {
                this.mining = null
                return
            }
            s.units.setPlayerWeapon(this.selfWeapon)
            if (firing) this._selfFire(dt)
            else this.mining = null
        } else if (this.mode === 'possess') {
            if (!u || !u.alive) {
                this.mining = null
                this.mode = 'dead'
                this._setInputsOn(-1)
                s.onControlledDied(u)
                return
            }
            if (firing && u.cooldown <= 0) this._unitAttack(u)
        }
    }

    _selfFire(dt) {
        const s = this.s
        const noa = this.noa
        const p = s.player
        const eye = noa.camera.getTargetPosition()
        const dir = noa.camera.getDirection()
        const wname = this.selfWeapon
        const w = WEAPONS[wname]
        // bows and muskets shoot where you look (and don't mine)
        if (w.attack !== 'melee') {
            this.mining = null
            if (p.cooldown <= 0) {
                p.cooldown = w.cooldown
                this._shoot(p, w.attack, w.damage, 0, eye, dir)
            }
            return
        }
        // hit hostile units first
        const hit = this._meleeTarget(p, w.range, eye, dir, (x) => x.side === 'attacker')
        if (hit) {
            this.mining = null
            if (p.cooldown <= 0) {
                p.cooldown = w.cooldown
                p.char.playAction('attack')
                s.units.damage(hit, w.damage, p)
                s.audio.swing(eye)
            }
            return
        }
        if (!s.canEdit) {
            this.mining = null
            if (p.cooldown <= 0) {
                // swing at the air
                p.cooldown = w.cooldown
                p.char.playAction('attack')
                s.audio.swing(eye)
            }
            return
        }
        const t = noa.targetedBlock
        if (!t) {
            this.mining = null
            return
        }
        const [x, y, z] = t.position
        const id = noa.getBlock(x, y, z)
        const def = BLOCK_BY_ID[id]
        if (!def || !isFinite(def.hardness)) {
            this.mining = null
            return
        }
        const key = `${x},${y},${z}`
        if (!this.mining || this.mining.key !== key) {
            this.mining = { key, x, y, z, id, progress: 0, sound: 0 }
        }
        const m = this.mining
        const time = s.inventory.creative ? 0.12 : Math.max(0.1, def.hardness / PLAYER_MINE_SPEED)
        m.progress += dt / time
        m.sound -= dt
        if (!p.char.busy) p.char.playAction('mine', 1.2)
        if (m.sound <= 0) {
            m.sound = 0.25
            s.audio.dig([x + 0.5, y + 0.5, z + 0.5], soundMaterial(def.name))
        }
        if (m.progress >= 1) {
            this.mining = null
            s.breakBlock(x, y, z, id)
        }
    }

    /** enemy in front of the camera within melee range: on the crosshair, or close and roughly ahead */
    _meleeTarget(u, range, eye, dir, filter) {
        const s = this.s
        const noa = this.noa
        const hit = s.units.unitOnRay(eye, dir, range + 1.3 + noa.camera.currentZoom, filter)
        if (hit) return hit.unit
        const p = s.units.posOf(u)
        const near = s.units.nearestEnemy(u, range + 0.8)
        if (!near || !filter(near)) return null
        const q = s.units.posOf(near)
        const ang = Math.atan2(q[0] - p[0], q[2] - p[2])
        let d = Math.abs(ang - noa.camera.heading) % (Math.PI * 2)
        if (d > Math.PI) d = Math.PI * 2 - d
        return d < 0.9 ? near : null
    }

    /** fire a projectile from a unit toward what the camera looks at */
    _shoot(u, kind, damage, blockDamage, eye, dir) {
        const s = this.s
        const p = s.units.posOf(u)
        u.char.playAction('shoot')
        const from = [p[0], p[1] + u.height * 0.8, p[2]]
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
            u.char.playAction(def.digs ? 'mine' : 'attack')
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
                        s.effects.burst([x + 0.5, y + 0.5, z + 0.5], [0.5, 0.45, 0.4], destroyed ? 10 : 3)
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
            if (ps.scrolly) a.zoom = Math.max(AERIAL_MIN_ZOOM, Math.min(AERIAL_MAX_ZOOM, a.zoom * (ps.scrolly > 0 ? 1.12 : 0.89)))
            if (st.rotl) a.heading -= dt * 1.6
            if (st.rotr) a.heading += dt * 1.6
            const speed = a.zoom * 0.9 * dt
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
            }
            if (f || r) {
                a.tx = undefined
                const sin = Math.sin(a.heading), cos = Math.cos(a.heading)
                a.x += (sin * f + cos * r) * speed
                a.z += (cos * f - sin * r) * speed
            } else if (a.tx !== undefined) {
                a.x += (a.tx - a.x) * Math.min(1, dt * 5)
                a.z += (a.tz - a.z) * Math.min(1, dt * 5)
            }
            const half = s.world.half
            a.x = Math.max(-half, Math.min(half, a.x))
            a.z = Math.max(-half, Math.min(half, a.z))
            // keep the orbit target above the terrain so the camera isn't clamped into it
            const ground = s.world.surfaceY(Math.floor(a.x), Math.floor(a.z))
            a.y += (Math.max(ground, 1) + 3 - a.y) * Math.min(1, dt * 3)
            noa.entities.setPosition(cam.cameraTarget, [a.x, a.y, a.z])
            cam.heading = a.heading
            cam.pitch = a.pitch
            cam.zoomDistance = a.zoom
            s.sky.setFogOffset(Math.round(a.zoom * 0.8))
        } else if (ps.scrolly && this.mode === 'self' && this.inputActive) {
            s.inventory.select(s.inventory.selected + (ps.scrolly > 0 ? 1 : -1))
        }
        if (this.mode !== 'aerial') s.sky.setFogOffset(0)

        if (this.shakeT > 0) {
            this.shakeT = Math.max(0, this.shakeT - dt * 1.6)
            const j = this.shakeT * this.shakeT * 0.05
            this._shakeH = (Math.random() - 0.5) * j
            this._shakeP = (Math.random() - 0.5) * j
            cam.heading += this._shakeH
            cam.pitch += this._shakeP
        }

        // hide the controlled character in first person
        const u = this.controlled
        if (u && u.char) u.char.setVisible(cam.currentZoom > 1.2 || !u.alive)
        if (this.mode === 'self' && s.player && s.player.alive) {
            const inv = s.inventory
            const item = inv.selectedItem
            const kind = item ? ITEMS[item].kind : null
            const w = WEAPONS[this.selfWeapon]
            if (kind === 'weapon' || !s.canEdit) s.player.char.setItem(w.item, undefined, w.tint || null)
            else s.player.char.setItem(kind === 'block' ? 'block' : kind === 'unit' ? null : 'pickaxe')
        }

        // audio listener follows the camera
        const cp = cam.getPosition()
        s.audio.setListener([cp[0], cp[1], cp[2]], cam.getDirection())
    }
}
