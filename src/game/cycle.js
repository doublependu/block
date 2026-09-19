/*
 *  Day / dusk / night / dawn state machine.
 *
 *  Survival: day runs on a timer (or the player hits "ready").
 *  Creative: always day until the player starts a night with a chosen strength.
 */

import { EventEmitter } from 'events'
import { DAY_SECONDS, DUSK_SECONDS, NIGHT_MAX_SECONDS, DAWN } from './balance.js'

/** @typedef {'day'|'dusk'|'night'|'dawn'} Phase */

/**
 * pure: roles (playing a unit, watching from above) are only chosen while an
 * attack is coming or on. From dawn on, the player is always the builder.
 * @param {Phase} phase
 */
export function canChooseRole(phase) {
    return phase === 'dusk' || phase === 'night'
}

/**
 * pure: how long a dawn's rebuild takes for this many destroyed blocks, and
 * the whole dawn around it (seconds; see DAWN).
 * @param {number} blocks
 * @param {boolean} [opening] after the opening raid
 * @returns {{lead: number, rebuild: number, total: number}}
 */
export function dawnPlan(blocks, opening = false) {
    if (blocks <= 0) return { lead: 0, rebuild: 0, total: DAWN.empty }
    const rebuild = opening ? DAWN.openingRebuild
        : Math.max(DAWN.minRebuild, Math.min(DAWN.maxRebuild, DAWN.base + DAWN.perBlock * blocks))
    return { lead: DAWN.lead, rebuild, total: DAWN.lead + rebuild + DAWN.hold }
}

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
        /** the current (or last) dawn's timing, set when the rebuild starts (see planDawn) */
        this.dawn = dawnPlan(0)
    }

    /**
     * Time the dawn that just started around the rebuild of `blocks` destroyed
     * blocks (the session calls this when dawn begins).
     * @returns {{lead: number, rebuild: number, total: number}}
     */
    planDawn(blocks) {
        this.dawn = dawnPlan(blocks, this.opening)
        return this.dawn
    }

    /** skip the rest of the rebuild: straight to the last look at the town */
    skipDawn() {
        if (this.phase === 'dawn') this.t = Math.max(this.t, this.dawn.total - DAWN.hold)
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
            case 'dawn': return 0.95 + 0.07 * Math.min(1, this.t / this.dawn.total)
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
        // until the session times it (planDawn), a dawn with nothing to rebuild
        this.dawn = dawnPlan(0)
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
            if (this.t >= this.dawn.total && ctx.damageRemaining === 0) {
                // the opening raid comes before day 1, so it doesn't count as a day
                if (!this.opening) this.day++
                this.wasOpening = this.opening
                this.opening = false
                this._set('day')
            }
        }
    }
}
