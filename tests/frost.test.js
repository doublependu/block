import { describe, it, expect } from 'vitest'
import { freeze, canFreeze, tickFrost, frostDamage, touchesIce, freezesId } from '../src/game/frost.js'
import { blastCells } from '../src/game/siege.js'
import { towerTarget } from '../src/game/towers.js'
import { defenceParts, planWave } from '../src/game/waves.js'
import { FROST, FIREBALL, UNITS, TOWERS, RECIPES, ITEMS, FROST_ITEMS, lobReach, reachAt, blockDefenceValue } from '../src/game/balance.js'
import { BLOCK_BY_NAME, AIR, blockId } from '../src/world/blocks.js'
import { holdsPost, HIGH_POST } from '../src/game/units.js'
import { label } from '../src/ui/hud.js'
import { ITEM_TILE } from '../src/world/atlas.js'

const ICE_BLOCKS = ['snow_brick', 'blue_ice', 'ice', 'ice_spikes']
const attacker = () => ({ side: 'attacker', alive: true, frozenT: 0, frostImmuneT: 0 })

describe('frost: freezing (plan 12 §3.1)', () => {
    it('freezes an attacker for FROST.freeze seconds, then it thaws and is immune for FROST.immune', () => {
        const u = attacker()
        expect(freeze(u)).toBe(true)
        expect(u.frozenT).toBe(FROST.freeze)
        // already frozen: no refreeze, the clock isn't reset
        expect(freeze(u)).toBe(false)
        let t = 0, thawed = null
        while (!thawed && t < 10) {
            thawed = tickFrost(u, 0.1)
            t += 0.1
        }
        expect(thawed).toBe('thawed')
        expect(t).toBeCloseTo(FROST.freeze, 1)
        expect(u.frostImmuneT).toBe(FROST.immune)
        // immune: an ice arrow or ice block can't freeze it again yet
        expect(canFreeze(u)).toBe(false)
        expect(freeze(u)).toBe(false)
        for (let i = 0; i < FROST.immune / 0.1 + 1; i++) tickFrost(u, 0.1)
        expect(canFreeze(u)).toBe(true)
    })

    it('never freezes a defender or the builder', () => {
        expect(freeze({ side: 'defender', alive: true, frozenT: 0, frostImmuneT: 0 })).toBe(false)
    })

    it('can hold an attacker at most 40% of the time', () => {
        expect(FROST.freeze / (FROST.freeze + FROST.immune)).toBeLessThanOrEqual(0.4 + 1e-9)
    })

    it('a frozen attacker takes FROST.vulnerable times the damage from every blow', () => {
        const u = attacker()
        expect(frostDamage(u)).toBe(1)
        freeze(u)
        expect(frostDamage(u)).toBe(FROST.vulnerable)
        expect(FROST.vulnerable).toBe(1.5)
    })
})

describe('frost: touching ice (plan 12 §4.2)', () => {
    const ICE = blockId('ice'), SPIKES = blockId('ice_spikes'), STONE = blockId('stone')
    /** a world of air with blocks at given cells */
    const world = (cells) => (x, y, z) => cells[`${x},${y},${z}`] ?? AIR
    const p = [5.5, 10, 5.5]

    it('every ice block freezes, and nothing else does', () => {
        for (const name of ICE_BLOCKS) expect(freezesId(blockId(name)), name).toBe(true)
        for (const name of ['stone', 'cobble', 'stone_wall', 'spikes', 'frost_tower', 'ashlar']) expect(freezesId(blockId(name)), name).toBe(false)
    })

    it('standing on ice, standing in ice spikes', () => {
        expect(touchesIce(world({ '5,9,5': ICE }), p, 0.6, 1.75)).toBe(true)
        expect(touchesIce(world({ '5,10,5': SPIKES }), p, 0.6, 1.75)).toBe(true)
        expect(touchesIce(world({ '5,9,5': STONE }), p, 0.6, 1.75)).toBe(false)
    })

    it('pressing against ice at foot or head height, on any side; not a step away', () => {
        // the body is 0.6 wide: its faces are 0.3 from the middle, the next cell 0.2 past the face
        const against = [5.5, 10, 5.5]
        for (const [x, z] of [[6, 5], [4, 5], [5, 6], [5, 4]]) {
            // 0.2 is out of reach, so move the body up to the face first
            const q = [against[0] + (x - 5) * 0.15, 10, against[2] + (z - 5) * 0.15]
            expect(touchesIce(world({ [`${x},10,${z}`]: ICE }), q, 0.6, 1.75), `${x},${z} feet`).toBe(true)
            expect(touchesIce(world({ [`${x},11,${z}`]: ICE }), q, 0.6, 1.75), `${x},${z} head`).toBe(true)
        }
        // in the middle of its cell: 0.2 from the next one, out of reach
        expect(touchesIce(world({ '6,10,5': ICE }), [5.5, 10, 5.5], 0.6, 1.75)).toBe(false)
        // over its head: not touching
        expect(touchesIce(world({ '5,12,5': ICE }), [5.5, 10, 5.5], 0.6, 1.75)).toBe(false)
    })
})

describe('the fireball (plan 12 §2.2)', () => {
    const blocks = {}
    const at = (x, y, z) => blocks[`${x},${y},${z}`]
    // a flat world: stone below y = 10, a wall and the plaza and some ice
    const getBlock = (x, y, z) => at(x, y, z) ?? (y < 10 ? (y === 9 && x === 0 && z === 0 ? blockId('plaza') : y < 2 ? blockId('bedrock') : blockId('stone')) : AIR)
    blocks['2,10,0'] = blockId('stone_wall')
    blocks['0,10,2'] = blockId('ice')
    blocks['1,9,1'] = blockId('water')
    blocks['2,11,0'] = blockId('town_core')

    it('blows a crater of every breakable block within FIREBALL.radius, nearest first', () => {
        const pos = [1.0, 10.2, 0.5]
        const cells = blastCells(getBlock, pos)
        const keys = cells.map(([, x, y, z]) => `${x},${y},${z}`)
        expect(keys).toContain('2,10,0') // the wall
        expect(keys).toContain('1,9,0') // natural ground: a crater
        expect(keys).not.toContain('0,9,0') // the plaza is unbreakable
        expect(keys).not.toContain('2,11,0') // so is the Town Center
        expect(keys).not.toContain('1,9,1') // water isn't blown out
        for (let i = 1; i < cells.length; i++) expect(cells[i][0]).toBeGreaterThanOrEqual(cells[i - 1][0])
        for (const [d, x, y, z] of cells) {
            const id = getBlock(x, y, z)
            if (!BLOCK_BY_NAME.ice || id !== blockId('ice')) expect(d, `${x},${y},${z}`).toBeLessThanOrEqual(FIREBALL.radius)
        }
        // about 33 cells of a sphere of 2 at most (here half of it is air)
        expect(cells.length).toBeLessThanOrEqual(40)
    })

    it('melts ice further out than it blows stone', () => {
        const pos = [0.5, 10.5, 0.5]
        const keys = blastCells(getBlock, pos).map(([, x, y, z]) => `${x},${y},${z}`)
        // the ice block is 2.0 away: inside iceRadius, outside radius; stone 2.2 away isn't blown
        expect(keys).toContain('0,10,2')
        expect(keys).not.toContain('0,9,-2')
    })

    it('a fire mage can\'t lob uphill past its range: a tower up high is out of reach', () => {
        const R = UNITS.pyro.range
        expect(lobReach(R, 0)).toBe(R)
        expect(lobReach(R, -R)).toBe(0)
        expect(lobReach(R, -30)).toBe(0)
        expect(lobReach(R, -4)).toBeLessThan(R)
        // where a tower's own reach is floored, a lob's isn't
        expect(reachAt(R, -30)).toBeGreaterThan(0)
        // a ground arrow tower out-ranges a fire mage, and a tower up high far more
        expect(TOWERS.arrow.range).toBeGreaterThan(R)
    })
})

describe('the frost tower (plan 12 §3.2)', () => {
    const from = [0, 10, 0]
    const unit = (x, frozen = 0, immune = 0) => ({ alive: true, active: true, side: 'attacker', pos: [x, 9, 0], frozenT: frozen, frostImmuneT: immune })
    const posOf = (u) => u.pos
    it('goes for the nearest attacker it can still freeze, before a nearer frozen or immune one', () => {
        const near = unit(3, 1.5), immune = unit(5, 0, 2), free = unit(9)
        const { best } = towerTarget(from, 8, 16, [near, immune, free], posOf, () => true, (u) => u.frozenT <= 0 && u.frostImmuneT <= 0)
        expect(best).toBe(free)
    })
    it('takes the nearest when none can be frozen, and plain towers keep taking the nearest', () => {
        const near = unit(3, 1.5), far = unit(9, 1)
        expect(towerTarget(from, 8, 16, [far, near], posOf, () => true, (u) => u.frozenT <= 0).best).toBe(near)
        expect(towerTarget(from, 8, 16, [unit(9), near], posOf, () => true).best).toBe(near)
    })
})

describe('frost in the night (plan 12 §5.1)', () => {
    it('ice and frost towers are their own part of the defence', () => {
        const p = defenceParts(['ice', 'ice', 'snow_brick', 'frost_tower', 'stone_wall', 'arrow_tower'], [])
        expect(p.frost).toBeCloseTo(2 * blockDefenceValue('ice') + blockDefenceValue('snow_brick') + TOWERS.frost.value)
        expect(p.walls).toBeCloseTo(blockDefenceValue('stone_wall'))
        expect(p.arrow).toBe(TOWERS.arrow.value)
    })
    it('draws fire mages once they come (night 7), grunts before', () => {
        const parts = defenceParts(Array(800).fill('ice'), [])
        const late = planWave(9, parts, () => 0.5)
        expect(late.answer.pyro).toBeGreaterThan(0)
        expect(late.answers).toBe('frost')
        const early = planWave(4, parts, () => 0.5)
        expect(early.answer.pyro || 0).toBe(0)
        expect(early.answer.grunt).toBeGreaterThan(0)
    })
    it('the fire mage is not in the opening raid', () => {
        expect(UNITS.pyro.unlockNight).toBe(7)
    })
})

describe('the frost items (plan 12 §4)', () => {
    it('every one is craftable, named, has an icon, and sits in the Frost row', () => {
        for (const name of FROST_ITEMS) {
            expect(ITEMS[name], name).toBeTruthy()
            expect(RECIPES.find((r) => r.out === name), name).toBeTruthy()
            expect(label(name), name).not.toBe(name)
            if (ITEMS[name].kind === 'block') expect(ITEM_TILE[name], name).toBeTruthy()
        }
    })
    it('snow brick and blue ice hold like a stone wall per cobble, and draw twice its night', () => {
        const perCobble = (name) => {
            const r = RECIPES.find((x) => x.out === name)
            return r.count / r.cost.cobble
        }
        for (const name of ['snow_brick', 'blue_ice']) {
            const hard = BLOCK_BY_NAME[name].hardness * perCobble(name)
            expect(hard).toBeCloseTo(BLOCK_BY_NAME.stone_wall.hardness * perCobble('stone_wall'))
            expect(blockDefenceValue(name) * perCobble(name)).toBeCloseTo(2 * blockDefenceValue('stone_wall') * perCobble('stone_wall'), 1)
        }
    })
})

describe('archers hold high posts (plan 12 §6.5)', () => {
    it('a ranged defender 3 or more above the natural ground holds its post; a low one and a swordsman wander', () => {
        expect(holdsPost(UNITS.archer, [0, 20, 0], 7)).toBe(true)
        expect(holdsPost(UNITS.archer, [0, 7 + HIGH_POST, 0], 7)).toBe(true)
        expect(holdsPost(UNITS.archer, [0, 8, 0], 7)).toBe(false)
        expect(holdsPost(UNITS.gunner, [0, 20, 0], 7)).toBe(true)
        expect(holdsPost(UNITS.swordsman, [0, 20, 0], 7)).toBe(false)
    })
})
