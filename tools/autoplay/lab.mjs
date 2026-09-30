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
 *  --lab=siege:<town>:<n>  load a saved town (tools/autoplay/towns/<town>.world.json, "default" for
 *                        worlds/default.world.json, or a path to a world or save) through Continue
 *                        and start night n at once. The builder fights on autopilot and the run
 *                        stops when the night is over: it measures the town, not the player
 *                        (tools/autoplay/map.mjs runs many)
 */

import { readFileSync } from 'node:fs'
import { buildCastle, FLOOR } from './castle/blueprint.js'
import { createGenerator } from '../../src/world/gen/index.js'
import { join } from 'node:path'

export const TOWNS = new URL('./towns/', import.meta.url).pathname

/** a saved town's world file */
export function townFile(name) {
    // (or a path to any world or save file)
    if (name.includes('/')) return name
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

/**
 * Put a save (or a world) where Continue finds it (the browser's autosave), and
 * reload the menu: returns the Continue button to click.
 */
export async function putAutosave(page, text, name = 'Saved game') {
    await page.evaluate(({ text, name }) => new Promise((resolve, reject) => {
        const req = indexedDB.open('block', 1)
        req.onupgradeneeded = () => req.result.createObjectStore('kv')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
            const tx = req.result.transaction('kv', 'readwrite')
            tx.objectStore('kv').put({ sourceId: 'lab', name, savedAt: Date.now(), text }, 'autosave')
            tx.oncomplete = () => resolve(true)
            tx.onerror = () => reject(tx.error)
        }
    }), { text, name })
    await page.reload()
    await page.waitForSelector('[data-go="continue"]', { state: 'visible', timeout: 30000 })
    return '[data-go="continue"]'
}

/** what --lab=castle:kit hands the castle bot: its first loads, to watch it build without gathering */
const CASTLE_KIT = { stone_wall: 280, cobble: 60, gate: 20, brick: 420, window: 60, ashlar: 400, arrow_tower: 6, planks: 40 }

export const LAB = {
    castle: {
        /**
         * The castle bot from day 1 (use with --seed). `kit` hands it materials for
         * its first loads. `upper` builds the castle's lower courses at once (a debug
         * write) and hands it the materials for the rest, except sand and wood, which
         * it has to go and get: roofs, spires, high towers, the sand trip, the logs.
         * `done` builds all of it: the end of a game (the flyover, the nights to
         * show it holds, the export).
         */
        async setup(page, arg) {
            await skipToDay(page)
            let cells = []
            let kit = arg === 'kit' ? CASTLE_KIT : {}
            if (arg === 'upper' || arg === 'done') {
                const seed = await page.evaluate(() => window.game.def.seed)
                const gen = createGenerator(1, seed, 192)
                const castle = buildCastle({ groundAt: (x, z) => gen.surfaceY(x, z) })
                if (arg === 'upper') {
                    cells = castle.cells.filter(([, y]) => y < FLOOR + 7)
                    kit = { ashlar: 1200, slate: 400, brick: 200, copper_roof: 40, iron_wall: 8, cobble: 200, iron: 30, gold: 12, stone_wall: 20 }
                } else {
                    // `done`: all of it, towers and all (the end of the game: flyover, show nights, export)
                    cells = [...castle.cells, ...castle.towers.map((t) => t.ground
                        ? [[t.x, t.y, t.z, 'cobble'], [t.x, t.y + 1, t.z, 'cobble'], [t.x, t.y + 2, t.z, 'ballista_tower']]
                        : [[t.x, t.y, t.z, 'ballista_tower']]).flat()]
                }
            }
            await page.evaluate(({ kit, cells }) => {
                const g = window.game
                for (const [x, y, z, b] of cells) g.sync.submit({ t: 'block', x, y, z, b })
                for (const [k, v] of Object.entries(kit)) g.inventory.add(k, v)
                window.__ap.labReady()
            }, { kit, cells })
        },
    },
    siege: {
        /** put the town where Continue finds it (the autosave), then Continue */
        async beforePlay(page, arg) {
            const [town] = arg.split(':')
            return putAutosave(page, readFileSync(townFile(town || 'default'), 'utf8'), 'Lab town')
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
