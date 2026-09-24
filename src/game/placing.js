/*
 *  Build and action rules that don't need the engine (unit tested):
 *    - a tower placed on the ground comes with its column
 *    - at night, a hole the attackers made can be patched with the same block
 *    - what the left button does, whatever is in front of you
 */

import { AIR, BLOCK_BY_ID } from '../world/blocks.js'
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
