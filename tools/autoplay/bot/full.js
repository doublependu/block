/*
 *  Playing to win and spending everything: the default strategy since
 *  iteration 7 (--strategy=bot). Days and nights as PlayStrategy, plus what the
 *  rules since iteration 7 ask for:
 *
 *    - from night 3 (brutes come, and arrows barely hurt them): cannon towers
 *      with the iron, keeping tower spots for them (arrow towers stop at
 *      ARROW_CAP), and the musket
 *    - troops with the gold: gunners when there's iron, archers, swordsmen
 *    - a stock of stone walls, and at night it patches breaches in the wall
 *      when no attacker is close to the hole
 *
 *  PlayStrategy on its own (--strategy=towers) is iteration 6's plan: arrow
 *  towers, archers, the bow and the musket.
 */

import { PlayStrategy } from './play.js'
import { RECIPES, FAMILIES, weaponDps } from '../../../src/game/balance.js'
import { BLOCK_BY_ID } from '../../../src/world/blocks.js'

const cost = (out) => RECIPES.find((r) => r.out === out).cost
/** arrow towers it builds once brutes come (the other spots are for cannons) */
export const ARROW_CAP = 14
/** stone walls it keeps to patch breaches */
export const PATCH_STOCK = 6
/** blocks it patches: the wall and its gates, at any tier */
const PATCHABLE = new Set([...FAMILIES.wall, ...FAMILIES.gate])
/** no attacker this close to a hole (blocks) */
const PATCH_CLEAR = 4

export class FullStrategy extends PlayStrategy {
    /** @param {import('./bot.js').Bot} bot */
    constructor(bot) {
        super(bot)
        /** holes it couldn't patch (until when) */
        this.patchFailed = new Map()
    }

    /** brutes come from night 3 */
    get brutes() {
        return this.see.nightLevel >= 3
    }

    /** arrow towers standing in the town */
    arrowTowers() {
        return this.see.g.towers.list.filter((t) => t.type === 'arrow').length
    }

    /** tower spots nothing is waiting for */
    freeSlots() {
        const s = this.see
        return this.slots().length - s.count('arrow_tower') - s.count('cannon_tower')
    }

    troopSpotsLeft() {
        const s = this.see
        return this.town.troopSpots().length - s.count('archer') - s.count('gunner') - s.count('swordsman')
    }

    /** what the stock buys, in order (worked out on paper first, so one purchase doesn't starve the next) */
    shopping() {
        const s = this.see
        const inv = s.g.inventory
        const brutes = this.brutes
        let cobble = s.count('cobble') - (this.ranged() ? this.stepsToBuild().length : 0)
        let iron = s.count('iron')
        let gold = s.count('gold')
        let wood = this.wood()
        let slots = this.freeSlots()
        const out = []
        const buy = (item, n) => n > 0 && out.push([item, n])
        let cannons = 0
        while (brutes && slots > 0 && iron >= 4 && cobble >= 10) {
            cannons++
            slots--
            iron -= 4
            cobble -= 10
        }
        buy('cannon_tower', cannons)
        // while there are spots for cannons, the iron is for them (the cobble comes next)
        if (brutes && slots > 0) iron = Math.max(0, iron - 4 * slots)
        if (this.ranged() !== 'musket' && inv.bestWeapon === 'iron_sword' && iron >= 4 && gold >= 2) {
            buy('musket', 1)
            iron -= 4
            gold -= 2
        }
        const arrowsNow = this.arrowTowers()
        let arrows = 0
        while (slots > 0 && wood >= 6 && cobble >= 6 && (!brutes || arrowsNow + arrows < ARROW_CAP)) {
            arrows++
            slots--
            wood -= 6
            cobble -= 6
        }
        buy('arrow_tower', arrows)
        let spots = this.troopSpotsLeft()
        let gunners = 0, archers = 0, swordsmen = 0
        for (; spots > 0 && brutes && gold >= 2 && iron >= 4; spots--, gold -= 2, iron -= 4) gunners++
        for (; spots > 0 && gold >= 1 && wood >= 4; spots--, gold--, wood -= 4) archers++
        for (; spots > 0 && gold >= 1 && iron >= 3; spots--, gold--, iron -= 3) swordsmen++
        buy('gunner', gunners)
        buy('archer', archers)
        buy('swordsman', swordsmen)
        buy('stone_wall', Math.min(Math.ceil(Math.max(0, PATCH_STOCK - s.count('stone_wall')) / 2), Math.floor(cobble / 3)))
        return out
    }

    async craftUseful() {
        const s = this.see
        const inv = s.g.inventory
        const best = inv.bestWeapon
        const can = (out) => inv.canAfford(cost(out))
        const weapons = []
        if (weaponDps(best) < weaponDps('iron_sword') && can('iron_sword')) weapons.push(['iron_sword', 1])
        else if (weaponDps(best) < weaponDps('stone_sword') && can('stone_sword')) weapons.push(['stone_sword', 1])
        if (!this.ranged() && can('bow')) weapons.push(['bow', 1])
        if (weapons.length) await this.k.craft(weapons)
        const list = this.shopping()
        if (list.length) await this.k.craft(list)
        // what gets placed next goes on the hotbar
        const keep = ['cobble', 'cannon_tower', 'arrow_tower', 'stone_wall', inv.bestWeapon]
        for (const item of ['cannon_tower', 'arrow_tower', 'gunner', 'archer', 'swordsman']) {
            if (s.count(item) > 0) await this.k.toHotbar(item, keep)
        }
        for (const item of ['cobble', 'stone_wall', this.ranged()]) if (item && s.count(item) > 0) await this.k.toHotbar(item, keep)
    }

    /** the next thing to gather for, or null when there's nothing more worth building */
    needs() {
        const s = this.see
        const c = (n) => s.count(n)
        const best = s.g.inventory.bestWeapon
        if (weaponDps(best) < weaponDps('stone_sword') && c('cobble') < 3) return { kind: 'stone', n: 4 }
        const iron = !this._noIron && this.nearIron()
        if (weaponDps(best) < weaponDps('iron_sword') && c('iron') < 3 && iron) return { kind: 'iron' }
        if (this.freeSlots() > 0) {
            if (this.brutes && c('iron') >= 4) {
                if (c('cobble') < 10) return { kind: 'stone', n: 12 - c('cobble') }
            } else if (!this.brutes || this.arrowTowers() + c('arrow_tower') < ARROW_CAP) {
                if (c('cobble') < 6) return { kind: 'stone', n: 12 - c('cobble') }
                if (this.wood() < 6) return { kind: 'wood' }
            } else if (iron) return { kind: 'iron' }
        }
        if (c('stone_wall') < PATCH_STOCK && c('cobble') < 3) return { kind: 'stone', n: 6 }
        if (this.troopSpotsLeft() > 0 && c('gold') >= 1 && this.wood() < 4 && c('iron') < 3) return { kind: 'wood' }
        return null
    }

    /** place one tower or troop: cannons before arrow towers */
    async placeSomething() {
        const s = this.see
        if (s.count('cannon_tower') > 0 && s.count('cobble') >= 2) {
            const slots = this.slots()
            const me = s.me().pos
            slots.sort((a, b) => a.near - b.near || Math.hypot(a.x - me[0], a.z - me[2]) - Math.hypot(b.x - me[0], b.z - me[2]))
            if (slots[0] && (await this.buildTower(slots[0], 'cannon_tower'))) return true
        }
        return super.placeSomething()
    }

    /**
     * Night: patch the nearest hole in the wall that no attacker is near, if
     * it carries the block. Returns whether it did something.
     */
    async patchSomething() {
        const s = this.see
        const now = this.bot.time
        const R = this.town.R
        /** @type {[number, number, number, string][]} */
        const holes = []
        s.g.world.damage.forEach((x, y, z, id) => {
            const b = BLOCK_BY_ID[id]
            if (!b || !PATCHABLE.has(b.name) || s.count(b.name) <= 0) return
            if (this.town.ringDist(x, z) > R || (this.patchFailed.get(`${x},${y},${z}`) || 0) > now) return
            holes.push([x, y, z, b.name])
        })
        if (!holes.length) return false
        const attackers = s.attackers()
        const clear = holes.filter((h) => !attackers.some((a) => Math.hypot(a.pos[0] - h[0] - 0.5, a.pos[2] - h[2] - 0.5) < PATCH_CLEAR))
        if (!clear.length) return false
        const me = s.me().pos
        // the lowest first (the one above rests on it), then the nearest
        clear.sort((a, b) => a[1] - b[1] || Math.hypot(a[0] - me[0], a[2] - me[2]) - Math.hypot(b[0] - me[0], b[2] - me[2]))
        const [x, y, z, item] = clear[0]
        this.k.activity = 'patching'
        const ok = await this.k.goPlace([x, y, z], item, { night: true, avoid: (ax, ay, az) => !this.inTown(ax, az) })
        if (!ok) this.patchFailed.set(`${x},${y},${z}`, now + 10)
        return ok
    }
}
