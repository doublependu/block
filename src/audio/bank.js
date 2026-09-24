/*
 *  The sound bank: the heavier recipes (voices, debris, bells, drums, anything
 *  with several layers) rendered once into AudioBuffers, a few takes each, so
 *  playing one is a single buffer source however many layers it has. Cheap
 *  on a weak phone in the middle of a siege.
 *
 *  Rendering happens after the game is playable, a recipe at a time in idle
 *  moments, and costs nothing at load. Until a recipe is in the bank the
 *  engine synthesises it live (same recipe, same sound).
 */

import { synth, recipeLength } from './synth.js'
import { RECIPES, DEFAULT_PITCH } from './sounds.js'
import { makeRandom } from '../core/rng.js'

/** the bank's sample rate: plenty for effects heard through game speakers, half the memory of 44.1 kHz */
export const BANK_RATE = 22050

/**
 * pure: is a recipe worth pre-rendering? Voices, debris and rings are many
 * nodes live; so is anything with four layers or more.
 * @param {import('./sounds.js').Recipe} r
 */
export function banked(r) {
    let nodes = 0
    for (const L of r.layers) {
        if (L.k === 'crackle' || L.k === 'voice' || L.k === 'ring') return true
        nodes++
    }
    return nodes >= 4
}

/**
 * pure: how many takes of a recipe the bank keeps: fewer for the long ones
 * (each play also varies its speed a little, see Audio.play, so even one take
 * doesn't sound the same twice)
 */
export function takes(r) {
    const len = recipeLength(r)
    return len > 0.9 ? 1 : len > 0.35 ? 2 : 3
}

/** pure: the bank's size in bytes once everything is rendered */
export function bankBytes(recipes = RECIPES) {
    let bytes = 0
    for (const r of Object.values(recipes)) {
        if (banked(r)) bytes += Math.ceil(recipeLength(r) * BANK_RATE) * 4 * takes(r)
    }
    return bytes
}

/** pure: a take's detune, spread evenly across ± the recipe's pitch range */
export function takePitch(r, i, n) {
    const range = r.pitch ?? DEFAULT_PITCH
    return n <= 1 ? 1 : 1 + range * ((i / (n - 1)) * 2 - 1)
}

export class Bank {
    constructor() {
        /** @type {Map<string, AudioBuffer[]>} */
        this.buffers = new Map()
        this.started = false
        this.done = false
        this.bytes = 0
        this.ms = 0
    }

    /** @returns {AudioBuffer | null} a take of this recipe, if it's rendered */
    get(name) {
        const list = this.buffers.get(name)
        return list && list.length ? list[Math.floor(Math.random() * list.length)] : null
    }

    /** render everything, one recipe per idle moment */
    start() {
        if (this.started || typeof OfflineAudioContext === 'undefined') return
        this.started = true
        const queue = Object.entries(RECIPES).filter(([, r]) => banked(r))
        const idle = /** @type {any} */ (window).requestIdleCallback || ((f) => setTimeout(f, 30))
        const next = () => {
            const item = queue.shift()
            if (!item) {
                this.done = true
                return
            }
            this.render(item[0], item[1]).then(() => idle(next), () => idle(next))
        }
        idle(next)
    }

    /** render one recipe's takes */
    async render(name, r) {
        const t0 = performance.now()
        const n = takes(r)
        const len = Math.ceil(recipeLength(r) * BANK_RATE)
        const list = []
        for (let i = 0; i < n; i++) {
            const ctx = new OfflineAudioContext(1, len, BANK_RATE)
            synth(ctx, ctx.destination, r, 0, makeRandom(`${name}:${i}`), takePitch(r, i, n))
            list.push(await ctx.startRendering())
            this.bytes += len * 4
        }
        this.buffers.set(name, list)
        this.ms += performance.now() - t0
    }
}
