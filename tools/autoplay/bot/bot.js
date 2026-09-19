/*
 *  The bot's loop. Every frame:
 *    1. turn the camera toward the look target (mouse movement, capped speed)
 *    2. deal with panels a player would deal with (result cards, the role
 *       picker after being knocked out, the pause menu)
 *    3. run the task for the current phase (a strategy decides which); a task
 *       is an async function that waits frame by frame, and is cancelled when
 *       the phase changes
 */

import { See } from './see.js'
import { Input } from './input.js'
import { Skills } from './skills.js'
import { violations } from './readonly.js'

export class Cancelled extends Error {}

const wrapPi = (a) => {
    a = (a + Math.PI) % (Math.PI * 2)
    if (a < 0) a += Math.PI * 2
    return a - Math.PI
}

export class Bot {
    /**
     * @param {any} rawGame the session (only its canvas is used directly; everything else is read-only)
     * @param {import('./log.js').Logger} logger
     */
    constructor(rawGame, logger) {
        this.see = new See(rawGame)
        this.input = new Input(rawGame.noa.container.canvas)
        this.skills = new Skills(this)
        this.logger = logger
        this.time = 0
        /** where the camera should look: {h, p, fast} */
        this.look = null
        /** ms of bot work this second (telemetry) */
        this.cpu = 0
        this._waiters = []
        this._task = null
        this._next = null
        /** set by the strategy */
        this.strategy = null
        /** a panel the current task opened on purpose (the UI handler leaves it alone) */
        this.expectPanel = null
        this._panelSince = 0
        this._panel = null
        /** the harness stops when this is set */
        this.done = null
        this.nights = { survived: 0, lost: 0 }
        /** blocks and troops placed so far (scans cached until it changes) */
        this.placedCount = 0
        this.paused = false
        rawGame.cycle.on('nightOver', (result) => {
            if (rawGame.cycle.opening) return
            if (result === 'survived') this.nights.survived++
            else this.nights.lost++
        })
    }

    violations() {
        return violations.count
    }

    note(what, data = {}) {
        if (what === 'placed') this.placedCount++
        this.logger.event({ type: 'bot', what, ...data })
    }

    /** run fn, and log it when it takes long enough to cost a frame */
    timed(name, fn) {
        const t0 = performance.now()
        const r = fn()
        const ms = performance.now() - t0
        this.cpu += ms
        if (ms > 12) this.note('slow', { fn: name, ms: +ms.toFixed(1) })
        return r
    }

    // ---- waiting ---------------------------------------------------------------------

    frame() {
        const token = this._token
        return new Promise((res, rej) => this._waiters.push({ res, rej, token }))
    }

    async wait(seconds) {
        const end = this.time + seconds
        while (this.time < end) await this.frame()
    }

    /** wait until cond() holds (true) or the time runs out (false) */
    async until(cond, seconds) {
        const end = this.time + seconds
        while (!cond()) {
            if (this.time >= end) return false
            await this.frame()
        }
        return true
    }

    // ---- the loop ----------------------------------------------------------------------

    start() {
        let last = performance.now()
        const loop = (now) => {
            const t0 = performance.now()
            const dt = Math.min(0.1, (now - last) / 1000)
            last = now
            try {
                this._tick(dt)
            } catch (err) {
                this.note('error', { message: String(err && err.message), stack: String(err && err.stack).split('\n').slice(0, 4).join(' | ') })
            }
            this.cpu += performance.now() - t0
            requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)
    }

    _tick(dt) {
        this.time += dt
        if (this.paused) return
        this._applyLook(dt)
        this._handlePanels()
        this._supervise()
        const w = this._waiters
        this._waiters = []
        for (const x of w) {
            if (x.token && x.token.cancelled) x.rej(new Cancelled())
            else x.res()
        }
    }

    /** turn toward the look target: eased, with a capped speed, in whole pixels of mouse movement */
    _applyLook(dt) {
        const L = this.look
        const see = this.see
        if (!L || !see.locked || (see.mode !== 'self' && see.mode !== 'possess')) return
        const c = see.cam()
        const dh = wrapPi(L.h - c.heading), dp = L.p - c.pitch
        const max = (L.fast ? 11 : 6.5) * dt
        const gain = Math.min(1, dt * (L.fast ? 20 : 13))
        let sh = Math.max(-max, Math.min(max, dh * gain))
        let sp = Math.max(-max, Math.min(max, dp * gain))
        // the last little bit in one go (a pixel is 0.0014 rad)
        if (Math.abs(dh) < 0.006) sh = dh
        if (Math.abs(dp) < 0.006) sp = dp
        this.input.moveMouse(sh / c.radPerPx, sp / c.radPerPx)
    }

    /** what a player does with panels that pop up */
    _handlePanels() {
        const see = this.see
        const panel = see.panel
        if (panel !== this._panel) {
            this._panel = panel
            this._panelSince = this.time
        }
        const open = this.time - this._panelSince
        if (!panel || panel === this.expectPanel) return
        const click = (sel) => this.input.click(document.querySelector(sel))
        if (panel === 'pause') {
            // opened by losing pointer lock; carry on
            if (open > 0.6) click('[data-panel="pause"] [data-a="resume"]')
        } else if (panel === 'result') {
            // read it, then carry on
            if (open > 3) click('[data-panel="result"] .primary')
        } else if (panel === 'role') {
            if (see.me().alive && open > 1) {
                const r = this.strategy && this.strategy.roleChoice ? this.strategy.roleChoice() : 'self'
                const btn = /** @type {HTMLButtonElement} */ (document.querySelector(`[data-panel="role"] [data-role="${r}"]`))
                // a stale "knocked out" button: close the picker instead
                if (btn && !btn.disabled) this.input.click(btn)
                else if (open > 2.5) click('[data-panel="role"] [data-close]')
            }
        } else if (open > 1.5) {
            click(`[data-panel="${panel}"] [data-close]`)
        }
    }

    _supervise() {
        const want = this.strategy ? this.strategy.want() : null
        const t = this._task
        if (t && !t.done && (!want || want.key !== t.key)) {
            // cancel; the next task starts once this one has unwound
            t.token.cancelled = true
            return
        }
        if (t && !t.done) return
        if (!want || (t && t.key === want.key)) return
        const token = { cancelled: false }
        this._token = token
        const task = { key: want.key, token, done: false }
        this._task = task
        this.skills.activity = 'idle'
        this.note('task', { key: want.key })
        Promise.resolve()
            .then(() => want.run())
            .catch((err) => {
                if (!(err instanceof Cancelled)) this.note('task-error', { key: want.key, message: String(err && err.message), stack: String(err && err.stack).split('\n').slice(0, 5).join(' | ') })
            })
            .finally(() => {
                task.done = true
                this.input.releaseAll()
                this.expectPanel = null
            })
    }

    /** for the harness */
    status() {
        const see = this.see
        let needLock = false
        try {
            needLock = !see.locked && !see.panel && (see.mode === 'self' || see.mode === 'possess') && see.me().alive
        } catch {
            needLock = false
        }
        return {
            phase: see.phase, day: see.day, level: see.phase === 'day' ? see.nightLevel : see.activeLevel,
            activity: this.skills.activity, task: this._task && this._task.key, needLock, done: this.done,
            survived: this.nights.survived, nights: this.nights.survived + this.nights.lost,
        }
    }
}
