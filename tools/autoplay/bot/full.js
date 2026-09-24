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
 *    - since iteration 9, tiers: every tower it buys is the best of its family
 *      the stock pays for, it keeps a gold per open tower spot for a tier III,
 *      and once the spots are taken, or iron and gold pile up (late in a game
 *      the cobble for new towers runs out first), it upgrades the standing
 *      towers in place, lowest tier and oldest first, mining the cobble for it. (Spending the gold and iron on troops
 *      and upgrades sooner was tried in iteration 9 and lost by night 9 twice:
 *      troops count double toward the night, see next_9.md)
 *
 *  PlayStrategy on its own (--strategy=towers) is iteration 6's plan: arrow
 *  towers, archers, the bow and the musket.
 */

import { PlayStrategy } from './play.js'
import { RECIPES, FAMILIES, weaponDps, familyOf } from '../../../src/game/balance.js'
import { BLOCK_BY_ID } from '../../../src/world/blocks.js'

const cost = (out) => RECIPES.find((r) => r.out === out).cost
/** the tower families, best tier first */
const ARROWS = [...FAMILIES.arrow_tower].reverse()
const CANNONS = [...FAMILIES.cannon_tower].reverse()
/** the cobble column a tower on the ground stands on */
const COLUMN = 2
/** holding this much, the bot upgrades towers even while spots are open (see rich) */
const RICH = { iron: 10, gold: 8 }
/** at most this many upgrades bought at once (the rest of the stock is for troops) */
const UPGRADES_AT_ONCE = 3
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
        /** towers bought to replace standing ones: {cell, from, item} */
        this.upgradeQueue = []
        /** upgrades done, for the report */
        this.upgrades = []
    }

    /** brutes come from night 3 */
    get brutes() {
        return this.see.nightLevel >= 3
    }

    /** arrow-family towers standing in the town, any tier */
    arrowTowers() {
        return this.see.g.towers.list.filter((t) => FAMILIES.arrow_tower.includes(`${t.type}_tower`)).length
    }

    /** towers held, of a family (any tier) */
    held(family) {
        return family.reduce((n, t) => n + this.see.count(t), 0)
    }

    /** iron and gold piling up faster than new towers use them */
    rich() {
        return this.see.count('iron') >= RICH.iron && this.see.count('gold') >= RICH.gold
    }

    /** tower spots nothing is waiting for */
    freeSlots() {
        return this.slots().length - this.held(ARROWS) - this.held(CANNONS)
    }

    /**
     * Standing towers a better tier could replace, in the order to do it:
     * the lowest tier first, then the oldest.
     */
    upgradable() {
        return this.see.g.towers.list
            .map((t, age) => ({ cell: [t.x, t.y, t.z], name: `${t.type}_tower`, age }))
            .map((t) => ({ ...t, f: familyOf(t.name) }))
            .filter((t) => t.f && t.f.tier < 3)
            .sort((a, b) => a.f.tier - b.f.tier || a.age - b.age)
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
        const stock = {
            cobble: s.count('cobble') - (this.ranged() ? this.stepsToBuild().length : 0),
            iron: s.count('iron'), gold: s.count('gold'), planks: this.wood(),
        }
        const affords = (item, extra = {}) => {
            const need = { ...extra }
            for (const [k, n] of Object.entries(cost(item))) need[k] = (need[k] || 0) + n
            return Object.entries(need).every(([k, n]) => (stock[k] ?? 0) >= n)
        }
        const pay = (item, extra = {}) => {
            for (const [k, n] of Object.entries(cost(item))) stock[k] -= n
            for (const [k, n] of Object.entries(extra)) stock[k] -= n
        }
        /** the best tier of a family the stock pays for, with a column under it */
        const best = (family, extra = { cobble: COLUMN }) => family.find((t) => affords(t, extra)) || null
        let slots = this.freeSlots()
        const out = []
        const bought = new Map()
        const buy = (item, n = 1) => {
            if (n <= 0) return
            bought.set(item, (bought.get(item) || 0) + n)
        }
        // cannon towers for the brutes, the best tier the stock pays for
        while (brutes && slots > 0) {
            const t = best(CANNONS)
            if (!t) break
            pay(t, { cobble: COLUMN })
            buy(t)
            slots--
        }
        // while there are spots for cannons, the iron is for them (the cobble comes next)
        const reserved = brutes && slots > 0 ? Math.min(stock.iron, 4 * slots) : 0
        stock.iron -= reserved
        if (this.ranged() !== 'musket' && inv.bestWeapon === 'iron_sword' && affords('musket')) {
            pay('musket')
            buy('musket')
        }
        let arrows = this.arrowTowers()
        while (slots > 0 && (!brutes || arrows < ARROW_CAP)) {
            const t = best(ARROWS)
            if (!t) break
            pay(t, { cobble: COLUMN })
            buy(t)
            slots--
            arrows++
        }
        // no spots left, or iron and gold piling up anyway (late, the cobble for more
        // towers runs out first): make the standing towers better. The iron kept
        // for cannons goes back in, but for one cannon's worth
        this.upgradeQueue = []
        const full = slots <= 0 && this.freeSlots() <= 0
        const rich = this.rich()
        if (rich) stock.iron += Math.max(0, reserved - 4)
        for (const t of full || rich ? this.upgradable() : []) {
            if (this.upgradeQueue.length >= UPGRADES_AT_ONCE) break
            const family = t.f.family === 'arrow_tower' ? ARROWS : CANNONS
            const to = family.find((n) => familyOf(n).tier > t.f.tier && affords(n))
            if (!to) continue
            pay(to)
            buy(to)
            this.upgradeQueue.push({ cell: t.cell, from: t.name, item: to })
        }
        // a gold for each open spot stays for a tier III tower; the rest pays for troops
        const keepGold = Math.min(stock.gold, Math.max(0, slots))
        stock.gold -= keepGold
        let spots = this.troopSpotsLeft()
        let gunners = 0, archers = 0, swordsmen = 0
        for (; spots > 0 && brutes && stock.gold >= 2 && stock.iron >= 4; spots--, stock.gold -= 2, stock.iron -= 4) gunners++
        for (; spots > 0 && stock.gold >= 1 && stock.planks >= 4; spots--, stock.gold--, stock.planks -= 4) archers++
        for (; spots > 0 && stock.gold >= 1 && stock.iron >= 3; spots--, stock.gold--, stock.iron -= 3) swordsmen++
        buy('gunner', gunners)
        buy('archer', archers)
        buy('swordsman', swordsmen)
        buy('stone_wall', Math.min(Math.ceil(Math.max(0, PATCH_STOCK - s.count('stone_wall')) / 2), Math.floor(stock.cobble / 3)))
        for (const [item, n] of bought) out.push([item, n])
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
        const towers = [...CANNONS, ...ARROWS].filter((t) => s.count(t) > 0)
        const keep = ['cobble', ...towers, 'stone_wall', inv.bestWeapon]
        for (const item of [...towers, 'gunner', 'archer', 'swordsman']) {
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
            } else if (!this.brutes || this.arrowTowers() + this.held(ARROWS) < ARROW_CAP) {
                if (c('cobble') < 6) return { kind: 'stone', n: 12 - c('cobble') }
                if (this.wood() < 6) return { kind: 'wood' }
            } else if (iron) return { kind: 'iron' }
        }
        // upgrades waiting on cobble
        if (this.rich() && c('cobble') < 8 && this.upgradable().length) return { kind: 'stone', n: 12 - c('cobble') }
        if (c('stone_wall') < PATCH_STOCK && c('cobble') < 3) return { kind: 'stone', n: 6 }
        if (this.troopSpotsLeft() > 0 && c('gold') >= 1 && this.wood() < 4 && c('iron') < 3) return { kind: 'wood' }
        return null
    }

    /** place one tower (cannons before arrow towers, the best tier first) or troop, or upgrade a tower */
    async placeSomething() {
        const s = this.see
        for (const item of [...CANNONS, ...ARROWS]) {
            // the ones bought to upgrade a standing tower aren't for a new spot
            const reserved = (this.upgradeQueue || []).filter((u) => u.item === item).length
            if (s.count(item) <= reserved || s.count('cobble') < COLUMN) continue
            const slots = this.slots()
            if (!slots.length) break
            const me = s.me().pos
            slots.sort((a, b) => a.near - b.near || Math.hypot(a.x - me[0], a.z - me[2]) - Math.hypot(b.x - me[0], b.z - me[2]))
            if (await this.buildTower(slots[0], item)) return true
        }
        if (await this.upgradeSomething()) return true
        return super.placeSomething()
    }

    /** replace the next tower in the queue with the better one bought for it */
    async upgradeSomething() {
        const q = this.upgradeQueue || []
        while (q.length) {
            const u = q[0]
            const here = BLOCK_BY_ID[this.see.block(...u.cell)]
            if (!here || here.name !== u.from || this.see.count(u.item) <= 0) {
                q.shift()
                continue
            }
            this.k.activity = 'upgrading'
            const ok = await this.k.goUpgrade(u.cell, u.item)
            q.shift()
            if (ok) {
                this.upgrades.push({ day: this.see.g.cycle.day, from: u.from, to: u.item })
                return true
            }
        }
        return false
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
