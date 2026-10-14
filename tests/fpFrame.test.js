/*
 *  First person is the body itself (plan 14), seen from the vantage
 *  (src/game/fpView.js): these hold what that shows, on the character GLBs
 *  posed as the game plays them (tools/fp-frame.mjs), for every model and
 *  every item it holds, on a desktop window, a phone held sideways and one
 *  held upright. And every weapon meets what it swings at the right way round:
 *  a blade with its edge, a pickaxe with its point, a bow with its string
 *  toward the archer (next_10.md: for three iterations nothing checked it).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import {
    cases, measure, slashShape, onScreen, onScreenShare, modelFor, poseModel, heldFrame, leftHand, project, itemMatrix, itemDir,
    SCREENS, FRAME, FPS,
} from '../tools/fp-frame.mjs'
import { vantage, VANTAGE, HEAD_HEIGHT } from '../src/game/fpView.js'
import { ITEM_POSE, NOCK } from '../src/characters/itemPose.js'
import { CLIP_KEYS, holdForItem, companionItem } from '../src/characters/contract.js'
import { WEAPONS, UNITS, FAMILIES } from '../src/game/balance.js'

const DEG = 180 / Math.PI
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(a.normalize(), b.normalize())))) * DEG
const AHEAD = new Vector3(0, 0, 1)
const label = (c) => `${c.model} ${c.item}`
const all = cases()

describe('first person sees the body from the vantage (plan 14 §2.3)', () => {
    it('covers every item anyone holds, and every model that holds it', () => {
        const items = new Set(all.map((c) => c.item))
        for (const w of Object.values(WEAPONS)) if (w.item !== 'pickaxe' || w.clip) expect(items.has(w.item), w.item).toBe(true)
        for (const u of Object.values(UNITS)) expect(all.some((c) => c.model === u.model), u.model).toBe(true)
        expect(items.has('pickaxe') && items.has('block') && items.has('fist')).toBe(true)
    })

    for (const [screen, aspect] of Object.entries(SCREENS)) {
        describe(screen, () => {
            for (const c of all) {
                const r = measure(c, aspect)
                it(`${label(c)}: at rest the hand and what it holds are on screen, clear of the crosshair`, () => {
                    expect(onScreen(r.rest.hand, aspect), 'hand').toBe(true)
                    expect(onScreen(r.rest.tip, aspect), 'item').toBe(true)
                    // the hand at the bottom of the screen, where you'd look for it
                    expect(onScreenShare(r.rest.hand, aspect).y).toBeLessThan(-0.4)
                    if (c.item !== 'block') expect(r.rest.gap).toBeGreaterThan(FRAME.crosshair)
                })
                it(`${label(c)}: nothing comes within ${FRAME.near} m of the vantage, at rest or through its strike`, () => {
                    expect(r.near).toBeGreaterThan(FRAME.near)
                })
                // the chop is the old one exactly (plan 14 §5): it sweeps down through the view and lands
                // below the crosshair, so its blow isn't on screen
                if (r.moments.blow && c.action !== 'mine') {
                    it(`${label(c)}: at the blow (or the loose) what it holds is on screen`, () => {
                        expect(onScreen(r.moments.blow.tip, aspect)).toBe(true)
                    })
                }
                if (c.item.endsWith('sword')) {
                    it(`${label(c)}: the slash's blade crosses the crosshair`, () => expect(r.pass).toBeLessThan(0.03))
                }
            }
        })
    }

    it('a bigger body is seen from further up and back, so it looks the same', () => {
        const big = vantage(HEAD_HEIGHT * 1.24), mine = vantage()
        for (let i = 0; i < 3; i++) expect(big[i]).toBeCloseTo(mine[i] * 1.24, 6)
        expect(modelFor('attacker_brute').head).toBeGreaterThan(modelFor('player').head * 1.2)
    })

    it('a phone held upright moves it toward the right shoulder and back; a wide screen leaves it', () => {
        const wide = vantage(HEAD_HEIGHT, 16 / 9), upright = vantage(HEAD_HEIGHT, SCREENS.upright)
        expect(wide).toEqual([VANTAGE.x, VANTAGE.y, VANTAGE.z])
        expect(upright[0]).toBeGreaterThan(wide[0])
        expect(upright[2]).toBeLessThan(wide[2])
    })

    it('grunts and brutes hold both fists up, so in first person both show (plan 14 §8.5)', () => {
        for (const model of ['attacker_grunt', 'attacker_brute']) {
            const m = modelFor(model)
            const v = vantage(m.head)
            const eye = new Vector3(v[0], v[1], v[2])
            const w = poseModel(m, { hold: 'hold_fists' })
            const right = project(heldFrame(m, w, 'fist').hand, eye), left = project(leftHand(m, w).hand, eye)
            expect(onScreen(right, 16 / 9) && onScreen(left, 16 / 9), model).toBe(true)
            expect(right.x).toBeGreaterThan(0)
            expect(left.x).toBeLessThan(0)
        }
    })
})

describe('one slash for every sword, from up to down (plan 14 §3)', () => {
    const swords = all.filter((c) => c.item.endsWith('sword'))

    it('every sword names the one clip, and the swordsman swings it too', () => {
        for (const w of FAMILIES.sword) expect(WEAPONS[w].clip, w).toBe('attack')
        expect(swords.map((c) => c.model)).toContain('defender_swordsman')
        for (const c of swords) expect(c.action).toBe('attack')
    })

    it('fits inside the shortest sword cooldown, so slashes never overlap', () => {
        const length = Math.max(...swords.map((c) => modelFor(c.model).clips.attack.length))
        const shortest = Math.min(...FAMILIES.sword.map((w) => WEAPONS[w].cooldown))
        expect(length).toBeLessThan(shortest)
    })

    for (const c of swords) {
        it(`${label(c)}: a cut, not a wave: down, edge first, the blade on from the arm and in its own plane`, () => {
            const s = slashShape(c)
            expect(s.down, 'the tip goes down at the blow').toBeGreaterThan(0.8)
            expect(s.edge, 'the edge leads (0° edge first, 90° the flat)').toBeLessThan(15)
            expect(s.lean, 'the blade within 40° of the forearm').toBeLessThan(40)
            expect(s.reach, 'the tip travels much farther than the hand').toBeGreaterThan(1.5)
            expect(s.flat, 'the blade in the plane it sweeps').toBeLessThan(30)
        })
    }

    it('the check catches a blade turned flat into the cut (what was wrong until iteration 10)', () => {
        const c = swords[0]
        const m = modelFor(c.model)
        const at = (f, pose) => heldFrame(m, poseModel(m, { hold: c.hold, action: 'attack', t: f / FPS }), c.item, pose)
        const turned = { ...ITEM_POSE[c.item], roll: (ITEM_POSE[c.item].roll || 0) + Math.PI / 2 }
        const k = CLIP_KEYS.attack.blow
        const b = at(k, turned), b0 = at(k - 0.5, turned), b1 = at(k + 0.5, turned)
        const travel = b1.tip.subtract(b0.tip)
        const sweep = travel.subtract(b.axis.scale(Vector3.Dot(travel, b.axis)))
        expect(Math.min(angle(b.edge, sweep), angle(b.edge.scale(-1), sweep))).toBeGreaterThan(60)
    })
})

describe('every other item meets what it strikes the right way round', () => {
    const m = modelFor('player')

    it('the pickaxe swings its head in the plane of the chop, as before plan 13 (plan 14 §5)', () => {
        const at = (f) => heldFrame(m, poseModel(m, { hold: 'hold_sword', action: 'mine', t: f / FPS }), 'pickaxe')
        for (let f = 2; f <= CLIP_KEYS.mine.blow; f++) {
            const a = at(f - 1), b = at(f)
            // the plane the head sweeps through, about the hand
            const n = Vector3.Cross(a.tip.subtract(a.hand), b.tip.subtract(b.hand)).normalize()
            // the head's long axis (+x in items.glb, the point) lies in it
            expect(Math.abs(90 - angle(b.edge, n)), `frame ${f}`).toBeLessThan(10)
        }
    })

    it('the chop is the big one from over the head: raised above the head, then down in front', () => {
        const head = m.head + 0.38
        const top = heldFrame(m, poseModel(m, { action: 'mine', t: 0 }), 'pickaxe')
        const blow = heldFrame(m, poseModel(m, { action: 'mine', t: CLIP_KEYS.mine.blow / FPS }), 'pickaxe')
        expect(top.hand.y).toBeGreaterThan(head - 0.1)
        expect(blow.hand.y).toBeLessThan(m.head - 0.3)
        expect(blow.hand.z).toBeGreaterThan(0.3)
    })

    it('a bow has its string on the archer\'s side, and the arrow on it points ahead', () => {
        for (const bow of FAMILIES.bow.map((w) => WEAPONS[w].item)) {
            const world = poseModel(m, { hold: 'hold_bow' })
            const im = itemMatrix(m, world, ITEM_POSE[bow])
            // +z in items.glb is the string's side of the stave
            expect(Vector3.Dot(itemDir(im, [0, 0, 1]), AHEAD), bow).toBeLessThan(-0.5)
            // the nocked arrow (head on +y in items.glb), turned by NOCK into the bow's space as library.js does
            const drawn = poseModel(m, { hold: 'hold_bow', action: 'shoot_draw', t: 9 / FPS })
            const dm = itemMatrix(m, drawn, ITEM_POSE[bow])
            const nock = Matrix.FromQuaternionToRef(Quaternion.FromEulerAngles(NOCK.rot[0], NOCK.rot[1], NOCK.rot[2]), new Matrix())
            const local = Vector3.TransformNormal(new Vector3(0, 1, 0), nock).asArray()
            expect(Vector3.Dot(itemDir(dm, local), AHEAD), bow).toBeGreaterThan(0.6)
            expect(companionItem(bow)).toBe(bow + '_string')
        }
    })

    it('the musket\'s barrel points ahead', () => {
        const im = itemMatrix(m, poseModel(m, { hold: holdForItem('gun') }), ITEM_POSE.gun)
        expect(Vector3.Dot(itemDir(im, [0, 0, 1]), AHEAD)).toBeGreaterThan(0.8)
    })

    it('every item anyone holds has its own pose in the hand, by name', () => {
        const held = new Set([...Object.values(WEAPONS).map((w) => w.item), ...Object.values(UNITS).map((u) => u.item).filter(Boolean), 'pickaxe', 'block'])
        for (const item of held) expect(ITEM_POSE[item], item).toBeTruthy()
        for (const bow of FAMILIES.bow.map((w) => WEAPONS[w].item)) expect(ITEM_POSE[bow + '_string'], bow).toEqual(ITEM_POSE[bow])
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
        for (const s of ['sword', 'wood_sword', 'stone_sword', 'iron_sword']) {
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
