/*
 *  First person against third person (plan 13 §2): where each item points, how
 *  the forearm holding it points, and which way its tip travels at the blow,
 *  in the hands you see (src/game/handPose.js) and in the body's hand (the
 *  character GLBs, with the item on the hand socket as src/characters/itemPose.js
 *  puts it). Both are measured in the same frame: x to the right, y up, z
 *  ahead (the camera's for first person, looking level; the body's for third).
 *
 *  tests/handMatch.test.js holds the two together; run as a script, this
 *  prints the table.
 *
 *  Usage: node --import ./tools/node-ext.mjs tools/hand-match.mjs [--model=player] [--item=wood_sword]
 */

import { join } from 'node:path'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { PerformanceConfigurator } from '@babylonjs/core/Engines/performanceConfigurator'
import { readGlb, animationCurves } from './glb-info.mjs'
import { sampleCurve } from '../src/characters/animFix.js'
import { normaliseClipName, ARM_BONES, UPPER_BONES, ITEM_SOCKET, holdForItem, FALLBACKS, CLIP_KEYS, CLIP_FPS } from '../src/characters/contract.js'
import { ITEM_POSE as TP_POSE } from '../src/characters/itemPose.js'
import { MOTIONS, heldMatrix, handMatrix, itemRotation, momentsOf, clipSpeed } from '../src/game/handPose.js'
import { WEAPONS, UNITS } from '../src/game/balance.js'

export const MODELS = new URL('../public/models/', import.meta.url).pathname

// without an engine Babylon keeps every matrix ever made (to change their precision when one
// starts): tens of thousands of poses would run node out of memory
PerformanceConfigurator.SetMatrixPrecision(false)

/** frames per second of the clips (tools/blender/make_characters.py) */
export const FPS = CLIP_FPS

const DEG = 180 / Math.PI
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1)

/** an item's long axis in items.glb: up the blade, haft or stave (+y); the musket's barrel is +z */
const AXIS = { gun: Z }
const axisOf = (item) => AXIS[item] || Y

/** the item's working end in items.glb (m): a blade's tip, the pick's point, the bow's top, the coal */
export const TIP = {
    sword: [0, 0.72, 0], wood_sword: [0, 0.66, 0], stone_sword: [0, 0.8, 0], iron_sword: [0, 1.0, 0],
    pickaxe: [0.49, 0.345, 0], crude_pickaxe: [0.42, 0.3, 0],
    bow: [0, 0.5, 0], recurve_bow: [0, 0.5, 0], war_bow: [0, 0.55, 0],
    gun: [0, 0, 0.6], fire_staff: [0, 0.95, 0],
    // a bare fist: the knuckles, just past the hand
    fist: [0, 0, 0],
}

// ---- first person ----------------------------------------------------------------

/**
 * Key moments of a first-person motion, as shares of its time: where it is
 * wound up, where it lands (the blow), and where the stroke ends.
 * @returns {{windUp: number, blow: number, end: number}}
 */
export function fpMoments(motion) {
    return momentsOf(motion) || { windUp: 0.1, blow: 0.18, end: 0.4 }
}

/**
 * The hand you see at share `p` of a motion (null: at rest).
 * @returns {{axis: Vector3, forearm: Vector3, tip: Vector3}}
 */
export function fpFrame(item, motion = null, p = 0, back = false) {
    const o = motion ? MOTIONS[motion].f(p, back) : {}
    const hand = handMatrix(o)
    const forearm = Vector3.TransformNormal(Z, hand).normalize()
    if (item === 'fist') return { axis: forearm, forearm, tip: Vector3.TransformCoordinates(new Vector3(0, 0, 0.06), hand) }
    const m = heldMatrix(item, motion, p, back)
    return {
        axis: Vector3.TransformNormal(axisOf(item), m).normalize(),
        forearm,
        tip: Vector3.TransformCoordinates(Vector3.FromArray(TIP[item]), m),
    }
}

// ---- third person ----------------------------------------------------------------

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
    return { name, nodes, index, clips }
}

/** a clip by name, or what the game falls back to (contract.js FALLBACKS) */
export function clipOf(model, name) {
    if (model.clips[name]) return { name, clip: model.clips[name] }
    for (const alt of FALLBACKS[name] || []) if (model.clips[alt]) return { name: alt, clip: model.clips[alt] }
    return null
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
 * glTF's frame (the character faces +z, its right hand on -x) to the body's
 * as the game shows it: the glTF loader mirrors x, so the right hand is on +x
 */
const toBody = (v) => new Vector3(-v.x, v.y, v.z)

/**
 * The body's hand: where the item it holds points, its forearm, the item's tip.
 * @param {ReturnType<typeof loadModel>} model
 * @param {string} item an item name, or 'fist'
 * @param {{hold?: string | null, action?: string | null, t?: number, pose?: any}} o pose: the item's
 *   pose on the socket (default: itemPose.js)
 */
export function tpFrame(model, item, { hold = undefined, action = null, t = 0, pose = undefined } = {}) {
    const world = poseModel(model, { hold: hold === undefined ? holdForItem(item === 'fist' ? null : item) : hold, action, t })
    const arm = world[model.index['lower_arm.R']]
    const forearm = toBody(Vector3.TransformNormal(Y, arm).normalize())
    const socket = world[model.index[ITEM_SOCKET]]
    if (item === 'fist') {
        const tip = toBody(Vector3.TransformCoordinates(new Vector3(0, 0.06, 0), socket))
        return { axis: forearm, forearm, tip }
    }
    const p = pose || TP_POSE[item]
    const m = Matrix.Compose(new Vector3(p.scale, p.scale, p.scale), itemRotation(p), Vector3.FromArray(p.pos)).multiply(socket)
    return {
        axis: toBody(Vector3.TransformNormal(axisOf(item), m).normalize()),
        forearm,
        tip: toBody(Vector3.TransformCoordinates(Vector3.FromArray(TIP[item]), m)),
    }
}

// ---- the comparison ----------------------------------------------------------------

export const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(a.normalize(), b.normalize())))) * DEG

/**
 * What a weapon does in both views: the first-person motion and the body's
 * clip it goes with, the clip's key frames (contract.js CLIP_KEYS) and the
 * speed the game plays it at. `back`: the backhand of a mirroring stroke.
 * @typedef {{item: string, model: string, motion: string, clip: string, back: boolean,
 *   frames: {windUp: number, blow: number, end: number}, speed: number}} Stroke
 */

/**
 * Every item and every model that holds it, with what it does (plan 13 §2.1):
 * what the builder holds by weapon tier, and each troop and attacker as you'd
 * play it (control.js _playAction picks the same motion, clip and speed).
 * @returns {Stroke[]}
 */
export function strokes() {
    const list = []
    const add = (item, model, motion, clip, { back = false, frames = CLIP_KEYS[clip], speed = clipSpeed(clip, motion) } = {}) =>
        list.push({ item, model, motion, clip, back, frames, speed })
    for (const [name, w] of Object.entries(WEAPONS)) {
        if (name === 'none' || !w.motion) continue
        add(w.item, 'player', w.motion, w.clip)
        if (MOTIONS[w.motion].mirror) add(w.item, 'player', w.motion, w.clip + '_back', { back: true })
    }
    // digging plays the chop over and over, at 1.2 (control.js _chop)
    add('pickaxe', 'player', 'mine', 'mine', { speed: 1.2 })
    for (const u of Object.values(UNITS)) {
        const item = u.item || 'fist'
        if (u.attack === 'melee' && u.digs) add(item, u.model, 'mine', 'mine', { speed: 1.2 })
        else if (u.attack === 'melee' && u.item) {
            add(item, u.model, 'swing', 'attack')
            add(item, u.model, 'swing', 'attack_back', { back: true })
        } else if (u.attack === 'melee') add(item, u.model, 'punch', 'attack', { frames: CLIP_KEYS.attack_fist, speed: 1 })
        else if (u.attack === 'fireball') add(item, u.model, 'cast', 'cast')
        else if (item.endsWith('bow')) add(item, u.model, 'draw', 'shoot_draw')
        else add(item, u.model, 'recoil', 'shoot')
    }
    // one of each (a troop type can share a model and an item with another)
    const seen = new Set()
    return list.filter((s) => {
        const k = `${s.item}|${s.model}|${s.motion}|${s.clip}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
    })
}

const models = new Map()
const modelFor = (name) => {
    if (!models.has(name)) models.set(name, loadModel(name))
    return models.get(name)
}

/**
 * The two views of one stroke, measured (degrees, seconds): at rest, at the
 * wind-up, the blow and the end; the tip's travel at the blow; and when the
 * blow lands.
 * @param {Stroke} s
 * @param {{pose?: any, model?: ReturnType<typeof loadModel>}} [o] stand-ins for the item pose or the model (fitting)
 */
export function measure(s, { pose = undefined, model = undefined } = {}) {
    const m = model || modelFor(s.model)
    const c = clipOf(m, s.clip)
    const out = { stroke: s, clip: c ? c.name : null, rest: null, forearmRest: null, moments: {}, travel: null, blowFP: 0, blowTP: 0 }
    const fpRest = fpFrame(s.item, null)
    const tpRest = tpFrame(m, s.item, { pose })
    out.rest = angle(fpRest.axis, tpRest.axis)
    out.forearmRest = angle(fpRest.forearm, tpRest.forearm)
    if (!c || !MOTIONS[s.motion]) return out
    const fpM = fpMoments(s.motion)
    const fr = s.frames
    for (const k of ['windUp', 'blow', 'end']) {
        const a = fpFrame(s.item, s.motion, fpM[k], s.back)
        const b = tpFrame(m, s.item, { action: c.name, t: fr[k] / FPS, pose })
        out.moments[k] = { axis: angle(a.axis, b.axis), forearm: angle(a.forearm, b.forearm) }
    }
    // the tip's travel through the blow
    const dp = 0.02, dt = 1 / FPS
    const fa = fpFrame(s.item, s.motion, fpM.blow - dp, s.back).tip, fb = fpFrame(s.item, s.motion, fpM.blow + dp, s.back).tip
    const ta = tpFrame(m, s.item, { action: c.name, t: fr.blow / FPS - dt, pose }).tip
    const tb = tpFrame(m, s.item, { action: c.name, t: fr.blow / FPS + dt, pose }).tip
    out.travel = angle(fb.subtract(fa), tb.subtract(ta))
    out.blowFP = fpM.blow * MOTIONS[s.motion].time
    // as the game plays it
    out.blowTP = fr.blow / FPS / s.speed
    return out
}

/**
 * pure: a cut, not a wave (plan 13 §2.3), for a sword stroke in one view: at
 * the blow the blade is within `lean` of the forearm's line, the tip travels
 * at least `reach` times as far as the hand, and the blade lies within `flat`
 * of the plane its tip sweeps through.
 * @param {(k: 'windUp'|'blow'|'end') => {axis: Vector3, forearm: Vector3, tip: Vector3, hand: Vector3}} frameAt
 */
export function cutShape(frameAt) {
    const w = frameAt('windUp'), b = frameAt('blow'), e = frameAt('end')
    const lean = angle(b.axis, b.forearm)
    const tipPath = Vector3.Distance(w.tip, b.tip) + Vector3.Distance(b.tip, e.tip)
    const handPath = Vector3.Distance(w.hand, b.hand) + Vector3.Distance(b.hand, e.hand)
    const n = Vector3.Cross(b.tip.subtract(w.tip), e.tip.subtract(b.tip)).normalize()
    const flat = Math.asin(Math.min(1, Math.abs(Vector3.Dot(b.axis.normalize(), n)))) * DEG
    return { lean, reach: tipPath / Math.max(1e-6, handPath), flat }
}

/** the hand's own position, for cutShape: first person (the grip), third person (the socket) */
export function fpHand(item, motion, p, back = false) {
    return Vector3.TransformCoordinates(Vector3.Zero(), heldMatrix(item, motion, p, back))
}

export function tpHand(model, action, t) {
    const world = poseModel(model, { action, t })
    return toBody(Vector3.TransformCoordinates(Vector3.Zero(), world[model.index[ITEM_SOCKET]]))
}

/** cutShape for a sword stroke in both views */
export function cuts(s, { pose = undefined, model = undefined } = {}) {
    const m = model || modelFor(s.model)
    const fpM = fpMoments(s.motion)
    const c = clipOf(m, s.clip)
    const fr = s.frames
    const fp = cutShape((k) => ({ ...fpFrame(s.item, s.motion, fpM[k], s.back), hand: fpHand(s.item, s.motion, fpM[k], s.back) }))
    const tp = cutShape((k) => ({ ...tpFrame(m, s.item, { action: c.name, t: fr[k] / FPS, pose }), hand: tpHand(m, c.name, fr[k] / FPS) }))
    return { fp, tp }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
    const f = (v) => (v === null || v === undefined ? '   -' : v.toFixed(0).padStart(4))
    console.log('item           model               motion          clip              rest  arm | windUp      blow       end   (item/arm) | travel | blow s FP/TP')
    for (const s of strokes()) {
        if (args.model && s.model !== args.model) continue
        if (args.item && s.item !== args.item) continue
        const r = measure(s)
        const mo = (k) => (r.moments[k] ? `${f(r.moments[k].axis)}/${f(r.moments[k].forearm).trim()}` : '    -').padEnd(10)
        console.log(`${s.item.padEnd(14)} ${s.model.padEnd(19)} ${(s.motion + (s.back ? ' (back)' : '')).padEnd(15)} ${String(r.clip).padEnd(17)} ${f(r.rest)} ${f(r.forearmRest)} | ${mo('windUp')} ${mo('blow')} ${mo('end')} | ${f(r.travel)}   | ${r.blowFP.toFixed(2)}/${r.blowTP.toFixed(2)}`)
    }
}
