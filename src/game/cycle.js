/*
 *  Day / dusk / night / dawn state machine, and the game's end.
 *
 *  Survival: day runs on a timer (or the player hits "ready"). Each night the
 *  Town Center falls costs a life; after the last one the game is over
 *  (phase 'over': the ruins stay, nothing rebuilds).
 *  Creative: always day until the player starts a night with a chosen strength.
 */

import { EventEmitter } from 'events'
import { DAY_SECONDS, DUSK_SECONDS, NIGHT_MAX_SECONDS, DAWN, LIVES } from './balance.js'

/** @typedef {'day'|'dusk'|'night'|'dawn'|'over'} Phase */

/**
 * pure: lives left after a night. Only a lost survival night costs one (the
 * opening raid is meant to be lost; creative has no lives; a game with
 * unlimited lives keeps them all, plan 12 §5.5).
 * @param {number} lives
 * @param {'survived'|'lost'} result
 * @param {{creative?: boolean, opening?: boolean, unlimited?: boolean}} [o]
 */
export function livesAfter(lives, result, { creative = false, opening = false, unlimited = false } = {}) {
    if (result !== 'lost' || creative || opening || unlimited) return lives
    return Math.max(0, lives - 1)
}

/**
 * pure: does this night count as one lost? (a survival night the Town Center
 * fell in, not the opening raid): what an unlimited game counts instead of lives
 * @param {'survived'|'lost'} result
 */
export function countsAsLost(result, { creative = false, opening = false } = {}) {
    return result === 'lost' && !creative && !opening
}

/**
 * pure: roles (playing a unit, watching from above) are only chosen while an
 * attack is coming or on. From dawn on, the player is always the builder.
 * @param {Phase} phase
 */
export function canChooseRole(phase) {
    return phase === 'dusk' || phase === 'night'
}

/**
 * pure: what the attackers still out do at dawn (plan 13 §3). The opening
 * raiders leave (they cheered in its aftermath); the winners of a lost night
 * cheer over the Town Center, then leave; a night held to sunrise wipes out
 * the rest, and they fall. (At the game's end there's no dawn: they cheer and stay.)
 * @param {'survived'|'lost'|null} result
 * @param {boolean} opening
 * @returns {'leave'|'cheer'|'fall'}
 */
export function attackersAtDawn(result, opening) {
    if (opening) return 'leave'
    return result === 'lost' ? 'cheer' : 'fall'
}

/**
 * pure: how long a dawn's rebuild takes for this many destroyed blocks, and
 * the whole dawn around it (seconds; see DAWN). After a lost night the lead
 * is the winners' cheer: the rebuild waits until they've left.
 * @param {number} blocks
 * @param {boolean} [opening] after the opening raid
 * @param {boolean} [lost] the Town Center fell (not the opening raid, which has its own aftermath)
 * @returns {{lead: number, rebuild: number, total: number}}
 */
export function dawnPlan(blocks, opening = false, lost = false) {
    const lead = lost && !opening ? DAWN.cheer : DAWN.lead
    if (blocks <= 0) return lost && !opening ? { lead, rebuild: 0, total: lead + DAWN.hold } : { lead: 0, rebuild: 0, total: DAWN.empty }
    const rebuild = opening ? DAWN.openingRebuild
        : Math.max(DAWN.minRebuild, Math.min(DAWN.maxRebuild, DAWN.base + DAWN.perBlock * blocks))
    return { lead, rebuild, total: lead + rebuild + DAWN.hold }
}

export class DayCycle extends EventEmitter {
    /**
     * @param {{mode: string, day: number, nightLevel: number, lives?: number, unlimitedLives?: boolean, nightsLost?: number}} opts
     */
    constructor({ mode, day, nightLevel, lives = LIVES, unlimitedLives = false, nightsLost = 0 }) {
        super()
        this.creative = mode === 'creative'
        /** lives left (survival) */
        this.lives = lives
        /** unlimited lives (plan 12 §5.5): a lost night never ends the game */
        this.unlimitedLives = !!unlimitedLives
        /** survival nights the Town Center fell in, this game */
        this.nightsLost = nightsLost
        /** the game is over: the last life went (phase 'over') */
        this.over = !this.creative && !this.unlimitedLives && lives <= 0
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
        /** true on a page that follows another page's game: see `follow` */
        this.follower = false
    }

    /**
     * Time the dawn that just started around the rebuild of `blocks` destroyed
     * blocks (the session calls this when dawn begins).
     * @returns {{lead: number, rebuild: number, total: number}}
     */
    planDawn(blocks) {
        this.dawn = dawnPlan(blocks, this.opening, this.lastResult === 'lost')
        return this.dawn
    }

    /** the winners of a lost night are still cheering (the lead of its dawn) */
    get cheering() {
        return this.phase === 'dawn' && this.lastResult === 'lost' && !this.opening && this.t < this.dawn.lead
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
            case 'over': return 0.9
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
        if (countsAsLost(result, { creative: this.creative, opening: this.opening })) this.nightsLost++
        this.lives = livesAfter(this.lives, result, { creative: this.creative, opening: this.opening, unlimited: this.unlimitedLives })
        this.over = !this.creative && !this.unlimitedLives && this.lives <= 0
        this.emit('nightOver', result, this.activeLevel)
        this._set(this.over ? 'over' : 'dawn')
    }

    /** nights survived in this game: the highest night won */
    get nightsSurvived() {
        return this.nightLevel - 1
    }

    /** the dawn (or the opening's aftermath) is over: a new day */
    _newDay() {
        // the opening raid comes before day 1, so it doesn't count as a day
        if (!this.opening) this.day++
        this.wasOpening = this.opening
        this.opening = false
        this._set('day')
    }

    /** what the page that leads says about the game, for the pages that follow it (see `follow`) */
    get state() {
        return {
            phase: this.phase, t: Math.round(this.t * 10) / 10, level: this.activeLevel, opening: this.opening,
            day: this.day, nightLevel: this.nightLevel, lives: this.lives, nightsLost: this.nightsLost,
            result: this.lastResult,
        }
    }

    /**
     * Go where the leading page says the game is: `s` is its `state`. The same
     * steps this cycle would take by itself, so everything that listens for a
     * phase hears it here too. A page that was away for more than one step is
     * simply put in the phase it finds.
     * @param {DayCycle['state']} s
     */
    follow(s) {
        if (s.phase !== this.phase) {
            if (s.phase === 'dusk') {
                this.activeLevel = s.level
                this._set('dusk')
            } else if (s.phase === 'night') {
                this.opening = !!s.opening
                this.activeLevel = s.level
                this._set('night')
            } else if ((s.phase === 'dawn' || s.phase === 'over') && this.phase === 'night') {
                this.endNight(s.result === 'lost' ? 'lost' : 'survived')
            } else if (s.phase === 'day' && this.phase === 'dawn') {
                this._newDay()
            } else {
                this.opening = !!s.opening
                this.activeLevel = s.level
                this._set(s.phase)
            }
        }
        // the numbers are the leading page's, whatever this one worked out
        this.day = s.day
        this.nightLevel = s.nightLevel
        this.lives = s.lives
        this.nightsLost = s.nightsLost
        this.over = s.phase === 'over'
        if (Math.abs(this.t - s.t) > 1.5) this.t = s.t
    }

    /**
     * @param {number} dt seconds
     * @param {{damageRemaining: number}} ctx
     */
    update(dt, ctx) {
        this.t += dt
        // in a room somebody else hosts, the phases change when the host says so (see `follow`)
        if (this.follower) return
        if (this.phase === 'day') {
            if (!this.creative && this.t >= this.dayLength) this.startNight()
        } else if (this.phase === 'dusk') {
            if (this.t >= DUSK_SECONDS) this._set('night')
        } else if (this.phase === 'night') {
            if (this.t >= NIGHT_MAX_SECONDS && !this.opening) this.endNight('survived')
        } else if (this.phase === 'dawn') {
            if (this.t >= this.dawn.total && ctx.damageRemaining === 0) this._newDay()
        }
    }
}
