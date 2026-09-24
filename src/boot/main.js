/*
 *  Boot: the tiny first-load script behind the menu.
 *
 *  The menu is plain HTML and becomes interactive immediately. Meanwhile the
 *  engine chunk downloads in the background, and the worldgen worker starts
 *  generating the default world's spawn chunks, so "Play" is near-instant.
 */

import worlds from 'virtual:world-list'
import { idbGet } from '../core/idb.js'
import { CHUNK_SIZE } from '../core/constants.js'
import { detectTier } from '../engine/quality.js'

const timings = { menuInteractive: 0, playClicked: 0, codeLoaded: 0, gameCreated: 0, playable: 0 }
// @ts-ignore
window.__timings = timings

/** @type {(sel: string) => any} */
const $ = (sel) => document.querySelector(sel)
const menu = $('#menu')
const loading = $('#loading')
const params = new URLSearchParams(location.search)
// ?soundboard: every sound in the game with a play button (and what tools/sound-check.mjs renders through)
if (params.has('soundboard')) import('../audio/soundboard.js').then((m) => m.showSoundboard())

const tier = detectTier()
const defaultWorld = worlds.find((w) => w.isDefault) || worlds[0]

// start downloading the game code right away
const gameModule = import('../game/session.js')
gameModule.catch((err) => console.error(err))

// worldgen worker, pre-warmed with the default world's spawn area
const worker = new Worker(new URL('../world/gen/worker.js', import.meta.url), { type: 'module' })
const prewarm = (meta) => {
    const key = `${meta.generator.version}|${meta.seed}|${meta.size}`
    worker.postMessage({ type: 'world', key, version: meta.generator.version, seed: meta.seed, size: meta.size })
    const tc = meta.townCenter || [0, 8, 0]
    const r = Math.ceil(tier.chunkAddDistance[0])
    worker.postMessage({ type: 'prewarm', key, s: CHUNK_SIZE, cx: Math.floor(tc[0] / CHUNK_SIZE), cy: Math.floor(tc[1] / CHUNK_SIZE), cz: Math.floor(tc[2] / CHUNK_SIZE), radius: r, vRadius: 1 })
}
if (defaultWorld) prewarm(defaultWorld)
const defaultFile = defaultWorld ? fetch(defaultWorld.url).then((r) => r.text()) : null

// ---- menu ---------------------------------------------------------------------

function show(view) {
    for (const v of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.view'))) v.hidden = v.getAttribute('data-view') !== view
}

let autosave = null
idbGet('autosave').then((save) => {
    if (!save || !save.text) return
    autosave = save
    const btn = $('[data-go="continue"]')
    btn.hidden = false
    const ago = Math.round((Date.now() - save.savedAt) / 60000)
    btn.querySelector('.continue-info').textContent = `— ${save.name}, ${ago < 1 ? 'just now' : ago < 60 ? `${ago} min ago` : `${Math.round(ago / 60)} h ago`}`
})

function renderWorldList() {
    const box = $('.worlds')
    box.innerHTML = ''
    for (const w of worlds) {
        const b = document.createElement('button')
        b.innerHTML = `<b></b><small></small>`
        b.querySelector('b').textContent = w.name + (w.isDefault ? ' (default)' : '')
        b.querySelector('small').textContent = `${w.description ? w.description + ' · ' : ''}${w.mode} · ${w.size}×${w.size} · day ${w.day} · ${w.edits} edits · ${w.units} troops`
        b.addEventListener('click', () => launch({ kind: 'file', meta: w }))
        box.appendChild(b)
    }
    if (!worlds.length) box.textContent = 'No worlds in worlds/ yet.'
}

menu.addEventListener('click', (e) => {
    const el = /** @type {HTMLElement} */ (e.target).closest('[data-go]')
    if (!el) return
    const go = el.getAttribute('data-go')
    if (go === 'main' || go === 'new') show(go)
    else if (go === 'list') {
        renderWorldList()
        show('list')
    } else if (go === 'play') launch({ kind: 'file', meta: defaultWorld })
    else if (go === 'continue' && autosave) launch({ kind: 'autosave' })
    else if (go === 'create') {
        launch({
            kind: 'new',
            opts: {
                name: $('.f-name').value.trim(),
                seed: $('.f-seed').value.trim(),
                size: Number($('.f-size').value),
                mode: $('.f-mode').value,
                skirmish: $('.f-skirmish').checked,
            },
        })
    }
})

timings.menuInteractive = performance.now()

// ---- launch --------------------------------------------------------------------

let launched = false
async function launch(choice) {
    if (launched) return
    launched = true
    timings.playClicked = performance.now()
    menu.hidden = true
    loading.hidden = false
    const text = $('.loading-text')
    try {
        text.textContent = 'Loading game…'
        const [{ startGame }, { parseWorld, newWorldDef }, { localServices, probeServices }] = await Promise.all([
            gameModule,
            import('../world/worldFile.js'),
            import('../net/services.js'),
        ])
        timings.codeLoaded = performance.now()
        let def, sourceId
        if (choice.kind === 'file') {
            const raw = choice.meta === defaultWorld && defaultFile ? await defaultFile : await (await fetch(choice.meta.url)).text()
            def = parseWorld(raw)
            sourceId = choice.meta.id
        } else if (choice.kind === 'autosave') {
            def = parseWorld(autosave.text)
            sourceId = autosave.sourceId
        } else {
            def = newWorldDef(choice.opts)
            sourceId = 'new'
        }
        if (choice.kind !== 'file' || choice.meta !== defaultWorld) prewarm({ ...def })
        text.textContent = 'Building world…'
        const services = localServices()
        const session = await startGame({
            def, sourceId, worker, tier, services, resumed: choice.kind === 'autosave',
            container: $('#game'), hudRoot: $('#hud'), touchRoot: $('#touch'),
        })
        // @ts-ignore debugging handle
        window.game = session
        timings.gameCreated = performance.now()
        await waitForGround(session)
        loading.hidden = true
        timings.playable = performance.now()
        session.begin()
        // background: look for multiplayer servers (never blocks play)
        probeServices().then((r) => {
            if (r.config && r.config.identityUrl && !r.reachable) console.info('Servers configured but unreachable: single player')
        })
    } catch (err) {
        console.error(err)
        text.innerHTML = '<span class="err">Could not start the game.</span> <button onclick="location.reload()">Reload</button>'
    }
}

/** resolve once the chunk under the player has terrain (max ~4s) */
function waitForGround(session) {
    const noa = session.noa
    const t0 = performance.now()
    return /** @type {Promise<void>} */ (new Promise((resolve) => {
        const check = () => {
            const p = noa.entities.getPosition(noa.playerEntity)
            const w = noa.world
            const [i, j, k] = w._coordsToChunkIndexes(p[0], p[1] - 1, p[2])
            const chunk = w._storage.getChunkByIndexes(i, j, k)
            if ((chunk && !chunk._terrainDirty) || performance.now() - t0 > 4000) resolve()
            else setTimeout(check, 30)
        }
        check()
    }))
}

if (params.has('autoplay')) launch({ kind: 'file', meta: defaultWorld })
// "New game" after a game over: that world, fresh
else if (params.get('play')) {
    const meta = worlds.find((w) => w.id === params.get('play'))
    if (meta) launch({ kind: 'file', meta })
}
