/*
 *  Every weapon in your hand meets what it swings at the right way round.
 *  The swords led with the flat of the blade for three iterations, and the bow
 *  and pickaxe were half a turn out, because nothing checked a pose against the
 *  direction the item moves (next_10.md). These tests do, in camera space (the
 *  camera looks down +z), with the same maths the view model draws with.
 *  They also check where a sword points at rest: ahead, toward the crosshair,
 *  not standing across the view (next_11.md).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MOTIONS, ITEM_POSE, NOCK, STROKE, COMBO_GAP, poseFor, heldMatrix, itemMatrix, handMatrix, drawOffset, nextStroke, momentsOf } from '../src/game/handPose.js'
import { cutShape } from '../tools/hand-match.mjs'
import { WEAPONS, UNITS } from '../src/game/balance.js'
import { companionItem } from '../src/characters/contract.js'

const DEG = 180 / Math.PI
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1)
const dir = (v, m) => Vector3.TransformNormal(v, m).normalize()
const at = (v, m) => Vector3.TransformCoordinates(v, m)
const angle = (a, b) => Math.acos(Math.min(1, Math.abs(Vector3.Dot(a.normalize(), b.normalize())))) * DEG

/** the blade's tip in item space, per sword (the top of its mesh, items.glb) */
const TIP = { sword: 0.72, wood_sword: 0.66, stone_sword: 0.8, iron_sword: 1.0 }
const SWORDS = Object.keys(TIP)
// every sword swings the same stroke (plan 13 §2.3); the swordsman's is the plain `swing`
const MOTION_OF = { sword: 'swing', wood_sword: WEAPONS.wood_sword.motion, stone_sword: WEAPONS.stone_sword.motion, iron_sword: WEAPONS.iron_sword.motion }

/**
 * The angle between the direction the blade cuts and its edge, at share `q`
 * of the slash. The cut is the tip's motion across the blade (sliding along
 * its own length is neither edge nor flat): 0° is edge first, 90° the flat.
 */
function cutAngle(item, q, { mirror = false, roll = 0 } = {}) {
    const motion = MOTION_OF[item]
    const k = MOTIONS[motion].swing
    const p = k.windUp + (k.slashEnd - k.windUp) * q
    const pose = { ...poseFor(item), roll: (poseFor(item).roll || 0) + roll }
    const frame = (t) => {
        const o = MOTIONS[motion].f(t, mirror)
        return itemMatrix(pose, o.roll || 0).multiply(handMatrix(o))
    }
    const a = frame(p), b = frame(p + 0.004)
    const tip = new Vector3(0, TIP[item], 0)
    const v = at(tip, b).subtract(at(tip, a))
    const blade = dir(Y, a)
    const across = v.subtract(blade.scale(Vector3.Dot(v, blade)))
    return angle(across, dir(X, a))
}

/** how squarely the blade's flat faces your eye at rest (1 = full on, 0 = edge-on) */
function flatShowing(item) {
    const m = heldMatrix(item)
    const toEye = at(new Vector3(0, TIP[item] / 2, 0), m).scale(-1).normalize()
    return Math.abs(Vector3.Dot(dir(Z, m), toEye))
}

/**
 * Where a sword points at rest, seen from your eye: the blade against the view
 * direction (3D), the blade's line on the screen against the line from its
 * grip to the crosshair, and how far the tip sits from the aim (all degrees).
 * `m` defaults to the sword's pose; pass another to measure that instead.
 */
function restAim(item, m = heldMatrix(item)) {
    const grip = at(Vector3.Zero(), m), tip = at(new Vector3(0, TIP[item], 0), m)
    const screen = (v) => [v.x / v.z, v.y / v.z]
    const [gx, gy] = screen(grip), [tx, ty] = screen(tip)
    const onScreen = Math.atan2(ty - gy, tx - gx), toCrosshair = Math.atan2(-gy, -gx)
    let off = Math.abs(onScreen - toCrosshair) * DEG
    if (off > 180) off = 360 - off
    return {
        fromView: Math.acos(Vector3.Dot(tip.subtract(grip).normalize(), Z)) * DEG,
        offCrosshairLine: off,
        tipFromAim: Math.atan(Math.hypot(tip.x, tip.y) / tip.z) * DEG,
    }
}

describe('swords cut with the edge', () => {
    for (const item of SWORDS) {
        it(`${item}: the edge leads at the impact point of its slash`, () => {
            expect(cutAngle(item, 0.5)).toBeLessThanOrEqual(20)
        })
        it(`${item}: and through the heart of the slash`, () => {
            for (const q of [0.35, 0.65]) expect(cutAngle(item, q)).toBeLessThanOrEqual(25)
        })
    }
    for (const item of SWORDS) {
        it(`${item}: its backhand leads with the edge too (the other one)`, () => {
            expect(MOTIONS[MOTION_OF[item]].mirror).toBe(true)
            expect(cutAngle(item, 0.5, { mirror: true })).toBeLessThanOrEqual(20)
            for (const q of [0.35, 0.65]) expect(cutAngle(item, q, { mirror: true })).toBeLessThanOrEqual(25)
        })
    }
    it('the check catches a quarter turn (what was wrong until iteration 10)', () => {
        for (const item of SWORDS) {
            expect(cutAngle(item, 0.5, { roll: Math.PI / 2 })).toBeGreaterThan(60)
            expect(cutAngle(item, 0.5, { roll: -Math.PI / 2 })).toBeGreaterThan(60)
        }
    })
})

describe('swords point where you look', () => {
    // ref/sword-90.png: until iteration 11 the blade stood up out of the fist
    // and leant out to the right, 84° from where you look and 69° off the line
    // to the crosshair, lying across the screen (next_11.md). The edge tests
    // above passed on it: they check which face leads, not where the blade points
    for (const item of SWORDS) {
        it(`${item}: at rest the blade reaches ahead, not across the view`, () => {
            expect(restAim(item).fromView).toBeLessThanOrEqual(55)
        })
        it(`${item}: on the screen it heads toward the crosshair`, () => {
            expect(restAim(item).offCrosshairLine).toBeLessThanOrEqual(30)
        })
        it(`${item}: its tip stays clear of the aim`, () => {
            expect(restAim(item).tipFromAim).toBeGreaterThanOrEqual(6)
        })
        it(`${item}: some of the flat shows, so it never reads as a stick`, () => {
            const f = flatShowing(item)
            expect(f).toBeGreaterThan(0.3)
            expect(f).toBeLessThan(0.9)
        })
    }
    it('the check catches the pose in ref/sword-90.png (iterations 8 to 10)', () => {
        const old = { pos: [-0.02, 0.06, 0.02], rot: [0.3, 0, -0.42], roll: -0.35, scale: 0.62 }
        const r = restAim('wood_sword', itemMatrix(old).multiply(handMatrix({})))
        expect(r.fromView).toBeGreaterThan(55)
        expect(r.offCrosshairLine).toBeGreaterThan(30)
    })
})

describe('the pickaxe chops in the plane of its head, point first', () => {
    // items.glb: the haft is +y, the head runs along x with the long point at +x (curving down)
    const point = new Vector3(0.49, 0.345, 0)
    const motionAt = (p) => {
        const a = heldMatrix('pickaxe', 'mine', p), b = heldMatrix('pickaxe', 'mine', p + 0.004)
        return { a, v: at(point, b).subtract(at(point, a)) }
    }
    it('the head moves within its own plane as it lands', () => {
        const { a, v } = motionAt(MOTIONS.mine.impact - 0.02)
        expect(angle(v, dir(Z, a))).toBeGreaterThan(70)
    })
    it('the long point leads, not the chisel', () => {
        const { a, v } = motionAt(MOTIONS.mine.impact - 0.02)
        const forward = dir(new Vector3(1, -0.5, 0), a)
        expect(Vector3.Dot(v.normalize(), forward)).toBeGreaterThan(Math.cos(60 / DEG))
    })
})

describe('bows: the string on your side, the arrow toward what you aim at', () => {
    const STRING = new Vector3(0, 0, 0.06) // items.glb: the string is 6 cm off the stave on +z
    const GRIP = new Vector3(0, 0, -0.03)
    for (const bow of ['bow', 'recurve_bow', 'war_bow']) {
        it(`${bow}: the string is between the stave and your eye`, () => {
            const m = heldMatrix(bow)
            expect(at(STRING, m).z).toBeLessThan(at(GRIP, m).z)
        })
        it(`${bow}: its string sits exactly where the stave does`, () => {
            expect(poseFor(companionItem(bow))).toEqual(poseFor(bow))
        })
    }
    it('drawing brings the string toward you', () => {
        const home = poseFor('bow')
        const drawn = itemMatrix({ ...home, pos: [home.pos[0], home.pos[1], home.pos[2] + drawOffset(0.05)] }).multiply(handMatrix({}))
        expect(at(STRING, drawn).z).toBeLessThan(at(STRING, heldMatrix('bow')).z)
    })
    for (const pull of [0, 0.062]) {
        it(`the nocked arrow points ahead, with its fletching on the string (pull ${pull})`, () => {
            const home = poseFor('bow')
            const hand = handMatrix({})
            const nock = itemMatrix({ ...NOCK, pos: [home.pos[0] + NOCK.side, home.pos[1] + NOCK.lift, home.pos[2] + NOCK.ahead + drawOffset(pull)] }).multiply(hand)
            const string = itemMatrix({ ...home, pos: [home.pos[0], home.pos[1], home.pos[2] + drawOffset(pull)] }).multiply(hand)
            // items.glb: the arrow's head is at +y, its fletching at -y
            expect(dir(Y, nock).z).toBeGreaterThan(0.85)
            expect(Vector3.Distance(at(new Vector3(0, -0.33, 0), nock), at(STRING, string))).toBeLessThan(0.012)
        })
    }
})

describe('the musket points where you look', () => {
    it('its barrel (+z in items.glb) runs along the view', () => {
        expect(dir(Z, heldMatrix('gun')).z).toBeGreaterThan(0.85)
    })
})

describe('every held item has its own pose', () => {
    const held = new Set(['pickaxe', 'block', ...Object.values(WEAPONS).map((w) => w.item)])
    // the attackers too (plan 13 §2.4): until then the sapper's pick and the fire mage's staff were posed as swords
    for (const u of Object.values(UNITS)) if (u.item) held.add(u.item)
    it('first person: every item you can hold (or hold as a unit you play) is in ITEM_POSE by name', () => {
        for (const item of held) expect(ITEM_POSE[item], item).toBeTruthy()
    })
    it('the sapper\'s pick is held as the pickaxe, and the fire mage\'s staff stands upright, the coal at the top', () => {
        expect(ITEM_POSE.crude_pickaxe.rot).toEqual(ITEM_POSE.pickaxe.rot)
        expect(dir(Y, heldMatrix('fire_staff')).y).toBeGreaterThan(0.95)
    })
    it('tiers of a family are posed within 0.1 rad of each other', () => {
        const families = [['sword', 'wood_sword', 'stone_sword', 'iron_sword'], ['bow', 'recurve_bow', 'war_bow']]
        for (const f of families) {
            const [base, ...tiers] = f.map((i) => ITEM_POSE[i])
            for (const t of tiers) {
                for (let i = 0; i < 3; i++) expect(Math.abs(t.rot[i] - base.rot[i])).toBeLessThanOrEqual(0.1)
                expect(Math.abs((t.roll || 0) - (base.roll || 0))).toBeLessThanOrEqual(0.1)
            }
        }
    })
})

describe('items.glb keeps the axes the poses are written for', () => {
    // a rebuilt mesh that comes out turned fails here, before anyone sees it in the hand
    const glb = readFileSync(new URL('../public/models/items.glb', import.meta.url))
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString())
    const bounds = {}
    for (const node of json.nodes) {
        if (node.mesh === undefined) continue
        const acc = json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION]
        bounds[node.name] = { min: acc.min, max: acc.max, size: acc.max.map((v, i) => v - acc.min[i]) }
    }
    it('swords: the blade runs up +y, wider across x (its edges) than through z (its flat)', () => {
        for (const s of SWORDS) {
            const b = bounds[s]
            expect(b.max[1], s).toBeGreaterThan(0.6)
            expect(b.size[1]).toBeGreaterThan(b.size[0] * 2)
            expect(b.size[0]).toBeGreaterThan(b.size[2] * 2)
        }
    })
    it('bows: the stave runs along y, the string sits on +z of it', () => {
        for (const bow of ['bow', 'recurve_bow', 'war_bow']) {
            expect(bounds[bow].size[1]).toBeGreaterThan(0.9)
            expect(bounds[bow + '_string'].min[2]).toBeGreaterThan(bounds[bow].min[2])
            expect(bounds[bow + '_string'].min[2]).toBeGreaterThan(0.03)
        }
    })
    it('the pickaxe: haft up +y, the long point out on +x', () => {
        expect(bounds.pickaxe.max[1]).toBeGreaterThan(0.5)
        expect(bounds.pickaxe.max[0]).toBeGreaterThan(-bounds.pickaxe.min[0])
    })
    it('the arrow: head on +y; the musket: barrel on +z', () => {
        expect(bounds.arrow.max[1]).toBeGreaterThan(-bounds.arrow.min[1])
        expect(bounds.gun.max[2]).toBeGreaterThan(-bounds.gun.min[2])
    })
})

describe('every sword swings one stroke (plan 13 §2.3)', () => {
    it('every sword names the same motion and the same clip', () => {
        const swords = Object.entries(WEAPONS).filter(([, w]) => w.item.endsWith('sword'))
        expect(swords.length).toBe(3)
        for (const [name, w] of swords) {
            expect(w.motion, name).toBe('swing')
            expect(w.clip, name).toBe('attack')
        }
        // a tier given a stroke of its own again fails here: there is one
        expect(Object.values(MOTIONS).filter((m) => m.swing)).toHaveLength(1)
    })

    it('fits inside the shortest sword cooldown, so strokes never overlap', () => {
        const shortest = Math.min(...Object.values(WEAPONS).filter((w) => w.item.endsWith('sword')).map((w) => w.cooldown))
        expect(MOTIONS.swing.time).toBeLessThanOrEqual(shortest)
    })

    // a cut, not a wave: the blade laid out from the arm, the tip going much farther than the
    // hand, the blade lying in the plane it sweeps (the iron sword's old flourish failed all three)
    for (const back of [false, true]) {
        for (const item of SWORDS) {
            it(`${item}: the ${back ? 'backhand' : 'forehand'} is a cut, not a wave`, () => {
                const mo = momentsOf('swing')
                const c = cutShape((k) => {
                    const m = heldMatrix(item, 'swing', mo[k], back)
                    return {
                        axis: dir(Y, m), forearm: dir(Z, handMatrix(MOTIONS.swing.f(mo[k], back))),
                        tip: at(new Vector3(0, TIP[item], 0), m), hand: at(Vector3.Zero(), m),
                    }
                })
                expect(c.lean).toBeLessThanOrEqual(40)
                expect(c.reach).toBeGreaterThanOrEqual(1.5)
                expect(c.flat).toBeLessThanOrEqual(30)
            })
        }
    }

    it('the forehand goes from high right to low left through the crosshair, the backhand back', () => {
        const mo = momentsOf('swing')
        const screen = (back, k) => {
            const t = at(new Vector3(0, TIP.wood_sword, 0), heldMatrix('wood_sword', 'swing', mo[k], back))
            return [t.x / t.z, t.y / t.z]
        }
        const [wx, wy] = screen(false, 'windUp'), [bx, by] = screen(false, 'blow'), [ex, ey] = screen(false, 'end')
        expect(wx).toBeGreaterThan(0.2)
        expect(wy).toBeGreaterThan(0.1)
        expect(Math.hypot(bx, by)).toBeLessThan(0.12)
        expect(ex).toBeLessThan(-0.15)
        expect(ey).toBeLessThan(-0.15)
        const [vx, vy] = screen(true, 'windUp'), [fx, fy] = screen(true, 'end')
        expect(vx).toBeLessThan(-0.15)
        expect(vy).toBeLessThan(-0.15)
        expect(fx).toBeGreaterThan(0.2)
        expect(fy).toBeGreaterThan(0.1)
        expect(STROKE.fore.axis).not.toEqual(STROKE.back.axis)
    })

    it('alternates forehand and backhand while you keep swinging, and opens with the forehand after a pause', () => {
        let s = nextStroke(null, 10)
        expect(s.back).toBe(false)
        s = nextStroke(s, 10.4)
        expect(s.back).toBe(true)
        s = nextStroke(s, 10.8)
        expect(s.back).toBe(false)
        // a pause: the forehand again
        s = nextStroke(s, 10.8 + COMBO_GAP + 0.1)
        expect(s.back).toBe(false)
        // a swordsman strikes every 0.8 s (UNITS.swordsman.cooldown): it alternates too
        expect(UNITS.swordsman.cooldown).toBeLessThan(COMBO_GAP)
        expect(nextStroke(nextStroke(null, 0), UNITS.swordsman.cooldown).back).toBe(true)
    })
})
