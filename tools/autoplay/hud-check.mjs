/*
 *  The version label against the HUD (plan 12 §1): at a desktop window, a
 *  phone held upright and a phone held sideways, on the menu and in a game,
 *  the label's box must overlap nothing else on screen. Also screenshots each,
 *  and checks the health chip and the hotbar don't overlap (the landscape fix,
 *  plan 12 §0.1).
 *
 *  Usage: node tools/autoplay/hud-check.mjs [--no-build] [--out=recordings/hud12]
 *  Exits non-zero on an overlap.
 */

import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { serveDist, DIST } from '../serve-dist.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const ROOT = new URL('../../', import.meta.url).pathname
const out = args.out || join(ROOT, 'recordings', 'hud12')
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
    }
    await ctx.close()
}
await browser.close()
server.close()
console.log(`output: ${out}`)
if (bad) process.exitCode = 1
