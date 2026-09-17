/*
 *  Day / dusk / night / dawn state machine.
 *
 *  Survival: day runs on a timer (or the player hits "ready").
 *  Creative: always day until the player starts a night with a chosen strength.
 */

import { EventEmitter } from 'events'
import { DAY_SECONDS, DUSK_SECONDS, NIGHT_MAX_SECONDS, DAWN_MIN_SECONDS } from './balance.js'

/** @typedef {'day'|'dusk'|'night'|'dawn'} Phase */

export class DayCycle extends EventEmitter {
    /**
     * @param {{mode: string, day: number, nightLevel: number}} opts
     */
    constructor({ mode, day, nightLevel }) {
        super()
        this.creative = mode === 'creative'
        /** @type {Phase} */
        this.phase = 'day'
        this.t = 0
        this.day = day
        this.nightLevel = nightLevel
        /** level of the night currently running */
        this.activeLevel = nightLevel
        this.lastResult = null
        this.dayLength = DAY_SECONDS
        /** the scripted opening raid is running (night level 0) */
        this.opening = false
        /** the day that just started followed the opening raid */
        this.wasOpening = false
    }

    /** seconds until dusk (Infinity in creative) */
    get timeToNight() {
        if (this.phase !== 'day') return 0
        return this.creative ? Infinity : Math.max(0, this.dayLength - this.t)
    }

    /**
     * 0..1 position through a full cycle for sky rendering:
     * 0.0-0.5 day, 0.5-0.55 dusk, 0.55-0.95 night, 0.95-1.0 dawn
     */
    get skyTime() {
        switch (this.phase) {
            case 'day': return this.creative ? 0.22 : 0.05 + 0.43 * Math.min(1, this.t / this.dayLength)
            case 'dusk': return 0.48 + 0.07 * Math.min(1, this.t / DUSK_SECONDS)
            // the opening raid happens at late dusk: readable, and clearly "attack time"
            case 'night': return this.opening ? 0.525 : 0.55 + 0.4 * Math.min(1, this.t / NIGHT_MAX_SECONDS)
            case 'dawn': return 0.95 + 0.07 * Math.min(1, this.t / DAWN_MIN_SECONDS)
        }
        return 0
    }

    _set(phase) {
        const old = this.phase
        this.phase = phase
        this.t = 0
        this.emit('phase', phase, old)
    }

    /** start dusk now (survival "ready" button, creative "start night") */
    startNight(level = null) {
        if (this.phase !== 'day') return
        this.activeLevel = level ?? this.nightLevel
        this._set('dusk')
    }

    /** start the opening raid straight away (no dusk warning, no level) */
    startOpening() {
        if (this.phase !== 'day') return
        this.opening = true
        this.activeLevel = 0
        this._set('night')
    }

    /** @param {'survived'|'lost'} result */
    endNight(result) {
        if (this.phase !== 'night') return
        this.lastResult = result
        if (result === 'survived' && !this.creative && !this.opening) this.nightLevel++
        this.emit('nightOver', result, this.activeLevel)
        this._set('dawn')
    }

    /**
     * @param {number} dt seconds
     * @param {{damageRemaining: number}} ctx
     */
    update(dt, ctx) {
        this.t += dt
        if (this.phase === 'day') {
            if (!this.creative && this.t >= this.dayLength) this.startNight()
        } else if (this.phase === 'dusk') {
            if (this.t >= DUSK_SECONDS) this._set('night')
        } else if (this.phase === 'night') {
            if (this.t >= NIGHT_MAX_SECONDS && !this.opening) this.endNight('survived')
        } else if (this.phase === 'dawn') {
            if (this.t >= DAWN_MIN_SECONDS && ctx.damageRemaining === 0) {
                // the opening raid comes before day 1, so it doesn't count as a day
                if (!this.opening) this.day++
                this.wasOpening = this.opening
                this.opening = false
                this._set('day')
            }
        }
    }
}
