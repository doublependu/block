/*
 *  The sound board (?soundboard): every recipe with a play button, grouped by
 *  what it's for, and the night's soundscape with sliders standing in for the
 *  game (how bad the night is, how much of the town is left). For listening
 *  to the sounds without playing for them, and for tools/sound-check.mjs,
 *  which renders each one offline through window.__renderSound.
 *
 *  Its own chunk: nothing here is in the game's code.
 */

import { Audio } from './audio.js'
import { Ambience } from './ambience.js'
import { RECIPES } from './sounds.js'
import { synth, recipeLength } from './synth.js'
import { banked, takes, takePitch } from './bank.js'
import { makeRandom } from '../core/rng.js'

/** @type {[string, RegExp][]} */
const GROUPS = [
    ['Swings', /^swing/], ['Hits', /^(hit|blow)/], ['Bows and guns', /^(bow|string|musket)/], ['Towers', /^fire/],
    ['Impacts', /^(impact|explosion|fuse)/], ['Pickaxe', /^dig/], ['Breaking', /^break/], ['Battering', /^bash/],
    ['Building', /^(place|tower_build|upgrade|patch|refuse)/], ['Moving', /^(step|jump|land)/],
    ['Voices', /^(hurt|death)/], ['Soundscape', /^(drum|war_cry|clash|bird|cricket|heartbeat|town_bell)/],
]

/**
 * Render one take of a recipe offline, as plain numbers (mono).
 * @param {string} name @param {number} [take] @param {number} [rate]
 */
export async function renderSound(name, take = 0, rate = 44100) {
    const r = RECIPES[name]
    const n = takes(r)
    const ctx = new OfflineAudioContext(1, Math.ceil(recipeLength(r) * rate), rate)
    synth(ctx, ctx.destination, r, 0, makeRandom(`${name}:${take}`), takePitch(r, take % n, n))
    const buf = await ctx.startRendering()
    return Array.from(buf.getChannelData(0))
}

export function showSoundboard() {
    // @ts-ignore for tools/sound-check.mjs
    window.__renderSound = renderSound
    // @ts-ignore
    window.__recipes = Object.keys(RECIPES)
    const audio = new Audio()
    const amb = new Ambience(audio)
    const root = document.createElement('div')
    root.id = 'soundboard'
    root.style.cssText = 'position:fixed;inset:0;z-index:100;overflow:auto;background:#15171c;color:#e8e8e8;font:14px system-ui,sans-serif;padding:16px'
    const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
    let html = '<h1 style="margin:0 0 4px">Sound board</h1><p style="margin:0 0 12px;color:#aaa">Click a sound to hear it (a different take each time). Rendered sounds are the ones the game pre-renders; the rest are made live.</p>'
    html += `<fieldset style="border:1px solid #333;margin:0 0 12px"><legend>The night</legend>
        <label>Phase <select class="sb-phase"><option>day</option><option>dusk</option><option selected>night</option><option>off</option></select></label>
        <label style="margin-left:12px">How bad <input class="sb-threat" type="range" min="0" max="1" step="0.05" value="0.5"></label>
        <label style="margin-left:12px">Town left <input class="sb-town" type="range" min="0" max="1" step="0.05" value="1"></label>
        <span class="sb-state" style="margin-left:12px;color:#aaa"></span></fieldset>`
    const used = new Set()
    for (const [title, re] of GROUPS) {
        const names = Object.keys(RECIPES).filter((n) => re.test(n) && !used.has(n))
        names.forEach((n) => used.add(n))
        html += `<h3 style="margin:12px 0 6px">${title}</h3><div>`
        for (const n of names) html += `<button data-sound="${n}" style="margin:2px;padding:6px 10px;background:${banked(RECIPES[n]) ? '#2a3350' : '#2b2f36'};color:#eee;border:1px solid #444;border-radius:4px">${esc(n)}</button>`
        html += '</div>'
    }
    const rest = Object.keys(RECIPES).filter((n) => !used.has(n))
    if (rest.length) html += `<h3>Other</h3><div>${rest.map((n) => `<button data-sound="${n}">${esc(n)}</button>`).join('')}</div>`
    root.innerHTML = html
    document.body.appendChild(root)
    root.addEventListener('click', (e) => {
        const b = /** @type {HTMLElement} */ (e.target).closest('[data-sound]')
        if (!b) return
        audio._ensure()
        audio.ctx.resume()
        audio.play(b.getAttribute('data-sound'), null, { own: true })
    })
    audio.prepare()
    const $ = (s) => /** @type {HTMLInputElement} */ (root.querySelector(s))
    setInterval(() => {
        if (!audio.ctx) return
        const phase = $('.sb-phase').value
        if (phase === 'off') return
        const i = Number($('.sb-threat').value)
        const state = { phase, attackers: Math.round(i * 30), nearest: 60 - i * 55, front: [30, 0, -30], townHp: Number($('.sb-town').value), fighting: 0 }
        amb.update(0.1, state)
        root.querySelector('.sb-state').textContent = `${state.attackers} attackers, nearest ${Math.round(state.nearest)} m · intensity ${amb.intensity.toFixed(2)} · bank ${audio.bank.done ? 'ready' : 'rendering'} (${(audio.bank.bytes / 1e6).toFixed(1)} MB)`
    }, 100)
}
