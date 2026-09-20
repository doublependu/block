import { describe, it, expect } from 'vitest'
import { Inventory, payment } from '../src/game/inventory.js'
import {
    RECIPES, ITEMS, FAMILIES, TOWERS, WEAPONS, PROJECTILES, WAVE_ADAPTIVE, HP_PER_HARDNESS,
    blockDefenceValue, armourFactor,
} from '../src/game/balance.js'
import { towerPlacement, canPatch, pressAction, upgradePlacement, TOWER_COLUMN } from '../src/game/placing.js'
import { AIR, blockId, BLOCK_BY_NAME, BLOCK_DUST } from '../src/world/blocks.js'
import { ITEM_TILE, TILE_NAMES } from '../src/world/atlas.js'
import { soundMaterial } from '../src/audio/audio.js'
import { label } from '../src/ui/hud.js'

const recipe = (out) => RECIPES.find((r) => r.out === out)

describe('crafting', () => {
    it('logs stand in for missing planks, and the rest of a cut log comes back as planks', () => {
        const count = (o) => (k) => o[k] || 0
        // 6 planks needed, 2 in stock: one log covers the other 4
        expect(payment({ planks: 6, cobble: 4 }, count({ planks: 2, log: 3, cobble: 4 }))).toEqual({ take: { planks: 2, log: 1, cobble: 4 }, give: {} })
        // none in stock: 2 logs make 8, 2 come back
        expect(payment({ planks: 6 }, count({ log: 2 }))).toEqual({ take: { log: 2 }, give: { planks: 2 } })
        // not enough logs either
        expect(payment({ planks: 6 }, count({ log: 1 }))).toBe(null)
        // a recipe that needs a log as well (the bow): the log is on top of the ones cut for planks
        expect(payment({ planks: 3, log: 1 }, count({ log: 1 }))).toBe(null)
        expect(payment({ planks: 3, log: 1 }, count({ log: 2 }))).toEqual({ take: { log: 2 }, give: { planks: 1 } })
        // enough planks: logs untouched
        expect(payment({ planks: 4 }, count({ planks: 4, log: 5 }))).toEqual({ take: { planks: 4 }, give: {} })
    })

    it('crafts a tower straight from logs', () => {
        const inv = new Inventory({ log: 2, cobble: 4 }, false)
        expect(inv.canAfford(recipe('arrow_tower').cost)).toBe(true)
        expect(inv.logsFor(recipe('arrow_tower').cost)).toBe(2)
        expect(inv.craft(recipe('arrow_tower'))).toBe(true)
        expect(inv.count('arrow_tower')).toBe(1)
        expect(inv.count('log')).toBe(0)
        expect(inv.count('planks')).toBe(2)
        expect(inv.count('cobble')).toBe(0)
    })

    it('crafts several at once, stopping when the stock runs out', () => {
        const inv = new Inventory({ cobble: 10 }, false)
        expect(inv.craftMany(recipe('stone_wall'), 5)).toBe(3)
        expect(inv.count('stone_wall')).toBe(6)
        expect(inv.count('cobble')).toBe(1)
        expect(inv.craftMany(recipe('stone_wall'), 5)).toBe(0)
    })

    it('keeps dirt, sand and logs off the hotbar unless you put them there', () => {
        const inv = new Inventory({ dirt: 5, cobble: 2 }, false)
        expect(inv.hotbar).not.toContain('dirt')
        expect(inv.hotbar).toContain('cobble')
        inv.add('sand', 3)
        inv.add('log', 2)
        inv.add('stone_wall', 2)
        expect(inv.hotbar).not.toContain('sand')
        expect(inv.hotbar).not.toContain('log')
        expect(inv.hotbar).toContain('stone_wall')
        expect(inv.assign(4, 'dirt')).toBe(true)
        expect(inv.hotbar[4]).toBe('dirt')
    })
})

describe('placing', () => {
    // a flat world: grass at y 7, air above; built blocks can be added
    const world = (extra = {}) => (x, y, z) => extra[`${x},${y},${z}`] ?? (y <= 7 ? blockId('grass') : AIR)

    it('a tower on the ground comes with its column', () => {
        const r = towerPlacement(world(), [3, 8, 3], 'arrow_tower', { cobble: 5 })
        expect(r.cells).toEqual([[3, 8, 3, 'cobble'], [3, 9, 3, 'cobble'], [3, 10, 3, 'arrow_tower']])
        expect(TOWER_COLUMN).toBe(2)
    })

    it('on a wall or a column it is just the tower', () => {
        const w = world({ '3,8,3': blockId('stone_wall'), '3,9,3': blockId('stone_wall') })
        expect(towerPlacement(w, [3, 10, 3], 'cannon_tower', { cobble: 0 }).cells).toEqual([[3, 10, 3, 'cannon_tower']])
    })

    it('says why it can not: cobble, room, someone standing there', () => {
        expect(towerPlacement(world(), [3, 8, 3], 'arrow_tower', { cobble: 1 }).reason).toMatch(/1 more/)
        const low = world({ '3,10,3': blockId('leaves') })
        expect(towerPlacement(low, [3, 8, 3], 'arrow_tower', { cobble: 5 }).reason).toMatch(/No room/)
        const busy = towerPlacement(world(), [3, 8, 3], 'arrow_tower', { cobble: 5, free: (x, y) => y !== 9 })
        expect(busy.reason).toMatch(/No room/)
        const hill = world({ '3,67,3': blockId('grass') })
        expect(towerPlacement(hill, [3, 68, 3], 'arrow_tower', { cobble: 5, maxY: 70 }).reason).toMatch(/Too high/)
    })

    it('patches only a hole made tonight, and only with the same block', () => {
        expect(canPatch(blockId('stone_wall'), 'stone_wall')).toBe(true)
        expect(canPatch(blockId('gate'), 'gate')).toBe(true)
        expect(canPatch(blockId('stone_wall'), 'cobble')).toBe(false)
        expect(canPatch(undefined, 'stone_wall')).toBe(false)
        // natural blocks are never in the night's damage, but never patchable either
        expect(canPatch(blockId('stone'), 'stone')).toBe(false)
    })
})

describe('what the left button does', () => {
    const press = (o) => pressAction({ kind: 'tool', attack: 'melee', canEdit: true, enemyInReach: false, blockTargeted: false, ...o })

    it('always does something, whatever is in front of you', () => {
        for (const kind of ['tool', 'block', 'unit', 'weapon', 'resource', null]) {
            for (const attack of ['melee', 'arrow', 'bullet']) {
                for (const canEdit of [true, false]) {
                    for (const enemyInReach of [true, false]) {
                        for (const blockTargeted of [true, false]) {
                            const a = press({ kind, attack, canEdit, enemyInReach, blockTargeted })
                            expect(['mine', 'attack', 'shoot'], JSON.stringify({ kind, attack, canEdit, enemyInReach, blockTargeted })).toContain(a)
                        }
                    }
                }
            }
        }
    })

    it('swings at the air with a weapon in hand and chops with anything else', () => {
        expect(press({ kind: 'weapon' })).toBe('attack')
        expect(press({ kind: 'tool' })).toBe('mine')
        expect(press({ kind: 'block' })).toBe('mine')
        expect(press({ kind: 'unit' })).toBe('mine')
        expect(press({ kind: null })).toBe('mine')
    })

    it('mines a block that is there, with a sword in hand too', () => {
        expect(press({ kind: 'tool', blockTargeted: true })).toBe('mine')
        // you always dig with the pickaxe, whatever is selected (see control.render)
        expect(press({ kind: 'weapon', blockTargeted: true })).toBe('mine')
    })

    it('hits an enemy in reach before anything else', () => {
        expect(press({ enemyInReach: true, blockTargeted: true })).toBe('attack')
        expect(press({ kind: 'block', enemyInReach: true })).toBe('attack')
    })

    it('swings at night, when there is nothing to dig', () => {
        expect(press({ canEdit: false })).toBe('attack')
        expect(press({ kind: 'block', canEdit: false, blockTargeted: true })).toBe('attack')
    })

    it('shoots with a bow or a musket, and never mines with one', () => {
        expect(press({ attack: 'arrow', blockTargeted: true })).toBe('shoot')
        expect(press({ attack: 'bullet', enemyInReach: true })).toBe('shoot')
        expect(press({ attack: 'arrow', canEdit: false })).toBe('shoot')
    })
})

describe('three levels of every defence', () => {
    const tiersOf = (family) => FAMILIES[family].map((name) => ({ name, def: BLOCK_BY_NAME[name], weapon: WEAPONS[name] }))
    const structures = ['wall', 'gate', 'spikes', 'arrow_tower', 'cannon_tower']

    it('has a block, a tile, a dust colour, a label, a recipe and a sound for every tier', () => {
        for (const family of structures) {
            for (const { name, def } of tiersOf(family)) {
                expect(def, `${name} is a block`).toBeTruthy()
                expect(ITEMS[name]?.kind, `${name} is placeable`).toBe('block')
                expect(ITEM_TILE[name], `${name} has an icon tile`).toBeTruthy()
                expect(TILE_NAMES, `${name}'s tile is painted`).toContain(ITEM_TILE[name])
                expect(BLOCK_DUST[name], `${name} has dust`).toBeTruthy()
                expect(label(name), `${name} has a label`).not.toBe(name)
                expect(RECIPES.some((r) => r.out === name), `${name} is craftable`).toBe(true)
                expect(soundMaterial(name), `${name} sounds like something`).toBeTruthy()
            }
        }
    })

    it('makes every tier tougher and worth more than the one below', () => {
        for (const family of structures) {
            const tiers = tiersOf(family)
            for (let i = 1; i < tiers.length; i++) {
                const lo = tiers[i - 1], hi = tiers[i]
                expect(hi.def.hardness, `${hi.name} is harder than ${lo.name}`).toBeGreaterThan(lo.def.hardness)
                expect(blockDefenceValue(hi.name), `${hi.name} is worth more than ${lo.name}`).toBeGreaterThan(blockDefenceValue(lo.name))
            }
        }
    })

    /**
     * The rule the whole thing rests on: the night answers what you build, so a
     * tier is only worth its resources if it gives more power per point of
     * defence value than the tier below. Otherwise two tier I's would always beat
     * one tier II and upgrading would be a trap.
     */
    it('gives more power per defence point at every tier', () => {
        for (const family of ['arrow_tower', 'cannon_tower']) {
            const rates = FAMILIES[family].map((name) => {
                const t = TOWERS[BLOCK_BY_NAME[name].tower]
                return (t.damage / t.cooldown) / t.value
            })
            for (let i = 1; i < rates.length; i++) {
                expect(rates[i], `${FAMILIES[family][i]} vs ${FAMILIES[family][i - 1]}`).toBeGreaterThan(rates[i - 1])
            }
        }
        // spikes: damage per second per point of value
        const spikeRates = FAMILIES.spikes.map((n) => BLOCK_BY_NAME[n].contactDamage / blockDefenceValue(n))
        for (let i = 1; i < spikeRates.length; i++) expect(spikeRates[i]).toBeGreaterThan(spikeRates[i - 1])
        // walls and gates: night hit points per point of value
        for (const family of ['wall', 'gate']) {
            const rates = FAMILIES[family].map((n) => (BLOCK_BY_NAME[n].hardness * HP_PER_HARDNESS) / blockDefenceValue(n))
            for (let i = 1; i < rates.length; i++) expect(rates[i], `${FAMILIES[family][i]}`).toBeGreaterThan(rates[i - 1])
        }
    })

    it('costs iron at tier II and gold at tier III', () => {
        for (const family of structures) {
            const [, two, three] = FAMILIES[family].map((n) => RECIPES.find((r) => r.out === n).cost)
            expect(two.iron, `${FAMILIES[family][1]} costs iron`).toBeGreaterThan(0)
            expect(three.gold, `${FAMILIES[family][2]} costs gold`).toBeGreaterThan(0)
        }
    })

    it('keeps the tower blocks and the tower table in step', () => {
        for (const family of ['arrow_tower', 'cannon_tower']) {
            for (const name of FAMILIES[family]) {
                const type = BLOCK_BY_NAME[name].tower
                expect(type, `${name} runs a tower`).toBeTruthy()
                expect(TOWERS[type], `${type} is in TOWERS`).toBeTruthy()
                expect(blockDefenceValue(name)).toBe(TOWERS[type].value)
            }
        }
    })

    it('leaves the starting town at the value the waves are tuned for', () => {
        // the default town is all tier I, so WAVE_ADAPTIVE.free still fits it
        expect(blockDefenceValue('iron_wall')).toBeLessThan(blockDefenceValue('steel_wall'))
        expect(WAVE_ADAPTIVE.free).toBe(226)
    })

    it('sends a bolt through brute armour and an arrow only half way', () => {
        expect(armourFactor('brute', 'arrow')).toBe(0.5)
        expect(armourFactor('brute', 'bolt')).toBe(1)
        expect(armourFactor('brute', 'cannonball')).toBe(1)
        expect(TOWERS.ballista.projectile).toBe('bolt')
        expect(WEAPONS.war_bow.attack).toBe('bolt')
        expect(PROJECTILES.bolt).toBeTruthy()
    })
})

describe('upgrading in place', () => {
    const world = (name) => (x, y, z) => (x === 0 && y === 0 && z === 0 ? blockId(name) : AIR)

    it('builds a higher tier of the same family straight onto a lower one', () => {
        const r = upgradePlacement(world('arrow_tower'), [0, 0, 0], 'ballista_tower', true)
        expect(r.ok).toBe(true)
        expect(r.ok && r.replaces).toBe('arrow_tower')
    })

    it('refuses the same tier, a lower tier, another family and bare ground', () => {
        expect(upgradePlacement(world('iron_wall'), [0, 0, 0], 'iron_wall', true).ok).toBe(false)
        expect(upgradePlacement(world('steel_wall'), [0, 0, 0], 'iron_wall', true).ok).toBe(false)
        expect(upgradePlacement(world('stone_wall'), [0, 0, 0], 'ballista_tower', true).ok).toBe(false)
        expect(upgradePlacement(world('stone'), [0, 0, 0], 'iron_wall', true).ok).toBe(false)
        expect(upgradePlacement(() => AIR, [0, 0, 0], 'iron_wall', true).ok).toBe(false)
    })

    it('refuses at night, and only mentions it when the family matched', () => {
        const night = upgradePlacement(world('stone_wall'), [0, 0, 0], 'iron_wall', false)
        expect(night.ok).toBe(false)
        expect(night.sameFamily).toBe(true)
        // an ordinary build against a wall says nothing about upgrades
        expect(upgradePlacement(world('stone_wall'), [0, 0, 0], 'gate', true).sameFamily).toBe(false)
    })
})

describe('the hotbar with three of everything', () => {
    it('gives a higher tier the slot its family already holds', () => {
        const inv = new Inventory({ stone_wall: 4, arrow_tower: 1 }, false)
        const slot = inv.hotbar.indexOf('arrow_tower')
        expect(slot).toBeGreaterThan(0)
        inv.add('ballista_tower', 1)
        expect(inv.hotbar[slot]).toBe('ballista_tower')
        expect(inv.hotbar.filter((n) => n === 'arrow_tower')).toHaveLength(0)
        // and the wall it also holds is untouched
        expect(inv.hotbar).toContain('stone_wall')
    })

    it('still takes a free slot for a family it holds nothing of', () => {
        const inv = new Inventory({ stone_wall: 4 }, false)
        const before = inv.hotbar.filter(Boolean).length
        inv.add('cannon_tower', 1)
        expect(inv.hotbar.filter(Boolean).length).toBe(before + 1)
    })
})
