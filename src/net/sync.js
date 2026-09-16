/*
 *  SyncService - ordered, reliable world ops + unreliable presence.
 *
 *  The game never mutates permanent world state directly: it submits an op
 *  and applies it when the op comes back through onOp. LocalSync echoes
 *  immediately (single player). A remote implementation relays through the
 *  generic sync server, which orders ops per room without understanding them
 *  (see docs/protocol.md).
 */

/**
 * @typedef {object} OpEnvelope
 *  @property {number} seq     room-wide order
 *  @property {string} from    member id
 *  @property {object} op      opaque game payload
 */

/**
 * @typedef {object} SyncService
 *  @property {string} selfId
 *  @property {boolean} online
 *  @property {(roomId: string) => Promise<{members: {id: string, order: number}[]}>} join
 *  @property {(op: object) => void} submit
 *  @property {(cb: (env: OpEnvelope) => void) => () => void} onOp
 *  @property {(blob: object) => void} sendPresence
 *  @property {(cb: (from: string, blob: object) => void) => () => void} onPresence
 *  @property {() => boolean} isHost  earliest-joined member runs the NPC simulation
 *  @property {() => void} leave
 */

/** @implements {SyncService} */
export class LocalSync {
    constructor() {
        this.selfId = 'local'
        this.online = false
        this._seq = 0
        /** @type {Set<(env: OpEnvelope) => void>} */
        this._opListeners = new Set()
    }

    async join(roomId) {
        this.roomId = roomId
        return { members: [{ id: this.selfId, order: 0 }] }
    }

    submit(op) {
        const env = { seq: ++this._seq, from: this.selfId, op }
        for (const cb of this._opListeners) cb(env)
    }

    onOp(cb) {
        this._opListeners.add(cb)
        return () => this._opListeners.delete(cb)
    }

    sendPresence() { }

    onPresence() {
        return () => { }
    }

    isHost() {
        return true
    }

    leave() {
        this._opListeners.clear()
    }
}
