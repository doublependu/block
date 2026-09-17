/*
 *  Tiny Web Audio engine with procedural sound effects (no audio downloads).
 *  Positional one-shots via PannerNode; the listener follows the camera.
 *  The AudioContext is created on the first user gesture (autoplay policy).
 */

const MAX_VOICES = 24

export class Audio {
    constructor() {
        this.ctx = null
        this.master = null
        this.voices = 0
        this.muted = false
        this.volume = 0.7
        this._noise = null
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
        this.master = this.ctx.createGain()
        this.master.gain.value = this.muted ? 0 : this.volume
        this.master.connect(this.ctx.destination)
        // shared white noise buffer
        const len = this.ctx.sampleRate
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
        const d = buf.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
        this._noise = buf
        return true
    }

    setMuted(m) {
        this.muted = m
        if (this.master) this.master.gain.value = m ? 0 : this.volume
    }

    /** @param {number[]} pos @param {number[]} dir */
    setListener(pos, dir) {
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

    _out(pos, gain) {
        const ctx = this.ctx
        const g = ctx.createGain()
        g.gain.value = gain
        if (pos) {
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
            p.connect(this.master)
        } else {
            g.connect(this.master)
        }
        return g
    }

    _voice(dur) {
        if (this.voices >= MAX_VOICES) return false
        this.voices++
        setTimeout(() => this.voices--, dur * 1000 + 50)
        return true
    }

    _noiseBurst(pos, { dur = 0.15, gain = 0.4, freq = 1200, q = 1, type = 'bandpass', attack = 0.005, sweepTo = null }) {
        if (!this._ensure() || !this._voice(dur)) return
        const ctx = this.ctx, t = ctx.currentTime
        const src = ctx.createBufferSource()
        src.buffer = this._noise
        const f = ctx.createBiquadFilter()
        f.type = /** @type {BiquadFilterType} */ (type)
        f.frequency.setValueAtTime(freq, t)
        if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
        f.Q.value = q
        const out = this._out(pos, 0)
        out.gain.setValueAtTime(0, t)
        out.gain.linearRampToValueAtTime(gain, t + attack)
        out.gain.exponentialRampToValueAtTime(0.001, t + dur)
        src.connect(f)
        f.connect(out)
        src.start(t, Math.random() * 0.5)
        src.stop(t + dur + 0.05)
    }

    _tone(pos, { freq = 440, dur = 0.2, gain = 0.3, type = 'sine', to = null, delay = 0 }) {
        if (!this._ensure() || !this._voice(dur + delay)) return
        const ctx = this.ctx, t = ctx.currentTime + delay
        const o = ctx.createOscillator()
        o.type = /** @type {OscillatorType} */ (type)
        o.frequency.setValueAtTime(freq, t)
        if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur)
        const out = this._out(pos, 0)
        out.gain.setValueAtTime(0, t)
        out.gain.linearRampToValueAtTime(gain, t + 0.01)
        out.gain.exponentialRampToValueAtTime(0.001, t + dur)
        o.connect(out)
        o.start(t)
        o.stop(t + dur + 0.05)
    }

    // ---- game sounds ----------------------------------------------------------

    /** @param {'soft'|'stone'|'wood'|'metal'} material */
    step(pos, material) {
        const freq = { soft: 500, stone: 1500, wood: 900, metal: 2500 }[material] || 700
        this._noiseBurst(pos, { dur: 0.07, gain: 0.12, freq, q: 0.8 })
    }

    dig(pos, material) {
        const freq = { soft: 400, stone: 1800, wood: 700, metal: 2600 }[material] || 800
        this._noiseBurst(pos, { dur: 0.09, gain: 0.25, freq, q: 2 })
    }

    breakBlock(pos, material) {
        const freq = { soft: 350, stone: 1200, wood: 600, metal: 2000 }[material] || 700
        this._noiseBurst(pos, { dur: 0.25, gain: 0.45, freq, q: 0.7, sweepTo: freq / 3 })
    }

    place(pos) {
        this._noiseBurst(pos, { dur: 0.08, gain: 0.35, freq: 300, q: 1.5, type: 'lowpass' })
        this._tone(pos, { freq: 140, to: 90, dur: 0.08, gain: 0.25 })
    }

    swing(pos) {
        this._noiseBurst(pos, { dur: 0.15, gain: 0.18, freq: 2500, q: 2, sweepTo: 700 })
    }

    hit(pos) {
        this._noiseBurst(pos, { dur: 0.1, gain: 0.35, freq: 900, q: 1.2 })
        this._tone(pos, { freq: 180, to: 110, dur: 0.12, gain: 0.2, type: 'triangle' })
    }

    shoot(pos, kind) {
        if (kind === 'bullet') {
            this._noiseBurst(pos, { dur: 0.25, gain: 0.7, freq: 1800, q: 0.5, sweepTo: 200 })
        } else if (kind === 'cannonball') {
            this._noiseBurst(pos, { dur: 0.6, gain: 0.8, freq: 400, q: 0.5, type: 'lowpass', sweepTo: 60 })
            this._tone(pos, { freq: 80, to: 35, dur: 0.5, gain: 0.5 })
        } else {
            this._tone(pos, { freq: 520, to: 180, dur: 0.12, gain: 0.15, type: 'triangle' })
            this._noiseBurst(pos, { dur: 0.18, gain: 0.12, freq: 3000, q: 3, sweepTo: 1200 })
        }
    }

    explosion(pos) {
        this._noiseBurst(pos, { dur: 0.8, gain: 0.8, freq: 600, q: 0.4, type: 'lowpass', sweepTo: 50 })
        this._tone(pos, { freq: 70, to: 30, dur: 0.7, gain: 0.5 })
    }

    /** a lit fuse hissing */
    fuse(pos) {
        this._noiseBurst(pos, { dur: 1.6, gain: 0.18, freq: 5000, q: 1.5, attack: 0.05, sweepTo: 3000 })
    }

    death(pos) {
        this._tone(pos, { freq: 300, to: 70, dur: 0.45, gain: 0.25, type: 'sawtooth' })
    }

    townHit(pos) {
        this._tone(pos, { freq: 110, to: 80, dur: 0.3, gain: 0.35, type: 'square' })
    }

    horn() {
        for (const [f, d] of [[146.8, 0], [220, 0.02], [293.7, 0.04]]) this._tone(null, { freq: f, dur: 2.2, gain: 0.12, type: 'sawtooth', delay: d })
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

/** sound material for a block name */
export function soundMaterial(name) {
    if (!name) return 'soft'
    if (/stone|cobble|ore|bedrock|plaza|town/.test(name)) return 'stone'
    if (/log|planks|gate|arrow_tower/.test(name)) return 'wood'
    if (/iron|spikes|cannon/.test(name)) return 'metal'
    return 'soft'
}
