/*
 *  Navigation worker: owns a NavGrid for the current world and publishes flow
 *  fields to the main thread (see navCore.js for the algorithm).
 *
 *  In:  { type: 'init', version, seed, size, town, blocks: [[x,y,z,id]...] }
 *       { type: 'blocks', list: [[x,y,z,id]...] }
 *       { type: 'siege', walls: boolean }   walls count as siege goals (opening raid)
 *  Out: { type: 'field', half, minY, W, L, nodeY, walker, digger, walkerDist, diggerDist,
 *         siege, siegeDist (null when there is nothing to besiege), ms }
 */

import { createGenerator, generatorBounds } from '../world/gen/index.js'
import { createNavGrid, fillFromGenerator } from './navCore.js'

let grid = null
let timer = null
let walls = false

function publish() {
    timer = null
    const t0 = performance.now()
    grid.update()
    const walker = grid.computeField('walker')
    const digger = grid.computeField('digger')
    const siege = grid.hasTowers || walls ? grid.computeField('siege', { walls }) : null
    const nodeY = grid.nodeY.slice()
    const post = /** @type {any} */ (self).postMessage.bind(self)
    const transfer = [nodeY.buffer, walker.next.buffer, digger.next.buffer, walker.dist.buffer, digger.dist.buffer]
    if (siege) transfer.push(siege.next.buffer, siege.dist.buffer)
    post({
        type: 'field', half: grid.half, minY: grid.minY, W: grid.W, L: grid.L,
        nodeY, walker: walker.next, digger: digger.next,
        walkerDist: walker.dist, diggerDist: digger.dist,
        siege: siege ? siege.next : null, siegeDist: siege ? siege.dist : null,
        ms: performance.now() - t0,
    }, transfer)
}

function schedule(delay) {
    if (!timer) timer = setTimeout(publish, delay)
}

self.onmessage = (e) => {
    const msg = e.data
    if (msg.type === 'init') {
        const { minY, maxY } = generatorBounds(msg.version)
        const gen = createGenerator(msg.version, msg.seed, msg.size)
        grid = createNavGrid({ size: msg.size, minY, maxY, town: msg.town }, fillFromGenerator(gen, msg.size, minY, maxY))
        grid.setBlocks(msg.blocks)
        publish()
    } else if (msg.type === 'blocks' && grid) {
        grid.setBlocks(msg.list)
        schedule(700)
    } else if (msg.type === 'siege') {
        if (walls === !!msg.walls) return
        walls = !!msg.walls
        if (grid) schedule(50)
    }
}
