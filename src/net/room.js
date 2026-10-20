/*
 *  The room: other people in the same world, through a p3p2 server.
 *
 *  A room on a p3p2 server is a place several pages can meet. The server relays
 *  and remembers, and never knows what a block is (docs/protocol.md). This file
 *  is everything the game knows about that: which world a room holds, how edits
 *  reach everybody in one order, and what the room keeps for each player.
 *  Showing the others the night is net/replica.js.
 *
 *  What a room holds:
 *
 *    world   one value, set once by whoever brings a world first: a save
 *            (the world and the game in it), packed. Everybody who comes
 *            later plays that world, whatever they were playing before.
 *    log     every permanent change since: the ops the game always made
 *            ({t: 'block'}, {t: 'unit+'}, {t: 'unit-'}), numbered by the
 *            server and given to everybody in the same order. Now and then
 *            the host folds the ops so far into one new save (a snapshot),
 *            so the list stays short. The room keeps it all when everybody
 *            has left.
 *    me      one value per player: where they stood, what they carried,
 *            their hotbar as they arranged it, and the colour of their shirt.
 *
 *  RoomSync is the game's SyncService (net/sync.js) for all of it. Alone it
 *  echoes ops straight back, as LocalSync does; in a room it sends them to the
 *  room's log and applies them when they come back. The game cannot tell the
 *  difference, which was the point of SyncService.
 */

import { pack, unpack } from '@p3p2/client/pack'
import { parseWorld, serializeSave, startingKit } from '../world/worldFile.js'
import { Replica } from './replica.js'
import { isShirt } from '../characters/shirt.js'

/** how often a player's own things are written into the room, seconds */
const KEEP_SECONDS = 15
/** what a message carries besides the value itself (the channel, the envelope) */
const FRAME_SLACK = 512

/**
 * pure: does a packed world fit one message on a server that takes `max` bytes?
 * @param {string} packed
 * @param {number} max room.limits.maxFrameBytes (Infinity where the server doesn't say)
 */
export function fits(packed, max) {
    return packed.length + FRAME_SLACK <= max
}

const kb = (n) => `${Math.ceil(n / 1024)} KB`

/**
 * pure: where somebody new to a room first stands: where a game alone starts
 * (session.js), moved round it by the order they joined in, a place each, on a
 * sunflower's spiral (the golden angle, out by the square root): every place at
 * least a metre from the others, a dozen of them within 5 m. (A spot inside a
 * block lifts them out: session.js unstuckY.)
 * @param {number[]} tc the Town Center
 * @param {number} order Member.order
 */
export function newcomerSpot(tc, order) {
    const n = order % 12
    const a = n * 2.39996
    const r = 1.4 * Math.sqrt(n)
    return [tc[0] + 0.5 + Math.sin(a) * r, tc[1], tc[2] + 5.5 + Math.cos(a) * r]
}

/**
 * pure: a player's own things as the room kept them (`me`), checked: somebody
 * else's data. Somebody new to the room starts with the world's kit.
 * @param {any} mine
 * @param {Record<string, number>} kit the world's starting kit (def.start.inventory)
 * @returns {{pos: number[] | null, inventory: Record<string, number>, hotbar?: (string | null)[], shirt?: number}}
 */
export function ownThings(mine, kit) {
    const ok = mine && typeof mine === 'object'
    const pos = ok && Array.isArray(mine.pos) && mine.pos.length === 3 && mine.pos.every(Number.isFinite) ? mine.pos : null
    const inventory = ok && mine.inventory && typeof mine.inventory === 'object' && !Array.isArray(mine.inventory) ? mine.inventory : null
    // checked again when the game starts (inventory.js readHotbar), as a save's is
    const hotbar = ok && Array.isArray(mine.hotbar) && mine.hotbar.length <= 9 ? { hotbar: mine.hotbar.map((n) => (typeof n === 'string' ? n : null)) } : {}
    // the colour they wore (plan 16 §3): theirs again, unless somebody who came before them wears it now (pickShirt)
    const shirt = ok && isShirt(mine.shirt) ? { shirt: mine.shirt } : {}
    return { pos, inventory: inventory || startingKit(kit), ...hotbar, ...shirt }
}

/** A SyncService (net/sync.js), for a game alone and for a game in a room. */
export class RoomSync {
    constructor() {
        this.selfId = 'local'
        this.online = false
        /** @type {any} the room whose log the ops go through, once its log is being read */
        this.room = null
        this._seq = 0
        /** @type {Set<(env: import('./sync.js').OpEnvelope) => void>} */
        this._listeners = new Set()
        /** ops that arrived before the game listened, and ops waiting to be sent */
        this._early = []
        this._out = []
        this._sending = false
        /**
         * Set while a world is being handed to a room: what is built in those
         * moments waits, and goes into the room's log once that is open. Applied at
         * once it would be in this page's world and in nobody else's.
         */
        this.holding = false
    }

    async join() {
        return { members: [{ id: this.selfId, order: 0 }] }
    }

    submit(op) {
        if (!this.room && !this.holding) return this._deliver(op)
        // everything submitted in one go is one op in the room's log: a tower and its column, a
        // bot laying a wall. One frame, one number, and the server's rate limit counts it once.
        this._out.push(op)
        if (this._sending || !this.room) return
        this._sending = true
        queueMicrotask(() => this.flush())
    }

    /** a world that never reached the room (net.js _bring): what was held is this page's alone again */
    release() {
        this.holding = false
        const ops = this._out
        this._out = []
        for (const op of ops) this._deliver(op)
    }

    /** send what is waiting. Also called when the room can be reached again. */
    flush() {
        this._sending = false
        const ops = this._out
        if (!ops.length || !this.room) return
        this._out = []
        // not sent (the connection is down): they wait, and nothing is applied until they come back
        if (!this.room.log.submit(ops.length === 1 ? ops[0] : { t: 'many', ops })) this._out = ops.concat(this._out)
    }

    /** an op out of the room's log */
    take(op) {
        if (op && op.t === 'many' && Array.isArray(op.ops)) for (const o of op.ops) this._deliver(o)
        else this._deliver(op)
    }

    _deliver(op) {
        if (!op || typeof op !== 'object') return
        if (!this._listeners.size) return void this._early.push(op)
        const env = { seq: ++this._seq, from: this.selfId, op }
        for (const cb of this._listeners) cb(env)
    }

    onOp(cb) {
        this._listeners.add(cb)
        const early = this._early
        this._early = []
        for (const op of early) this._deliver(op)
        return () => this._listeners.delete(cb)
    }

    sendPresence() { }

    onPresence() {
        return () => { }
    }

    isHost() {
        return !this.room || this.room.isHost
    }

    leave() {
        this._listeners.clear()
    }
}

export class Net {
    /**
     * @param {any} p3p2 the P3P2 instance boot made (boot/main.js)
     * @param {any} room the room the page is in, or null
     */
    constructor(p3p2, room) {
        this.p3p2 = p3p2
        this.room = room
        this.sync = new RoomSync()
        /** @type {any} the running game, once there is one */
        this.session = null
        /** @type {Replica | null} */
        this.replica = null
        /** the room everything is wired to */
        this._wired = null
        this._kept = ''
        this._keepTimer = KEEP_SECONDS
    }

    inRoom() {
        return !!this.room
    }

    /** is it for this page to decide what the units and the night do? */
    leads() {
        return !this.room || this.room.isHost
    }

    /** opens p3p2's panel: paste a room URL, invite friends, see who is here, chat */
    open() {
        return this.p3p2.open()
    }

    // ---- which world --------------------------------------------------------------------

    /**
     * The room's world and the game in it, for a page that is about to start
     * playing it (boot/main.js). With this player's own things, if the room
     * remembers them, and a starting kit if it does not.
     */
    async def() {
        const r = this.room
        let text = await unpack(r.retained('world'))
        await this._read(r, (state) => {
            text = state
        })
        const def = parseWorld(/** @type {string} */ (text), { as: 'save' })
        def.player = ownThings(r.retained('me', { player: r.self.pid }), def.start.inventory)
        // somebody new stands beside the others, not inside them
        if (!def.player.pos) def.player.pos = newcomerSpot(def.townCenter, r.self.order)
        return def
    }

    /**
     * Start reading the room's log: ops go to the game through RoomSync. `first`
     * gets the state the log starts from, if it has one (a snapshot, unpacked).
     */
    _read(r, first) {
        let opened = false
        return r.log.open({
            load: async (state) => {
                // Handed over whole a second time, after a long gap: this world may be behind in
                // ways no op will mend. Start again from what the room has.
                if (opened) return void location.reload()
                opened = true
                if (state !== undefined) first(await unpack(state))
            },
            apply: (op) => this.sync.take(op),
            // asked for by the server as the list of ops grows long, and offered at every dawn
            save: () => (this.session && r.isHost ? pack(this._saveText()) : undefined),
        }).then(() => {
            this.sync.room = r
            this.sync.online = true
            this.sync.holding = false
            this.sync.flush()
        })
    }

    /** the world and the game as they are now, without anything that is one player's own */
    _saveText() {
        return serializeSave({ ...this.session.snapshot(), player: { pos: null, inventory: {} } })
    }

    /** out of the room, by the player's choice (the pause panel's quit): `_left` goes back to the menu */
    leave() {
        if (this.room) this.room.leave()
        else location.reload()
    }

    /**
     * This page is already playing, and is now in a room that it was not
     * playing in: the room gets this world, if it has none. If it has one
     * (or somebody else's offer was first), that is the world to play, and a
     * world is only loaded once: the page reloads into it.
     */
    async _bring(r) {
        if (r.retained('world') !== undefined) return this._cross()
        // the opening raid is a lesson for one: a room opened in the middle of it starts from its dawn
        this.session.skipOpening()
        // from the save that is offered on, everything built goes through the room
        this.sync.holding = true
        const mine = await pack(this._saveText())
        if (this.room !== r) return this.sync.release()
        // a world is one message: one larger than the server takes would never arrive (plan 15 §3.2)
        if (!fits(mine, r.limits.maxFrameBytes)) {
            this.sync.release()
            this.room = null
            this.session.hud.toast(`This world is too big for this room's server (${kb(mine.length)} of ${kb(r.limits.maxFrameBytes)}). Your game goes on alone.`, 'warn')
            r.leave()
            return
        }
        const held = await r.offer('world', mine)
        if (this.room !== r) return
        if (held !== mine) return this._cross()
        await this._read(r, () => this._cross())
        if (this.room === r) this._wire(r)
    }

    _cross() {
        // the game that was being played is kept (Continue brings it back), and the room's is next.
        // Not autosave(): the page is in the room already, where that writes only the player's own things
        this.session.saveLocal()
        this.session.hud.toast('This room already holds a world. Loading it…')
        setTimeout(() => location.reload(), 900)
    }

    // ---- the game is running ------------------------------------------------------------

    /** called once, by boot, when the game has started */
    attach(session) {
        this.session = session
        this.replica = new Replica(session, this)
        const r = this.room
        if (r && this.sync.room === r) this._wire(r)
        else if (r) this._bring(r)
        this.p3p2.on('room', (room) => {
            if (room === this._wired || room === this.room) return
            this.room = room
            this._bring(room)
        })
        this.p3p2.on('leave', (reason) => this._left(reason))
    }

    _wire(r) {
        this._wired = r
        const s = this.session
        this._kept = ''
        s.cycle.follower = !r.isHost
        this.replica.start(r)
        r.on('host-change', () => {
            s.cycle.follower = !r.isHost
            this.replica.hostChanged()
        })
        r.on('status', (status) => {
            if (status === 'open') this.sync.flush()
        })
        r.on('member-join', (m) => s.hud.toast(`${m.name} joined`))
        r.on('member-leave', (m) => s.hud.toast(`${m.name} left`))
        s.hud.toast(r.isHost ? 'This world is now open to your friends' : `You joined ${r.name}`, 'good')
    }

    /**
     * Out of the room. What was being played was the room's world, not this
     * player's own, so the game ends here and the menu comes back: Continue
     * still holds the game they had to themselves.
     */
    _left(reason) {
        if (!this._wired) return
        this._wired = null
        this.room = null
        this.sync.room = null
        if (this.replica) this.replica.stop()
        if (reason === 'left') {
            try {
                const url = new URL(location.href)
                url.searchParams.delete('room')
                history.replaceState(history.state, '', url)
            } catch { /* the address stays as it is */ }
        }
        this.session.hud.toast(reason === 'left' ? 'You left the room' : 'The room is out of reach', 'warn')
        setTimeout(() => location.reload(), 1200)
    }

    /** every tick of the game */
    tick(dt) {
        if (!this._wired) return
        this.replica.tick(dt)
        this._keepTimer -= dt
        if (this._keepTimer <= 0) this.keep()
    }

    /** every frame */
    render(dt) {
        if (this._wired) this.replica.render(dt)
    }

    /** have the room write down what is this player's own: where they stand, what they carry, what they wear */
    keep() {
        const r = this._wired
        if (!r) return
        this._keepTimer = KEEP_SECONDS
        const s = this.session
        const p = s.noa.entities.getPosition(s.noa.playerEntity)
        const mine = { pos: [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100, Math.round(p[2] * 100) / 100], inventory: s.inventory.toJSON(), hotbar: s.inventory.hotbar.slice(), shirt: this.replica.shirt ?? undefined }
        const text = JSON.stringify(mine)
        if (text !== this._kept && r.send('me', mine, { retain: 'player' })) this._kept = text
    }

    /**
     * A new day (session.js): the host folds the ops so far into one save for
     * the room, and everybody has their own things written down.
     */
    newDay() {
        const r = this._wired
        if (!r) return
        if (r.isHost) r.log.snapshot()
        this.keep()
    }
}
