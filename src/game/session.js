/*
 *  Game session: creates the engine and all game systems for one world,
 *  applies world ops, runs the day/night loop, export and autosave.
 */

import { createEngine } from '../engine/createEngine.js'
import { TIERS, lowerTier, detectTier } from '../engine/quality.js'

const TIER_ORDER = ['low', 'med', 'high']
import { Sky } from '../engine/sky.js'
import { WorldState } from '../world/worldState.js'
import { serializeWorld, slugify } from '../world/worldFile.js'
import { AIR, BLOCK_BY_ID, blockId } from '../world/blocks.js'
import { CharacterLibrary } from '../characters/library.js'
import { BUILTIN_MODELS } from '../characters/contract.js'
import { NavClient } from '../ai/navClient.js'
import { Audio, soundMaterial } from '../audio/audio.js'
import { TouchControls } from '../input/touch.js'
import { Hud, label } from '../ui/hud.js'
import { idbSet } from '../core/idb.js'
import { UnitManager } from './units.js'
import { Towers } from './towers.js'
import { WaveDirector, waveBudget, composeWave } from './waves.js'
import { Effects } from './effects.js'
import { DayCycle } from './cycle.js'
import { Inventory } from './inventory.js'
import { Control } from './control.js'
import { ITEMS, UNITS, STARTING_INVENTORY, DAWN_RESTORE_RATE } from './balance.js'
import { shouldPlayOpening, openingFront, OPENING_TEXT } from './opening.js'

export const AUTOSAVE_KEY = 'autosave'
const AUTOSAVE_SECONDS = 30

/**
 * @param {object} o
 * @param {import('../world/worldFile.js').WorldDef} o.def
 * @param {string} o.sourceId      world list id (or 'new' / 'autosave')
 * @param {Worker} o.worker        worldgen worker (possibly pre-warmed)
 * @param {HTMLElement} o.container
 * @param {HTMLElement} o.hudRoot
 * @param {HTMLElement} o.touchRoot
 * @param {any} o.tier
 * @param {{identity: any, sync: any}} o.services
 * @param {boolean} [o.resumed]    loaded from the autosave (Continue)
 */
export async function startGame(o) {
    const session = new Session(o)
    await session.init()
    return session
}

class Session {
    constructor({ def, sourceId, worker, container, hudRoot, touchRoot, tier, services, resumed = false }) {
        this.def = def
        this.sourceId = sourceId
        /** start with the opening raid once the world is playable (see begin()) */
        this.openingPlanned = shouldPlayOpening(def, { resumed, search: location.search })
        /** @type {{angle: number, skipped: boolean} | null} */
        this.opening = null
        this.tier = tier
        this.services = services
        this.sync = services.sync
        const { noa, atlasURL } = createEngine(container, tier)
        this.noa = noa
        // refine the quality tier now that the GPU is known
        const refined = detectTier(noa.rendering.engine.getGlInfo().renderer)
        if (TIER_ORDER.indexOf(refined.name) < TIER_ORDER.indexOf(tier.name)) {
            tier = refined
            noa.rendering.engine.setHardwareScalingLevel(tier.hardwareScaling)
            noa.world.setAddRemoveDistance(tier.chunkAddDistance, tier.chunkRemoveDistance)
            this.tier = tier
        }
        this.world = new WorldState(noa, def, worker)
        this.sky = new Sky(noa, tier)
        this.audio = new Audio()
        this.effects = new Effects(noa, tier)
        this.chars = new CharacterLibrary(noa)
        this.nav = new NavClient(this.world)
        this.units = new UnitManager({ noa, world: this.world, nav: this.nav, chars: this.chars, effects: this.effects, tier })
        this.towers = new Towers({ noa, world: this.world, units: this.units, effects: this.effects })
        this.waves = new WaveDirector({ world: this.world, units: this.units, tier })
        this.cycle = new DayCycle({ mode: def.mode, day: def.day, nightLevel: def.nightLevel })
        const creative = def.mode === 'creative'
        const inv = def.player.inventory && Object.keys(def.player.inventory).length ? def.player.inventory
            : (def.edits.length === 0 && def.day === 1 ? STARTING_INVENTORY : {})
        this.inventory = new Inventory(inv, creative)
        /** @type {Map<string, import('../world/worldFile.js').UnitPlacement>} */
        this.placements = new Map(def.units.map((u) => [u.id, u]))
        this._atlasURL = atlasURL
        this._hudRoot = hudRoot
        this._touchRoot = touchRoot
        this._saveTimer = AUTOSAVE_SECONDS
        this._hudTimer = 0
        this._fpsLow = 0
        this._unitCounter = 0
        this.paused = false
    }

    async init() {
        const { noa, world, def } = this
        await this.sync.join(`${def.seed}:${def.generator.version}`)
        this.sync.onOp(({ op }) => this.applyOp(op))

        // player avatar
        const profile = await this.services.identity.getProfile()
        this.player = this.units.adoptPlayer(profile.avatar ? profile.avatar.glbUrl : 'player')
        const spawn = def.player.pos || [def.townCenter[0] + 0.5, def.townCenter[1], def.townCenter[2] + 5.5]
        noa.entities.setPosition(noa.playerEntity, spawn)
        // face the town center
        noa.camera.heading = Math.atan2(def.townCenter[0] + 0.5 - spawn[0], def.townCenter[2] + 0.5 - spawn[2])
        noa.camera.pitch = 0.15
        world.prewarm(spawn[0], spawn[1], spawn[2], 2, 1)

        // placed defenders
        for (const p of this.placements.values()) this._spawnPlacement(p)

        this.hud = new Hud(this._hudRoot, this, this._atlasURL)
        this.touch = new TouchControls(this._touchRoot, noa, {
            look: (dx, dy) => this.control.lookDelta(dx, dy),
            pinch: (scale) => this.control.zoomBy(scale),
            tap: (x, y) => this.control.touchTap(x, y),
            button: (name, down) => this.control.touchButton(name, down),
        })
        this.touch.attach(noa.container.canvas)
        this.control = new Control(this)
        this.control.enterBuild()

        this._wireEvents()
        noa.on('tick', (dt) => this.tick(dt / 1000))
        noa.on('beforeRender', (dt) => this.render(dt))

        // warm up character models after the first frames
        setTimeout(() => {
            this.chars.loadItems()
            for (const m of BUILTIN_MODELS) this.chars.load(m)
        }, 1500)

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.autosave()
        })
        window.addEventListener('beforeunload', () => this.autosave())
        this.hud.toast(`${def.name} — ${def.mode === 'creative' ? 'creative' : 'survival'} mode. Press H for controls.`)
        if (/[?&]fps/.test(location.search)) this.showFps(true)
    }

    /** called once the first playable frame is on screen */
    begin() {
        if (this.openingPlanned) {
            this.openingPlanned = false
            // the raiders' models (small) start loading now, not before the first frame
            for (const m of ['attacker_grunt', 'attacker_brute']) this.chars.load(m)
            setTimeout(() => this.startOpening(), 700)
        }
    }

    // ---- opening raid ---------------------------------------------------------------------

    startOpening() {
        if (this.cycle.phase !== 'day' || this.opening) return
        this.opening = { angle: openingFront(), skipped: false }
        this.cycle.startOpening()
    }

    skipOpening() {
        if (!this.opening || !this.cycle.opening || this.cycle.phase !== 'night') return
        this.opening.skipped = true
        this.cycle.endNight('lost')
    }

    // ---- ops (permanent world changes) ------------------------------------------------

    applyOp(op) {
        if (op.t === 'block') {
            this.world.applyBlockEdit(op.x, op.y, op.z, blockId(op.b))
        } else if (op.t === 'unit+') {
            const p = { id: op.id, type: op.type, pos: op.pos, yaw: op.yaw || 0 }
            this.placements.set(p.id, p)
            this._spawnPlacement(p)
        } else if (op.t === 'unit-') {
            this.placements.delete(op.id)
            for (const u of this.units.units) if (u.placementId === op.id) this.units.remove(u)
        }
    }

    _spawnPlacement(p) {
        if (!UNITS[p.type]) return
        const u = this.units.spawn(p.type, p.pos, { placementId: p.id, yaw: (p.yaw * Math.PI) / 180 })
        return u
    }

    get canEdit() {
        return this.cycle.phase === 'day'
    }

    breakBlock(x, y, z, id) {
        const def = BLOCK_BY_ID[id]
        this.sync.submit({ t: 'block', x, y, z, b: 'air' })
        if (def && def.drop && !this.inventory.creative) this.inventory.add(def.drop, 1)
        const pos = [x + 0.5, y + 0.5, z + 0.5]
        this.effects.burst(pos, [0.55, 0.45, 0.35], 10, 3)
        this.audio.breakBlock(pos, soundMaterial(def && def.name))
    }

    /** place the selected hotbar item at a voxel */
    placeSelected(at, against) {
        const inv = this.inventory
        const item = inv.selectedItem
        if (!item) return this.hud.toast('Select something to place (B to craft)')
        if (!this.canEdit) return this.hud.toast('You can only build during the day', 'warn')
        const [x, y, z] = at
        const w = this.world
        if (!w.inBounds(x, y, z) || y >= 70) return this.hud.toast('Outside the buildable area', 'warn')
        const kind = ITEMS[item].kind
        if (kind === 'block') {
            if (this.noa.getBlock(x, y, z) !== AIR && !BLOCK_BY_ID[this.noa.getBlock(x, y, z)]?.fluid) return
            if (this.noa.entities.isTerrainBlocked(x, y, z)) return
            if (!inv.remove(item, 1)) return
            this.sync.submit({ t: 'block', x, y, z, b: item })
            this.audio.place([x + 0.5, y + 0.5, z + 0.5])
            this.player.char.playAction('place')
        } else if (kind === 'unit') {
            const floor = BLOCK_BY_ID[this.noa.getBlock(x, y - 1, z)]
            if (!floor || !floor.solid) return this.hud.toast('Troops need solid ground', 'warn')
            if (this.noa.getBlock(x, y, z) !== AIR || this.noa.getBlock(x, y + 1, z) !== AIR) return this.hud.toast('Not enough room', 'warn')
            if (!inv.remove(item, 1)) return
            const id = `u${Date.now().toString(36)}${(this._unitCounter++).toString(36)}`
            const yaw = Math.round((Math.atan2(x + 0.5 - this.world.townCenter[0], z + 0.5 - this.world.townCenter[2]) * 180) / Math.PI)
            this.sync.submit({ t: 'unit+', id, type: item, pos: [x + 0.5, y, z + 0.5], yaw })
            this.audio.place([x + 0.5, y + 0.5, z + 0.5])
            this.hud.toast(`Placed ${label(item)}`, 'good')
        }
    }

    pickUpUnit(u) {
        if (!u.placementId) return
        this.sync.submit({ t: 'unit-', id: u.placementId })
        this.inventory.add(u.type, 1)
        this.hud.toast(`Picked up ${label(u.type)}`)
    }

    respawnPlayer() {
        const p = this.player
        const tc = this.world.townCenter
        this.noa.entities.setPosition(p.entity, [tc[0] + 0.5, tc[1], tc[2] + 5.5])
        p.hp = p.maxHp
        p.alive = true
        p.char.reset()
        this.hud.toast('You respawned at the town center')
    }

    // ---- day / night --------------------------------------------------------------------

    requestNight() {
        if (this.cycle.phase !== 'day') return
        if (this.cycle.creative) return this.hud.openPanel('night')
        this.startNight()
    }

    startNight(level = null) {
        if (this.cycle.phase !== 'day') return
        this.cycle.startNight(level)
    }

    describeNight(level) {
        const budget = waveBudget(level, this.waves.defenceValue(this.placements.values()))
        const list = composeWave(level, budget, (() => { let s = level * 9301; return () => ((s = (s * 49297 + 233280) % 233280) / 233280) })())
        const counts = {}
        for (const t of list) counts[t] = (counts[t] || 0) + 1
        return `About ${list.length} attackers: ` + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')
    }

    openRolePicker() {
        const phase = this.cycle.phase
        if (phase === 'day') return this.hud.toast('Roles are chosen at night. Press N to start the night.')
        this.hud.showRolePicker(phase === 'dusk' ? 'The night is about to start.' : '')
    }

    chooseRole(kind, type) {
        const c = this.control
        if (kind === 'aerial') return c.enterAerial()
        const alive = this.units.units.filter((u) => u.alive && !u.isPlayer && u.side === kind && u.type === type)
        if (!alive.length) {
            if (kind === 'attacker') {
                this.pendingRole = { kind, type }
                c.enterAerial()
                this.hud.toast(`Waiting for the next ${label(type)}…`)
            }
            return
        }
        // prefer the unit closest to the action (the town center)
        const tc = this.world.townCenter
        alive.sort((a, b) => {
            const pa = this.units.posOf(a), pb = this.units.posOf(b)
            return Math.hypot(pa[0] - tc[0], pa[2] - tc[2]) - Math.hypot(pb[0] - tc[0], pb[2] - tc[2])
        })
        const pick = kind === 'attacker' ? alive[0] : alive[0]
        c.possess(pick)
    }

    onControlledDied(u) {
        this.hud.toast(`Your ${u ? label(u.type) : 'unit'} was defeated`, 'warn')
        if (this.cycle.phase === 'night' || this.cycle.phase === 'dusk') {
            this.control.enterAerial()
            this.hud.showRolePicker('You fell. Pick another unit or keep watching.')
        } else {
            this.control.enterBuild()
        }
    }

    _wireEvents() {
        const { cycle, units, audio, hud, waves } = this
        cycle.on('phase', (phase) => {
            if (phase === 'dusk') {
                audio.horn()
                hud.toast(`Night ${cycle.activeLevel} is coming! Choose your role.`, 'warn')
                hud.closePanel()
                for (const m of BUILTIN_MODELS) this.chars.load(m)
                this.openRolePicker()
            } else if (phase === 'night') {
                units.combat = true
                if (cycle.opening) waves.startOpening(this.opening.angle)
                else waves.startNight(cycle.activeLevel, [...this.placements.values()])
                // the builder sits the night out
                this.player.active = false
                this.player.char.setVisible(false)
                const ents = this.noa.entities
                if (ents.hasComponent(this.player.entity, ents.names.shadow)) ents.removeComponent(this.player.entity, ents.names.shadow)
                if (this.control.mode === 'build') this.control.enterAerial()
                if (hud.openName === 'role') hud.closePanel()
                if (cycle.opening) {
                    audio.horn()
                    this.control.frameFront(this.opening.angle, true)
                    hud.banner(OPENING_TEXT.start, { kind: 'warn', seconds: 0, action: { label: 'Skip', fn: () => this.skipOpening() } })
                    setTimeout(() => hud.toast(OPENING_TEXT.hint), 2500)
                }
            } else if (phase === 'dawn') {
                waves.stop()
                for (const u of units.units) if (u.alive && u.side === 'attacker') units.kill(u)
                if (this.control.mode !== 'build') this.control.enterBuild()
                units.town.hp = units.town.maxHp
                this.pendingRole = null
            } else if (phase === 'day') {
                audio.chime()
                this.player.active = true
                // (in build mode control.render handles first/third person visibility)
                if (this.control.mode !== 'build') this.player.char.setVisible(true)
                const ents = this.noa.entities
                if (!ents.hasComponent(this.player.entity, ents.names.shadow)) ents.addComponent(this.player.entity, ents.names.shadow, { size: 0.6 })
                if (!this.player.alive) this.respawnPlayer()
                // revive defenders at their posts, and heal the ones that made it
                for (const p of this.placements.values()) {
                    const alive = units.units.some((u) => u.placementId === p.id && u.alive)
                    if (alive) {
                        for (const u of units.units) if (u.placementId === p.id && u.alive) u.hp = u.maxHp
                    } else {
                        for (const u of [...units.units]) if (u.placementId === p.id) units.remove(u)
                        this._spawnPlacement(p)
                    }
                }
                if (cycle.wasOpening) {
                    this.opening = null
                    hud.banner(OPENING_TEXT.day, { kind: 'good', seconds: 16 })
                } else {
                    hud.toast(`Day ${cycle.day}. The town has been rebuilt.`, 'good')
                }
                this.autosave()
            }
        })
        cycle.on('nightOver', (result, level) => {
            units.combat = false
            if (cycle.opening) {
                hud.hideBanner()
                if (!this.opening.skipped) {
                    audio.defeat()
                    hud.showResult(OPENING_TEXT.lostTitle, OPENING_TEXT.lostText)
                }
                return
            }
            if (result === 'survived') {
                audio.victory()
                const reward = { gold: 1 + Math.floor(level / 2), iron: Math.ceil(level / 2) }
                if (!this.inventory.creative) for (const [k, v] of Object.entries(reward)) this.inventory.add(k, v)
                hud.showResult(`Night ${level} survived!`, this.inventory.creative ? 'The town held.' : `Reward: ${reward.gold} gold, ${reward.iron} iron. The next night will be stronger.`)
            } else {
                audio.defeat()
                hud.showResult(`Night ${level}: the town center fell`, 'The town will be rebuilt at dawn. Strengthen your defences and try again.')
            }
        })
        units.on('townDestroyed', () => {
            if (cycle.phase === 'night') cycle.endNight('lost')
        })
        units.on('died', (u) => {
            const p = units.posOf(u)
            audio.death(p)
            if (u.isPlayer) {
                this.control.respawnTimer = 5
                hud.toast('You were knocked out! Respawning…', 'warn')
            }
        })
        units.on('hit', (u) => audio.hit(units.posOf(u)))
        units.on('shot', (u, kind) => audio.shoot(units.posOf(u), kind))
        units.on('melee', (u) => audio.swing(units.posOf(u)))
        units.on('towerFired', (t) => audio.shoot([t.x + 0.5, t.y + 1.5, t.z + 0.5], t.spec.projectile))
        units.on('townHit', () => audio.townHit(units.town.pos))
        units.on('explosion', (p) => audio.explosion(p))
        units.on('blockHit', (x, y, z, id, destroyed) => {
            const m = soundMaterial(BLOCK_BY_ID[id]?.name)
            if (destroyed) audio.breakBlock([x + 0.5, y + 0.5, z + 0.5], m)
            else audio.dig([x + 0.5, y + 0.5, z + 0.5], m)
        })
        units.on('spawned', (u) => {
            const pr = this.pendingRole
            if (pr && u.side === pr.kind && u.type === pr.type && this.control.mode === 'aerial') {
                this.pendingRole = null
                setTimeout(() => this.control.possess(u), 200)
            }
        })
        waves.on('subwave', (n, fronts) => {
            const from = fronts.map((f) => f.name).join(' and the ')
            if (cycle.opening) {
                if (waves.round > 0) hud.toast(`Raider reinforcements from the ${from}!`, 'warn')
                return
            }
            hud.banner(`${n} attackers approaching from the ${from}!`, { kind: 'warn', seconds: 6 })
            this.control.frameFront(fronts[0].angle)
        })
        waves.on('skirmish', (n, from) => {
            hud.toast(`A scouting party of ${n} is approaching from the ${from}`, 'warn')
            units.combat = true
        })
        this.world.on('blockRestored', (x, y, z) => {
            if (Math.random() < 0.15) this.effects.burst([x + 0.5, y + 0.5, z + 0.5], [0.95, 0.9, 0.6], 3, 1.5, 0.08, 0.5)
        })
    }

    // ---- loop ------------------------------------------------------------------------------

    /** @param {number} dt seconds */
    tick(dt) {
        const { cycle, units, waves, world } = this
        cycle.update(dt, { damageRemaining: world.damageCount })
        units.phase = cycle.phase
        if (cycle.phase === 'dawn') world.restoreDamage(Math.ceil(DAWN_RESTORE_RATE * dt))
        if (cycle.phase === 'night') {
            if (units.town.hp <= 0) cycle.endNight('lost')
            else if (waves.cleared) cycle.endNight('survived')
        }
        if (cycle.phase === 'day' && units.combat && units.aliveAttackers() === 0) units.combat = false
        waves.tick(dt, { day: cycle.phase === 'day', skirmish: this.def.skirmish && !cycle.creative })
        units.tick(dt)
        this.towers.tick(dt)
        this.effects.tick(dt, (p, pos) => units.projectileHit(p, pos))
        this.control.tick(dt)
        this._keepInBounds()

        this._saveTimer -= dt
        if (this._saveTimer <= 0) {
            this._saveTimer = AUTOSAVE_SECONDS
            if (cycle.phase === 'day') this.autosave()
        }
    }

    _keepInBounds() {
        const half = this.world.half
        for (const u of this.units.units) {
            if (!u.alive) continue
            const p = this.units.posOf(u)
            if (p[1] < -40) {
                // fell out of the world
                if (u.isPlayer) this.respawnPlayer()
                else this.units.kill(u)
                continue
            }
            const cx = Math.max(-half + 0.5, Math.min(half - 0.5, p[0]))
            const cz = Math.max(-half + 0.5, Math.min(half - 0.5, p[2]))
            if (cx !== p[0] || cz !== p[2]) this.noa.entities.setPosition(u.entity, [cx, p[1], cz])
        }
    }

    /** @param {number} dtMs */
    render(dtMs) {
        this.sky.update(this.cycle.skyTime)
        this.units.render(dtMs)
        this.effects.render(dtMs)
        this.control.render(dtMs)
        this._hudTimer -= dtMs
        if (this._hudTimer <= 0) {
            this._hudTimer = 100
            this.hud.update()
            this._governFps()
        }
    }

    /** step quality down when the frame rate stays low */
    _governFps() {
        if (this.paused || document.hidden) return
        const fps = this.noa.rendering.engine.getFps()
        this._fpsLow = fps < 40 ? this._fpsLow + 0.1 : Math.max(0, this._fpsLow - 0.2)
        if (this._fpsLow > 6 && !/[?&]quality=/.test(location.search)) {
            this._fpsLow = 0
            const lower = lowerTier(this.tier)
            if (lower) {
                this.setQuality(lower.name)
                this.hud.toast(`Lowered graphics quality to ${lower.name} for smoother play`)
            }
        }
    }

    setQuality(name) {
        const tier = TIERS[name]
        if (!tier) return
        this.tier = tier
        this.units.tier = tier
        this.waves.tier = tier
        this.effects.particleScale = tier.particles
        const noa = this.noa
        noa.rendering.engine.setHardwareScalingLevel(tier.hardwareScaling)
        noa.world.setAddRemoveDistance(tier.chunkAddDistance, tier.chunkRemoveDistance)
        this.sky.setFogEnd(tier.fogEnd)
    }

    showFps(on) {
        let el = document.getElementById('fps')
        if (!on) {
            if (el) el.remove()
            clearInterval(this._fpsInterval)
            return
        }
        if (!el) {
            el = document.createElement('div')
            el.id = 'fps'
            el.style.cssText = 'position:fixed;left:8px;bottom:64px;z-index:20;font:12px monospace;color:#fff;background:rgba(0,0,0,.5);padding:2px 6px;border-radius:4px;pointer-events:none'
            document.body.appendChild(el)
        }
        clearInterval(this._fpsInterval)
        this._fpsInterval = setInterval(() => {
            el.textContent = `${Math.round(this.noa.rendering.engine.getFps())} fps · ${this.tier.name} · ${this.units.units.length} units`
        }, 500)
    }

    setPaused(p) {
        this.paused = p
        this.noa.setPaused(p)
    }

    describeWorld() {
        const d = this.def
        return `${d.name} · seed "${d.seed}" · ${d.size}×${d.size} · ${d.mode} · day ${this.cycle.day} · next night ${this.cycle.nightLevel} · ${this.world.edits.count} block edits · ${this.placements.size} troops`
    }

    // ---- save / export ---------------------------------------------------------------------

    snapshot() {
        const p = this.noa.entities.getPosition(this.noa.playerEntity)
        return {
            ...this.def,
            day: this.cycle.day,
            nightLevel: this.cycle.nightLevel,
            edits: this.world.sortedEdits(),
            units: [...this.placements.values()],
            player: { pos: [p[0], p[1], p[2]], inventory: this.inventory.toJSON() },
        }
    }

    exportWorld() {
        const text = serializeWorld(this.snapshot())
        const blob = new Blob([text], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${slugify(this.def.name)}.world.json`
        document.body.appendChild(a)
        a.click()
        setTimeout(() => {
            URL.revokeObjectURL(a.href)
            a.remove()
        }, 1000)
        this.hud.toast(`Exported ${a.download} — commit it to worlds/ to add it to the world list`, 'good')
    }

    autosave() {
        try {
            const text = serializeWorld(this.snapshot())
            idbSet(AUTOSAVE_KEY, { sourceId: this.sourceId, name: this.def.name, savedAt: Date.now(), text })
        } catch (err) {
            console.warn('autosave failed', err)
        }
    }

    quit() {
        this.autosave()
        setTimeout(() => location.reload(), 150)
    }
}
