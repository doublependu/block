/*
 *  What happened, for the report: game events (listened to, never changed),
 *  per-night totals, toasts and banners (read from the DOM), and one telemetry
 *  line a second. Sent to the harness in batches.
 */

import { blockName, BLOCK_BY_ID } from '../../../src/world/blocks.js'

/** who did it: builder, tower:arrow, troop:archer, attacker:brute, spikes, … */
export function sourceKind(s) {
    if (!s) return 'none'
    if (s === 'spikes') return 'spikes'
    if (typeof s !== 'object') return String(s)
    if (s.isPlayer) return 'builder'
    if (s.spec && s.head) return 'tower:' + s.type
    if (s.def) return (s.side === 'defender' ? 'troop:' : 'attacker:') + s.type
    return 'other'
}

const add = (o, k, n = 1) => (o[k] = (o[k] || 0) + n)

export class Logger {
    constructor(game) {
        this.g = game
        this.queue = []
        this.t0 = performance.now()
        /** the night being counted */
        this.night = null
        /** totals for the whole game */
        this.total = { kills: {}, builderDeaths: 0, crafted: {}, placed: {}, mined: {} }
        this.frame = { max: 0, over50: 0, last: performance.now(), n: 0 }
        /** seconds of each bot activity, per phase */
        this.activity = {}
        this.bot = null
    }

    get t() {
        return +((performance.now() - this.t0) / 1000).toFixed(2)
    }

    event(e) {
        this.queue.push({ t: this.t, ...e })
    }

    _safe(fn) {
        return (...a) => {
            try {
                fn(...a)
            } catch (err) {
                this.event({ type: 'logger-error', message: String(err && err.message) })
            }
        }
    }

    start() {
        const g = this.g
        const on = (em, name, fn) => em.on(name, this._safe(fn))
        on(g.cycle, 'phase', (phase) => {
            const c = g.cycle
            this.event({ type: 'phase', phase, day: c.day, level: c.activeLevel, nightLevel: c.nightLevel, opening: !!c.opening, result: phase === 'dawn' ? c.lastResult : undefined })
            if (phase === 'night') this.night = { level: c.activeLevel, opening: !!c.opening, start: this.t, kills: {}, spawned: 0, townDamage: 0, builderDamage: 0, builderDealt: 0, builderDeaths: 0, destroyed: {}, minTown: g.units.town.hp, defence: this._defence(), patches0: g.patches || 0, wave: this._wave }
        })
        on(g.cycle, 'nightOver', (result, level) => {
            const n = this.night || {}
            this.event({
                type: 'nightOver', result, level, opening: !!g.cycle.opening, seconds: +(this.t - (n.start || this.t)).toFixed(1),
                townHp: Math.round(g.units.town.hp), minTown: Math.round(n.minTown ?? g.units.town.hp), townMax: g.units.town.maxHp,
                spawned: n.spawned, kills: n.kills, townDamage: Math.round(n.townDamage || 0),
                builderDamage: Math.round(n.builderDamage || 0), builderDealt: Math.round(n.builderDealt || 0), builderDeaths: n.builderDeaths,
                destroyed: n.destroyed, towersLeft: g.towers.activeCount, towers: g.towers.count, defence: n.defence,
                troops: g.placements.size, lives: g.cycle.lives, over: !!g.cycle.over, patches: (g.patches || 0) - (n.patches0 || 0),
                wave: n.wave || null,
            })
            this.night = null
        })
        // what the night brings (and, since iteration 7, why)
        on(g.waves, 'nightStarted', (info) => {
            this.event({ type: 'nightStarted', ...info })
            this._wave = { counts: info.counts, answer: info.answer, answers: info.answers }
            if (this.night) this.night.wave = this._wave
        })
        on(g.units, 'spawned', (u) => {
            if (u.side === 'attacker' && this.night) this.night.spawned++
        })
        on(g.units, 'died', (u, source) => {
            const k = sourceKind(source)
            if (u.side === 'attacker') {
                add(this.total.kills, k)
                if (this.night) add(this.night.kills, k)
            } else {
                if (u.isPlayer) {
                    this.total.builderDeaths++
                    if (this.night) this.night.builderDeaths++
                }
                this.event({ type: 'died', who: u.isPlayer ? 'builder' : u.type, by: k, phase: g.cycle.phase })
            }
        })
        on(g.units, 'hit', (u, amount, source) => {
            if (!this.night) return
            if (u.isPlayer) this.night.builderDamage += amount
            else if (source && source.isPlayer) this.night.builderDealt += amount
        })
        on(g.units, 'townHit', (amount) => {
            if (!this.night) return
            this.night.townDamage += amount
            this.night.minTown = Math.min(this.night.minTown, g.units.town.hp)
        })
        on(g.world, 'blockDestroyed', (x, y, z, id) => {
            if (this.night && BLOCK_BY_ID[id]?.built) add(this.night.destroyed, blockName(id))
        })
        on(g.inventory, 'crafted', (name) => add(this.total.crafted, name))
        on(g.world, 'blockChanged', (x, y, z, id, prev) => {
            if (g.cycle.phase !== 'day') return
            if (prev === 0 && id) add(this.total.placed, blockName(id))
            else if (id === 0 && prev && !BLOCK_BY_ID[prev]?.built) add(this.total.mined, blockName(prev))
        })
        // what the player is told: toasts and banners
        const watch = (sel, kind) => {
            const el = document.querySelector(sel)
            if (!el) return
            new MutationObserver((muts) => {
                for (const m of muts) {
                    for (const n of m.addedNodes) {
                        if (kind === 'toast' && n instanceof HTMLElement) this.event({ type: 'toast', text: n.textContent, kind: n.className.replace('toast', '').trim() })
                    }
                }
                if (kind === 'banner' && !el.hidden) this.event({ type: 'banner', text: el.querySelector('.banner-text')?.textContent })
            }).observe(el, kind === 'toast' ? { childList: true } : { attributes: true, childList: true, subtree: true, characterData: true })
        }
        watch('#hud .toasts', 'toast')
        watch('#hud .banner', 'banner')
        let lastPanel = null
        document.addEventListener('pointerlockchange', () => this.event({ type: 'pointerlock', locked: !!document.pointerLockElement, panel: g.hud.openName }))
        // frame times, every frame
        const loop = (now) => {
            const d = now - this.frame.last
            this.frame.last = now
            this.frame.max = Math.max(this.frame.max, d)
            if (d > 50) this.frame.over50++
            this.frame.n++
            const panel = g.hud.openName
            if (panel !== lastPanel) {
                this.event({ type: 'panel', panel })
                lastPanel = panel
            }
            if (this.night) this.night.minTown = Math.min(this.night.minTown, g.units.town.hp)
            requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)
        setInterval(this._safe(() => this._second()), 1000)
        // --diag: what's still alive after a full garbage collection
        const w = /** @type {any} */ (window)
        if (w.__AP_CONFIG && w.__AP_CONFIG.diag && w.gc) setInterval(this._safe(() => this._diag()), 30000)
    }

    _diag() {
        const w = /** @type {any} */ (window)
        w.gc()
        const g = this.g
        const scene = g.noa.rendering.getScene()
        const mem = /** @type {any} */ (performance).memory
        this.event({
            type: 'diag', heapMB: +(mem.usedJSHeapSize / 1e6).toFixed(1), phase: g.cycle.phase, day: g.cycle.day,
            meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length,
            transformNodes: scene.transformNodes.length, animationGroups: scene.animationGroups.length, skeletons: scene.skeletons.length,
            geometries: scene.geometries.length, particleSystems: scene.particleSystems.length, lights: scene.lights.length,
            observers: scene.onBeforeRenderObservable.observers.length, units: g.units.units.length, entities: Object.keys(g.noa.ents._storage || {}).length || null,
            edits: g.world.edits.count, damage: g.world.damage.size ?? null, effects: g.effects.projectiles ? g.effects.projectiles.length : null,
        })
    }

    _defence() {
        try {
            return Math.round(g_defence(this.g))
        } catch {
            return null
        }
    }

    _second() {
        const g = this.g
        const bot = this.bot
        const act = bot ? bot.skills.activity : 'idle'
        const key = `${g.cycle.phase}:${act}`
        add(this.activity, key)
        const mem = /** @type {any} */ (performance).memory
        const p = g.units.posOf(g.player)
        const tele = {
            t: this.t, phase: g.cycle.phase, day: g.cycle.day, level: g.cycle.activeLevel, nightLevel: g.cycle.nightLevel,
            cycleT: +g.cycle.t.toFixed(1), fps: +g.noa.rendering.engine.getFps().toFixed(1), frames: this.frame.n,
            maxFrame: +this.frame.max.toFixed(1), over50: this.frame.over50, heapMB: mem ? +(mem.usedJSHeapSize / 1e6).toFixed(1) : null,
            units: g.units.units.length, attackers: g.units.aliveAttackers(), remaining: g.cycle.phase === 'night' ? g.waves.remaining : 0,
            townHp: Math.round(g.units.town.hp), hp: Math.round(g.player.hp), alive: g.player.alive, mode: g.control.mode,
            pos: [+p[0].toFixed(1), +p[1].toFixed(1), +p[2].toFixed(1)], towers: g.towers.activeCount, troops: g.placements.size,
            inv: { ...g.inventory.items }, weapon: g.inventory.bestWeapon, tier: g.tier.name, activity: act, locked: !!document.pointerLockElement,
            panel: g.hud.openName, botMs: bot ? +bot.cpu.toFixed(2) : 0, blocked: bot ? bot.violations() : 0,
        }
        // the last few attackers of a night: where they are and what they're doing (a stalled night)
        if (g.cycle.phase === 'night' && tele.attackers > 0 && tele.attackers <= 3 && Math.round(this.t) % 10 === 0) {
            const list = []
            for (const u of g.units.units) {
                if (!u.alive || u.side !== 'attacker') continue
                const q = g.units.posOf(u)
                const r = (v) => (v ? v.slice(0, 4).map((x) => (typeof x === 'number' ? +x.toFixed(1) : x)) : null)
                list.push({
                    type: u.type, pos: r(q), hp: Math.round(u.hp), active: u.active, moveTo: r(u.moveTo), attackBlock: r(u.attackBlock),
                    siege: r(u.siegeTarget), target: u.target ? u.target.type : null, attackTown: u.attackTown, stuck: +(u.stuckTime || 0).toFixed(1),
                    crowd: +(u.crowdTime || 0).toFixed(1), walk: !!u.walk, breaking: !!u.breaking, sinceUseful: Math.round((performance.now() - (u.lastUseful || 0)) / 1000),
                    loaded: g.units.chunkLoaded(q[0], q[1], q[2]),
                })
            }
            this.event({ type: 'lastAttackers', cycleT: tele.cycleT, list })
        }
        this.frame.max = 0
        this.frame.over50 = 0
        this.frame.n = 0
        if (bot) bot.cpu = 0
        const w = /** @type {any} */ (window)
        if (w.__apTelemetry) w.__apTelemetry(tele)
        this.flush()
    }

    flush() {
        const w = /** @type {any} */ (window)
        if (!this.queue.length || !w.__apEvents) return
        const list = this.queue
        this.queue = []
        w.__apEvents(list)
    }

    summary() {
        return { total: this.total, activity: this.activity }
    }
}

/** the defence value the waves scale with (same sum as WaveDirector.defenceValue + the weapon) */
function g_defence(g) {
    return g.waves.defenceValue(g.placements.values()) + g.weaponValue
}
