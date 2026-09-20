/*
 *  Game session: creates the engine and all game systems for one world,
 *  applies world ops, runs the day/night loop, export and autosave.
 */

import { createEngine } from '../engine/createEngine.js'
import { TIERS, lowerTier, detectTier, isTouchDevice } from '../engine/quality.js'

const TIER_ORDER = ['low', 'med', 'high']
import { Sky } from '../engine/sky.js'
import { WorldState } from '../world/worldState.js'
import { serializeWorld, slugify } from '../world/worldFile.js'
import { AIR, BLOCK_BY_ID, blockId, blockName, dustColor } from '../world/blocks.js'
import { CharacterLibrary } from '../characters/library.js'
import { BUILTIN_MODELS } from '../characters/contract.js'
import { NavClient } from '../ai/navClient.js'
import { Audio, soundMaterial } from '../audio/audio.js'
import { TouchControls } from '../input/touch.js'
import { Hud, label } from '../ui/hud.js'
import { idbSet, idbDelete } from '../core/idb.js'
import { getSetting, setSetting } from '../core/settings.js'
import { UnitManager, unstuckY } from './units.js'
import { Towers } from './towers.js'
import { WaveDirector, waveText } from './waves.js'
import { Effects } from './effects.js'
import { HealthBars } from './healthBars.js'
import { Cracks } from './cracks.js'
import { Rebuild } from './rebuild.js'
import { Guide } from './guide.js'
import { DayCycle } from './cycle.js'
import { Inventory } from './inventory.js'
import { Control } from './control.js'
import { ITEMS, UNITS, STARTING_INVENTORY, HERO, WEAPONS } from './balance.js'
import { shouldPlayOpening, OpeningRaid, OPENING_TEXT } from './opening.js'
import { compassName } from './waves.js'
import { isWallBlock } from './siege.js'
import { Demolition } from './siege.js'
import { canChooseRole } from './cycle.js'
import { towerPlacement, canPatch } from './placing.js'

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
        /** @type {OpeningRaid | null} */
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
        this.healthBars = new HealthBars({ noa, units: this.units, tier })
        this.healthBars.setEnabled(getSetting('hpBars'))
        this.cracks = new Cracks(noa)
        this.rebuild = new Rebuild({ noa, world: this.world, effects: this.effects, audio: this.audio })
        /** points at the part of the town being rebuilt at dawn, when it's off screen */
        this._rebuildPin = null
        this.waves = new WaveDirector({ world: this.world, units: this.units, tier })
        /** the coming night's attack, planned at dusk */
        this.nightPlan = null
        /** holes patched at night, this game */
        this.patches = 0
        /** the night the "patch the breach" hint was shown */
        this._patchHint = 0
        this.cycle = new DayCycle({ mode: def.mode, day: def.day, nightLevel: def.nightLevel, lives: def.lives })
        this.demolition = new Demolition({
            world: this.world, units: this.units, effects: this.effects, audio: this.audio,
            onExplosion: (pos) => {
                const cp = noa.camera.getPosition()
                const d = Math.hypot(cp[0] - pos[0], cp[1] - pos[1], cp[2] - pos[2])
                if (d < 40) this.control.shake(0.9 * (1 - d / 40))
            },
        })
        this.units.demolition = this.demolition
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
        this._solid = (x, y, z) => noa.world.getBlockSolidity(x, y, z)
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
        this.control.returnToSelf()
        this.guide = new Guide(this, { touchDevice: isTouchDevice() })
        this.units.setPlayerWeapon(this.inventory.bestWeapon)

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
        this.audio.setMuted(getSetting('muted'))
        if (getSetting('fps')) this.showFps(true)
    }

    /** called once the first playable frame is on screen */
    begin() {
        if (this.openingPlanned) {
            this.openingPlanned = false
            // the raiders' models (small) start loading now, not before the first frame
            for (const m of ['attacker_grunt', 'attacker_brute', 'attacker_sapper']) this.chars.load(m)
            setTimeout(() => this.startOpening(), 700)
        }
    }

    // ---- opening raid ---------------------------------------------------------------------

    startOpening() {
        if (this.cycle.phase !== 'day' || this.opening) return
        this.opening = new OpeningRaid(this)
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
            for (const u of [...this.units.units]) if (u.placementId === op.id) this.units.remove(u)
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
        this.effects.burst(pos, dustColor(def && def.name), 10, 3)
        this.audio.breakBlock(pos, soundMaterial(def && def.name))
    }

    /** place the selected hotbar item at a voxel */
    placeSelected(at, against) {
        const inv = this.inventory
        const item = inv.selectedItem
        if (!item) return this.hud.toast('Select something to place (B to craft)')
        if (!this.canEdit) {
            // at night, holes the attackers made can be patched with the same block
            if (this.cycle.phase === 'night' && !this.cycle.opening && ITEMS[item].kind === 'block') return this.patch(at, item)
            return this.hud.toast('You can only build during the day', 'warn')
        }
        const [x, y, z] = at
        const w = this.world
        if (!w.inBounds(x, y, z) || y >= 70) return this.hud.toast('Outside the buildable area', 'warn')
        const kind = ITEMS[item].kind
        if (kind === 'weapon') return this.hud.toast('Weapons are used with left click (hold ⛏ on touch)')
        if (kind === 'tool') return this.hud.toast('The pickaxe digs: hold left click on a block (hold ⛏ on touch)')
        if (kind === 'block') {
            if (this.noa.getBlock(x, y, z) !== AIR && !BLOCK_BY_ID[this.noa.getBlock(x, y, z)]?.fluid) return
            if (this.noa.entities.isTerrainBlocked(x, y, z)) return
            // a tower on the ground comes with its column
            if (BLOCK_BY_ID[blockId(item)]?.tower) {
                const plan = towerPlacement((a, b, c) => this.noa.getBlock(a, b, c), at, item, {
                    cobble: inv.count('cobble'), free: (a, b, c) => !this.noa.entities.isTerrainBlocked(a, b, c),
                })
                if (plan.reason) return this.hud.toast(plan.reason, 'warn')
                if (!inv.remove(item, 1)) return
                if (plan.cells.length > 1) inv.remove('cobble', plan.cells.length - 1)
                for (const [cx, cy, cz, b] of plan.cells) this.sync.submit({ t: 'block', x: cx, y: cy, z: cz, b })
                const top = plan.cells[plan.cells.length - 1]
                this.audio.place([top[0] + 0.5, top[1] + 0.5, top[2] + 0.5])
                this.control._playAction(this.player, 'place')
                this.guide.note('placed', item)
                return
            }
            if (!inv.remove(item, 1)) return
            this.sync.submit({ t: 'block', x, y, z, b: item })
            this.audio.place([x + 0.5, y + 0.5, z + 0.5])
            this.control._playAction(this.player, 'place')
            this.guide.note('placed', item)
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
            this.guide.note('placed', item)
        }
    }

    /**
     * Night: put back a block the attackers destroyed, with the same block from
     * your stock. It's back at full strength, and dawn has nothing left to do there.
     */
    patch(at, item) {
        const [x, y, z] = at
        const w = this.world
        const destroyed = w.damage.get(x, y, z)
        if (!canPatch(destroyed, item)) {
            return this.hud.toast(destroyed === undefined ? 'At night you can only patch holes the attackers made' : `That hole needs a ${label(blockName(destroyed)).toLowerCase()}`, 'warn')
        }
        if (this.noa.entities.isTerrainBlocked(x, y, z)) return
        if (!this.inventory.remove(item, 1)) return
        w.restoreBlock(x, y, z)
        this.audio.place([x + 0.5, y + 0.5, z + 0.5])
        this.control._playAction(this.player, 'place')
        this.guide.note('patched', item)
        this.patches++
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
        // standing still: a body that was moving (falling) must not carry it into the ground
        const body = this.noa.entities.getPhysics(p.entity)?.body
        if (body) body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
        p.hp = p.maxHp
        p.alive = true
        p.respawnIn = 0
        p.deadTime = 0
        p.char.reset()
        const c = this.control
        const hud = this.hud
        // knocked out while you controlled it: back to your builder, unless you picked something else meanwhile
        if (c.autoReturn && c.mode === 'aerial') {
            c.returnToSelf()
            // the picker said "knocked out": it's done its job
            hud.closeRolePicker()
        } else if (hud.openName === 'role') {
            // still choosing: "Fight as yourself" is open again
            hud.showRolePicker('Your builder is back on its feet.')
        }
        c.autoReturn = false
        hud.toast(c.mode === 'self' ? 'You are back on your feet at the Town Center' : 'Your builder is back on its feet at the Town Center')
    }

    // ---- day / night --------------------------------------------------------------------

    requestNight() {
        // N at dawn skips the rest of the rebuild
        if (this.cycle.phase === 'dawn') return this.skipDawn()
        if (this.cycle.phase !== 'day') return
        if (this.cycle.creative) return this.hud.openPanel('night')
        this.startNight()
    }

    startNight(level = null) {
        if (this.cycle.phase !== 'day') return
        this.cycle.startNight(level)
    }

    /** the dawn banner's Skip: put the rest of the town back at once */
    skipDawn() {
        if (this.cycle.phase !== 'dawn') return
        this.rebuild.skip()
        this.cycle.skipDawn()
        this.hud.hideBanner()
        if (this._rebuildPin) this._rebuildPin.remove()
        this._rebuildPin = null
    }

    /** dawn: the town rebuilds itself, slowly enough to watch */
    _startRebuild() {
        const { cycle, hud } = this
        const plan = cycle.planDawn(this.world.damageCount)
        this.rebuild.start(plan, this.world.townCenter)
        this.cracks.clearAll()
        if (!this.rebuild.active) return plan
        // the first few dawns explain what's going on
        const text = cycle.day <= 3 ? 'Dawn: your town rebuilds itself after every night.' : 'Dawn: the town is rebuilding.'
        hud.banner(text, { kind: 'good', seconds: 0, action: { label: 'Skip (N)', fn: () => this.skipDawn() } })
        if (this.control.mode === 'self') {
            this._rebuildPin = hud.pin(this.world.townCenter, { kind: 'rebuild', label: 'rebuilding', edgeOnly: true })
        }
        return plan
    }

    /** defence value the waves scale with, outside the world: the builder's best weapon */
    get weaponValue() {
        return WEAPONS[this.inventory.bestWeapon].value
    }

    /** creative's night panel: what a night of this level would bring against the town as it stands */
    describeNight(level) {
        let seed = level * 9301
        const rnd = () => ((seed = (seed * 49297 + 233280) % 233280) / 233280)
        const plan = this.waves.plan(level, this.placements.values(), this.weaponValue, rnd)
        return `About ${plan.list.length} attackers: ${waveText(plan).makeup}`
    }

    openRolePicker() {
        const phase = this.cycle.phase
        if (!canChooseRole(phase)) return this.hud.toast('Roles are chosen at dusk and at night. Press N to start the night.')
        const p = this.player
        this.hud.showRolePicker(!p.alive ? `Your builder is knocked out — back in ${Math.ceil(p.respawnIn)} s.` : phase === 'dusk' ? 'The night is about to start.' : '')
    }

    chooseRole(kind, type) {
        const c = this.control
        if (!canChooseRole(this.cycle.phase)) return
        if (kind === 'self') {
            if (this.player.alive) c.returnToSelf()
            else this.hud.toast(`Your builder is knocked out — back in ${Math.ceil(this.player.respawnIn)} s`)
            return
        }
        c.autoReturn = false
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
        c.possess(alive[0])
    }

    onControlledDied(u) {
        this.hud.toast(`Your ${u ? label(u.type) : 'unit'} was defeated`, 'warn')
        if (canChooseRole(this.cycle.phase)) {
            this.control.enterAerial()
            this.hud.showRolePicker('You fell. Fight as yourself, pick another unit, or keep watching.')
        } else {
            this.control.returnToSelf()
        }
    }

    _wireEvents() {
        const { cycle, units, audio, hud, waves } = this
        cycle.on('phase', (phase) => {
            if (phase === 'dusk') {
                audio.horn()
                hud.closePanel()
                // the attack is planned now (nothing can be built from dusk on), so the banner says what's really coming
                this.nightPlan = waves.plan(cycle.activeLevel, this.placements.values(), this.weaponValue)
                const { makeup, why } = waveText(this.nightPlan)
                hud.banner(`Night ${cycle.activeLevel} is coming: ${makeup}.${why ? ' ' + why : ''}`, {
                    kind: 'warn', seconds: 10, action: { label: 'Change role (R)', fn: () => this.openRolePicker() },
                })
                for (const m of BUILTIN_MODELS) this.chars.load(m)
                this.inventory.selectBestWeapon()
            } else if (phase === 'night') {
                units.combat = true
                this.demolition.active = true
                if (hud.openName === 'role') hud.closePanel()
                if (cycle.opening) {
                    this.opening.start()
                    audio.horn()
                    // watch the town go down from above; the builder fights on its own
                    this.control.enterAerial()
                    this.control.frameFront(this.opening.angle, true, { ahead: 4, zoom: 58, pitch: 0.8 })
                    hud.banner(OPENING_TEXT.start, { kind: 'warn', seconds: 0, action: { label: 'Skip', fn: () => this.skipOpening() } })
                    setTimeout(() => hud.toast(OPENING_TEXT.hint), 2500)
                } else {
                    waves.startNight(cycle.activeLevel, [...this.placements.values()], this.weaponValue, this.nightPlan)
                    this.nightPlan = null
                }
            } else if (phase === 'dawn') {
                waves.stop()
                for (const u of [...units.units]) {
                    if (!u.alive || u.side !== 'attacker') continue
                    // the raiders leave the ruins; regular attackers are wiped out by the sunrise
                    if (cycle.opening) {
                        this.effects.burst(units.posOf(u), [0.6, 0.55, 0.5], 6, 2, 0.2, 0.8)
                        units.remove(u)
                    } else units.kill(u)
                }
                hud.closeRolePicker()
                if (this.control.mode !== 'self' && !(cycle.opening && this.control.mode === 'aerial')) this.control.returnToSelf()
                units.town.hp = units.town.maxHp
                this.pendingRole = null
                this.demolition.active = false
                this.demolition.reset()
                if (this.opening) this.opening.end()
                if (!this.player.alive) this.respawnPlayer()
                const plan = this._startRebuild()
                // after the opening raid, keep circling the town from above to watch it come back
                if (cycle.opening && this.control.mode === 'aerial') this.control.orbitTown(plan.total)
            } else if (phase === 'over') {
                // the end: the attackers stop and cheer over the ruins, nothing is rebuilt
                waves.stop()
                units.combat = false
                units.celebrating = true
                this.demolition.active = false
                this.pendingRole = null
                hud.hideBanner()
            } else if (phase === 'day') {
                audio.chime()
                hud.hideBanner()
                if (hud.openName === 'result') hud.closePanel()
                if (this._rebuildPin) this._rebuildPin.remove()
                this._rebuildPin = null
                // (dawn already did this; a role picked in between must not outlast the night)
                if (this.control.mode !== 'self') this.control.returnToSelf()
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
                this.player.hp = this.player.maxHp
                // a new day of digging and building: the pickaxe in hand (dusk took out your weapon)
                this.inventory.selectTool()
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
            } else if (cycle.over) {
                audio.defeat()
                this._gameOver()
            } else {
                audio.defeat()
                const left = cycle.creative ? '' : ` ${cycle.lives} ${cycle.lives === 1 ? 'life' : 'lives'} left.`
                hud.showResult(`Night ${level}: the Town Center fell.${left}`,
                    `The town will be rebuilt at dawn, and night ${level} comes again. Strengthen your defences.` + (cycle.lives === 1 ? ' If it falls once more, the game is over.' : ''))
            }
        })
        units.on('townDestroyed', () => {
            if (cycle.phase !== 'night') return
            if (this.opening) this.opening.onTownDestroyed()
            else cycle.endNight('lost')
        })
        units.on('died', (u) => {
            const p = units.posOf(u)
            audio.death(p)
            if (!u.isPlayer) return
            const fight = canChooseRole(cycle.phase)
            u.respawnIn = fight ? HERO.respawnSeconds : HERO.dayRespawnSeconds
            const c = this.control
            if (c.mode === 'self' && fight) {
                c.enterAerial()
                c.autoReturn = true
                hud.showRolePicker(`You were knocked out! Back on your feet in ${u.respawnIn} s — play as a unit meanwhile, or watch.`)
            } else if (c.mode === 'self') {
                hud.toast('You were knocked out! Respawning…', 'warn')
            } else {
                hud.toast(`Your builder was knocked out — back in ${u.respawnIn} s`, 'warn')
            }
        })
        units.on('hit', (u, amount, source) => {
            const p = units.posOf(u)
            audio.hit(p)
            const c = this.control
            // what you hit: a marker on the crosshair and the damage over its head
            if (source && source === c.controlled) {
                hud.hitMarker(u.hp <= 0)
                hud.damageNumber([p[0], p[1] + u.height + 0.5, p[2]], amount, u.hp <= 0)
            }
            // what hits you: red edges from that side, a jolt, and a shaken camera
            const mine = u === c.controlled || (u.isPlayer && c.mode !== 'possess')
            if (!mine) return
            let angle = null
            if (source && source.entity !== undefined) {
                const q = units.posOf(source)
                angle = Math.atan2(q[0] - p[0], q[2] - p[2]) - this.noa.camera.heading
            }
            hud.hurt(amount / Math.max(1, u.maxHp), c.mode === 'aerial' ? null : angle)
            if (c.mode !== 'aerial') {
                c.shake(Math.min(0.35, 0.12 + amount / Math.max(1, u.maxHp)))
                if (u.hp > 0) c.view.play('hit')
            }
        })
        units.on('shot', (u, kind) => audio.shoot(units.posOf(u), kind))
        units.on('melee', (u) => audio.swing(units.posOf(u)))
        units.on('towerFired', (t) => audio.shoot([t.x + 0.5, t.y + 1.5, t.z + 0.5], t.spec.projectile))
        units.on('townHit', () => {
            audio.townHit(units.town.pos)
            this.demolition.updateTownRuin()
            hud.flashTown()
            hud.alert('town', 'The Town Center is under attack!', units.town.pos, 3, 10)
        })
        units.on('explosion', (p) => audio.explosion(p))
        units.on('chargeLit', (u) => audio.fuse(units.posOf(u)))
        units.on('blockHit', (x, y, z, id, destroyed) => {
            const b = BLOCK_BY_ID[id]
            const m = soundMaterial(b?.name)
            const pos = [x + 0.5, y + 0.5, z + 0.5]
            if (destroyed) audio.breakBlock(pos, m)
            else audio.dig(pos, m)
            if (!b) return
            const tc = this.world.townCenter
            const side = compassName(Math.atan2(x + 0.5 - tc[0], z + 0.5 - tc[2]))
            if (b.tower) hud.alert(`tower${x},${z}`, `Your ${label(b.tower + '_tower')} is under attack!`, pos, 3, 15)
            else if (destroyed && (b.gate || isWallBlock(id))) {
                hud.alert(`breach-${side}`, `The ${side} wall is breached!`, pos, 4, 25)
                // the first breach of a night: it can be patched, with the block you carry
                if (this._patchHint !== cycle.activeLevel && cycle.phase === 'night' && !cycle.opening && this.inventory.count(b.name) > 0) {
                    this._patchHint = cycle.activeLevel
                    hud.toast(`Patch the breach: select ${label(b.name).toLowerCase()} and right click the hole`, 'warn')
                }
            }
            else if (b.gate) hud.alert(`gate-${side}`, `They're breaking the ${side} gate!`, pos, 3, 15)
        })
        units.on('spawned', (u) => {
            const pr = this.pendingRole
            if (pr && u.side === pr.kind && u.type === pr.type && this.control.mode === 'aerial') {
                this.pendingRole = null
                setTimeout(() => {
                    if (canChooseRole(cycle.phase)) this.control.possess(u)
                }, 200)
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
        this.world.on('blockDamaged', (x, y, z, fraction) => this.cracks.set(x, y, z, fraction))
        this.world.on('blockChanged', (x, y, z) => this.cracks.clear(x, y, z))
    }

    // ---- loop ------------------------------------------------------------------------------

    /** @param {number} dt seconds */
    tick(dt) {
        const { cycle, units, waves, world } = this
        cycle.update(dt, { damageRemaining: world.damageCount })
        units.phase = cycle.phase
        if (cycle.phase === 'dawn') {
            this.rebuild.tick(dt)
            const focus = this.rebuild.focus
            if (this._rebuildPin && focus) this._rebuildPin.pos.splice(0, 3, ...focus)
        }
        if (cycle.phase === 'night') {
            if (this.opening) this.opening.tick(dt)
            else if (units.town.hp <= 0) cycle.endNight('lost')
            else if (waves.cleared) cycle.endNight('survived')
        }
        if (cycle.phase === 'day' && units.combat && units.aliveAttackers() === 0) units.combat = false
        waves.tick(dt, { day: cycle.phase === 'day', skirmish: this.def.skirmish && !cycle.creative })
        this.demolition.tick()
        units.tick(dt)
        this.towers.tick(dt)
        this.effects.tick(dt, (p, pos) => units.projectileHit(p, pos))
        this.control.tick(dt)
        this.guide.tick(dt)
        this._tickPlayer(dt)
        this._keepInBounds()

        this._saveTimer -= dt
        if (this._saveTimer <= 0) {
            this._saveTimer = AUTOSAVE_SECONDS
            if (cycle.phase === 'day') this.autosave()
        }
    }

    /** knocked-out countdown, and the autopilot's weapon */
    _tickPlayer(dt) {
        const p = this.player
        if (!p.alive) {
            // after the game is over nobody gets up
            if (this.cycle.over) return
            p.respawnIn -= dt
            if (p.respawnIn <= 0) this.respawnPlayer()
            return
        }
        if (this.control.mode !== 'self' && this.units.combat) {
            const w = this.inventory.bestWeapon
            this.units.setPlayerWeapon(w, HERO.autopilotDamage)
            p.char.setItem(WEAPONS[w].item, undefined, WEAPONS[w].tint || null)
        }
    }

    _keepInBounds() {
        const half = this.world.half
        const ents = this.noa.entities
        for (const u of this.units.units) {
            const p = this.units.posOf(u)
            const body = ents.getPhysics(u.entity)?.body
            if (!u.alive) {
                // a knocked-out builder's body that fell through the world: stop it there (it gets up at the Town Center)
                if (p[1] < -40 && body) {
                    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
                    body.gravityMultiplier = 0
                }
                continue
            }
            if (p[1] < -40) {
                // fell out of the world
                if (u.isPlayer) this.respawnPlayer()
                else this.units.kill(u)
                continue
            }
            // stuck inside the terrain (a block was placed or fell onto it): up to where it fits.
            // Otherwise the physics lets it sink through the ground (seen with the knocked-out builder)
            const up = unstuckY(this._solid, p)
            if (up !== null) {
                ents.setPosition(u.entity, [p[0], up + 0.01, p[2]])
                if (body) body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
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
        this.healthBars.render(dtMs, this.control)
        this.cracks.render()
        this.rebuild.render(dtMs)
        this.hud.renderFloaters(dtMs)
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

    /** @param {boolean} on */
    setHealthBars(on) {
        setSetting('hpBars', on)
        this.healthBars.setEnabled(on)
    }

    setQuality(name) {
        const tier = TIERS[name]
        if (!tier) return
        this.tier = tier
        this.units.tier = tier
        this.healthBars.tier = tier
        this.waves.tier = tier
        this.effects.particleScale = tier.particles
        const noa = this.noa
        noa.rendering.engine.setHardwareScalingLevel(tier.hardwareScaling)
        noa.world.setAddRemoveDistance(tier.chunkAddDistance, tier.chunkRemoveDistance)
        this.sky.setFogEnd(tier.fogEnd)
    }

    setMuted(on) {
        setSetting('muted', on)
        this.audio.setMuted(on)
    }

    /** from the settings checkbox: remembered for next time */
    setFps(on) {
        setSetting('fps', on)
        this.showFps(on)
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
            lives: this.cycle.lives,
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

    /** the last life went: the score, and no save to continue from */
    _gameOver() {
        const nights = this.cycle.nightsSurvived
        const best = Object.assign({}, /** @type {Record<string, number>} */ (getSetting('best')))
        const key = this.sourceId || 'new'
        const before = best[key] || 0
        if (nights > before) {
            best[key] = nights
            setSetting('best', best)
        }
        idbDelete(AUTOSAVE_KEY)
        if (this.control.mode !== 'aerial') this.control.enterAerial()
        this.hud.showGameOver({ nights, previous: before, restartId: this.sourceId })
    }

    autosave() {
        // a finished game isn't saved: Continue would bring back the ruins
        if (this.cycle.over) return
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
