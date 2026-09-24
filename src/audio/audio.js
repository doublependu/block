/*
 *  The sound engine: procedural sound effects (no audio downloads), played
 *  positionally with a PannerNode each; the listener follows the camera. The
 *  AudioContext is created on the first user gesture (autoplay policy).
 *
 *  What a sound is lives in sounds.js (recipes) and synth.js (turning one into
 *  nodes). This file mixes them:
 *    - three buses, effects, ambience and ui, into a limiter, so a night with
 *      fifty attackers doesn't clip; the ambience ducks under close fighting
 *    - a shared reverb send (off on the low tier): the farther a sound, the
 *      more of it is room, so distant fighting sits back
 *    - a voice budget with priorities: your own actions first, then what's
 *      near you; a far sound doesn't get played at all once the budget is used
 *    - per-recipe limits, so a volley of arrows is a few twangs, not thirty
 *    - the bank (bank.js): the heavy recipes pre-rendered after load
 */

import { synth, recipeLength } from './synth.js'
import { RECIPES, DEFAULT_PITCH } from './sounds.js'
import { Bank } from './bank.js'
import LEVELS from './levels.json'

export { soundMaterial } from './sounds.js'

/** voices at once, by quality tier */
const VOICES = { low: 18, med: 28, high: 36 }
/** a positional sound farther than this isn't played (m) */
const MAX_DIST = 70
/** your own sounds (and non-positional ones) win every voice fight */
const OWN = 100

export class Audio {
    constructor() {
        this.ctx = null
        this.master = null
        this.muted = false
        this.volume = 0.7
        /** effects and ambience volumes, 0..1 (settings) */
        this.sfxVolume = 0.8
        this.ambVolume = 0.6
        /** set by the ambience: 0..1 of the ambience bus held down under fighting */
        this.duck = 0
        this.maxVoices = VOICES.high
        this.reverbOn = true
        /** @type {{src: AudioScheduledSourceNode, prio: number, end: number}[]} */
        this.active = []
        /** per recipe: when it last played, and how many are sounding */
        this._last = new Map()
        this.bank = new Bank()
        this.listener = [0, 0, 0]
        const unlock = () => {
            this._ensure()
            if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume()
        }
        window.addEventListener('pointerdown', unlock, { passive: true })
        window.addEventListener('keydown', unlock, { passive: true })
        window.addEventListener('touchstart', unlock, { passive: true })
    }

    _ensure() {
        if (this.ctx) return true
        try {
            const Ctx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext
            this.ctx = new Ctx()
        } catch {
            return false
        }
        const ctx = this.ctx
        this.master = ctx.createGain()
        this.master.gain.value = this.muted ? 0 : this.volume
        const limiter = ctx.createDynamicsCompressor()
        limiter.threshold.value = -14
        limiter.knee.value = 10
        limiter.ratio.value = 4
        limiter.attack.value = 0.003
        limiter.release.value = 0.25
        limiter.connect(this.master)
        this.master.connect(ctx.destination)
        this.buses = { sfx: ctx.createGain(), amb: ctx.createGain(), ui: ctx.createGain() }
        for (const b of Object.values(this.buses)) b.connect(limiter)
        this._applyVolumes()
        // the room: a second of decaying noise, stereo
        this.reverb = ctx.createConvolver()
        const len = Math.floor(ctx.sampleRate * 1.4)
        const ir = ctx.createBuffer(2, len, ctx.sampleRate)
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c)
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
        }
        this.reverb.buffer = ir
        this.reverbGain = ctx.createGain()
        this.reverbGain.gain.value = this.reverbOn ? 0.5 : 0
        this.reverb.connect(this.reverbGain).connect(limiter)
        return true
    }

    _applyVolumes() {
        if (!this.buses) return
        const t = this.ctx.currentTime
        this.buses.sfx.gain.setTargetAtTime(this.sfxVolume, t, 0.05)
        this.buses.ui.gain.setTargetAtTime(this.sfxVolume, t, 0.05)
        this.buses.amb.gain.setTargetAtTime(this.ambVolume * (1 - 0.45 * this.duck), t, 0.3)
    }

    setMuted(m) {
        this.muted = m
        if (this.master) this.master.gain.value = m ? 0 : this.volume
    }

    /** @param {number} sfx @param {number} amb 0..1 */
    setVolumes(sfx, amb) {
        this.sfxVolume = sfx
        this.ambVolume = amb
        this._applyVolumes()
    }

    /** @param {number} duck 0..1: how hard the fighting holds the ambience down */
    setDuck(duck) {
        if (Math.abs(duck - this.duck) < 0.05) return
        this.duck = duck
        this._applyVolumes()
    }

    /** the quality tier: fewer voices and no reverb on the low one */
    setTier(name) {
        this.maxVoices = VOICES[name] || VOICES.med
        this.reverbOn = name !== 'low'
        if (this.reverbGain) this.reverbGain.gain.value = this.reverbOn ? 0.5 : 0
    }

    /** once the game is playable: start rendering the bank in idle moments */
    prepare() {
        this.bank.start()
    }

    /** @param {number[]} pos @param {number[]} dir */
    setListener(pos, dir) {
        this.listener = pos
        if (!this.ctx) return
        const l = this.ctx.listener
        const t = this.ctx.currentTime
        if (l.positionX) {
            l.positionX.setValueAtTime(pos[0], t)
            l.positionY.setValueAtTime(pos[1], t)
            l.positionZ.setValueAtTime(pos[2], t)
            l.forwardX.setValueAtTime(dir[0], t)
            l.forwardY.setValueAtTime(dir[1], t)
            l.forwardZ.setValueAtTime(dir[2], t)
            l.upX.setValueAtTime(0, t)
            l.upY.setValueAtTime(1, t)
            l.upZ.setValueAtTime(0, t)
        } else if (l.setPosition) {
            l.setPosition(pos[0], pos[1], pos[2])
            l.setOrientation(dir[0], dir[1], dir[2], 0, 1, 0)
        }
    }

    /** voices still sounding (for the ambience's ducking) */
    get busy() {
        return this.active.length
    }

    /**
     * Play a recipe (sounds.js).
     * @param {string} name
     * @param {number[] | null} pos world position, or null for a sound in your head (UI, your own breath)
     * @param {{gain?: number, own?: boolean, delay?: number, rate?: number}} [o]
     *   own: yours (highest priority); rate: playback speed on top of the take's pitch
     */
    play(name, pos, { gain = 1, own = false, delay = 0, rate = 1 } = {}) {
        const r = RECIPES[name]
        if (!r || !this._ensure() || this.muted) return
        const ctx = this.ctx
        if (ctx.state !== 'running') return
        const now = ctx.currentTime
        const d = pos ? Math.hypot(pos[0] - this.listener[0], pos[1] - this.listener[1], pos[2] - this.listener[2]) : 0
        if (d > MAX_DIST) return
        // this recipe's own limits
        const lim = r.limit
        const last = this._last.get(name)
        if (lim && last) {
            last.list = last.list.filter((e) => e > now)
            if (now - last.at < lim.gap || last.list.length >= lim.max) return
        }
        const len = recipeLength(r) + 0.05
        // the voice budget
        this.active = this.active.filter((v) => v.end > now)
        const prio = own || !pos ? OWN : 1 / (1 + d)
        if (this.active.length >= this.maxVoices) {
            let lowest = null
            for (const v of this.active) if (!lowest || v.prio < lowest.prio) lowest = v
            if (!lowest || lowest.prio >= prio) return
            try {
                lowest.src.stop()
            } catch {
                // already stopped
            }
            this.active.splice(this.active.indexOf(lowest), 1)
        }
        const entry = last || { at: 0, list: [] }
        entry.at = now
        entry.list.push(now + delay + len)
        this._last.set(name, entry)

        const out = this._out(pos, gain * (LEVELS[name] ?? 1), r.bus || 'sfx', d)
        const t = now + delay
        const buf = this.bank.get(name)
        let src
        if (buf) {
            src = ctx.createBufferSource()
            src.buffer = buf
            // a little faster or slower each time, within the recipe's pitch range
            src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * (r.pitch ?? DEFAULT_PITCH) * 0.5)
            src.connect(out)
            src.start(t)
        } else {
            // not in the bank (light recipes, or before it's rendered): synthesise it now
            const range = r.pitch ?? DEFAULT_PITCH
            const pitch = (1 + (Math.random() * 2 - 1) * range) * rate
            synth(ctx, out, r, t, Math.random, pitch)
            // something to stop if the voice is taken: silence the output
            src = { stop: () => out.gain.setValueAtTime(0, ctx.currentTime) }
        }
        this.active.push({ src, prio, end: t + len })
    }

    /** the chain one sound goes out through: gain, panner, and the room */
    _out(pos, gain, bus, dist) {
        const ctx = this.ctx
        const g = ctx.createGain()
        g.gain.value = gain
        const dest = this.buses[bus] || this.buses.sfx
        if (!pos) {
            g.connect(dest)
            return g
        }
        const p = ctx.createPanner()
        p.panningModel = 'equalpower'
        p.distanceModel = 'inverse'
        p.refDistance = 3
        p.maxDistance = 80
        p.rolloffFactor = 1.2
        if (p.positionX) {
            p.positionX.value = pos[0]
            p.positionY.value = pos[1]
            p.positionZ.value = pos[2]
        } else p.setPosition(pos[0], pos[1], pos[2])
        g.connect(p)
        p.connect(dest)
        // the farther away, the more of it is room
        if (this.reverbOn) {
            const send = ctx.createGain()
            send.gain.value = Math.min(0.6, 0.08 + dist / 50)
            p.connect(send).connect(this.reverb)
        }
        return g
    }

    /** a plain tone, for the stingers and the UI (not worth a recipe each) */
    _tone(pos, { freq = 440, dur = 0.2, gain = 0.3, type = 'sine', to = null, delay = 0, bus = 'ui' }) {
        if (!this._ensure() || this.muted) return
        const ctx = this.ctx, t = ctx.currentTime + delay
        const o = ctx.createOscillator()
        o.type = /** @type {OscillatorType} */ (type)
        o.frequency.setValueAtTime(freq, t)
        if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur)
        const out = this._out(pos, 0, bus, 0)
        out.gain.setValueAtTime(0, t)
        out.gain.linearRampToValueAtTime(gain, t + 0.01)
        out.gain.exponentialRampToValueAtTime(0.001, t + dur)
        o.connect(out)
        o.start(t)
        o.stop(t + dur + 0.05)
    }

    // ---- stingers ------------------------------------------------------------------

    /** dusk: the attackers' horn */
    horn() {
        for (const [f, d] of [[146.8, 0], [220, 0.02], [293.7, 0.04]]) this._tone(null, { freq: f, dur: 2.2, gain: 0.12, type: 'sawtooth', delay: d, bus: 'amb' })
    }

    chime() {
        ;[523.3, 659.3, 784, 1046.5].forEach((f, i) => this._tone(null, { freq: f, dur: 0.6, gain: 0.12, delay: i * 0.12 }))
    }

    ui() {
        this._tone(null, { freq: 880, to: 660, dur: 0.06, gain: 0.08, type: 'triangle' })
    }

    victory() {
        ;[392, 523.3, 659.3, 784].forEach((f, i) => this._tone(null, { freq: f, dur: 0.5, gain: 0.15, type: 'triangle', delay: i * 0.15 }))
    }

    defeat() {
        ;[392, 349.2, 311.1, 261.6].forEach((f, i) => this._tone(null, { freq: f, dur: 0.6, gain: 0.15, type: 'sawtooth', delay: i * 0.2 }))
    }
}
