/*
 *  Navigation worker: owns a NavGrid for the current world and publishes flow
 *  fields to the main thread (see navCore.js for the algorithm).
 *
 *  In:  { type: 'init', version, seed, size, blocks: [[x,y,z,id]...] }
 *       { type: 'blocks', list: [[x,y,z,id]...] }
 *  Out: { type: 'field', half, minY, W, L, nodeY, walker, digger, walkerDist, diggerDist }
 */

import { createGenerator, generatorBounds } from '../world/gen/index.js'
import { createNavGrid, fillFromGenerator } from './navCore.js'

let grid = null
let timer = null

function publish() {
    timer = null
    grid.update()
    const walker = grid.computeField(false)
    const digger = grid.computeField(true)
    const nodeY = grid.nodeY.slice()
    const post = /** @type {any} */ (self).postMessage.bind(self)
    post({
        type: 'field', half: grid.half, minY: grid.minY, W: grid.W, L: grid.L,
        nodeY, walker: walker.next, digger: digger.next,
        walkerDist: walker.dist, diggerDist: digger.dist,
    }, [nodeY.buffer, walker.next.buffer, digger.next.buffer, walker.dist.buffer, digger.dist.buffer])
}

self.onmessage = (e) => {
    const msg = e.data
    if (msg.type === 'init') {
        const { minY, maxY } = generatorBounds(msg.version)
        const gen = createGenerator(msg.version, msg.seed, msg.size)
        grid = createNavGrid({ size: msg.size, minY, maxY }, fillFromGenerator(gen, msg.size, minY, maxY))
        grid.setBlocks(msg.blocks)
        publish()
    } else if (msg.type === 'blocks' && grid) {
        grid.setBlocks(msg.list)
        if (!timer) timer = setTimeout(publish, 700)
    }
}
