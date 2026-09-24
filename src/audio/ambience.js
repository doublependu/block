/*
 *  The soundscape: what you hear between the sound effects, driven by the
 *  state of the game rather than a timer.
 *
 *    day    a light wind, birds now and then
 *    dusk   crickets, the wind rising, and war drums far off
 *    night  a low drone and war drums, both following how close and how many
 *           the attackers are; war cries from the side they come from; a
 *           heartbeat under it all when the town is nearly gone. As the last
 *           attackers fall the drums thin out to a single beat and stop.
 *    dawn   quiet, then birds
 *
 *  The drums and war cries are placed toward the attackers, so on headphones
 *  you can hear which side the night is coming from.
 */

/** how fast the night's intensity follows the threat (per second): up quickly, down slowly */
const RISE = 0.35
const FALL = 0.12
/** how far out the drums and cries sound from (m) */
const FAR = 42

/**
 * pure: how threatening the night is right now, 0..1.
 * @param {{attackers: number, nearest: number}} s attackers alive, and the nearest one's distance to the town (m)
 */
export function threat({ attackers, nearest }) {
    if (attackers <= 0) return 0
    const many = Math.min(1, attackers / 25)
    const close = Math.max(0, Math.min(1, 1 - (nearest - 10) / 50))
    return Math.min(1, 0.15 + many * 0.5 + close * 0.35)
}

/**
 * pure: the drums for a bar of eight beats at this intensity. `low`/`high`
 * are the beats (0..7) each drum strikes on; bpm counts beats.
 * @param {number} i intensity 0..1
 */
export function drumBar(i) {
    const low = [0]
    const high = []
    if (i > 0.12) low.push(4)
    if (i > 0.3) high.push(6)
    if (i > 0.5) high.push(2)
    if (i > 0.7) low.push(7, 3)
    if (i > 0.85) high.push(5)
    return { low, high, bpm: 2 * (55 + 75 * i) }
}

export class Ambience {
    /** @param {import('./audio.js').Audio} audio */
    constructor(audio) {
        this.audio = audio
        this.intensity = 0
        this.phase = 'day'
        /** the next drum beat, in context time, and where it is in the bar */
        this._beatAt = 0
        this._beat = 0
        this._cryIn = 4
        this._birdIn = 3
        this._cricketIn = 1
        this._heartIn = 0
        this._beds = null
        /** where the attackers are (a world position FAR out that way), or null */
        this.front = null
    }

    /** the wind and the drone: running nodes whose levels follow the state */
    _ensureBeds() {
        const a = this.audio
        if (this._beds || !a.ctx || !a.buses) return this._beds
        const ctx = a.ctx
        // wind: looped noise through a lowpass that a slow oscillator moves
        const len = ctx.sampleRate * 2
        const buf = ctx.createBuffer(1, len, ctx.sampleRate)
        const d = buf.getChannelData(0)
        let last = 0
        for (let i = 0; i < len; i++) {
            // brown-ish noise: softer, more like air
            last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
            d[i] = last * 3.5
        }
        const wind = ctx.createBufferSource()
        wind.buffer = buf
        wind.loop = true
        const wf = ctx.createBiquadFilter()
        wf.type = 'lowpass'
        wf.frequency.value = 500
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 0.07
        const lfoAmt = ctx.createGain()
        lfoAmt.gain.value = 250
        lfo.connect(lfoAmt).connect(wf.frequency)
        const windGain = ctx.createGain()
        windGain.gain.value = 0
        wind.connect(wf).connect(windGain).connect(a.buses.amb)
        wind.start()
        lfo.start()
        // the night's drone: two detuned saws, low and dark
        const droneGain = ctx.createGain()
        droneGain.gain.value = 0
        const df = ctx.createBiquadFilter()
        df.type = 'lowpass'
        df.frequency.value = 170
        for (const f of [55, 55.6, 82.4]) {
            const o = ctx.createOscillator()
            o.type = 'sawtooth'
            o.frequency.value = f
            o.connect(df)
            o.start()
        }
        df.connect(droneGain).connect(a.buses.amb)
        this._beds = { windGain, droneGain }
        return this._beds
    }

    /**
     * Called a few times a second.
     * @param {number} dt seconds since the last call
     * @param {{phase: string, attackers: number, nearest: number, front: number[] | null, townHp: number, fighting: number}} s
     *   front: a point toward the attackers; townHp: 0..1; fighting: 0..1, how much is going on near you (ducks the ambience)
     */
    update(dt, s) {
        const a = this.audio
        if (!a.ctx || a.ctx.state !== 'running' || a.muted) return
        const beds = this._ensureBeds()
        if (!beds) return
        const night = s.phase === 'night'
        const target = night ? threat(s) : s.phase === 'dusk' ? 0.12 : 0
        this.intensity += (target - this.intensity) * Math.min(1, dt * (target > this.intensity ? RISE : FALL) * 3)
        if (this.intensity < 0.01 && !night) this.intensity = 0
        this.phase = s.phase
        if (s.front) this.front = s.front
        const i = this.intensity
        const t = a.ctx.currentTime
        beds.windGain.gain.setTargetAtTime(night ? 0.1 + 0.06 * i : s.phase === 'dusk' ? 0.09 : 0.06, t, 1.5)
        beds.droneGain.gain.setTargetAtTime(night ? 0.05 + 0.1 * i : 0, t, 2)
        a.setDuck(Math.min(1, s.fighting))

        // the drums, scheduled a little ahead so they keep time at any frame rate
        if (i > 0.02) {
            const bar = drumBar(i)
            const beat = 60 / bar.bpm
            if (this._beatAt < t) this._beatAt = t + 0.05
            while (this._beatAt < t + 0.4) {
                const b = this._beat % 8
                const at = this._beatAt - t
                const pos = this._far(0.3)
                const g = 0.35 + 0.65 * i
                if (bar.low.includes(b)) a.play('drum_low', pos, { gain: g, delay: at })
                if (bar.high.includes(b)) a.play('drum_high', pos, { gain: g * 0.8, delay: at })
                this._beat++
                this._beatAt += beat
            }
        } else this._beat = 0

        // war cries from the attackers' side, more often the worse it gets
        if (night && s.attackers > 0) {
            this._cryIn -= dt
            if (this._cryIn <= 0) {
                this._cryIn = (3 + Math.random() * 5) / (0.5 + i)
                a.play('war_cry', this._far(0.7), { gain: 0.5 + 0.5 * i })
            }
        }
        // the town about to fall: a heartbeat, faster at the end
        if (night && s.townHp < 0.25) {
            this._heartIn -= dt
            if (this._heartIn <= 0) {
                this._heartIn = s.townHp < 0.1 ? 0.62 : 0.85
                a.play('heartbeat', null, { gain: 0.6 })
            }
        }
        // birds by day, crickets at dusk and on a quiet night
        if (s.phase === 'day') {
            this._birdIn -= dt
            if (this._birdIn <= 0) {
                this._birdIn = 2 + Math.random() * 6
                a.play('bird', this._around(12, 26, 6), { gain: 0.6 })
            }
        } else if (s.phase === 'dusk' || (night && i < 0.25)) {
            this._cricketIn -= dt
            if (this._cricketIn <= 0) {
                this._cricketIn = 0.4 + Math.random() * 1.2
                a.play('cricket', this._around(4, 12, 0), { gain: 0.35 })
            }
        }
    }

    /** a point FAR out toward the attackers, spread by up to `spread` radians */
    _far(spread) {
        const l = this.audio.listener
        const f = this.front
        let ang = f ? Math.atan2(f[0] - l[0], f[2] - l[2]) : 0.8
        ang += (Math.random() - 0.5) * 2 * spread
        return [l[0] + Math.sin(ang) * FAR, l[1] + 6, l[2] + Math.cos(ang) * FAR]
    }

    /** a point somewhere around the listener, between r0 and r1 out and `up` above */
    _around(r0, r1, up) {
        const l = this.audio.listener
        const a = Math.random() * Math.PI * 2
        const r = r0 + Math.random() * (r1 - r0)
        return [l[0] + Math.sin(a) * r, l[1] + up, l[2] + Math.cos(a) * r]
    }
}
