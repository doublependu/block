/*
 *  Ground fog: fog measured across the ground from a point, instead of from
 *  the camera. The aerial camera stands far back from what it shows, so fog
 *  by distance from it can't hide where the loaded land ends without fogging
 *  the town too. Measured from the point it looks at, the land fades out in a
 *  ring round it, like a diorama, whatever the camera's distance.
 *
 *  A material plugin on every standard and PBR material (registered before
 *  the engine makes any): at the end of the vertex shader it replaces the fog
 *  distance Babylon worked out, while it's on. The scene's linear fog start
 *  and end then count from the point, horizontally (Sky.setAerialFog).
 */

import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase'
import { RegisterMaterialPlugin } from '@babylonjs/core/Materials/materialPluginManager'

/** shared by every material: where the fog counts from, and whether it's on */
export const GROUND_FOG = { x: 0, z: 0, on: false }

class GroundFogPlugin extends MaterialPluginBase {
    /** @param {import('@babylonjs/core/Materials/material').Material} material */
    constructor(material) {
        super(material, 'GroundFog', 300)
        this._enable(true)
    }

    getClassName() {
        return 'GroundFogPlugin'
    }

    getUniforms() {
        return {
            ubo: [{ name: 'groundFog', size: 4, type: 'vec4' }],
            vertex: 'uniform vec4 groundFog;',
        }
    }

    bindForSubMesh(uniformBuffer) {
        uniformBuffer.updateFloat4('groundFog', GROUND_FOG.x, GROUND_FOG.z, GROUND_FOG.on ? 1 : 0, 0)
    }

    getCustomCode(shaderType) {
        if (shaderType !== 'vertex') return null
        return {
            CUSTOM_VERTEX_MAIN_END: `
                #ifdef FOG
                if (groundFog.z > 0.5) vFogDistance = vec3(length(worldPos.xz - groundFog.xy), 0.0, 0.0);
                #endif
            `,
        }
    }
}

let registered = false

/** once, before the engine makes its first material */
export function registerGroundFog() {
    if (registered) return
    registered = true
    RegisterMaterialPlugin('GroundFog', (material) => {
        const kind = material.getClassName()
        return kind === 'StandardMaterial' || kind === 'PBRMaterial' ? new GroundFogPlugin(material) : null
    })
}
