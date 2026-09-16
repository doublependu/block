/*
 *  noa engine construction with this game's defaults.
 */

import { Engine } from 'noa-engine'
import { REACH } from '../game/balance.js'
import { registerBlocks } from '../world/registerBlocks.js'

import { CHUNK_SIZE } from '../core/constants.js'

/**
 * @param {HTMLElement} container
 * @param {typeof import('./quality.js').TIERS.med} tier
 */
export function createEngine(container, tier) {
    const noa = new Engine({
        domElement: container,
        debug: false,
        silent: true,
        silentBabylon: true,
        showFPS: new URLSearchParams(location.search).has('fps'),
        chunkSize: CHUNK_SIZE,
        chunkAddDistance: tier.chunkAddDistance,
        chunkRemoveDistance: tier.chunkRemoveDistance,
        playerStart: [0.5, 40, 0.5],
        playerHeight: 1.75,
        playerWidth: 0.6,
        playerAutoStep: true,
        playerShadowComponent: true,
        blockTestDistance: REACH,
        useAO: tier.useAO,
        AOmultipliers: [0.92, 0.78, 0.55],
        reverseAOmultiplier: 1.0,
        clearColor: [0.62, 0.8, 0.97],
        ambientColor: [0.62, 0.62, 0.66],
        lightDiffuse: [0.95, 0.93, 0.86],
        lightSpecular: [0, 0, 0],
        lightVector: [0.45, -1, 0.3],
        antiAlias: tier.name !== 'low',
        preserveDrawingBuffer: false,
        stickyPointerLock: true,
        dragCameraOutsidePointerLock: true,
        // worlds are at most 256 blocks wide, so float precision is never an issue:
        // disable origin rebasing and keep mesh positions in world coordinates
        originRebaseDistance: 1e9,
        tickRate: 30,
        inverseY: false,
        sensitivityX: 12,
        sensitivityY: 12,
        initialZoom: 0,
    })
    noa.rendering.engine.setHardwareScalingLevel(tier.hardwareScaling)
    const atlasURL = registerBlocks(noa)
    return { noa, atlasURL }
}
