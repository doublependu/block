/*
 *  The bot's eyes: facts about the game, read through the read-only view.
 *  It "sees" more than a player would (through walls, underground): the ore
 *  tip already shows where ore is, and the rest only saves it looking around.
 */

import { readonly } from './readonly.js'

export class See {
    constructor(rawGame) {
        const g = readonly(rawGame)
        this.g = g
        const world = g.world
        /** the current block anywhere: the loaded chunk's data (cheap), else the world's overlays + generator */
        this.block = (x, y, z) => {
            const id = world.peekLoaded(x, y, z)
            return id >= 0 ? id : world.getBlock(x, y, z)
        }
        this.tc = [...world.townCenter]
        this.half = world.half
    }

    get phase() {
        return this.g.cycle.phase
    }
    get day() {
        return this.g.cycle.day
    }
    get nightLevel() {
        return this.g.cycle.nightLevel
    }
    get activeLevel() {
        return this.g.cycle.activeLevel
    }
    get opening() {
        return !!this.g.cycle.opening
    }
    get canEdit() {
        return this.g.cycle.phase === 'day'
    }
    get timeToNight() {
        return this.g.cycle.timeToNight
    }
    get panel() {
        return this.g.hud.openName
    }
    get mode() {
        return this.g.control.mode
    }
    get uiOpen() {
        return this.g.control.uiOpen
    }
    get locked() {
        return !!document.pointerLockElement
    }

    me() {
        const p = this.g.player
        return { pos: [...this.g.units.posOf(p)], alive: p.alive, hp: p.hp, maxHp: p.maxHp, respawnIn: p.respawnIn }
    }

    feetCell() {
        const p = this.me().pos
        return [Math.floor(p[0]), Math.floor(p[1] + 0.05), Math.floor(p[2])]
    }

    eye() {
        return [...this.g.noa.camera.getTargetPosition()]
    }

    cam() {
        const c = this.g.noa.camera
        return { heading: c.heading, pitch: c.pitch, radPerPx: (c.sensitivityX * c.sensitivityMult * 0.0066 * Math.PI) / 180 }
    }

    _body() {
        return this.g.noa.entities.getPhysics(this.g.player.entity)?.body
    }

    speed() {
        const b = this._body()
        return b ? Math.hypot(b.velocity[0], b.velocity[2]) : 0
    }

    onGround() {
        const b = this._body()
        return !!b && b.resting[1] < 0
    }

    targeted() {
        const t = this.g.noa.targetedBlock
        if (!t) return null
        return { position: [...t.position], adjacent: [...t.adjacent], normal: [...t.normal] }
    }

    count(item) {
        return this.g.inventory.count(item)
    }

    /** living attackers, with where they are */
    attackers() {
        const out = []
        for (const u of this.g.units.units) {
            if (!u.alive || !u.active || u.side !== 'attacker') continue
            out.push({ u, pos: [...this.g.units.posOf(u)], type: u.type, hp: u.hp, attackTown: u.attackTown, busy: !!(u.attackBlock || u.siegeTarget), height: u.height })
        }
        return out
    }

    get townHp() {
        return this.g.units.town.hp
    }
}
