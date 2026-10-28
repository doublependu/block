/*
 *  Build and action rules that don't need the engine (unit tested):
 *    - a tower placed on the ground comes with its column
 *    - at night, a hole the attackers made can be patched with the same block
 *    - what the left button does, whatever is in front of you
 *    - what the crosshair lands on to mine or build
 */

import { AIR, BLOCK_BY_ID, TARGETABLE } from '../world/blocks.js'
import { familyOf } from './balance.js'

/** cobblestone a tower on the ground stands on */
export const TOWER_COLUMN = 2

/** @typedef {(x: number, y: number, z: number) => number} GetBlock */

/**
 * pure: the blocks a tower placed at `at` fills. On the ground it comes with
 * a column of TOWER_COLUMN cobblestone under it (from your stock); on a wall,
 * a column or anything else built, it's just the tower.
 * @param {GetBlock} getBlock
 * @param {number[]} at the (empty) cell the build fills
 * @param {string} tower item name
 * @param {object} o
 * @param {number} o.cobble in stock
 * @param {(x: number, y: number, z: number) => boolean} [o.free] nobody stands in the cell
 * @param {number} [o.maxY] cells from here up can't be built
 * @returns {{cells: [number, number, number, string][], reason?: undefined} | {reason: string, cells?: undefined}}
 */
export function towerPlacement(getBlock, at, tower, { cobble, free = () => true, maxY = 70 }) {
    const [x, y, z] = at
    const floor = BLOCK_BY_ID[getBlock(x, y - 1, z)]
    if (!floor || !floor.solid || floor.built) return { cells: [[x, y, z, tower]] }
    const empty = (cy) => {
        const id = getBlock(x, cy, z)
        return id === AIR || !!BLOCK_BY_ID[id]?.fluid
    }
    if (y + TOWER_COLUMN >= maxY) return { reason: 'Too high for a tower on its column' }
    for (let i = 0; i <= TOWER_COLUMN; i++) {
        if (!empty(y + i) || !free(x, y + i, z)) return { reason: 'No room here for the tower and its column' }
    }
    if (cobble < TOWER_COLUMN) return { reason: `A tower on the ground stands on ${TOWER_COLUMN} cobblestone: you need ${TOWER_COLUMN - cobble} more` }
    const cells = /** @type {[number, number, number, string][]} */ ([])
    for (let i = 0; i < TOWER_COLUMN; i++) cells.push([x, y + i, z, 'cobble'])
    cells.push([x, y + TOWER_COLUMN, z, tower])
    return { cells }
}

/**
 * pure: can `item` patch this cell at night? Only a built block destroyed
 * tonight, and only with the same block.
 * @param {number | undefined} destroyed the block destroyed there tonight (the world's damage overlay), if any
 * @param {string} item
 */
export function canPatch(destroyed, item) {
    if (destroyed === undefined) return false
    const b = BLOCK_BY_ID[destroyed]
    return !!b && !!b.built && b.name === item
}

/** seconds the build button is held to upgrade a wall or gate in place */
export const UPGRADE_HOLD = 0.4

/** families whose higher tier replaces the lower one on a plain click: nobody stacks a tower on a tower or spikes on spikes */
const CLICK_UPGRADES = new Set(['arrow_tower', 'cannon_tower', 'spikes'])

/**
 * pure: the gesture that upgrades the block called `onto` to `item` in place,
 * or null when `item` isn't a higher tier of its family (then a click builds
 * beside it, as with any other block).
 *
 * Towers and spikes upgrade on a click. A wall or gate is something you also
 * build beside and on top of, so a click does that and upgrading takes a hold.
 * @param {string | undefined} onto
 * @param {string} item
 * @returns {'click' | 'hold' | null}
 */
export function upgradeGesture(onto, item) {
    const from = onto ? familyOf(onto) : null
    const to = familyOf(item)
    if (!from || !to || from.family !== to.family || to.tier <= from.tier) return null
    return CLICK_UPGRADES.has(to.family) ? 'click' : 'hold'
}

/**
 * pure: does placing `item` against the block at `at` replace it?
 *
 * Only a higher tier of the same family, only by day, and the old block isn't
 * refunded. Without this, upgrading a wall means digging out the one you built,
 * and a tower has nowhere new to stand once the spots are taken. Anything else
 * (the same tier, a lower one, another family) is an ordinary build beside it.
 * @param {GetBlock} getBlock
 * @param {number[]} at the built block that was clicked
 * @param {string} item the item being placed
 * @param {boolean} canEdit day (false at night: no upgrading under fire)
 * @param {boolean} [held] the build button was held (see upgradeGesture)
 * @returns {{ok: boolean, replaces?: string, build?: boolean, hint?: string, reason?: string}}
 *   ok: replaces `replaces`; otherwise `build`: go on and build beside it (`hint`:
 *   how an upgrade is done), or not at all (`reason`)
 */
export function upgradePlacement(getBlock, at, item, canEdit, held = false) {
    const here = BLOCK_BY_ID[getBlock(at[0], at[1], at[2])]
    const gesture = here && here.built ? upgradeGesture(here.name, item) : null
    if (!gesture) return { ok: false, build: true }
    if (gesture === 'hold' && !held) return { ok: false, build: true, hint: `Hold to upgrade the ${label(here.name)} to ${label(item)}` }
    if (!canEdit) return { ok: false, build: false, reason: 'Upgrades have to wait for daylight' }
    return { ok: true, replaces: here.name }
}

const label = (name) => name.replace(/_/g, ' ')

/**
 * pure: what pressing the left button does. There is always an answer, so the
 * swing or the chop plays whether or not anything is in front of you — what
 * changes is whether it lands on something.
 *
 * @param {object} o
 * @param {string|null} o.kind    ITEMS[...].kind of the selected item (null: nothing selected)
 * @param {string} o.attack       the weapon's attack kind: melee shoots nothing
 * @param {boolean} o.canEdit     the world can be dug right now (day)
 * @param {boolean} o.enemyInReach an attacker is within the weapon's range
 * @param {boolean} o.blockTargeted a block you could actually mine is under the crosshair
 * @returns {'mine'|'attack'|'shoot'}
 */
export function pressAction({ kind, attack, canEdit, enemyInReach, blockTargeted }) {
    if (attack && attack !== 'melee') return 'shoot'
    if (enemyInReach) return 'attack'
    // at night nothing can be dug, so everything is a swing
    if (!canEdit) return 'attack'
    if (blockTargeted) return 'mine'
    // at thin air: a weapon swings, a pickaxe or a block in hand chops
    return kind === 'weapon' ? 'attack' : 'mine'
}

/**
 * pure: a pick result as blocks: the block struck (`position`), the cell in
 * front of the face struck (`adjacent`, where a build goes) and the face's
 * `normal`. Copied, since noa reuses its result object. The hit point noa
 * gives is nudged off the face toward the viewer, so it floors to the
 * adjacent cell, not to the block (reading it raw is what kept an attacker
 * you play from ever damaging a wall, plan 14 §4).
 * @param {null | {position: ArrayLike<number>, normal: ArrayLike<number>}} hit
 * @returns {null | {position: number[], adjacent: number[], normal: number[]}}
 */
export function blockHit(hit) {
    if (!hit) return null
    const p = hit.position, n = hit.normal
    const adjacent = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])]
    return { adjacent, normal: [n[0], n[1], n[2]], position: [adjacent[0] - n[0], adjacent[1] - n[1], adjacent[2] - n[2]] }
}

/** how far a melee attacker you play reaches a block, from its head (blocks) */
export const BLOCK_REACH = 3

/**
 * pure: can an attacker's melee blow damage this block? Anything built; a
 * digger (the sapper) the ground too. Never what can't be broken (bedrock).
 * @param {{hardness: number, built?: boolean} | undefined} block
 * @param {boolean} digs
 */
export function strikable(block, digs) {
    return !!block && isFinite(block.hardness) && (!!block.built || digs)
}

/**
 * pure: the block test for a pick that mines or builds: anything targetable (gates and
 * spikes too, see blocks.js), except a cell you can walk through that the pick
 * starts in, so the gate you stand in doesn't stop your own crosshair. noa
 * gives the test the voxel's world coords (a [block patch]).
 * @param {(id: number) => boolean} solid
 * @param {() => ArrayLike<number>} start where the pick starts (read only for a cell you can walk through)
 * @returns {(id: number, x: number, y: number, z: number) => boolean}
 */
export function targetTest(solid, start) {
    return (id, x, y, z) => {
        if (solid(id)) return true
        if (!TARGETABLE[id]) return false
        const p = start()
        return x !== Math.floor(p[0]) || y !== Math.floor(p[1]) || z !== Math.floor(p[2])
    }
}
