/*
 *  First person is the body itself (plan 14), seen from the vantage
 *  (src/game/fpView.js): a point a little behind the eye. This measures what
 *  that shows, on the character GLBs posed as the game plays them: for every
 *  model and every item it holds, at rest and at the key moments of its strike
 *  (contract.js CLIP_KEYS), where the hand and the item's working end land on
 *  the screen, on a desktop window, a phone held sideways and one held
 *  upright; how close the item comes to the crosshair at rest; and how close
 *  anything comes to the vantage.
 *
 *  tests/fpFrame.test.js holds the limits (FRAME); run as a script, this prints
 *  the table.
 *
 *  Usage: node --import ./tools/node-ext.mjs tools/fp-frame.mjs [--model=player] [--item=wood_sword] [--screen=desktop]
 */

import { join } from 'node:path'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { PerformanceConfigurator } from '@babylonjs/core/Engines/performanceConfigurator'
import { readGlb, animationCurves } from './glb-info.mjs'
import { sampleCurve } from '../src/characters/animFix.js'
import { normaliseClipName, ARM_BONES, UPPER_BONES, ITEM_SOCKET, holdForItem, FALLBACKS, CLIP_KEYS, CLIP_FPS } from '../src/characters/contract.js'
import { ITEM_POSE, itemRotation } from '../src/characters/itemPose.js'
import { vantage } from '../src/game/fpView.js'
import { WEAPONS, UNITS } from '../src/game/balance.js'

export const MODELS = new URL('../public/models/', import.meta.url).pathname

// without an engine Babylon keeps every matrix ever made (to change their precision when one
// starts): thousands of poses would run node out of memory
PerformanceConfigurator.SetMatrixPrecision(false)

/** frames per second of the clips (tools/blender/make_characters.py) */
export const FPS = CLIP_FPS

/** the game's view, top to bottom (Babylon's default; the game doesn't change it but to widen it while running) */
export const FOV = 0.8

/** the screens it's measured on: width / height */
export const SCREENS = { desktop: 16 / 9, phone: 19.5 / 9, upright: 9 / 19.5 }

/**
 * The limits (plan 14 §2.3), in tan units of the view (1 = the edge of the
 * screen's half-height at depth 1): what tests/fpFrame.test.js holds.
 *   crosshair  at rest the item and the hand stay at least this far from the
 *              middle of the screen (tan; 0.04 is about 2.3°, twice the size of
 *              the crosshair itself)
 *   near       nothing drawn comes closer to the vantage than this (m)
 *   edge       "on screen" allows this much past the edge (a share of the half-width)
 */
export const FRAME = { crosshair: 0.04, near: 0.25, edge: 0.04 }

const DEG = 180 / Math.PI
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1)

/** an item's long axis in items.glb: up the blade, haft or stave (+y); the musket's barrel is +z */
const AXIS = { gun: Z }
export const axisOf = (item) => AXIS[item] || Y

/** the item's working end in items.glb (m): a blade's tip, the pick's point, the bow's top, the coal, the muzzle */
export const TIP = {
    sword: [0, 0.72, 0], wood_sword: [0, 0.66, 0], stone_sword: [0, 0.8, 0], iron_sword: [0, 1.0, 0],
    pickaxe: [0.49, 0.345, 0], crude_pickaxe: [0.28, 0.5, 0],
    bow: [0, 0.5, 0], recurve_bow: [0, 0.6, 0], war_bow: [0, 0.68, 0],
    gun: [0, 0, 0.45], fire_staff: [0, 1.0, 0],
    block: [0, 0, 0],
    // a bare fist: the knuckles, just past the hand
    fist: [0, 0, 0],
}
/** the item's grip end (m, item space): where its drawn length starts */
const BUTT = { gun: [0, 0, -0.23], fire_staff: [0, -0.37, 0], bow: [0, -0.5, 0], recurve_bow: [0, -0.6, 0], war_bow: [0, -0.68, 0] }

// ---- the body ----------------------------------------------------------------------

/** a character GLB's skeleton at rest, and its clips by contract name */
export function loadModel(name) {
    const glb = readGlb(join(MODELS, name + '.glb'))
    const { json } = glb
    const nodes = json.nodes.map((n) => ({
        name: n.name,
        t: n.translation || [0, 0, 0],
        r: n.rotation || [0, 0, 0, 1],
        s: n.scale || [1, 1, 1],
        children: n.children || [],
        parent: -1,
    }))
    nodes.forEach((n, i) => n.children.forEach((c) => (nodes[c].parent = i)))
    const index = Object.fromEntries(nodes.map((n, i) => [n.name, i]))
    const clips = {}
    for (const c of animationCurves(glb)) {
        const clip = (clips[normaliseClipName(c.clip)] ||= { curves: [], length: 0 })
        clip.curves.push({ node: index[c.node], path: c.path, keys: c.keys })
        clip.length = Math.max(clip.length, c.keys[c.keys.length - 1].t)
    }
    const model = { name, nodes, index, clips, head: 0 }
    model.head = toBody(Vector3.TransformCoordinates(Vector3.Zero(), poseModel(model, {})[index.head])).y
    return model
}

/** a clip by name, or what the game falls back to (contract.js FALLBACKS) */
export function clipOf(model, name) {
    if (model.clips[name]) return { name, clip: model.clips[name] }
    for (const alt of FALLBACKS[name] || []) if (model.clips[alt]) return { name: alt, clip: model.clips[alt] }
    return null
}

/** world matrices from local transforms */
function worldOf(model, local) {
    const world = new Array(model.nodes.length)
    const get = (i) => {
        if (world[i]) return world[i]
        const l = local[i]
        const m = Matrix.Compose(Vector3.FromArray(l.s), Quaternion.FromArray(l.r), Vector3.FromArray(l.t))
        world[i] = model.nodes[i].parent >= 0 ? m.multiply(get(model.nodes[i].parent)) : m
        return world[i]
    }
    model.nodes.forEach((_, i) => get(i))
    return world
}

/**
 * World matrices of every node with clips layered as the game plays them
 * (library.js): locomotion for the whole body, the hold pose over the arms,
 * an action over the upper body (the hold stops while it plays).
 * @param {ReturnType<typeof loadModel>} model
 * @param {{base?: string, hold?: string | null, action?: string | null, t?: number}} o
 */
export function poseModel(model, { base = 'idle', hold = null, action = null, t = 0 }) {
    const local = model.nodes.map((n) => ({ t: n.t, r: n.r, s: n.s }))
    const apply = (name, time, bones) => {
        const c = name && clipOf(model, name)
        if (!c) return
        for (const cv of c.clip.curves) {
            if (bones && !bones.has(model.nodes[cv.node].name)) continue
            const v = sampleCurve(cv.keys, time)
            if (cv.path === 'rotation') local[cv.node].r = v
            else if (cv.path === 'translation') local[cv.node].t = v
            else if (cv.path === 'scale') local[cv.node].s = v
        }
    }
    apply(base, 0, null)
    if (action) apply(action, t, new Set(UPPER_BONES))
    else apply(hold, 0, new Set(ARM_BONES))
    return worldOf(model, local)
}

/**
 * glTF's frame (the character faces +z, its right hand on -x) to the body's
 * as the game shows it: the glTF loader mirrors x, so the right hand is on +x
 */
export const toBody = (v) => new Vector3(-v.x, v.y, v.z)

/**
 * an item's transform (glTF frame) as the hand holds it in a pose
 * @param {ReturnType<typeof poseModel>} world
 */
export function itemMatrix(model, world, pose) {
    const socket = world[model.index[ITEM_SOCKET]]
    return Matrix.Compose(new Vector3(pose.scale, pose.scale, pose.scale), itemRotation(pose), Vector3.FromArray(pose.pos)).multiply(socket)
}

/** a direction in the item's own space (items.glb), in the body's frame */
export const itemDir = (m, v) => toBody(Vector3.TransformNormal(Vector3.FromArray(v), m).normalize())

/**
 * What the body shows of a held item in a pose (body frame: x to its right, y
 * up from the feet, z ahead): the hand, the elbow, the item's grip and working
 * end, its long axis and its x (a blade's edge, a pick's point).
 * @param {ReturnType<typeof poseModel>} world
 */
export function heldFrame(model, world, item, pose = ITEM_POSE[item]) {
    const arm = world[model.index['lower_arm.R']]
    const socket = world[model.index[ITEM_SOCKET]]
    const hand = toBody(Vector3.TransformCoordinates(Vector3.Zero(), socket))
    const elbow = toBody(Vector3.TransformCoordinates(Vector3.Zero(), arm))
    const forearm = hand.subtract(elbow).normalize()
    if (item === 'fist' || !pose) return { hand, elbow, forearm, grip: hand, tip: hand, axis: forearm, edge: X }
    const m = itemMatrix(model, world, pose)
    return {
        hand, elbow, forearm,
        grip: toBody(Vector3.TransformCoordinates(Vector3.FromArray(BUTT[item] || [0, 0, 0]), m)),
        tip: toBody(Vector3.TransformCoordinates(Vector3.FromArray(TIP[item]), m)),
        axis: toBody(Vector3.TransformNormal(axisOf(item), m).normalize()),
        edge: toBody(Vector3.TransformNormal(X, m).normalize()),
    }
}

/**
 * The body's left hand and elbow (a bow's draw, the fists)
 * @param {ReturnType<typeof poseModel>} world
 */
export function leftHand(model, world) {
    const hand = toBody(Vector3.TransformCoordinates(Vector3.Zero(), world[model.index['hand.L']]))
    const elbow = toBody(Vector3.TransformCoordinates(Vector3.Zero(), world[model.index['lower_arm.L']]))
    return { hand, elbow }
}

// ---- the view ------------------------------------------------------------------------

/**
 * pure: a point of the body (body frame) as the camera sees it from the
 * vantage: tan of its angle right and up of the middle of the screen, and its
 * depth (m). On screen when |x| <= tan(FOV/2) * aspect and |y| <= tan(FOV/2).
 */
export function project(p, eye) {
    const v = p.subtract(eye)
    return { x: v.x / v.z, y: v.y / v.z, z: v.z }
}

const HALF = Math.tan(FOV / 2)

/** pure: is a projected point on a screen `aspect` wide (with FRAME.edge to spare)? */
export const onScreen = (s, aspect) => s.z > 0.05 && Math.abs(s.x) <= HALF * aspect * (1 + FRAME.edge) && Math.abs(s.y) <= HALF * (1 + FRAME.edge)

/** pure: as a share of the half-width and half-height (±1 is the edge) */
export const onScreenShare = (s, aspect) => ({ x: s.x / (HALF * aspect), y: s.y / HALF })

/** pure: how far the middle of the screen is from a projected segment (tan units) */
export function crosshairGap(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const k = len2 > 0 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2)) : 0
    return Math.hypot(a.x + dx * k, a.y + dy * k)
}

/** a segment from a to b, sampled: for how near it comes to the vantage */
const along = (a, b, n = 6) => Array.from({ length: n + 1 }, (_, i) => Vector3.Lerp(a, b, i / n))

// ---- what's measured ----------------------------------------------------------------

/**
 * One thing to look at in first person: a model holding an item, at rest
 * (`hold`) and through its strike (`action`, at its key moments).
 * @typedef {{model: string, item: string, hold: string | null, action: string | null, keys: {windUp: number, blow: number, end: number} | null, speed?: number}} Case
 */

/**
 * Every item and every model that holds it, as the game plays them: what the
 * builder holds by weapon, digging and building, and each troop and attacker
 * as you'd play it (control.js _playAction).
 * @returns {Case[]}
 */
export function cases() {
    const list = []
    const add = (model, item, hold, action, keys = action ? CLIP_KEYS[action] : null) => list.push({ model, item, hold, action, keys })
    for (const [name, w] of Object.entries(WEAPONS)) {
        if (name === 'none') continue
        add('player', w.item, holdForItem(w.item), w.clip)
    }
    add('player', 'pickaxe', holdForItem('pickaxe'), 'mine')
    add('player', 'block', holdForItem('block'), 'place', null)
    for (const u of Object.values(UNITS)) {
        if (u.attack === 'melee' && u.digs) add(u.model, u.item, holdForItem(u.item), 'mine')
        else if (u.attack === 'melee' && u.item) add(u.model, u.item, holdForItem(u.item), 'attack')
        else if (u.attack === 'melee') add(u.model, 'fist', 'hold_fists', 'attack', CLIP_KEYS.attack_fist)
        else if (u.attack === 'fireball') add(u.model, u.item, holdForItem(u.item), 'cast')
        else if (u.item && u.item.endsWith('bow')) add(u.model, u.item, holdForItem(u.item), 'shoot_draw')
        else add(u.model, u.item, holdForItem(u.item), 'shoot')
    }
    const seen = new Set()
    return list.filter((c) => {
        const k = `${c.model}|${c.item}|${c.action}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
    })
}

const models = new Map()
export const modelFor = (name) => {
    if (!models.has(name)) models.set(name, loadModel(name))
    return models.get(name)
}

/**
 * A case seen from the vantage on one screen: at rest, and at each key moment
 * of its strike: the hand and the working end on the screen, the gap between
 * the crosshair and what's held at rest, the nearest thing to the vantage, and
 * (a sword) how close its blade passes to the crosshair through the strike.
 * @param {Case} c
 * @param {number} aspect
 * @param {{model?: any, eye?: Vector3}} [o] stand-ins (fitting)
 */
export function measure(c, aspect, o = {}) {
    const m = o.model || modelFor(c.model)
    const v = vantage(m.head, aspect)
    const eye = o.eye || new Vector3(v[0], v[1], v[2])
    const look = (world) => {
        const f = heldFrame(m, world, c.item)
        const L = leftHand(m, world)
        const pts = [...along(f.elbow, f.hand), ...along(f.grip, f.tip), ...along(L.elbow, L.hand)]
        return {
            hand: project(f.hand, eye),
            tip: project(f.tip, eye),
            grip: project(f.grip, eye),
            wrist: project(Vector3.Lerp(f.elbow, f.hand, 0.6), eye),
            near: Math.min(...pts.map((p) => p.subtract(eye).length())),
            f,
        }
    }
    const clip = c.action && clipOf(m, c.action)
    const rest = look(poseModel(m, { hold: c.hold }))
    const out = {
        case: c, clip: clip ? clip.name : null, aspect,
        rest: { ...rest, gap: Math.min(crosshairGap(rest.grip, rest.tip), crosshairGap(rest.wrist, rest.hand)) },
        moments: {},
        near: rest.near,
        pass: Infinity,
    }
    if (!clip || !c.keys) return out
    for (const k of ['windUp', 'blow', 'end']) {
        const s = look(poseModel(m, { hold: c.hold, action: clip.name, t: c.keys[k] / FPS }))
        out.moments[k] = s
        out.near = Math.min(out.near, s.near)
    }
    // through the strike: how near the blade comes to the crosshair, and to the vantage
    for (let f = c.keys.windUp; f <= c.keys.end; f += 0.25) {
        const s = look(poseModel(m, { hold: c.hold, action: clip.name, t: f / FPS }))
        out.pass = Math.min(out.pass, crosshairGap(s.grip, s.tip))
        out.near = Math.min(out.near, s.near)
    }
    return out
}

/**
 * pure: a slash's shape in the body's frame (plan 13 §2.3, still the test of a
 * cut): at the blow the blade within `lean` of the forearm, the tip travelling
 * `reach` times as far as the hand, the blade within `flat` of the plane its
 * tip sweeps through; and `down`, how much of the tip's travel at the blow
 * goes downward (1 = straight down).
 */
export function slashShape(c) {
    const m = modelFor(c.model)
    const clip = clipOf(m, c.action)
    const at = (f) => heldFrame(m, poseModel(m, { hold: c.hold, action: clip.name, t: f / FPS }), c.item)
    const k = c.keys
    const w = at(k.windUp), b = at(k.blow), e = at(k.end)
    const angle = (a, d) => Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(a.normalize(), d.normalize())))) * DEG
    const tipPath = Vector3.Distance(w.tip, b.tip) + Vector3.Distance(b.tip, e.tip)
    const handPath = Vector3.Distance(w.hand, b.hand) + Vector3.Distance(b.hand, e.hand)
    const n = Vector3.Cross(b.tip.subtract(w.tip), e.tip.subtract(b.tip)).normalize()
    const b0 = at(k.blow - 0.5), b1 = at(k.blow + 0.5)
    const travel = b1.tip.subtract(b0.tip).normalize()
    const sweep = travel.subtract(b.axis.scale(Vector3.Dot(travel, b.axis))).normalize()
    return {
        lean: angle(b.axis, b.forearm),
        reach: tipPath / Math.max(1e-6, handPath),
        flat: Math.asin(Math.min(1, Math.abs(Vector3.Dot(b.axis, n)))) * DEG,
        down: -travel.y,
        // the edge leads: the blade's edge (its x) against the way it sweeps across itself, 0° edge first
        edge: Math.min(angle(b.edge, sweep), angle(b.edge.scale(-1), sweep)),
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
    const f2 = (v) => (v === undefined ? '    -' : v.toFixed(2).padStart(5))
    const pt = (s, aspect) => {
        const q = onScreenShare(s, aspect)
        return `${f2(q.x)},${f2(q.y)}${onScreen(s, aspect) ? ' ' : '!'}`
    }
    for (const [screen, aspect] of Object.entries(SCREENS)) {
        if (args.screen && args.screen !== screen) continue
        console.log(`\n${screen} (${aspect.toFixed(2)}): hand and tip as shares of the half-screen (! off it); gap from the crosshair at rest (tan); nearest (m); a strike's closest pass of the crosshair`)
        console.log('model               item           action      rest hand    rest tip     gap  | windUp tip   blow tip     end tip     | near  pass')
        for (const c of cases()) {
            if (args.model && c.model !== args.model) continue
            if (args.item && c.item !== args.item) continue
            const r = measure(c, aspect)
            const mo = (k) => (r.moments[k] ? pt(r.moments[k].tip, aspect) : '      -     ')
            console.log(`${c.model.padEnd(19)} ${c.item.padEnd(14)} ${String(c.action).padEnd(11)} ${pt(r.rest.hand, aspect)} ${pt(r.rest.tip, aspect)} ${r.rest.gap.toFixed(2)} | ${mo('windUp')} ${mo('blow')} ${mo('end')} | ${r.near.toFixed(2)}  ${isFinite(r.pass) ? r.pass.toFixed(2) : '   -'}`)
        }
    }
}
