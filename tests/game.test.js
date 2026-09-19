import { describe, it, expect } from 'vitest'
import { waveBudget, composeWave, compassName, pickFronts, spawnPoint } from '../src/game/waves.js'
import { UNITS, RECIPES, SPAWN_RADIUS, FRONT_ARC, TWO_FRONTS_FROM_NIGHT, ITEMS, WEAPONS, STARTING_INVENTORY, OPENING_RAID, weaponDps } from '../src/game/balance.js'
import { shouldPlayOpening, openingFront, lockReleased, finaleStep } from '../src/game/opening.js'
import { WaveDirector } from '../src/game/waves.js'
import { buildDefaultWorld } from '../src/world/defaultWorld.js'
import { createGenerator } from '../src/world/gen/index.js'
import { Inventory } from '../src/game/inventory.js'
import { DayCycle, canChooseRole, dawnPlan } from '../src/game/cycle.js'
import { restoreOrder } from '../src/game/rebuild.js'
import { B, blockId } from '../src/world/blocks.js'
import { DAWN } from '../src/game/balance.js'
import { normaliseClipName, holdForItem } from '../src/characters/contract.js'

const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

describe('waves', () => {
    it('grows with the night level and with defences', () => {
        expect(waveBudget(2)).toBeGreaterThan(waveBudget(1))
        expect(waveBudget(10)).toBeGreaterThan(waveBudget(9))
        expect(waveBudget(3, 200)).toBeGreaterThan(waveBudget(3, 0))
    })

    it('spends the budget only on unlocked attackers', () => {
        for (const level of [1, 3, 6, 12]) {
            const budget = waveBudget(level)
            const list = composeWave(level, budget, seeded(level))
            const cost = list.reduce((n, t) => n + UNITS[t].cost, 0)
            expect(cost).toBeLessThanOrEqual(budget)
            expect(cost).toBeGreaterThan(budget - 1)
            for (const t of list) {
                expect(UNITS[t].side).toBe('attacker')
                expect(UNITS[t].unlockNight).toBeLessThanOrEqual(level)
            }
        }
    })
})

const angleDiff = (a, b) => {
    const d = Math.abs(a - b) % (Math.PI * 2)
    return d > Math.PI ? Math.PI * 2 - d : d
}

describe('attack fronts', () => {
    it('names compass directions (north is +z, east is +x)', () => {
        expect(compassName(0)).toBe('north')
        expect(compassName(Math.PI / 2)).toBe('east')
        expect(compassName(Math.PI)).toBe('south')
        expect(compassName(-Math.PI / 2)).toBe('west')
        expect(compassName(Math.PI * 1.75)).toBe('north-west')
    })

    it('uses one front early, two later, and moves away from the previous front', () => {
        const rnd = seeded(7)
        for (let i = 0; i < 50; i++) {
            const prev = rnd() * Math.PI * 2
            const [a] = pickFronts(rnd, 1, prev)
            expect(pickFronts(rnd, 1, prev).length).toBe(1)
            expect(angleDiff(a, prev)).toBeGreaterThanOrEqual(Math.PI / 3 - 1e-9)
            const two = pickFronts(rnd, TWO_FRONTS_FROM_NIGHT)
            expect(two.length).toBe(2)
            expect(angleDiff(two[0], two[1])).toBeGreaterThan(Math.PI * 0.5)
        }
    })

    it('spawns on land, on the ring, inside the arc (default world)', () => {
        const gen = createGenerator(1, 'default-valley', 192)
        const rnd = seeded(3)
        const center = [0, 8, 0]
        for (let i = 0; i < 16; i++) {
            const angle = (i / 16) * Math.PI * 2
            for (let t = 0; t < 4; t++) {
                const p = spawnPoint({ standY: gen.surfaceY, isWater: (x, z) => gen.surfaceY(x, z) <= 1, half: 96, center, angle, rnd })
                expect(p).not.toBe(null)
                const r = Math.hypot(p[0] - center[0], p[2] - center[2])
                expect(r).toBeLessThanOrEqual(SPAWN_RADIUS[1] + 1)
                expect(r).toBeGreaterThanOrEqual(12)
                expect(Math.abs(p[0])).toBeLessThan(96)
                expect(Math.abs(p[2])).toBeLessThan(96)
                expect(angleDiff(Math.atan2(p[0], p[2]), angle)).toBeLessThanOrEqual(FRONT_ARC + 0.1)
                expect(gen.surfaceY(Math.floor(p[0]), Math.floor(p[2]))).toBeGreaterThan(1)
            }
        }
    })
})

describe('opening raid', () => {
    const fresh = { mode: 'survival', day: 1, nightLevel: 1 }

    it('plays only for fresh survival games', () => {
        expect(shouldPlayOpening(fresh)).toBe(true)
        expect(shouldPlayOpening(fresh, { resumed: true })).toBe(false)
        expect(shouldPlayOpening({ ...fresh, mode: 'creative' })).toBe(false)
        expect(shouldPlayOpening({ ...fresh, day: 4 })).toBe(false)
        expect(shouldPlayOpening({ ...fresh, nightLevel: 2 })).toBe(false)
        expect(shouldPlayOpening(fresh, { search: '?autoplay&intro=0' })).toBe(false)
        expect(shouldPlayOpening(fresh, { search: '?autoplay' })).toBe(true)
    })

    it('comes from a gate direction', () => {
        const rnd = seeded(11)
        for (let i = 0; i < 20; i++) expect([0, 0.5, 1, 1.5]).toContain(openingFront(rnd) / Math.PI)
    })

    it('has no time limit and is not a counted day or night', () => {
        const c = new DayCycle({ mode: 'survival', day: 1, nightLevel: 1 })
        c.startOpening()
        expect(c.phase).toBe('night')
        expect(c.activeLevel).toBe(0)
        c.update(100000, { damageRemaining: 0 })
        expect(c.phase).toBe('night')
        c.endNight('lost')
        c.update(5, { damageRemaining: 0 })
        expect(c.phase).toBe('day')
        expect(c.wasOpening).toBe(true)
        expect(c.day).toBe(1)
        expect(c.nightLevel).toBe(1)
        // the next night is a normal night 1
        c.startNight()
        c.update(11, { damageRemaining: 0 })
        expect(c.activeLevel).toBe(1)
        c.endNight('survived')
        c.update(5, { damageRemaining: 0 })
        expect(c.wasOpening).toBe(false)
        expect(c.day).toBe(2)
        expect(c.nightLevel).toBe(2)
    })
})

describe('inventory', () => {
    it('crafts when affordable and fills the hotbar', () => {
        const inv = new Inventory({ log: 2 }, false)
        const planks = RECIPES.find((r) => r.out === 'planks')
        expect(inv.craft(planks)).toBe(true)
        expect(inv.count('planks')).toBe(4)
        expect(inv.count('log')).toBe(1)
        expect(inv.hotbar).toContain('planks')
        const tower = RECIPES.find((r) => r.out === 'arrow_tower')
        expect(inv.craft(tower)).toBe(false)
    })

    it('always has the pickaxe in slot 1, never counted or saved', () => {
        for (const inv of [new Inventory({}, false), new Inventory({ cobble: 3, wood_sword: 1 }, false), new Inventory({}, true)]) {
            expect(inv.hotbar[0]).toBe('pickaxe')
            expect(inv.selectedItem).toBe('pickaxe')
            expect(inv.count('pickaxe')).toBe(Infinity)
            expect(inv.toJSON()).not.toHaveProperty('pickaxe')
        }
        const inv = new Inventory({ pickaxe: 2, cobble: 1 }, false)
        inv.add('pickaxe', 1)
        expect(inv.remove('pickaxe', 5)).toBe(true)
        expect(inv.toJSON()).toEqual({ cobble: 1 })
        expect(inv.hotbar.filter((n) => n === 'pickaxe').length).toBe(1)
    })

    it('can move the pickaxe but never push it off the hotbar', () => {
        const inv = new Inventory({ cobble: 3, planks: 2 }, false)
        // onto an item already on the hotbar: they swap
        expect(inv.assign(0, 'planks')).toBe(true)
        expect(inv.hotbar).toContain('pickaxe')
        // an item from the inventory over the pickaxe: the pickaxe moves to a free slot
        inv.add('log', 1)
        const at = inv.hotbar.indexOf('pickaxe')
        inv.hotbar[inv.hotbar.indexOf('log')] = null
        expect(inv.assign(at, 'log')).toBe(true)
        expect(inv.hotbar[at]).toBe('log')
        expect(inv.hotbar).toContain('pickaxe')
        // a full hotbar: refused
        const full = new Inventory({}, false)
        for (let i = 1; i < 9; i++) full.hotbar[i] = 'x' + i
        expect(full.assign(0, 'cobble')).toBe(false)
        expect(full.hotbar[0]).toBe('pickaxe')
    })

    it('swaps between the pickaxe and the last item with Q', () => {
        const inv = new Inventory({ cobble: 3, wood_sword: 1 }, false)
        const sword = inv.hotbar.indexOf('wood_sword')
        inv.select(sword)
        inv.swapTool()
        expect(inv.selectedItem).toBe('pickaxe')
        inv.swapTool()
        expect(inv.selectedItem).toBe('wood_sword')
        // from the pickaxe with nothing before it: stays on the pickaxe
        const fresh = new Inventory({ cobble: 3 }, false)
        fresh.swapTool()
        expect(fresh.selectedItem).toBe('pickaxe')
        // selectTool goes to the pickaxe from anywhere
        inv.selectTool()
        expect(inv.selectedItem).toBe('pickaxe')
    })

    it('doesn\'t count the pickaxe as a weapon', () => {
        const inv = new Inventory({ wood_sword: 1 }, false)
        expect(inv.selectedWeapon).toBe(null)
        expect(inv.bestWeapon).toBe('wood_sword')
    })

    it('is unlimited in creative mode', () => {
        const inv = new Inventory({}, true)
        expect(inv.count('cannon_tower')).toBe(Infinity)
        expect(inv.remove('cannon_tower', 99)).toBe(true)
        expect(inv.toJSON()).toEqual({})
    })
})

describe('day cycle', () => {
    it('runs day -> dusk -> night -> dawn -> day', () => {
        const c = new DayCycle({ mode: 'survival', day: 1, nightLevel: 1 })
        const phases = []
        c.on('phase', (p) => phases.push(p))
        c.update(c.dayLength + 1, { damageRemaining: 0 })
        c.update(11, { damageRemaining: 0 })
        expect(c.phase).toBe('night')
        c.endNight('survived')
        c.update(5, { damageRemaining: 3 })
        expect(c.phase).toBe('dawn') // still rebuilding
        c.update(1, { damageRemaining: 0 })
        expect(phases).toEqual(['dusk', 'night', 'dawn', 'day'])
        expect(c.day).toBe(2)
        expect(c.nightLevel).toBe(2)
    })

    it('does not grow the next night after a loss, and creative days never end', () => {
        const c = new DayCycle({ mode: 'survival', day: 1, nightLevel: 4 })
        c.startNight()
        c.update(11, { damageRemaining: 0 })
        c.endNight('lost')
        expect(c.nightLevel).toBe(4)
        const k = new DayCycle({ mode: 'creative', day: 1, nightLevel: 1 })
        k.update(100000, { damageRemaining: 0 })
        expect(k.phase).toBe('day')
        k.startNight(15)
        expect(k.activeLevel).toBe(15)
    })
})

describe('dawn rebuild', () => {
    it('is paced by time: longer for more damage, within limits', () => {
        expect(dawnPlan(0)).toEqual({ lead: 0, rebuild: 0, total: DAWN.empty })
        const few = dawnPlan(11), some = dawnPlan(28), many = dawnPlan(60), lots = dawnPlan(500)
        expect(few.rebuild).toBe(DAWN.minRebuild)
        expect(some.rebuild).toBeGreaterThan(few.rebuild)
        expect(many.rebuild).toBeGreaterThan(some.rebuild)
        expect(lots.rebuild).toBe(DAWN.maxRebuild)
        expect(some.total).toBeCloseTo(DAWN.lead + some.rebuild + DAWN.hold)
        // after the opening raid it takes its own, longer time
        expect(dawnPlan(183, true).rebuild).toBe(DAWN.openingRebuild)
        expect(DAWN.openingRebuild).toBeGreaterThan(DAWN.maxRebuild)
    })

    it('keeps it dawn until the rebuild is done, and Skip goes to the last look', () => {
        const c = new DayCycle({ mode: 'survival', day: 1, nightLevel: 1 })
        c.startNight()
        c.update(11, { damageRemaining: 0 })
        c.endNight('survived')
        const plan = c.planDawn(40)
        c.update(plan.total - 1, { damageRemaining: 0 })
        expect(c.phase).toBe('dawn')
        c.update(1.01, { damageRemaining: 5 })
        expect(c.phase).toBe('dawn') // blocks still to put back
        c.skipDawn()
        c.update(DAWN.hold + 0.01, { damageRemaining: 0 })
        expect(c.phase).toBe('day')
        // the sky moves through dawn over the dawn's own length
        const d = new DayCycle({ mode: 'survival', day: 1, nightLevel: 1 })
        d.startNight()
        d.update(11, { damageRemaining: 0 })
        d.endNight('lost')
        const p2 = d.planDawn(40)
        d.update(p2.total / 2, { damageRemaining: 1 })
        expect(d.skyTime).toBeCloseTo(0.95 + 0.07 / 2)
    })

    it('puts the Town Center back first, then the rest from the bottom up, sweeping round', () => {
        const tc = [0, 8, 0]
        const wall = blockId('stone_wall'), gate = blockId('gate')
        expect(wall).toBeGreaterThan(0)
        const blocks = [
            [13, 9, 0, wall], // east, second layer
            [0, 8, 13, wall], // north, first layer
            [-13, 8, 0, wall], // west, first layer
            [13, 8, 0, wall], // east, first layer
            [0, 7, 14, B.dirt], // a crater under the north wall
            [0, 9, 0, B.town_core],
            [0, 8, 0, B.town_core],
            [0, 8, -13, gate], // south, first layer
        ]
        const order = restoreOrder(blocks, tc)
        expect(order.length).toBe(blocks.length)
        expect(order.slice(0, 2)).toEqual([[0, 8, 0, B.town_core], [0, 9, 0, B.town_core]])
        const rest = order.slice(2)
        for (let i = 1; i < rest.length; i++) expect(rest[i][1]).toBeGreaterThanOrEqual(rest[i - 1][1])
        // the first layer goes clockwise from the north: north, east, south, west
        expect(rest.filter((b) => b[1] === 8).map((b) => [b[0], b[2]])).toEqual([[0, 13], [13, 0], [0, -13], [-13, 0]])
        // nothing before the block under it
        const at = (x, y, z) => order.findIndex((b) => b[0] === x && b[1] === y && b[2] === z)
        expect(at(13, 8, 0)).toBeLessThan(at(13, 9, 0))
    })
})

describe('character contract', () => {
    it('normalises clip names from other tools', () => {
        expect(normaliseClipName('Armature|Walk')).toBe('walk')
        expect(normaliseClipName('mine block')).toBe('mine')
        expect(normaliseClipName('Hold Bow')).toBe('hold_bow')
        expect(normaliseClipName('Death')).toBe('die')
    })

    it('maps items to hold poses', () => {
        expect(holdForItem('bow')).toBe('hold_bow')
        expect(holdForItem('gun')).toBe('hold_gun')
        expect(holdForItem('block')).toBe('hold_item')
        expect(holdForItem(null)).toBe(null)
    })
})

describe('roles', () => {
    it('are only chosen at dusk and at night', () => {
        expect(canChooseRole('dusk')).toBe(true)
        expect(canChooseRole('night')).toBe(true)
        expect(canChooseRole('dawn')).toBe(false)
        expect(canChooseRole('day')).toBe(false)
    })
})

describe('weapons', () => {
    it('can all be crafted and carried', () => {
        for (const name of Object.keys(WEAPONS)) {
            if (name === 'none') continue
            expect(ITEMS[name].kind).toBe('weapon')
            expect(RECIPES.some((r) => r.out === name)).toBe(true)
            expect(WEAPONS[name].value).toBeGreaterThan(0)
        }
        expect(weaponDps('iron_sword')).toBeGreaterThan(weaponDps('stone_sword'))
        expect(weaponDps('stone_sword')).toBeGreaterThan(weaponDps('wood_sword'))
        expect(weaponDps('wood_sword')).toBeGreaterThan(weaponDps('none'))
    })

    it('picks the best weapon held', () => {
        const inv = new Inventory({ planks: 3, wood_sword: 1, bow: 1 }, false)
        expect(inv.bestWeapon).toBe('wood_sword')
        inv.add('iron_sword', 1)
        expect(inv.bestWeapon).toBe('iron_sword')
        inv.select(inv.hotbar.indexOf('planks'))
        expect(inv.selectedWeapon).toBe(null)
        inv.selectBestWeapon()
        expect(inv.selectedItem).toBe('iron_sword')
        expect(new Inventory({ planks: 1 }, false).bestWeapon).toBe('none')
    })

    it('are in the starting inventories', () => {
        expect(STARTING_INVENTORY.wood_sword).toBe(1)
        expect(buildDefaultWorld().player.inventory.wood_sword).toBe(1)
    })
})

describe('opening raid script', () => {
    it('comes from all four sides', () => {
        const waves = new WaveDirector({ world: /** @type {any} */ ({}), units: /** @type {any} */ ({ aliveAttackers: () => 0 }), tier: { maxAttackers: 30 } })
        waves.startOpening(Math.PI / 2)
        expect(waves.fronts.length).toBe(4)
        const angles = waves.fronts.map((f) => f.angle).sort((a, b) => a - b)
        for (let i = 1; i < 4; i++) expect(angles[i] - angles[i - 1]).toBeCloseTo(Math.PI / 2)
        expect(waves.subwaves.length).toBe(OPENING_RAID.groups.length)
        expect(waves.cleared).toBe(false)
    })

    it('opens the town center once towers are gone and walls are mostly down', () => {
        expect(lockReleased({ towers: 1, walls: 0, wallStart: 100 })).toBe(false)
        expect(lockReleased({ towers: 0, walls: 80, wallStart: 100 })).toBe(false)
        const at = Math.floor(OPENING_RAID.unlockWallsLeft * 100)
        expect(lockReleased({ towers: 0, walls: at + 5, wallStart: 100 })).toBe(false)
        expect(lockReleased({ towers: 0, walls: at, wallStart: 100 })).toBe(true)
    })

    it('finishes the job in order: towers, walls, town center', () => {
        expect(finaleStep({ towers: 2, walls: 90, wallStart: 100, townHp: 100 })).toBe('tower')
        expect(finaleStep({ towers: 0, walls: 90, wallStart: 100, townHp: 100 })).toBe('walls')
        expect(finaleStep({ towers: 0, walls: 20, wallStart: 100, townHp: 100 })).toBe('town')
        expect(finaleStep({ towers: 0, walls: 20, wallStart: 100, townHp: 0 })).toBe(null)
    })
})
