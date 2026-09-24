/*
 *  Lab scenarios: development shortcuts for testing the bot's skills and
 *  tactics in minutes instead of hours. They write game state directly
 *  (skip the opening raid, hand out items, start a night), so they're never
 *  allowed in a recorded run (run.mjs refuses --record with --lab).
 *
 *  --lab=skills:<test>   skip to day 1, run one skill test (see bot/tests.js)
 *  --lab=day             skip to day 1 and play normally from there
 *  --lab=night:<n>       skip to day 1, give the resources the bot would have by
 *                        night n, let it build, and start night n when it presses N
 *  --lab=fight:<n>       skip to day 1 and start night n straight away (night tactics only)
 *  --lab=siege:<town>:<n>  load a saved town (tools/autoplay/towns/<town>.world.json, or "default" for
 *                        worlds/default.world.json) through Continue and start night n at once. The
 *                        builder fights on autopilot and the run stops when the night is over: it
 *                        measures the town, not the player (tools/autoplay/map.mjs runs many)
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const TOWNS = new URL('./towns/', import.meta.url).pathname

/** a saved town's world file */
export function townFile(name) {
    return name === 'default' ? new URL('../../worlds/default.world.json', import.meta.url).pathname : join(TOWNS, `${name}.world.json`)
}

/** skip the opening raid and its dawn: day 1 with the starting town */
export async function skipToDay(page) {
    await page.waitForFunction(() => window.game.opening && window.game.cycle.phase === 'night', null, { timeout: 15000 }).catch(() => {})
    await page.evaluate(() => window.game.skipOpening())
    await page.waitForFunction(() => window.game.cycle.phase === 'dawn', null, { timeout: 15000 })
    await page.evaluate(() => window.game.skipDawn())
    await page.waitForFunction(() => window.game.cycle.phase === 'day', null, { timeout: 30000 })
    await page.evaluate(() => {
        const g = window.game
        g.hud.closePanel()
        g.hud.hideBanner()
    })
}

/** what the bot would have gathered and been rewarded by night n (rough) */
function kitFor(n) {
    const k = Math.max(0, n - 1)
    return { planks: 12 + 20 * k, cobble: 12 + 14 * k, log: 4 + 2 * k, iron: 2 * k, gold: Math.ceil(1.5 * k) }
}

export const LAB = {
    siege: {
        /** put the town where Continue finds it (the autosave), then Continue */
        async beforePlay(page, arg) {
            const [town] = arg.split(':')
            const text = readFileSync(townFile(town || 'default'), 'utf8')
            await page.evaluate((text) => new Promise((resolve, reject) => {
                const req = indexedDB.open('block', 1)
                req.onupgradeneeded = () => req.result.createObjectStore('kv')
                req.onerror = () => reject(req.error)
                req.onsuccess = () => {
                    const tx = req.result.transaction('kv', 'readwrite')
                    tx.objectStore('kv').put({ sourceId: 'lab', name: 'Lab town', savedAt: Date.now(), text }, 'autosave')
                    tx.oncomplete = () => resolve(true)
                    tx.onerror = () => reject(tx.error)
                }
            }), text)
            await page.reload()
            await page.waitForSelector('[data-go="continue"]', { state: 'visible', timeout: 30000 })
            return '[data-go="continue"]'
        },
        async setup(page, arg) {
            const n = Number(arg.split(':')[1] || 3)
            await page.waitForFunction(() => window.game && window.game.cycle.phase === 'day', null, { timeout: 30000 })
            await page.evaluate((n) => {
                const g = window.game
                g.hud.closePanel()
                g.hud.hideBanner()
                g.cycle.day = Math.max(g.cycle.day, n)
                g.cycle.nightLevel = n
                window.__ap.labReady()
                g.startNight(n)
            }, n)
        },
    },
    skills: {
        async setup(page, arg) {
            await skipToDay(page)
            // the wall test builds, it doesn't mine: hand it the walls
            const kit = {
                ...(arg === 'walls' || arg === 'all' || !arg ? { stone_wall: 10, iron_wall: 3 } : {}),
                ...(arg === 'upgrade' || arg === 'all' || !arg ? { ballista_tower: 1 } : {}),
            }
            await page.evaluate((kit) => {
                for (const [k, v] of Object.entries(kit)) window.game.inventory.add(k, v)
                window.__ap.labReady()
            }, kit)
        },
    },
    day: {
        async setup(page) {
            await skipToDay(page)
            await page.evaluate(() => window.__ap.labReady())
        },
    },
    night: {
        async setup(page, arg) {
            const n = Number(arg || 3)
            await skipToDay(page)
            await page.evaluate(({ n, kit }) => {
                const g = window.game
                g.cycle.day = n
                g.cycle.nightLevel = n
                for (const [k, v] of Object.entries(kit)) g.inventory.add(k, v)
                window.__ap.labReady()
            }, { n, kit: kitFor(n) })
        },
    },
    fight: {
        async setup(page, arg) {
            const n = Number(arg || 3)
            await skipToDay(page)
            await page.evaluate((n) => {
                const g = window.game
                g.inventory.add('iron', 3)
                g.inventory.add('planks', 4)
                window.__ap.labReady()
                g.cycle.day = n
                g.cycle.nightLevel = n
                g.startNight(n)
            }, n)
        },
    },
}
