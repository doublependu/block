/*
 *  Procedural block texture atlas.
 *
 *  Tiles are 16x16 pixel-art squares stacked vertically (noa's atlas layout:
 *  one column, height = width * tileCount). Painted at startup on a canvas,
 *  so the atlas costs no network request. To use hand-made art instead,
 *  export a PNG with the same tile order (see TILE_NAMES) and pass its URL.
 */

import { rand3 } from '../core/rng.js'

export const TILE = 16

export const TILE_NAMES = [
    'bedrock', 'stone', 'dirt', 'grass_top', 'grass_side', 'sand', 'snow', 'snow_side',
    'water', 'log_side', 'log_top', 'leaves', 'iron_ore', 'gold_ore', 'cobble', 'planks',
    'stone_wall', 'iron_wall', 'gate', 'spikes', 'arrow_tower', 'cannon_tower', 'tower_top', 'plaza',
    'town_core', 'town_core_top', 'town_crystal',
]

/** @type {Record<string, number>} */
export const TILE_INDEX = Object.fromEntries(TILE_NAMES.map((n, i) => [n, i]))

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

/** @param {ImageData} img */
function painter(img, tileIndex) {
    const d = img.data
    const oy = tileIndex * TILE
    const put = (x, y, rgb, a = 255) => {
        if (x < 0 || y < 0 || x >= TILE || y >= TILE) return
        const p = ((oy + y) * TILE + x) * 4
        d[p] = rgb[0]; d[p + 1] = rgb[1]; d[p + 2] = rgb[2]; d[p + 3] = a
    }
    const jitter = (rgb, amount, x, y, salt) => {
        const r = (rand3(x, y, tileIndex, salt) - 0.5) * 2 * amount
        return [rgb[0] + r, rgb[1] + r, rgb[2] + r]
    }
    const noiseFill = (base, amount, salt = 1) => {
        const c = hex(base)
        for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) put(x, y, jitter(c, amount, x, y, salt))
    }
    const speckle = (col, chance, salt = 7, size = 1) => {
        const c = hex(col)
        for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
            if (rand3(x, y, tileIndex, salt) < chance) {
                for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) put(x + a, y + b, jitter(c, 12, x, y, salt + 1))
            }
        }
    }
    const rect = (x0, y0, w, h, col, amount = 8, salt = 3) => {
        const c = hex(col)
        for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, jitter(c, amount, x, y, salt))
    }
    const bricks = (mortar, brick, rowH, brickW) => {
        noiseFill(mortar, 6)
        for (let row = 0; row * rowH < TILE; row++) {
            const off = row % 2 ? brickW / 2 : 0
            for (let bx = -1; bx * brickW < TILE + brickW; bx++) {
                rect(bx * brickW + off + 1, row * rowH + 1, brickW - 1, rowH - 1, brick, 14, row * 31 + bx)
            }
        }
    }
    return { put, noiseFill, speckle, rect, bricks, hex, jitter }
}

const PAINT = {
    bedrock: (p) => { p.noiseFill('#3a3a3f', 18); p.speckle('#1d1d20', 0.25, 5, 2) },
    stone: (p) => { p.noiseFill('#7f7f84', 12); p.speckle('#6a6a70', 0.12, 9, 2) },
    dirt: (p) => { p.noiseFill('#7a5534', 14); p.speckle('#5e3f25', 0.12) },
    grass_top: (p) => { p.noiseFill('#5fa83a', 16); p.speckle('#4d8f2e', 0.2) },
    grass_side: (p) => {
        p.noiseFill('#7a5534', 14); p.speckle('#5e3f25', 0.12)
        for (let x = 0; x < TILE; x++) {
            const depth = 3 + Math.floor(rand3(x, 0, 4, 99) * 3)
            p.rect(x, 0, 1, depth, '#5fa83a', 14, 5)
        }
    },
    sand: (p) => { p.noiseFill('#dccb8c', 10); p.speckle('#c9b775', 0.15) },
    snow: (p) => { p.noiseFill('#eef3f7', 6); p.speckle('#d7e2ea', 0.1) },
    snow_side: (p) => {
        p.noiseFill('#7a5534', 14)
        for (let x = 0; x < TILE; x++) p.rect(x, 0, 1, 4 + Math.floor(rand3(x, 1, 7, 98) * 3), '#eef3f7', 6, 6)
    },
    water: (p) => {
        const c = p.hex('#2f6fd0')
        for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) p.put(x, y, p.jitter(c, 10, x, y, 2), 170)
    },
    log_side: (p) => {
        p.noiseFill('#6b4a2b', 10)
        for (let x = 0; x < TILE; x += 3) p.rect(x, 0, 1, TILE, '#533820', 8, x)
    },
    log_top: (p) => {
        p.noiseFill('#b8925c', 8)
        for (let r = 2; r < 8; r += 2) {
            for (let a = 0; a < 64; a++) {
                const t = a / 64 * 6.2832
                // ring outline, integer-rounded (cosmetic only, not worldgen)
                p.put(Math.round(7.5 + r * Math.cos(t)), Math.round(7.5 + r * Math.sin(t)), p.hex('#8f6d40'))
            }
        }
        for (let i = 0; i < TILE; i++) { p.put(i, 0, p.hex('#6b4a2b')); p.put(i, 15, p.hex('#6b4a2b')); p.put(0, i, p.hex('#6b4a2b')); p.put(15, i, p.hex('#6b4a2b')) }
    },
    leaves: (p) => {
        const c = p.hex('#3f8a2e')
        for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
            const hole = rand3(x, y, 11, 4) < 0.18
            p.put(x, y, p.jitter(c, 22, x, y, 3), hole ? 0 : 255)
        }
    },
    iron_ore: (p) => { PAINT.stone(p); p.speckle('#d8b59a', 0.07, 21, 2) },
    gold_ore: (p) => { PAINT.stone(p); p.speckle('#f2d23c', 0.07, 23, 2) },
    cobble: (p) => {
        p.noiseFill('#5c5c60', 8)
        for (let i = 0; i < 9; i++) {
            const x = Math.floor(rand3(i, 0, 14, 41) * 13), y = Math.floor(rand3(i, 1, 14, 41) * 13)
            p.rect(x, y, 4, 4, '#8a8a8f', 14, i)
        }
    },
    planks: (p) => {
        p.noiseFill('#a47a45', 10)
        for (let y = 3; y < TILE; y += 4) p.rect(0, y, TILE, 1, '#6e5028', 4, y)
        p.put(3, 1, p.hex('#6e5028')); p.put(11, 5, p.hex('#6e5028')); p.put(6, 9, p.hex('#6e5028')); p.put(13, 13, p.hex('#6e5028'))
    },
    stone_wall: (p) => p.bricks('#4b4b50', '#9b9ba2', 4, 8),
    iron_wall: (p) => {
        p.bricks('#3d3f45', '#8f98a3', 8, 8)
        for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13], [7, 7]]) p.rect(x, y, 2, 2, '#d7dde3', 4, x + y)
    },
    gate: (p) => {
        for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) p.put(x, y, [0, 0, 0], 0)
        for (let x = 1; x < TILE; x += 5) p.rect(x, 0, 3, TILE, '#8a6236', 10, x)
        p.rect(0, 3, TILE, 2, '#5a5f66', 6, 1); p.rect(0, 11, TILE, 2, '#5a5f66', 6, 2)
    },
    spikes: (p) => {
        for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) p.put(x, y, [0, 0, 0], 0)
        for (let s = 0; s < 4; s++) {
            const cx = 2 + s * 4
            for (let y = 4; y < TILE; y++) {
                const w = Math.floor((y - 4) / 5)
                for (let dx = -w; dx <= w; dx++) p.put(cx + dx, y, p.jitter(p.hex('#c3c9cf'), 10, cx + dx, y, s))
            }
        }
    },
    arrow_tower: (p) => {
        PAINT.planks(p)
        p.rect(6, 3, 4, 8, '#2b2016', 4, 2)
        p.rect(0, 0, TILE, 2, '#6e5028', 4, 3); p.rect(0, 14, TILE, 2, '#6e5028', 4, 4)
    },
    cannon_tower: (p) => {
        p.bricks('#3d3f45', '#7d7f86', 4, 8)
        p.rect(5, 5, 6, 6, '#1b1b1f', 4, 2)
    },
    tower_top: (p) => {
        p.noiseFill('#6e5028', 8)
        p.rect(2, 2, 12, 12, '#a47a45', 10, 5)
        p.rect(6, 6, 4, 4, '#c8423a', 10, 6)
    },
    town_core: (p) => {
        p.bricks('#6b5a3e', '#c9b27a', 4, 8)
        p.rect(0, 0, TILE, 2, '#3b5fa8', 6, 1)
        p.rect(6, 6, 4, 10, '#3b5fa8', 8, 2)
        p.rect(7, 8, 2, 3, '#f2d23c', 6, 3)
    },
    town_core_top: (p) => {
        p.noiseFill('#8d7b58', 8)
        p.rect(1, 1, 14, 14, '#c9b27a', 8, 4)
        p.rect(5, 5, 6, 6, '#3b5fa8', 8, 5)
    },
    town_crystal: (p) => {
        for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
            const edge = x === 0 || y === 0 || x === 15 || y === 15
            const diag = (x + y) % 5 === 0
            p.put(x, y, p.jitter(p.hex(edge ? '#9fe8ff' : diag ? '#e6fbff' : '#4fc3f7'), 10, x, y, 8), edge ? 255 : 200)
        }
    },
    plaza: (p) => {
        p.noiseFill('#8d877c', 6)
        for (let y = 0; y < TILE; y += 8) for (let x = 0; x < TILE; x += 8) p.rect(x + 1, y + 1, 6, 6, '#b3ab9d', 8, x + y)
    },
}

/** Paint all tiles, return a PNG data URL */
export function buildAtlasDataURL() {
    const canvas = document.createElement('canvas')
    canvas.width = TILE
    canvas.height = TILE * TILE_NAMES.length
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(canvas.width, canvas.height)
    TILE_NAMES.forEach((name, i) => PAINT[name](painter(img, i)))
    // clamp jittered colours
    ctx.putImageData(img, 0, 0)
    return canvas.toDataURL('image/png')
}
