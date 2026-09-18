/*
 *  In-game HUD and panels (plain DOM over the canvas).
 */

import './hud.css'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { ITEMS, RECIPES, UNITS, WEAPONS } from '../game/balance.js'
import { canChooseRole } from '../game/cycle.js'
import { HOTBAR_SIZE } from '../game/inventory.js'
import { TILE, TILE_INDEX, ITEM_TILE } from '../world/atlas.js'
const BADGE = {
    iron: ['#d8b59a', 'Fe'], gold: ['#f2d23c', 'Au'],
    swordsman: ['#7fa7e8', 'Sw'], archer: ['#8fd07a', 'Ar'], gunner: ['#e88f7f', 'Gu'],
    wood_sword: ['#b8864f', '⚔'], stone_sword: ['#9c9c9c', '⚔'], iron_sword: ['#e3e7ee', '⚔'], bow: ['#c9a15f', '🏹'], musket: ['#8a735c', '▬'],
}
const LABEL = {
    stone_wall: 'Stone wall', iron_wall: 'Iron wall', arrow_tower: 'Arrow tower', cannon_tower: 'Cannon tower',
    cobble: 'Cobblestone', planks: 'Planks', log: 'Log', dirt: 'Dirt', sand: 'Sand', gate: 'Gate', spikes: 'Spikes',
    iron: 'Iron', gold: 'Gold', swordsman: 'Swordsman', archer: 'Archer', gunner: 'Gunner',
    grunt: 'Grunt', raider: 'Raider archer', brute: 'Brute', sapper: 'Sapper', player: 'Builder',
    wood_sword: 'Wooden sword', stone_sword: 'Stone sword', iron_sword: 'Iron sword', bow: 'Bow', musket: 'Musket',
}

export const label = (name) => LABEL[name] || name

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function fmtTime(sec) {
    if (!isFinite(sec)) return '∞'
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60)
    return `${m}:${String(s).padStart(2, '0')}`
}

export class Hud {
    /**
     * @param {HTMLElement} root
     * @param {any} session
     * @param {string} atlasURL
     */
    constructor(root, session, atlasURL) {
        this.root = root
        this.s = session
        this.icons = {}
        this.openName = null
        this._atlas = new Image()
        this._atlas.onload = () => {
            this.icons = {}
            this.renderHotbar()
        }
        this._atlas.src = atlasURL

        root.innerHTML = `
            <div class="hud-top">
                <div class="chip phase"><b class="phase-name">Day 1</b> <span class="phase-timer"></span></div>
                <button class="ready" title="Start the night now (N)">Start night</button>
                <div class="chip town" hidden>Town <span class="bar"><i></i></span></div>
                <div class="chip wave" hidden></div>
            </div>
            <div class="banner" hidden><span class="banner-text"></span><button class="banner-action" hidden></button></div>
            <div class="markers"></div>
            <div class="alerts"></div>
            <div class="numbers"></div>
            <div class="hurt"><i></i></div>
            <div class="mode chip"></div>
            <div class="corner">
                <button data-a="build" title="Build & craft (B)">Build</button>
                <button data-a="aerial" title="Aerial view (M)">View</button>
                <button data-a="role" title="Pick a role (R)" hidden>Role</button>
                <button data-a="pause" title="Menu (P / Esc)">☰</button>
            </div>
            <div class="crosshair"><i></i></div>
            <div class="mine-progress"><i></i></div>
            <div class="hp chip"><span class="hp-label">Builder</span><span class="bar"><i></i></span><small class="hp-sub" hidden></small></div>
            <div class="hotbar"></div>
            <div class="toasts"></div>

            <div class="panel" data-panel="build">
                <h2>Build <button data-close>✕</button></h2>
                <p class="build-note"></p>
                <h3>Inventory — click an item, then a hotbar slot key (1-9) or slot to assign</h3>
                <div class="inv-grid"></div>
                <h3>Craft</h3>
                <div class="grid recipes"></div>
            </div>

            <div class="panel" data-panel="pause">
                <h2>Paused <button data-close>✕</button></h2>
                <div class="row">
                    <button class="primary" data-a="resume">Resume</button>
                    <button data-a="export">Export world</button>
                    <button data-a="help">Controls</button>
                    <button data-a="quit">Save & quit to menu</button>
                </div>
                <h3>Settings</h3>
                <div class="row">
                    <label>Quality <select class="quality"><option value="low">Low</option><option value="med">Medium</option><option value="high">High</option></select></label>
                    <label><input type="checkbox" class="hpbars"> Health bars</label>
                    <label><input type="checkbox" class="mute"> Mute</label>
                    <label><input type="checkbox" class="fps"> Show FPS</label>
                </div>
                <h3>World</h3>
                <p class="world-info"></p>
            </div>

            <div class="panel side" data-panel="role">
                <h2>Choose your role <button data-close>✕</button></h2>
                <p class="role-note"></p>
                <h3>You</h3>
                <div class="row">
                    <button class="primary" data-role="self">Fight as yourself</button>
                    <button data-role="aerial">Watch from above</button>
                </div>
                <p class="role-auto">Watching or playing a unit? Your builder fights on its own.</p>
                <h3>Join the defence</h3>
                <div class="grid role-defenders"></div>
                <h3>Join the attack</h3>
                <div class="grid role-attackers"></div>
            </div>

            <div class="panel" data-panel="night">
                <h2>Start a night <button data-close>✕</button></h2>
                <p>Creative mode: choose how strong the attack should be.</p>
                <div class="row">
                    <input type="range" class="strength" min="1" max="40" value="3" style="flex:1">
                    <b class="strength-val">3</b>
                </div>
                <p class="strength-info"></p>
                <div class="row"><button class="primary" data-a="start-night">Start night</button></div>
            </div>

            <div class="panel" data-panel="result">
                <h2 class="result-title">Night over <button data-close>✕</button></h2>
                <p class="result-text"></p>
                <div class="row"><button class="primary" data-close>Continue</button></div>
            </div>

            <div class="panel" data-panel="help">
                <h2>Controls <button data-close>✕</button></h2>
                <div class="help-table">
                    <span><span class="kbd">WASD</span> <span class="kbd">Space</span></span><span>Move, jump</span>
                    <span><span class="kbd">Left click</span> (hold)</span><span>Mine block / attack with your weapon / pick up your troop</span>
                    <span><span class="kbd">Right click</span> <span class="kbd">E</span></span><span>Place selected block or troop</span>
                    <span><span class="kbd">1-9</span> <span class="kbd">Wheel</span></span><span>Select hotbar slot</span>
                    <span><span class="kbd">B</span></span><span>Build & craft (walls, towers, troops, weapons)</span>
                    <span><span class="kbd">V</span></span><span>First / third person</span>
                    <span><span class="kbd">M</span></span><span>Aerial view / back to yourself (drag to rotate, wheel zoom, right click places, click a unit at night to play as it)</span>
                    <span><span class="kbd">R</span></span><span>At dusk and night: play as a unit, watch, or fight as yourself (your builder fights on its own while you're away)</span>
                    <span><span class="kbd">N</span></span><span>Start the night early</span>
                    <span><span class="kbd">P</span> <span class="kbd">Esc</span></span><span>Menu, export world</span>
                    <span>Touch</span><span>Left stick moves, drag to look, pinch to zoom in aerial view, tap units to play as them, ⛏ mines and attacks</span>
                </div>
            </div>
        `
        this.$ = (sel) => root.querySelector(sel)
        /** floating damage numbers and "under attack" markers, moved every frame */
        this._floaters = []
        this._alerts = []
        this._alertTimes = new Map()
        this._wire()
        this.renderHotbar()
        session.inventory.on('change', () => {
            this.renderHotbar()
            if (this.openName === 'build') this.renderBuild()
        })
    }

    _wire() {
        const s = this.s
        this.root.addEventListener('click', (e) => {
            const el = /** @type {HTMLElement} */ (e.target).closest('button, .slot')
            if (!el) return
            s.audio.ui()
            if (el.hasAttribute('data-close')) return this.closePanel()
            if (el.classList.contains('banner-action')) return this._bannerAction && this._bannerAction()
            const a = el.getAttribute('data-a')
            if (a === 'build') return this.togglePanel('build')
            if (a === 'aerial') return s.control.toggleAerial()
            if (a === 'role') return s.openRolePicker()
            if (a === 'pause') return this.openPanel('pause')
            if (a === 'resume') return this.closePanel()
            if (a === 'export') return s.exportWorld()
            if (a === 'help') return this.openPanel('help')
            if (a === 'quit') return s.quit()
            if (a === 'start-night') {
                const lvl = Number(this.$('.strength').value)
                this.closePanel()
                return s.startNight(lvl)
            }
            if (el.classList.contains('ready')) return s.requestNight()
            if (el.hasAttribute('data-slot')) {
                const slot = Number(el.getAttribute('data-slot'))
                if (this.pendingAssign) {
                    s.inventory.assign(slot, this.pendingAssign)
                    this.pendingAssign = null
                    this.renderBuild()
                } else s.inventory.select(slot)
                return
            }
            if (el.hasAttribute('data-recipe')) {
                const r = RECIPES[Number(el.getAttribute('data-recipe'))]
                if (s.inventory.craft(r)) this.toast(`Crafted ${r.count} × ${label(r.out)}`, 'good')
                return
            }
            if (el.hasAttribute('data-item')) {
                this.pendingAssign = el.getAttribute('data-item')
                this.toast(`Now press 1-9 or tap a hotbar slot for ${label(this.pendingAssign)}`)
                return
            }
            if (el.hasAttribute('data-role')) {
                const role = el.getAttribute('data-role')
                this.closePanel()
                return s.chooseRole(role, el.getAttribute('data-type'))
            }
        })
        const strength = this.$('.strength')
        strength.addEventListener('input', () => this._updateStrength())
        this.$('.quality').addEventListener('change', (e) => s.setQuality(/** @type {HTMLSelectElement} */ (e.target).value))
        this.$('.hpbars').addEventListener('change', (e) => s.setHealthBars(/** @type {HTMLInputElement} */ (e.target).checked))
        this.$('.mute').addEventListener('change', (e) => s.setMuted(/** @type {HTMLInputElement} */ (e.target).checked))
        this.$('.fps').addEventListener('change', (e) => s.setFps(/** @type {HTMLInputElement} */ (e.target).checked))
        window.addEventListener('keydown', (e) => {
            if (this.openName === 'build' && this.pendingAssign && /^Digit[1-9]$/.test(e.code)) {
                s.inventory.assign(Number(e.code.slice(5)) - 1, this.pendingAssign)
                this.pendingAssign = null
                this.renderBuild()
            }
            if (e.code === 'Escape' && this.openName) this.closePanel()
        })
    }

    _updateStrength() {
        const lvl = Number(this.$('.strength').value)
        this.$('.strength-val').textContent = String(lvl)
        this.$('.strength-info').textContent = this.s.describeNight(lvl)
    }

    // ---- panels ------------------------------------------------------------------

    openPanel(name) {
        if (this.openName === name) return
        this.closePanel(true)
        const el = this.root.querySelector(`[data-panel="${name}"]`)
        if (!el) return
        el.classList.add('open')
        this.openName = name
        if (name === 'build') this.renderBuild()
        if (name === 'pause') {
            this.$('.quality').value = this.s.tier.name
            this.$('.hpbars').checked = this.s.healthBars.enabled
            this.$('.mute').checked = this.s.audio.muted
            this.$('.fps').checked = !!document.getElementById('fps')
            this.$('.world-info').textContent = this.s.describeWorld()
            this.s.setPaused(true)
        }
        if (name === 'night') this._updateStrength()
        this.s.control.setUiOpen(true)
    }

    closePanel(silent = false) {
        if (!this.openName) return
        const el = this.root.querySelector(`[data-panel="${this.openName}"]`)
        if (el) el.classList.remove('open')
        if (this.openName === 'pause') this.s.setPaused(false)
        this.openName = null
        this.pendingAssign = null
        if (!silent) this.s.control.setUiOpen(false)
    }

    togglePanel(name) {
        if (this.openName === name) this.closePanel()
        else this.openPanel(name)
    }

    /**
     * Red edges when you take a hit, brighter on the side it came from.
     * @param {number} fraction of your health this hit took
     * @param {number|null} angle where it came from, relative to where you look
     */
    hurt(fraction, angle = null) {
        const el = /** @type {HTMLElement} */ (this.$('.hurt'))
        el.style.setProperty('--hurt', String(Math.min(0.85, 0.25 + fraction * 1.8)))
        const wedge = /** @type {HTMLElement} */ (el.firstElementChild)
        wedge.style.opacity = angle === null ? '0' : '1'
        if (angle !== null) wedge.style.transform = `rotate(${angle}rad)`
        el.classList.remove('flash')
        void el.offsetWidth
        el.classList.add('flash')
    }

    /** the town bar pulses when the Town Center is hit */
    flashTown() {
        const el = this.$('.town')
        if (!el || el.hidden) return
        el.classList.remove('pulse')
        void /** @type {HTMLElement} */ (el).offsetWidth
        el.classList.add('pulse')
    }

    /** a floating number over something you hit */
    damageNumber(pos, amount, kill = false) {
        const box = this.$('.numbers')
        if (box.children.length >= 12) box.firstChild.remove()
        const el = document.createElement('div')
        el.className = 'dmg' + (kill ? ' kill' : '')
        el.textContent = String(Math.round(amount))
        box.appendChild(el)
        this._floaters.push({ el, pos: [pos[0], pos[1], pos[2]], age: 0 })
    }

    /**
     * Point at something that's being attacked: a ring where it is, or an arrow
     * at the edge of the screen when it's out of view. At most one per `key`.
     * @param {string} key rate-limiting key (one town center, one per tower…)
     * @param {string} text toast to show with it
     * @param {number[]} pos world position
     * @param {number} [seconds]
     * @param {number} [cooldown] seconds before the same key can alert again
     */
    alert(key, text, pos, seconds = 3, cooldown = 10) {
        const now = performance.now()
        const last = this._alertTimes.get(key) || -Infinity
        if (now - last < cooldown * 1000) return
        this._alertTimes.set(key, now)
        if (text) this.toast(text, 'warn')
        const el = document.createElement('div')
        el.className = 'alert-marker'
        el.innerHTML = '<b></b><i></i>'
        this.$('.alerts').appendChild(el)
        this._alerts.push({ el, pos: [pos[0], pos[1], pos[2]], until: now + seconds * 1000 })
    }

    /** a tick on the crosshair when your attack lands (red when it finished the target off) */
    hitMarker(kill = false) {
        const el = this.$('.crosshair')
        el.classList.remove('hit', 'kill')
        // restart the animation
        void /** @type {HTMLElement} */ (el).offsetWidth
        el.classList.add(kill ? 'kill' : 'hit')
        clearTimeout(this._markerTimer)
        this._markerTimer = setTimeout(() => el.classList.remove('hit', 'kill'), 220)
    }

    // ---- toasts --------------------------------------------------------------------

    toast(msg, kind = '') {
        const box = this.$('.toasts')
        const t = document.createElement('div')
        t.className = 'toast ' + kind
        t.textContent = msg
        box.appendChild(t)
        while (box.children.length > 4) box.firstChild.remove()
        setTimeout(() => t.remove(), 3200)
    }

    /**
     * A short message strip under the top bar. Unlike toasts it stays until
     * replaced (or for `seconds`), and can carry one action button.
     * @param {string} text
     * @param {{kind?: string, seconds?: number, action?: {label: string, fn: () => void} | null}} [o]
     */
    banner(text, { kind = '', seconds = 6, action = null } = {}) {
        const el = this.$('.banner')
        el.className = 'banner ' + kind
        this.$('.banner-text').textContent = text
        const btn = this.$('.banner-action')
        btn.hidden = !action
        if (action) btn.textContent = action.label
        this._bannerAction = action ? action.fn : null
        el.hidden = false
        clearTimeout(this._bannerTimer)
        if (seconds > 0) this._bannerTimer = setTimeout(() => this.hideBanner(), seconds * 1000)
    }

    hideBanner() {
        clearTimeout(this._bannerTimer)
        this.$('.banner').hidden = true
        this._bannerAction = null
    }

    // ---- icons ---------------------------------------------------------------------

    iconHTML(name) {
        if (BADGE[name]) {
            const [bg, txt] = BADGE[name]
            return `<span class="icon" style="background:${bg}">${txt}</span>`
        }
        const tile = ITEM_TILE[name]
        if (tile && this._atlas.complete && this._atlas.naturalWidth) {
            if (!this.icons[name]) {
                const c = document.createElement('canvas')
                c.width = c.height = TILE
                c.getContext('2d').drawImage(this._atlas, 0, TILE_INDEX[tile] * TILE, TILE, TILE, 0, 0, TILE, TILE)
                this.icons[name] = c.toDataURL()
            }
            return `<img class="icon" alt="" src="${this.icons[name]}">`
        }
        return `<span class="icon" style="background:#888">${esc(name.slice(0, 2))}</span>`
    }

    renderHotbar() {
        const inv = this.s.inventory
        let html = ''
        for (let i = 0; i < HOTBAR_SIZE; i++) {
            const name = inv.hotbar[i]
            const n = name ? inv.count(name) : 0
            html += `<div class="slot ${i === inv.selected ? 'sel' : ''} ${name && n > 0 ? '' : 'empty'}" data-slot="${i}" title="${name ? esc(label(name)) : ''}">
                <span class="k">${i + 1}</span>${name ? this.iconHTML(name) : ''}${name && isFinite(n) ? `<span class="n">${n}</span>` : ''}</div>`
        }
        this.$('.hotbar').innerHTML = html
    }

    renderBuild() {
        const s = this.s
        const inv = s.inventory
        this.$('.build-note').textContent = s.canEdit
            ? (inv.creative ? 'Creative mode: everything is free.' : 'Mine blocks for resources. Craft walls, towers and troops, then place them before night.')
            : 'Building is only possible during the day.'
        const names = Object.keys(ITEMS).filter((k) => inv.count(k) > 0)
        this.$('.inv-grid').innerHTML = names.length
            ? names.map((k) => `<button class="slot" data-item="${k}" ${ITEMS[k].kind === 'resource' ? 'disabled' : ''} title="${esc(label(k))}">${this.iconHTML(k)}${isFinite(inv.count(k)) ? `<span class="n">${inv.count(k)}</span>` : ''}</button>`).join('')
            : '<p>Nothing yet. Mine something!</p>'
        this.$('.recipes').innerHTML = inv.creative ? '<p>Not needed in creative mode.</p>' : RECIPES.map((r, i) => {
            const ok = inv.canAfford(r.cost)
            const cost = Object.entries(r.cost).map(([k, v]) => `${v} ${label(k)} (${inv.count(k)})`).join(', ')
            const extra = UNITS[r.out] ? ` — ${UNITS[r.out].hp} hp` : WEAPONS[r.out] ? ` — ${WEAPONS[r.out].damage} damage${WEAPONS[r.out].attack === 'melee' ? '' : ', ranged'}` : ''
            return `<button class="recipe ${ok ? '' : 'cant'}" data-recipe="${i}" ${ok ? '' : 'disabled'}>${this.iconHTML(r.out)}<span><b>${r.count} × ${label(r.out)}</b>${extra}<br><span class="cost">${cost}</span></span></button>`
        }).join('')
    }

    // ---- role picker -------------------------------------------------------------

    showRolePicker(note = '') {
        const s = this.s
        this.$('.role-note').textContent = note
        const self = /** @type {HTMLButtonElement} */ (this.$('[data-role="self"]'))
        self.disabled = !s.player.alive
        self.textContent = s.player.alive ? 'Fight as yourself' : 'Fight as yourself (knocked out)'
        const group = (side) => {
            const counts = {}
            for (const u of s.units.units) if (u.alive && u.side === side && !u.isPlayer) counts[u.type] = (counts[u.type] || 0) + 1
            const level = s.cycle.activeLevel
            const types = Object.values(UNITS).filter((u) => u.side === side && (side === 'defender' || u.unlockNight <= level || counts[u.type]))
            return types.map((t) => {
                const n = counts[t.type] || 0
                const waiting = side === 'attacker' && n === 0 && s.cycle.phase !== 'day'
                return `<button data-role="${side}" data-type="${t.type}" ${n === 0 && !waiting ? 'disabled' : ''}>${label(t.type)} <span class="cost">${n ? `(${n})` : waiting ? '(next)' : ''}</span></button>`
            }).join('')
        }
        this.$('.role-defenders').innerHTML = group('defender')
        this.$('.role-attackers').innerHTML = group('attacker')
        this.openPanel('role')
    }

    closeRolePicker() {
        if (this.openName === 'role') this.closePanel()
    }

    showResult(title, text) {
        this.$('.result-title').firstChild.textContent = title + ' '
        this.$('.result-text').textContent = text
        this.openPanel('result')
    }

    // ---- per-frame state ------------------------------------------------------------

    update() {
        const s = this.s
        const c = s.cycle
        const phaseNames = { day: `Day ${c.day}`, dusk: 'Dusk', night: c.opening ? 'Raid' : `Night ${c.activeLevel}`, dawn: 'Dawn' }
        const phaseEl = this.$('.phase')
        phaseEl.classList.toggle('night', c.phase === 'night' || c.phase === 'dusk')
        this.$('.phase-name').textContent = phaseNames[c.phase]
        let timer = ''
        if (c.phase === 'day') timer = c.creative ? 'creative' : `night in ${fmtTime(c.timeToNight)}`
        else if (c.phase === 'dusk') timer = 'attack incoming…'
        else if (c.phase === 'night') timer = ''
        else timer = 'rebuilding…'
        this.$('.phase-timer').textContent = timer

        const ready = this.$('.ready')
        ready.hidden = c.phase !== 'day'
        ready.textContent = c.creative ? 'Start night…' : `Start night ${c.nightLevel} now`

        const night = c.phase === 'night' || c.phase === 'dusk'
        const town = this.$('.town')
        town.hidden = !night
        if (night) {
            const pct = (s.units.town.hp / s.units.town.maxHp) * 100
            town.querySelector('i').style.width = pct + '%'
            town.querySelector('.bar').classList.toggle('bad', pct < 35)
        }
        const wave = this.$('.wave')
        wave.hidden = !(c.phase === 'night' || s.units.aliveAttackers() > 0)
        wave.textContent = `Attackers: ${c.phase === 'night' ? s.waves.remaining : s.units.aliveAttackers()}`

        const mode = s.control.mode
        this.root.classList.toggle('aerial', mode === 'aerial')
        this.root.classList.toggle('dead', mode === 'dead')
        const fight = canChooseRole(c.phase)
        const p = s.player
        const modeLabel = { self: fight ? 'Fighting as yourself' : 'Building', aerial: 'Aerial view', possess: 'Playing as ', dead: 'Defeated — choose a role' }
        const u = s.control.controlled
        let modeText = modeLabel[mode] + (mode === 'possess' && u ? `${label(u.type)} (${u.side})` : '')
        if (mode !== 'self' && s.units.combat) modeText += p.alive ? ' · builder on autopilot' : ' · builder knocked out'
        this.$('.mode').textContent = modeText
        this.$('[data-a="role"]').hidden = !fight
        this.$('[data-a="build"]').hidden = c.phase !== 'day'

        const hp = this.$('.hp')
        const sub = this.$('.hp-sub')
        const shown = u && (mode === 'self' || mode === 'possess') ? u : s.units.combat ? p : null
        if (shown) {
            hp.hidden = false
            const weapon = shown.isPlayer && p.weapon !== 'none' ? ` · ${label(p.weapon)}` : ''
            this.$('.hp-label').textContent = (shown.isPlayer ? 'Builder' : label(shown.type)) + (shown.isPlayer && mode !== 'self' ? ' (autopilot)' : '') + weapon
            hp.querySelector('i').style.width = Math.max(0, (shown.hp / shown.maxHp) * 100) + '%'
            const down = !p.alive && p.respawnIn > 0
            sub.hidden = !down
            if (down) sub.textContent = `Builder knocked out — back in ${Math.ceil(p.respawnIn)} s`
        } else hp.hidden = true

        const m = s.control.mining
        const mp = this.$('.mine-progress')
        mp.style.display = m ? 'block' : 'none'
        if (m) mp.querySelector('i').style.width = Math.min(100, m.progress * 100) + '%'
        this.$('.hotbar').hidden = mode !== 'self' && mode !== 'aerial'
        this._updateMarkers()
    }

    /**
     * Damage numbers and "under attack" markers follow the world, so they move
     * every frame (the rest of the HUD updates ten times a second).
     * @param {number} dtMs
     */
    renderFloaters(dtMs) {
        const dt = dtMs / 1000
        if (!this._floaters.length && !this._alerts.length) return
        const p = this._projector()
        for (let i = this._floaters.length - 1; i >= 0; i--) {
            const f = this._floaters[i]
            f.age += dt
            const life = 0.8
            if (f.age >= life) {
                f.el.remove()
                this._floaters.splice(i, 1)
                continue
            }
            const s = p(f.pos)
            f.el.style.opacity = String(Math.max(0, 1 - f.age / life))
            if (!s.onScreen) {
                f.el.style.display = 'none'
                continue
            }
            f.el.style.display = ''
            f.el.style.transform = `translate(-50%, -50%) translate(${s.x}px, ${s.y - f.age * 42}px) scale(${1 + f.age * 0.25})`
        }
        const now = performance.now()
        for (let i = this._alerts.length - 1; i >= 0; i--) {
            const a = this._alerts[i]
            if (now > a.until) {
                a.el.remove()
                this._alerts.splice(i, 1)
                continue
            }
            const s = p(a.pos)
            const w = window.innerWidth, h = window.innerHeight
            if (s.onScreen) {
                a.el.classList.remove('edge')
                a.el.style.transform = `translate(-50%, -50%) translate(${s.x}px, ${s.y}px)`
            } else {
                a.el.classList.add('edge')
                let dx = s.x - w / 2, dy = s.y - h / 2
                if (!s.front) {
                    dx = -dx
                    dy = -dy
                }
                const len = Math.hypot(dx, dy) || 1
                const k = Math.min((w / 2 - 40) / Math.abs(dx || 1e-6), (h / 2 - 40) / Math.abs(dy || 1e-6))
                a.el.style.transform = `translate(-50%, -50%) translate(${w / 2 + dx * k}px, ${h / 2 + dy * k}px)`
                const arrow = /** @type {HTMLElement} */ (a.el.lastElementChild)
                arrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`
            }
        }
    }

    /** world position -> screen position for this frame */
    _projector() {
        const cam = this.s.noa.rendering.getScene().activeCamera
        const view = cam.getViewMatrix(), proj = cam.getProjectionMatrix()
        const w = window.innerWidth, h = window.innerHeight
        return (pos) => {
            const v = Vector3.TransformCoordinates(new Vector3(pos[0], pos[1], pos[2]), view)
            const front = v.z > 0.3
            const ndc = Vector3.TransformCoordinates(v, proj)
            const x = (ndc.x * 0.5 + 0.5) * w, y = (0.5 - ndc.y * 0.5) * h
            return { x, y, front, onScreen: front && x > 0 && x < w && y > 0 && y < h }
        }
    }

    /** edge-of-screen arrows toward attacker groups that are off screen */
    _updateMarkers() {
        const s = this.s
        const box = this.$('.markers')
        const show = s.control.mode !== 'dead' && (!this.openName || this.openName === 'role') && (s.cycle.phase === 'night' || s.units.aliveAttackers() > 0)
        const groups = show ? s.waves.frontGroups() : []
        while (box.children.length < groups.length) {
            const d = document.createElement('div')
            d.className = 'marker'
            d.innerHTML = '<i></i><span></span>'
            box.appendChild(d)
        }
        if (!groups.length && box.querySelector('.marker:not([hidden])') === null) return
        const cam = s.noa.rendering.getScene().activeCamera
        const w = window.innerWidth, h = window.innerHeight
        const view = cam.getViewMatrix(), proj = cam.getProjectionMatrix()
        // keep arrows clear of the top bar / banner and the hotbar
        const banner = this.$('.banner')
        const top = Math.max(this.$('.hud-top').getBoundingClientRect().bottom, banner.hidden ? 0 : banner.getBoundingClientRect().bottom) + 28
        const hotbar = this.$('.hotbar')
        const bottom = (hotbar.hidden ? h : hotbar.getBoundingClientRect().top) - 34
        const left = 30, right = w - 30
        for (let i = 0; i < box.children.length; i++) {
            const el = /** @type {HTMLElement} */ (box.children[i])
            const g = groups[i]
            if (!g) {
                el.hidden = true
                continue
            }
            const v = Vector3.TransformCoordinates(new Vector3(g.pos[0], g.pos[1] + 1, g.pos[2]), view)
            let dx = v.x, dy = -v.y
            if (v.z > 0.5) {
                const ndc = Vector3.TransformCoordinates(v, proj)
                const sx = (ndc.x * 0.5 + 0.5) * w, sy = (0.5 - ndc.y * 0.5) * h
                if (sx > 0 && sx < w && sy > 0 && sy < h) {
                    el.hidden = true
                    continue
                }
                dx = sx - w / 2
                dy = sy - h / 2
            }
            if (Math.abs(dx) + Math.abs(dy) < 1e-4) dy = 1
            // from the screen center to the edge of the free area
            const kx = dx > 0 ? (right - w / 2) / dx : dx < 0 ? (left - w / 2) / dx : Infinity
            const ky = dy > 0 ? (bottom - h / 2) / dy : dy < 0 ? (top - h / 2) / dy : Infinity
            const k = Math.max(0, Math.min(kx, ky))
            el.hidden = false
            el.style.transform = `translate(${w / 2 + dx * k}px, ${h / 2 + dy * k}px)`
            const arrow = /** @type {HTMLElement} */ (el.firstElementChild)
            arrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`
            el.lastElementChild.textContent = String(g.count)
        }
    }
}
