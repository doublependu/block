/*
 *  First person is the body itself (plan 14): whoever you control, the same
 *  model, clips and item as from outside, carried by the camera. Nothing here
 *  moves the body; it only decides where it's seen from.
 *
 *    - The body hangs from a node on the camera, so it turns with the view,
 *      up and down too: looking up or down never loses what's in your hand.
 *    - It sits so the camera sees it from the vantage (fpView.js), a little
 *      behind your eye: from the eye itself, a hand where a body holds it is
 *      below the screen. The world is still seen from the eye.
 *    - Only its arms and the item are drawn, after the world with its own depth
 *      clear (library.js setFirstPerson), so they never go into a wall.
 *
 *  Changing what you hold dips the whole body out of view and back: a camera
 *  move, not a pose.
 */

import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { RENDER_GROUP } from '../core/constants.js'
import { vantage, HEAD_HEIGHT } from './fpView.js'

/** changing item: the body dips this far below the view and comes back up, over this long */
const EQUIP = { time: 0.24, dip: 0.35 }

const smooth = (x) => {
    const k = Math.max(0, Math.min(1, x))
    return k * k * (3 - 2 * k)
}

export class FirstPerson {
    /** @param {import('noa-engine').Engine} noa */
    constructor(noa) {
        this.noa = noa
        const scene = noa.rendering.getScene()
        // last group, with its own depth clear: the hands never poke into a wall
        scene.setRenderingAutoClearDepthStencil(RENDER_GROUP.hands, true, true, false)
        this.anchor = new TransformNode('first-person', scene)
        this.anchor.parent = noa.rendering.camera
        /** @type {import('../characters/library.js').CharacterInstance | null} */
        this.char = null
        this._equip = 1
    }

    /**
     * Carry this body (null: none, the view is from outside or from above).
     * @param {import('../characters/library.js').CharacterInstance | null} char
     */
    set(char) {
        if (this.char === char) return
        if (this.char) {
            this.char.setFirstPerson(null)
            this.char.gleams = false
        }
        this.char = char
        if (char) {
            char.setFirstPerson(this.anchor)
            char.gleams = true
        }
    }

    /** the new item comes up into view */
    equip() {
        this._equip = 0
    }

    /** @param {number} dt seconds */
    render(dt) {
        const c = this.char
        if (!c) return
        this._equip = Math.min(1, this._equip + dt / EQUIP.time)
        const v = vantage(c.head || HEAD_HEIGHT, window.innerWidth / Math.max(1, window.innerHeight))
        this.anchor.position.set(-v[0], -v[1] - EQUIP.dip * (1 - smooth(this._equip)), -v[2])
    }
}
