/*
 *  The version label against the HUD (plan 12 §1): at a desktop window, a
 *  phone held upright and a phone held sideways, on the menu and in a game,
 *  the label's box must overlap nothing else on screen. Also screenshots each,
 *  and checks the health chip and the hotbar don't overlap (the landscape fix,
 *  plan 12 §0.1).
 *
 *  Plan 13 adds, on the same three screens:
 *    fork     "Fork me on GitHub" at the foot of the menu card and of the pause
 *             panel: on screen, and the version keeps its corner (§5)
 *    build    the Build panel's hotbar row and the inventory under it, both fully
 *             on screen together, every slot at least 44 px (§7.1, §7.3)
 *    moves    with taps (touch on the phones): put an item on the hotbar, swap two
 *             slots, take one off; the hotbar must be what the table says (§7.2)
 *
 *  Usage: node tools/autoplay/hud-check.mjs [--no-build] [--out=recordings/hud13]
 *  Exits non-zero on an overlap or a failed check.
 */

import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { serveDist, DIST } from '../serve-dist.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const ROOT = new URL('../../', import.meta.url).pathname
const out = args.out || join(ROOT, 'recordings', 'hud13')
mkdirSync(out, { recursive: true })
if (!args['no-build'] || !existsSync(join(DIST, 'index.html'))) {
    console.log('building…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}
const server = await serveDist({ port: Number(args.port || 4193) })
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] })

const SCREENS = [
    ['desktop', { viewport: { width: 1280, height: 720 } }],
    ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }],
    ['phone-land', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }],
]

/** boxes of everything visible that could share the label's corner */
const boxesOf = (page) => page.evaluate(() => {
    const visible = (el) => {
        const s = getComputedStyle(el)
        if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
    }
    const box = (el) => {
        const r = el.getBoundingClientRect()
        return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }
    }
    const ver = document.querySelector('#ver')
    const others = []
    // the HUD's own blocks (not its full-screen layers), the touch buttons, the menu's card
    const sel = '#hud .hud-top > *, #hud .hotbar, #hud .hp, #hud .mode, #hud .corner, #hud .banner, #hud .toasts > *, #touch .t-btn, #touch .t-stick, #menu .card'
    for (const el of document.querySelectorAll(sel)) if (visible(el)) others.push({ name: el.className || el.tagName, ...box(el) })
    return { ver: { text: ver.textContent, ...box(ver) }, others, hp: document.querySelector('#hud .hp') && visible(document.querySelector('#hud .hp')) ? box(document.querySelector('#hud .hp')) : null, hotbar: document.querySelector('#hud .hotbar') ? box(document.querySelector('#hud .hotbar')) : null }
})
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

let bad = 0
for (const [name, opts] of SCREENS) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...opts })
    const page = await ctx.newPage()
    await page.goto(server.url)
    await page.waitForSelector('[data-go="play"]')
    await page.waitForTimeout(800)
    for (const where of ['menu', 'game']) {
        if (where === 'game') {
            if (opts.hasTouch) await page.tap('[data-go="play"]')
            else await page.click('[data-go="play"]')
            await page.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 120000 })
            await page.waitForTimeout(2500)
            // a touch turns the touch controls on, as on a real phone
            if (opts.hasTouch) await page.touchscreen.tap(opts.viewport.width * 0.7, opts.viewport.height * 0.3)
            await page.waitForTimeout(600)
        }
        const b = await boxesOf(page)
        const hit = b.others.filter((o) => overlaps(b.ver, o))
        const chipUnderHotbar = where === 'game' && b.hp && b.hotbar && overlaps(b.hp, b.hotbar)
        const file = join(out, `${name}-${where}.png`)
        await page.screenshot({ path: file })
        const ok = !hit.length && !chipUnderHotbar
        if (!ok) bad++
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${where}: "${b.ver.text}" at ${Math.round(b.ver.x0)},${Math.round(b.ver.y0)}`
            + (hit.length ? ` overlaps ${hit.map((o) => o.name).join(', ')}` : '') + (chipUnderHotbar ? ' — the hotbar covers the health chip' : ''))
        if (where === 'menu') bad += await checkFork(page, name, 'menu', '#menu .fork')
    }
    // the pause panel's fork line
    await page.evaluate(() => window.game.hud.openPanel('pause'))
    await page.waitForTimeout(300)
    bad += await checkFork(page, name, 'pause', '#hud [data-panel="pause"] .fork')
    await page.screenshot({ path: join(out, `${name}-pause.png`) })
    await page.evaluate(() => window.game.hud.closePanel())
    bad += await checkBuild(page, name, opts)
    await ctx.close()
}

/** the fork line: on screen (scrolled to, inside a panel that scrolls), a real link, clear of the version */
async function checkFork(page, name, where, sel) {
    const r = await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el) return { missing: true }
        el.scrollIntoView({ block: 'nearest' })
        const box = (e) => {
            const b = e.getBoundingClientRect()
            return { x0: b.left, y0: b.top, x1: b.right, y1: b.bottom }
        }
        const links = [...el.querySelectorAll('a')].map((a) => ({ href: a.href, target: a.target, text: a.textContent.trim() }))
        return { box: box(el), ver: box(document.querySelector('#ver')), w: innerWidth, h: innerHeight, links }
    }, sel)
    if (r.missing) {
        console.log(`FAIL ${name} ${where} fork: missing`)
        return 1
    }
    const onScreen = r.box.x0 >= 0 && r.box.y0 >= 0 && r.box.x1 <= r.w && r.box.y1 <= r.h
    const clear = !overlaps(r.box, r.ver)
    const link = r.links.find((l) => /github\.com\/doublependu\/block$/.test(l.href) && l.target === '_blank')
    const ok = onScreen && clear && !!link
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${where} fork: ${r.links.map((l) => `"${l.text}" -> ${l.href}`).join(', ')}${onScreen ? '' : ' (off screen)'}${clear ? '' : ' (over the version)'}`)
    return ok ? 0 : 1
}

/** the Build panel: the hotbar row and the inventory both on screen; tap, then tap, moves things */
async function checkBuild(page, name, opts) {
    let bad = 0
    // something to move: a gate and spikes in the inventory, off the hotbar
    await page.evaluate(() => {
        const g = window.game
        g.inventory.add('gate', 2)
        g.inventory.add('spikes', 2)
        for (const n of ['gate', 'spikes']) {
            const i = g.inventory.hotbar.indexOf(n)
            if (i >= 0) g.inventory.tapMove({ hotbar: i }, { item: null })
        }
        g.hud.openPanel('build')
    })
    await page.waitForTimeout(300)
    const lay = await page.evaluate(() => {
        const box = (e) => {
            const b = e.getBoundingClientRect()
            return { x0: b.left, y0: b.top, x1: b.right, y1: b.bottom, w: b.width, h: b.height }
        }
        const bar = [...document.querySelectorAll('#hud .build-bar .slot')].map(box)
        const inv = [...document.querySelectorAll('#hud .inv-grid .slot')].map(box)
        return { bar, inv, w: innerWidth, h: innerHeight }
    })
    const on = (b) => b.x0 >= 0 && b.y0 >= 0 && b.x1 <= lay.w && b.y1 <= lay.h
    const all = [...lay.bar, ...lay.inv.slice(0, 5)]
    const small = all.filter((b) => b.w < 44 || b.h < 44).length
    const off = all.filter((b) => !on(b)).length
    const rows = new Set(lay.bar.map((b) => Math.round(b.y0))).size
    const ok = lay.bar.length === 9 && lay.inv.length > 0 && !small && !off
    if (!ok) bad++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} build panel: hotbar row ${lay.bar.length} slots in ${rows} row(s), inventory ${lay.inv.length} cells; ${small} under 44 px, ${off} off screen`)
    await page.screenshot({ path: join(out, `${name}-build.png`) })

    // tap, then tap (touch on the phones, the mouse on the desktop)
    const tap = async (sel) => {
        if (opts.hasTouch) await page.tap(sel)
        else await page.click(sel)
        await page.waitForTimeout(120)
    }
    const bar = () => page.evaluate(() => window.game.inventory.hotbar.slice())
    const before = await bar()
    const empty = before.indexOf(null)
    // put: the gate onto an empty hotbar slot
    await tap('#hud .inv-grid [data-item="gate"]')
    const line = await page.evaluate(() => document.querySelector('#hud .move-text').textContent)
    await tap(`#hud .build-bar [data-bslot="${empty}"]`)
    const put = await bar()
    // swap: that slot with slot 2
    await tap(`#hud .build-bar [data-bslot="${empty}"]`)
    await tap('#hud .build-bar [data-bslot="1"]')
    const swapped = await bar()
    // take off: slot 2 (the gate now) into an empty cell
    await tap('#hud .build-bar [data-bslot="1"]')
    await tap('#hud .inv-grid [data-empty]')
    const off2 = await bar()
    const checks = [
        ['the line asks where to put it', /Where to put this\? *Gate/i.test(line)],
        ['put: the gate goes on the empty slot', put[empty] === 'gate'],
        ['swap: the two slots trade', swapped[1] === 'gate' && swapped[empty] === before[1]],
        ['take off: the slot is empty, the gate back in the inventory', off2[1] === null && !off2.includes('gate')],
    ]
    for (const [what, pass] of checks) {
        if (!pass) bad++
        console.log(`${pass ? 'ok  ' : 'FAIL'} ${name} move (${opts.hasTouch ? 'touch' : 'mouse'}): ${what}`)
    }
    await page.evaluate(() => window.game.hud.closePanel())
    return bad
}
await browser.close()
server.close()
console.log(`output: ${out}`)
if (bad) process.exitCode = 1
