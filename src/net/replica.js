/*
 *  The replica: showing everybody in a room the same players and the same night.
 *
 *  The world's permanent changes go through the room's log (net/room.js).
 *  Everything here is the part that is not permanent, and that one page has to
 *  decide for the others: where the troops and the attackers are, what the
 *  night has knocked down, what phase the day is in. docs/protocol.md settled
 *  long ago who decides: the host. So:
 *
 *    the host     runs the whole simulation, as a single-player game does, and
 *                 says what it sees: every unit ten times a second (`un`, bytes,
 *                 droppable), each block the night destroys or a patch puts
 *                 back (`dm`, `rs`), what happens in the fight, for its sounds,
 *                 alerts and cracks (`ev`), and the phase and the numbers of
 *                 the game once a second and whenever they change (`st`).
 *    the others   simulate nothing but their own builder. They draw the units
 *                 where the host says (UnitManager.spawnRemote), knock down the
 *                 blocks it names, and follow its phases (DayCycle.follow).
 *                 What they do to the world of the night they ask the host
 *                 for: a blow on an attacker (`hit`), a patched hole
 *                 (`patch`), starting the night (`night`), skipping the dawn
 *                 (`skip`).
 *    everybody    says where their own builder is and what it does with its
 *                 hands (presence), and draws the other builders from that.
 *                 Each page says what it shoots (`fx`): the host its troops',
 *                 towers' and attackers' shots and its own, everybody else
 *                 their own. The others draw those shots harmless: what a shot
 *                 hits is decided where it was fired. On the host the builders
 *                 are also things an attacker can go for; a blow on one is sent
 *                 to the player it belongs to (`hurt`), whose page is the one
 *                 that counts its health.
 *
 *  When the host leaves, the next host has been drawing every unit and knows
 *  where each one stands and how hurt it is. It makes them its own (`lead`),
 *  and they carry on; what it cannot know is what the old host had planned,
 *  so no further wave arrives that night.
 *
 *  What comes in from the room is somebody else's data: anything that is not
 *  the shape it should be is ignored.
 */

import { Smooth } from '@p3p2/client/smooth'
import { UNITS, WEAPONS, FIREBALL } from '../game/balance.js'
import { swingSound, bowSounds, shotSound, placeSound, soundMaterial } from '../audio/sounds.js'
import { NO_FRONT } from '../game/waves.js'

const UNIT_TYPES = Object.keys(UNITS)
const PHASES = ['day', 'dusk', 'night', 'dawn', 'over']
/** what a unit does with its arms, as the host's report says (`netAct`) */
const ACTIONS = ['', 'attack', 'shoot', 'cast', 'mine', 'hit']
/** what a builder does with its arms, as its player's presence says */
export const HERO_ACTIONS = ['', 'attack', 'attack_fist', 'shoot', 'shoot_draw', 'mine', 'place', 'hit']

const UNITS_HZ = 10
const STATE_SECONDS = 1
const HERO_MOVING = 1 / 12
const HERO_STILL = 1
/** bytes for one unit in `un`, and for what comes before them; the format's number */
const UNIT_BYTES = 19
const HEAD_BYTES = 6
const UNITS_FORMAT = 2
/** places are sent in fiftieths of a block: two centimetres, in sixteen bits */
const SCALE = 50
const NO_POST = 255
/** the most of each that go out in one tick, and that are taken from one message */
const MAX_SHOTS = 40
const MAX_EVENTS = 60
/** a friend's name is shown over their head this near (metres) */
const NAME_RANGE = 40

/**
 * The fight's events (units.js) whose sounds and alerts the others need. A
 * unit in them goes as a reference (`ref`); the rest are numbers and names.
 * Deaths aren't here (each page kills the units it is told are down, and
 * hears that), nor impacts (each page flies the shots it draws).
 */
const EVENTS = ['shot', 'melee', 'hit', 'townHit', 'explosion', 'frozen', 'thawed', 'castStarted', 'castLost', 'chargeLit', 'blockHit', 'towerFired']

const round2 = (v) => Math.round(v * 100) / 100
const finite = (a, from, to) => {
    for (let i = from; i < to; i++) if (typeof a[i] !== 'number' || !isFinite(a[i])) return false
    return true
}

/**
 * pure: an action counter, as a unit's report and a builder's presence carry it:
 * which action (the low 3 bits) and how many so far (the rest), so that the same
 * action twice running is still two actions.
 * @param {number} prev the counter so far
 * @param {number} kind index in the list of actions (1..7)
 */
export function nextAct(prev, kind) {
    return ((((prev >> 3) + 1) & 31) << 3) | kind
}

/**
 * pure: what a builder's presence says, checked, or null: [x, y, z, yaw, speed,
 * alive, item, tint, tile, act, actSpeed, name].
 * @param {unknown} p
 */
export function readHero(p) {
    if (!Array.isArray(p) || p.length < 6 || !finite(p, 0, 6)) return null
    const str = (v) => (typeof v === 'string' && v ? v.slice(0, 32) : null)
    const tint = Array.isArray(p[7]) && p[7].length <= 4 && finite(p[7], 0, p[7].length) ? p[7] : null
    return {
        pos: [p[0], p[1], p[2]], yaw: p[3], speed: p[4], alive: p[5] !== 0,
        item: str(p[6]), tint, tile: str(p[8]),
        act: Number.isInteger(p[9]) ? p[9] : 0,
        actSpeed: typeof p[10] === 'number' && p[10] > 0 && p[10] < 10 ? p[10] : 1,
        name: str(p[11]),
    }
}

/**
 * pure: the sound a builder's action makes, for the others (the actor's page
 * plays its own). `name` is what it holds: a weapon or a block (Control.held).
 * @param {string} action HERO_ACTIONS
 * @param {string | null} name
 * @returns {string | null}
 */
export function heroSound(action, name) {
    if (action === 'attack' || action === 'attack_fist') return swingSound(name || '')
    if (action === 'shoot_draw') return bowSounds(name || '').draw
    if (action === 'place') return placeSound(soundMaterial(name || ''))
    return null
}

/**
 * pure: the sound of a player's shot leaving, for the others: a bow's string,
 * or the shot itself (a musket).
 * @param {string} kind projectile
 * @param {string | null} weapon what the player holds
 */
export function heroShotSound(kind, weapon) {
    const w = weapon && WEAPONS[weapon]
    if (w && w.item && w.item.endsWith('bow')) return bowSounds(weapon).release
    return shotSound(kind)
}

export class Replica {
    /**
     * @param {any} session the game (game/session.js)
     * @param {import('./room.js').Net} net
     */
    constructor(session, net) {
        this.s = session
        this.net = net
        /** @type {any} */
        this.room = null
        /** what the host said the coming night holds, for the banner at dusk */
        this.duskText = ''
        /** units drawn for the host: its unit id -> our unit; builders: member id -> our unit */
        this.byId = new Map()
        this.heroes = new Map()
        this.unitSmooth = new Smooth({ angles: [3], jump: 12 })
        this.heroSmooth = new Smooth({ angles: [3], jump: 12 })
        this._offs = []
        this._leading = false
        this._unitsTimer = 0
        this._stateTimer = 0
        this._heroTimer = Infinity
        this._heroSent = ''
        this._down = []
        this._back = []
        this._shots = []
        this._events = []
        /** this page's builder: what it last did with its hands (see nextAct) */
        this._act = 0
        this._actSpeed = 1
        this._actSent = 0
        /** set while drawing what somebody else said: none of it is passed on again */
        this._hearing = false
        /** this page took a night over half way: it ends when the attackers that are left are gone */
        this._tookOver = false
        this._v = []
        this._hookGame()
    }

    // ---- wiring -------------------------------------------------------------------------

    /** the things the game does that the room has to hear of; hooked once, live only in a room */
    _hookGame() {
        const { units, world, effects, cycle, fireballs, demolition } = this.s
        const leading = () => this._leading && !!this.room && !this._hearing
        // a blow that is somebody else's to count
        units.on('remoteHit', (u, amount, source) => {
            const r = this.room
            if (!r) return
            if (u.hero !== null) {
                if (r.isHost) r.send('hurt', round2(amount), { to: u.hero })
            } else if (!r.isHost && u.netId !== undefined) {
                // the host counts it, and says who struck it: this player's builder, or the unit it plays
                r.send('hit', [u.netId, round2(amount), source && source.isPlayer ? 1 : 0], { to: 'host' })
            }
        })
        // the night's damage, as the host does it
        world.on('blockDestroyed', (x, y, z) => {
            if (leading()) this._down.push([x, y, z])
        })
        world.on('blockRestored', (x, y, z) => {
            // the dawn puts everything back on every page by itself; only a patch is news
            if (leading() && cycle.phase === 'night') this._back.push([x, y, z])
        })
        world.on('blockDamaged', (x, y, z, fraction) => {
            if (leading()) this._event(['crack', x, y, z, round2(fraction)])
        })
        // every shot this page looses: the host's all, anybody else's their own (`mine`)
        effects.onLaunch = (p) => {
            if (!this.room || this._hearing || this._shots.length >= MAX_SHOTS) return
            const mine = !!p.owner && p.owner === this.s.player
            if (!this._leading && !mine) return
            const at = p.pos, v = p.vel
            this._shots.push([p.kind, round2(at[0]), round2(at[1]), round2(at[2]), round2(v[0]), round2(v[1]), round2(v[2]), p.side === 'attacker' ? 1 : 0, mine ? 1 : 0])
        }
        // a fire mage's fireball, thrown: the others draw it, harmless
        const throwBall = fireballs.throw.bind(fireballs)
        fireballs.throw = (from, to, owner) => {
            throwBall(from, to, owner)
            if (leading()) this._event(['fb', ...from.map(round2), ...to.map(round2), this._ref(owner)])
        }
        // a sapper's keg: the blast, without what it knocks down (that comes as `dm`)
        const explode = demolition.explode.bind(demolition)
        demolition.explode = (pos, spec, owner) => {
            explode(pos, spec, owner)
            if (leading()) this._event(['boom', ...pos.map(round2)])
        }
        // what the fight sounds like, and what the HUD says of it
        for (const name of EVENTS) {
            units.on(name, (...args) => {
                if (leading()) this._event(this._encode(name, args))
            })
        }
        this.s.waves.on('subwave', (n, fronts) => {
            if (leading()) this._event(['wave', n, fronts.map((f) => [f.name, round2(f.angle)])])
        })
        this.s.waves.on('skirmish', (n, from) => {
            if (leading()) this._event(['skirmish', n, from])
        })
        // what a unit is doing with its arms, for the pages that only draw it
        units.on('spawned', (u) => this._watchActions(u))
        for (const u of units.units) this._watchActions(u)
        cycle.on('phase', () => {
            if (this._leading && this.room) this._sayState(true)
        })
    }

    _watchActions(u) {
        if (u.remote || !u.char || u.char._watched) return
        u.char._watched = true
        const play = u.char.playAction.bind(u.char)
        u.netAct = 0
        // this page's own builder: in its presence, for the others to see (and hear)
        if (u.isPlayer) {
            u.char.playAction = (name, speed = 1, ...rest) => {
                const kind = HERO_ACTIONS.indexOf(name)
                if (kind > 0) {
                    this._act = nextAct(this._act, kind)
                    this._actSpeed = round2(speed)
                }
                return play(name, speed, ...rest)
            }
            return
        }
        u.char.playAction = (name, ...rest) => {
            const kind = ACTIONS.indexOf(name)
            if (kind > 0) u.netAct = nextAct(u.netAct, kind)
            return play(name, ...rest)
        }
    }

    /** the game is in room `r` from here on */
    start(r) {
        this.room = r
        this._leading = r.isHost
        const on = (channel, fn) => this._offs.push(r.on(channel, fn))
        const fromHost = (fn) => (data, from) => {
            if (from && from === r.host && !r.isHost) fn(data)
        }
        on('un', fromHost((bytes) => this._hearUnits(bytes)))
        on('st', fromHost((state) => this._hearState(state)))
        on('dm', fromHost((cells) => this._hearDamage(cells, true)))
        on('rs', fromHost((cells) => this._hearDamage(cells, false)))
        on('ev', fromHost((events) => this._hearEvents(events)))
        on('fx', (shots, from) => {
            if (from && from !== r.self) this._hearShots(shots, from)
        })
        on('hurt', fromHost((amount) => {
            if (typeof amount === 'number' && amount > 0 && amount < 1e4) this.s.units.damage(this.s.player, amount, null)
        }))
        // what the others ask of the host
        on('hit', (data, from) => {
            if (!r.isHost || !from || !Array.isArray(data)) return
            const u = this._realById(data[0])
            const by = this.heroes.get(from.id) || null
            if (u && typeof data[1] === 'number' && data[1] > 0 && data[1] < 1e4) this.s.units.damage(u, data[1], data[2] === 1 ? by : null)
        })
        on('patch', (cell, from) => {
            if (r.isHost && from && Array.isArray(cell) && cell.length === 3 && cell.every(Number.isInteger)) this.s.world.restoreBlock(cell[0], cell[1], cell[2])
        })
        on('night', (_data, from) => {
            if (r.isHost && from) this.s.requestNight(true)
        })
        // the dawn's Skip: asked of the host, and then done by everybody when the host does it
        on('skip', (_data, from) => {
            if (!from) return
            if (r.isHost) this.s.skipDawn()
            else if (from === r.host) this.s.skipDawn(true)
        })
        this._offs.push(r.presence.on((member, p, at) => this._hearHero(member, p, at)))
        on('member-leave', (member) => this._dropHero(member.id))
        on('member-join', (member) => {
            if (!r.isHost) return
            // what the night has knocked down so far, for somebody who walks into the middle of it
            const cells = []
            this.s.world.damage.forEach((x, y, z) => cells.push([x, y, z]))
            for (let i = 0; i < cells.length; i += 400) r.send('dm', cells.slice(i, i + 400), { to: member.id })
            this._sayState(true)
        })
        // A builder whose player's tab is in the background can't fight back: attackers leave it
        // alone until it is here again. One whose page is gone (closed, or its connection down)
        // isn't drawn: the room keeps its place a while in case it was a reload, and it comes back
        // with its presence if it does.
        on('member-state', (member, state) => {
            if (state === 'lost') return this._dropHero(member.id)
            const u = this.heroes.get(member.id)
            if (u) u.active = state === 'here'
            else this._hearHero(member, r.presence.get(member), r.presence.at(member))
        })
        for (const m of r.members) this._hearHero(m, r.presence.get(m), r.presence.at(m))
        if (!this._leading) this.follow()
    }

    /** out of the room: nothing is drawn for anybody any more */
    stop() {
        for (const off of this._offs) off()
        this._offs = []
        this.room = null
        for (const id of [...this.heroes.keys()]) this._dropHero(id)
    }

    hostChanged() {
        const r = this.room
        if (!r) return
        if (r.isHost && !this._leading) this.lead()
        else if (!r.isHost && this._leading) this.follow()
    }

    /** ask the host for something only it can do */
    ask(what, data = null) {
        return !!this.room && this.room.send(what, data, { to: 'host' })
    }

    /** the host skipped the dawn (session.js skipDawn): everybody else does too */
    skipped() {
        if (this.room && this._leading) this.room.send('skip', 1)
    }

    // ---- leading and following ----------------------------------------------------------

    /**
     * This page stops deciding and starts drawing: everything it was simulating
     * goes, and comes back as the host's.
     */
    follow() {
        const { units, waves, demolition } = this.s
        this._leading = false
        this._tookOver = false
        waves.stop()
        waves.coming = 0
        demolition.active = false
        for (const u of [...units.units]) if (!u.isPlayer && !u.remote) units.remove(u)
    }

    /**
     * This page is the host now. Every unit it was drawing for the old host
     * becomes one it simulates, where it stands and as hurt as it is.
     */
    lead() {
        const s = this.s
        const { units, cycle } = s
        this._leading = true
        // what the old host had still to send is lost with it (no further wave that night)
        s.waves.coming = 0
        const posts = [...s.placements.keys()].sort()
        for (const [id, old] of [...this.byId]) {
            const pos = old.netPos.slice()
            const alive = old.alive
            const share = old.maxHp > 0 ? old.hp / old.maxHp : 1
            const type = old.type, yaw = old.yaw, post = posts[old.netPost]
            units.remove(old)
            this.byId.delete(id)
            this.unitSmooth.delete(id)
            // one that was already down stays down, and is not carried over
            if (!alive) continue
            const p = post ? s.placements.get(post) : null
            const u = units.spawn(type, pos, { placementId: p ? p.id : undefined, yaw })
            if (p) u.post = p.pos.slice()
            u.hp = Math.max(1, Math.round(u.maxHp * share))
        }
        const night = cycle.phase === 'night'
        units.combat = night
        s.demolition.active = night
        this._tookOver = night
        // by day the troops belong at their posts: anybody missing is put back
        if (cycle.phase === 'day') {
            for (const p of s.placements.values()) {
                if (!units.units.some((u) => u.placementId === p.id)) s._spawnPlacement(p)
            }
        }
        this._sayState(true)
    }

    // ---- every tick and every frame -----------------------------------------------------

    tick(dt) {
        const r = this.room
        if (!r) return
        this._sayHero(dt)
        const alone = r.members.length < 2
        // everybody's own shots
        if (this._shots.length) {
            if (!alone) r.send('fx', this._shots, { volatile: true })
            this._shots = []
        }
        if (!this._leading) return
        const s = this.s
        if (this._tookOver && s.cycle.phase === 'night' && s.units.aliveAttackers() === 0) {
            this._tookOver = false
            s.cycle.endNight('survived')
        }
        if (alone) {
            this._down.length = this._back.length = this._events.length = 0
            return
        }
        if (this._down.length) r.send('dm', this._down.splice(0, 400))
        if (this._back.length) r.send('rs', this._back.splice(0, 400))
        if (this._events.length) r.send('ev', this._events.splice(0), { volatile: true })
        this._unitsTimer -= dt
        if (this._unitsTimer <= 0) {
            this._unitsTimer = 1 / UNITS_HZ
            r.send('un', this._units(), { volatile: true })
        }
        this._stateTimer -= dt
        if (this._stateTimer <= 0) this._sayState(false)
    }

    render(dt) {
        if (!this.room) return
        const now = performance.now()
        const place = (smooth, id, u) => {
            const v = smooth.get(id, now, this._v)
            if (!v) return
            const before = u.netPos
            const speed = dt > 0 ? Math.hypot(v[0] - before[0], v[2] - before[2]) / dt : 0
            // eased, so that the walk does not flicker between two paces
            u.netSpeed += (speed - u.netSpeed) * Math.min(1, dt * 8)
            u.netPos = [v[0], v[1], v[2]]
            u.yaw = v[3]
        }
        for (const [id, u] of this.byId) place(this.unitSmooth, id, u)
        const eye = this.s.noa.camera.getPosition()
        for (const [id, u] of this.heroes) {
            place(this.heroSmooth, id, u)
            if (!u.tag) continue
            const p = u.netPos
            const near = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) < NAME_RANGE
            u.tag.set([p[0], p[1] + u.height + 0.35, p[2]], near && u.alive)
        }
    }

    // ---- the host says ------------------------------------------------------------------

    /** every unit the host simulates, in bytes: see `_hearUnits` for the other end */
    _units() {
        const s = this.s
        const list = s.units.units.filter((u) => !u.isPlayer && !u.remote)
        const posts = [...s.placements.keys()].sort()
        const out = new DataView(new ArrayBuffer(HEAD_BYTES + list.length * UNIT_BYTES))
        const town = s.units.town
        out.setUint8(0, UNITS_FORMAT)
        out.setUint8(1, PHASES.indexOf(s.cycle.phase))
        out.setUint16(2, Math.round(65535 * Math.max(0, Math.min(1, town.hp / Math.max(1, town.maxHp)))), true)
        out.setUint16(4, list.length, true)
        let at = HEAD_BYTES
        for (const u of list) {
            const p = s.units.posOf(u)
            const post = u.placementId ? posts.indexOf(u.placementId) : -1
            out.setUint32(at, u.uid, true)
            out.setUint8(at + 4, Math.max(0, UNIT_TYPES.indexOf(u.type)))
            out.setUint8(at + 5, (u.alive ? 1 : 0) | (u.frozenT > 0 ? 2 : 0) | (u.cheer ? 4 : 0))
            out.setInt16(at + 6, Math.round(p[0] * SCALE), true)
            out.setInt16(at + 8, Math.round(p[1] * SCALE), true)
            out.setInt16(at + 10, Math.round(p[2] * SCALE), true)
            out.setUint8(at + 12, Math.round((((u.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 256) & 255)
            out.setUint8(at + 13, Math.round(255 * Math.max(0, Math.min(1, u.hp / Math.max(1, u.maxHp)))))
            out.setUint8(at + 14, u.netAct || 0)
            out.setUint8(at + 15, post >= 0 && post < NO_POST ? post : NO_POST)
            out.setUint16(at + 16, Math.min(65535, Math.round(u.maxHp)), true)
            // the wave front it came from, for the markers at the screen's edge (WaveDirector.frontGroups)
            out.setUint8(at + 18, Number.isInteger(u.front) && u.front >= 0 && u.front < NO_FRONT ? u.front : NO_FRONT)
            at += UNIT_BYTES
        }
        return out.buffer
    }

    _sayState(now) {
        const r = this.room
        if (!r || !this._leading || r.members.length < 2) return
        this._stateTimer = STATE_SECONDS
        const s = this.s
        // `coming`: attackers its waves haven't sent out yet, for the count at the top of the screen
        const state = { c: s.cycle.state, text: this.duskText, coming: s.waves.waiting }
        // a change of phase must not be lost; the repeat once a second may be
        r.send('st', state, now ? {} : { volatile: true })
    }

    _event(e) {
        if (this._events.length < MAX_EVENTS) this._events.push(e)
    }

    /**
     * A unit, as the others know it: a unit the host simulates by its id (0 and
     * up), a builder by its member's id (below 0), or nothing (null).
     */
    _ref(u) {
        if (!u || u.entity === undefined) return null
        const r = this.room
        if (u.isPlayer) return r ? -r.self.id - 1 : null
        if (u.remote) return u.hero !== null ? -u.hero - 1 : null
        return u.uid
    }

    /** the other end of `_ref` */
    _unref(ref) {
        if (typeof ref !== 'number' || !Number.isInteger(ref)) return null
        if (ref >= 0) return this.byId.get(ref) || null
        const id = -ref - 1
        if (this.room && id === this.room.self.id) return this.s.player
        return this.heroes.get(id) || null
    }

    /** one of EVENTS, for the wire */
    _encode(name, a) {
        if (name === 'shot') return [name, this._ref(a[0]), a[1]]
        if (name === 'hit') return [name, this._ref(a[0]), round2(a[1]), this._ref(a[2]), a[3] ? 1 : 0]
        if (name === 'townHit') return [name, round2(a[0])]
        if (name === 'explosion') return [name, ...a[0].map(round2)]
        if (name === 'blockHit') return [name, a[0], a[1], a[2], a[3], a[4] ? 1 : 0]
        if (name === 'towerFired') return [name, a[0].x, a[0].y, a[0].z, a[0].type]
        // the unit the event is about: melee, frozen, thawed, castStarted, castLost, chargeLit
        return [name, this._ref(a[0])]
    }

    // ---- the others hear ----------------------------------------------------------------

    _hearUnits(bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.length < HEAD_BYTES) return
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        if (v.getUint8(0) !== UNITS_FORMAT) return
        const count = v.getUint16(4, true)
        if (bytes.length !== HEAD_BYTES + count * UNIT_BYTES) return
        const s = this.s
        const units = s.units
        units.town.hp = (v.getUint16(2, true) / 65535) * units.town.maxHp
        const seen = new Set()
        const now = performance.now()
        let at = HEAD_BYTES
        for (let i = 0; i < count; i++, at += UNIT_BYTES) {
            const id = v.getUint32(at, true)
            const type = UNIT_TYPES[v.getUint8(at + 4)]
            if (!type) continue
            const flags = v.getUint8(at + 5)
            const pos = [v.getInt16(at + 6, true) / SCALE, v.getInt16(at + 8, true) / SCALE, v.getInt16(at + 10, true) / SCALE]
            const yaw = (v.getUint8(at + 12) / 256) * Math.PI * 2
            const act = v.getUint8(at + 14)
            seen.add(id)
            let u = this.byId.get(id)
            if (!u) {
                // one that is already down when it is first heard of: there is nothing to draw
                if (!(flags & 1)) continue
                u = units.spawnRemote(type, pos, { yaw })
                u.netId = id
                u.netAct = act
                this.byId.set(id, u)
            }
            u.netPost = v.getUint8(at + 15)
            u.netFront = v.getUint8(at + 18)
            u.maxHp = v.getUint16(at + 16, true) || 1
            u.hp = (v.getUint8(at + 13) / 255) * u.maxHp
            this.unitSmooth.set(id, [pos[0], pos[1], pos[2], yaw], now)
            if (!(flags & 1) && u.alive) units.kill(u)
            const frozen = !!(flags & 2)
            if (frozen !== u.frozenT > 0) {
                u.frozenT = frozen ? 1 : 0
                u.char.setFrozen(frozen)
            }
            u.cheer = !!(flags & 4)
            if (act !== u.netAct) {
                u.netAct = act
                const name = ACTIONS[act & 7]
                if (name && u.alive) u.char.playAction(name)
            }
        }
        // each report names every unit there is: one that is not in it is gone
        for (const [id, u] of [...this.byId]) {
            if (seen.has(id)) continue
            // an attacker that goes on its feet left (the opening's raiders, the winners of a
            // lost night): the same puff of dust as on the host
            if (u.alive && u.side === 'attacker') s.effects.burst(u.netPos, [0.6, 0.55, 0.5], 6, 2, 0.2, 0.8)
            units.remove(u)
            this.byId.delete(id)
            this.unitSmooth.delete(id)
        }
    }

    _hearState(state) {
        const c = state && state.c
        if (!c || !PHASES.includes(c.phase)) return
        for (const k of ['t', 'level', 'day', 'nightLevel', 'lives', 'nightsLost']) if (typeof c[k] !== 'number' || !isFinite(c[k])) return
        if (typeof state.text === 'string') this.duskText = state.text.slice(0, 300)
        this.s.waves.coming = Number.isInteger(state.coming) && state.coming >= 0 && state.coming < 1e4 ? state.coming : 0
        this.s.cycle.follow(c)
    }

    _hearDamage(cells, down) {
        if (!Array.isArray(cells)) return
        const s = this.s
        for (const c of cells.slice(0, 400)) {
            if (!Array.isArray(c) || c.length !== 3 || !c.every(Number.isInteger)) continue
            // with the dust it goes down in on the host
            if (down) s.demolition.demolishNow(c[0], c[1], c[2])
            else s.world.restoreBlock(c[0], c[1], c[2])
        }
    }

    _hearShots(shots, from) {
        if (!Array.isArray(shots)) return
        const s = this.s
        // what that player holds, for the sound of their shot (see heroShotSound)
        const hero = this.heroes.get(from.id)
        this._hearing = true
        try {
            for (const sh of shots.slice(0, MAX_SHOTS)) {
                if (!Array.isArray(sh) || sh.length !== 9 || typeof sh[0] !== 'string' || !finite(sh, 1, 9)) continue
                const at = [sh[1], sh[2], sh[3]]
                // drawn, and harmless: what it hits is decided on the page that fired it
                if (!s.effects.launch(sh[0], at, [sh[4], sh[5], sh[6]], { drawn: true, side: sh[7] ? 'attacker' : 'defender' })) continue
                // a player's shot sounds where it leaves; the host's units' shots come with their events
                if (sh[8]) s.audio.play(heroShotSound(sh[0], hero ? hero.netName : null), at)
            }
        } finally {
            this._hearing = false
        }
    }

    /** what happened in the host's fight: each is told to this page's game as if it had happened here */
    _hearEvents(events) {
        if (!Array.isArray(events)) return
        const s = this.s
        const { units } = s
        this._hearing = true
        try {
            for (const e of events.slice(0, MAX_EVENTS)) {
                if (!Array.isArray(e) || typeof e[0] !== 'string') continue
                const name = e[0]
                if (name === 'crack') {
                    if (finite(e, 1, 5)) s.cracks.set(e[1], e[2], e[3], Math.max(0, Math.min(1, e[4])))
                } else if (name === 'fb') {
                    if (finite(e, 1, 7)) s.fireballs.throw([e[1], e[2], e[3]], [e[4], e[5], e[6]], this._unref(e[7]) || { remote: true })
                } else if (name === 'boom') {
                    if (finite(e, 1, 4)) s.demolition.explosionFx([e[1], e[2], e[3]])
                } else if (name === 'wave') {
                    if (Number.isInteger(e[1]) && Array.isArray(e[2])) {
                        const fronts = e[2].filter((f) => Array.isArray(f) && typeof f[0] === 'string' && typeof f[1] === 'number').map((f) => ({ name: f[0].slice(0, 20), angle: f[1] }))
                        if (fronts.length) s.waves.emit('subwave', e[1], fronts)
                    }
                } else if (name === 'skirmish') {
                    if (Number.isInteger(e[1]) && typeof e[2] === 'string') s.waves.emit('skirmish', e[1], e[2].slice(0, 20))
                } else if (EVENTS.includes(name)) this._replay(name, e)
            }
        } finally {
            this._hearing = false
        }
    }

    /** one of EVENTS from the host, told to this page's game (session.js plays and shows it) */
    _replay(name, e) {
        const s = this.s
        const units = s.units
        if (name === 'townHit') {
            if (typeof e[1] === 'number') units.emit('townHit', e[1], null)
        } else if (name === 'explosion') {
            if (finite(e, 1, 4)) units.emit('explosion', [e[1], e[2], e[3]])
        } else if (name === 'blockHit') {
            if (e.slice(1, 5).every(Number.isInteger)) units.emit('blockHit', e[1], e[2], e[3], e[4], e[5] === 1)
        } else if (name === 'towerFired') {
            if (e.slice(1, 4).every(Number.isInteger) && typeof e[4] === 'string') units.emit('towerFired', { x: e[1], y: e[2], z: e[3], type: e[4] })
        } else {
            const u = this._unref(e[1])
            if (!u) return
            if (name === 'hit') {
                // this page's own: its builder's hurts come as `hurt`, its own blows were shown as they landed
                const by = this._unref(e[3])
                if (u === s.player || by === s.player || typeof e[2] !== 'number') return
                u.char.flash(0.12)
                units.emit('hit', u, e[2], by, e[4] === 1)
            } else if (name === 'shot') {
                if (typeof e[2] === 'string') units.emit('shot', u, e[2])
            } else if (name === 'castStarted') {
                s.fireballs.gather(u, () => (u.alive ? units._staffTip(u) : null), FIREBALL.windup)
                units.emit(name, u)
            } else if (name === 'castLost') {
                s.fireballs.cancel(u)
            } else units.emit(name, u)
        }
    }

    _realById(id) {
        for (const u of this.s.units.units) if (u.uid === id && !u.remote && !u.isPlayer) return u
        return null
    }

    // ---- the builders -------------------------------------------------------------------

    /** say where this player's builder is: often while it moves, now and then while it stands, at once when it acts */
    _sayHero(dt) {
        const s = this.s
        const p = s.player
        const pos = s.units.posOf(p)
        const body = s.noa.entities.getPhysics(p.entity)?.body
        const speed = body ? Math.hypot(body.velocity[0], body.velocity[2]) : 0
        this._heroTimer += dt
        const acted = this._act !== this._actSent
        if (!acted && this._heroTimer < (speed > 0.2 ? HERO_MOVING : HERO_STILL)) return
        this._heroTimer = 0
        this._actSent = this._act
        // what is in its hand, as its own page draws it (CharacterInstance.item, .tint and .tile),
        // and the name of it, for the sounds (Control.held)
        const c = p.char
        const tint = c && Array.isArray(c.tint) ? c.tint.map(round2) : null
        const held = s.control.held
        this.room.presence.set([
            round2(pos[0]), round2(pos[1]), round2(pos[2]), round2(p.yaw), round2(speed), p.alive ? 1 : 0,
            (c && c.item) || '', tint, (c && c.tile) || '', this._act, this._actSpeed, (held && held.name) || '',
        ])
    }

    // `at`: when the server got it, so that a hero is drawn where it was then, not when the batch came.
    _hearHero(member, value, at) {
        const r = this.room
        // this player's own page from before (closed, and still keeping its place), or a page that is gone
        if (!r || member === r.self || member.pid === r.self.pid || member.state === 'lost') return
        const h = readHero(value)
        if (!h) return this._dropHero(member.id)
        const s = this.s
        const units = s.units
        let u = this.heroes.get(member.id)
        if (!u) {
            u = units.spawnRemote('player', h.pos, { yaw: h.yaw, hero: member.id })
            u.name = member.name
            u.netAct = h.act
            u.active = member.state === undefined || member.state === 'here'
            u.tag = s.hud.nameTag(member.name)
            this.heroes.set(member.id, u)
        }
        this.heroSmooth.set(member.id, [h.pos[0], h.pos[1], h.pos[2], h.yaw], at)
        if (member.name !== u.name && u.tag) {
            u.name = member.name
            u.tag.setLabel(member.name)
        }
        if (!h.alive && u.alive) units.kill(u)
        else if (h.alive && !u.alive) {
            u.alive = true
            u.hp = u.maxHp
            u.char.reset()
        }
        u.netName = h.name
        const held = `${h.item}|${h.tint}|${h.tile}`
        if (h.alive && held !== u.netItem) {
            u.netItem = held
            try {
                u.char.setItem(h.item, undefined, h.tint, h.tile)
            } catch { /* something this page cannot hold: empty hands */ }
        }
        if (h.act !== u.netAct) {
            u.netAct = h.act
            const action = HERO_ACTIONS[h.act & 7]
            if (action && h.alive) {
                u.char.playAction(action, h.actSpeed)
                const sound = heroSound(action, h.name)
                if (sound) s.audio.play(sound, u.netPos, { gain: 0.8 })
            }
        }
    }

    _dropHero(id) {
        const u = this.heroes.get(id)
        if (!u) return
        if (u.tag) u.tag.remove()
        this.s.units.remove(u)
        this.heroes.delete(id)
        this.heroSmooth.delete(id)
    }

    /** for the automated check: what this page draws for the others, and what it leads */
    list() {
        const units = this.s.units
        const at = (u) => (u.remote ? u.netPos : units.posOf(u)).map(round2)
        return {
            leads: this._leading,
            phase: this.s.cycle.phase,
            heroes: [...this.heroes].map(([id, u]) => ({ id, name: u.name, pos: at(u), alive: u.alive, item: u.char.item, tile: u.char.tile || null, act: u.netAct, active: u.active })),
            units: units.units.filter((u) => !u.isPlayer && u.hero === null).map((u) => ({ id: u.remote ? u.netId : u.uid, type: u.type, pos: at(u), alive: u.alive, remote: u.remote, hp: Math.round((u.hp / Math.max(1, u.maxHp)) * 100), hold: u.char.hold || null })),
            damage: this.s.world.damageCount,
            townHp: Math.round((units.town.hp / Math.max(1, units.town.maxHp)) * 100),
        }
    }
}
