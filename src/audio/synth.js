/*
 *  The synthesiser: turns a recipe (sounds.js) into Web Audio nodes on any
 *  context — the live one, or an OfflineAudioContext rendering it into the
 *  bank (bank.js). A recipe is a few layers started together:
 *
 *    noise    filtered white noise: whooshes, thuds, crunches, breath
 *    tone     an oscillator, optionally gliding: thumps, twangs, bells
 *    ring     inharmonic sine partials that die away: struck metal
 *    crackle  a scatter of tiny clicks: debris, splinters, creaks, sparks, rattles
 *    voice    a sawtooth through vowel formants: grunts, roars, war cries
 *
 *  Every layer has `at` (start, s), `dur` (s) and `gain`, with a short attack
 *  and an exponential decay. `pitch` scales every frequency (a variant's
 *  random detune), so one recipe gives several takes of the same sound.
 */

/** formant frequencies (Hz) and their strengths for the vowels the voices use */
const VOWELS = {
    a: [[800, 1], [1150, 0.5], [2900, 0.25]],
    o: [[450, 1], [800, 0.45], [2830, 0.15]],
    u: [[325, 1], [700, 0.35], [2530, 0.12]],
    e: [[400, 1], [1600, 0.4], [2700, 0.2]],
}
/** struck metal: partials of a free bar, the higher ones dying sooner */
const RING = [1, 2.76, 5.4, 8.93]

/** one second of white noise per context (seeded when rendering into the bank) */
const noiseBuffers = new WeakMap()
function noiseFor(ctx, rnd) {
    let b = noiseBuffers.get(ctx)
    if (b) return b
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1
    noiseBuffers.set(ctx, b)
    return b
}

/** attack to `gain`, then an exponential fall to silence at `end` */
function envelope(param, t, gain, attack, end) {
    param.setValueAtTime(0, t)
    param.linearRampToValueAtTime(gain, t + attack)
    param.exponentialRampToValueAtTime(0.0005, Math.max(t + attack + 0.001, end))
    param.setValueAtTime(0, end + 0.001)
}

/** a frequency that glides from `from` to `to` over `dur` */
function glide(param, t, from, to, dur) {
    param.setValueAtTime(from, t)
    if (to && to !== from) param.exponentialRampToValueAtTime(to, t + dur)
}

/**
 * Build a recipe's nodes into `dest`, starting at `t0`.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @param {import('./sounds.js').Recipe} recipe
 * @param {number} t0 context time
 * @param {() => number} rnd random numbers in [0, 1)
 * @param {number} [pitch] multiplies every frequency
 */
export function synth(ctx, dest, recipe, t0, rnd, pitch = 1) {
    const noise = noiseFor(ctx, rnd)
    for (const L of recipe.layers) {
        const t = t0 + (L.at || 0)
        const end = t + L.dur
        const attack = L.attack ?? (L.k === 'noise' ? 0.003 : 0.005)
        if (L.k === 'noise') {
            const src = ctx.createBufferSource()
            src.buffer = noise
            src.loop = true
            const f = ctx.createBiquadFilter()
            f.type = L.f || 'bandpass'
            glide(f.frequency, t, L.freq * pitch, L.to && L.to * pitch, L.dur)
            f.Q.value = L.q ?? 1
            const g = ctx.createGain()
            envelope(g.gain, t, L.gain, attack, end)
            src.connect(f).connect(g).connect(dest)
            src.start(t, rnd() * 0.9)
            src.stop(end + 0.02)
        } else if (L.k === 'tone') {
            const o = ctx.createOscillator()
            o.type = L.wave || 'sine'
            glide(o.frequency, t, L.freq * pitch, L.to && L.to * pitch, L.dur)
            const g = ctx.createGain()
            envelope(g.gain, t, L.gain, attack, end)
            o.connect(g).connect(dest)
            o.start(t)
            o.stop(end + 0.02)
        } else if (L.k === 'ring') {
            const partials = L.partials || RING
            partials.forEach((r, i) => {
                const f = L.freq * r * pitch * (1 + (rnd() - 0.5) * 0.004)
                // the bank renders at 22 kHz: a partial it can't carry is left out
                if (f > ctx.sampleRate * 0.45) return
                const o = ctx.createOscillator()
                o.frequency.value = f
                const g = ctx.createGain()
                envelope(g.gain, t, L.gain / (1 + i * 0.7), 0.002, t + L.dur / (1 + i * 0.8))
                o.connect(g).connect(dest)
                o.start(t)
                o.stop(t + L.dur + 0.02)
            })
        } else if (L.k === 'crackle') {
            // clicks thin out over the layer: most of the debris comes at the start
            const f = ctx.createBiquadFilter()
            f.type = 'bandpass'
            f.frequency.value = L.freq * pitch
            f.Q.value = L.q ?? 1.5
            f.connect(dest)
            for (let i = 0; i < L.n; i++) {
                const at = t + L.dur * Math.pow(rnd(), 1.6)
                const len = (L.size || 0.004) * (0.5 + rnd())
                const src = ctx.createBufferSource()
                src.buffer = noise
                const g = ctx.createGain()
                const k = 1 - (at - t) / L.dur
                envelope(g.gain, at, L.gain * (0.35 + 0.65 * rnd()) * (0.3 + 0.7 * k), 0.0005, at + len)
                src.connect(g).connect(f)
                src.start(at, rnd() * 0.9)
                src.stop(at + len + 0.01)
            }
        } else if (L.k === 'voice') {
            const o = ctx.createOscillator()
            o.type = 'sawtooth'
            glide(o.frequency, t, L.f0 * pitch, L.to && L.to * pitch, L.dur)
            // a little roughness: breath in the voice
            const src = ctx.createBufferSource()
            src.buffer = noise
            src.loop = true
            const breath = ctx.createGain()
            breath.gain.value = L.rough ?? 0.3
            const g = ctx.createGain()
            envelope(g.gain, t, L.gain, attack, end)
            for (const [freq, amp] of VOWELS[L.vowel || 'a']) {
                const f = ctx.createBiquadFilter()
                f.type = 'bandpass'
                f.frequency.value = freq * (0.9 + 0.2 * rnd()) * Math.sqrt(pitch)
                f.Q.value = freq / 90
                const a = ctx.createGain()
                a.gain.value = amp * 4
                o.connect(f)
                breath.connect(f)
                f.connect(a).connect(g)
            }
            src.connect(breath)
            g.connect(dest)
            o.start(t)
            o.stop(end + 0.02)
            src.start(t, rnd() * 0.9)
            src.stop(end + 0.02)
        }
    }
}

/** seconds from the start of a recipe to its last layer's end */
export function recipeLength(recipe) {
    let end = 0
    for (const L of recipe.layers) end = Math.max(end, (L.at || 0) + L.dur)
    return end + 0.03
}
