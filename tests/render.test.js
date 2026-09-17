import { describe, it, expect } from 'vitest'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { AssetContainer } from '@babylonjs/core/assetContainer'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { SceneOctreeManager } from '../vendor/noa/src/lib/sceneOctreeManager.js'

function setup() {
    const engine = new NullEngine()
    const scene = new Scene(engine)
    const rendering = {
        scene,
        noa: { world: { _chunkSize: 24 }, globalToLocal: (g, _, out) => Object.assign(out, g) },
    }
    const manager = new SceneOctreeManager(rendering, 2)
    return { scene, manager, dynamic: scene._selectionOctree.dynamicContent }
}

describe('noa scene octree manager', () => {
    // regression: clones share their source's metadata object, and noa used to keep its
    // "added to scene" flags there, so only the first clone of a character ever rendered
    it('renders every clone of a model', () => {
        const { scene, manager, dynamic } = setup()
        const container = new AssetContainer(scene)
        const root = new TransformNode('root', scene)
        const body = CreateBox('body', {}, scene)
        body.parent = root
        body.metadata = { fromGltf: true }
        container.transformNodes.push(root)
        container.meshes.push(body)
        container.removeAllFromScene()

        const clones = []
        for (let i = 0; i < 3; i++) {
            const entries = container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true })
            clones.push(entries.rootNodes[0].getChildMeshes(false)[0])
        }
        // the premise of the bug: clones do share one metadata object
        expect(clones[1].metadata).toBe(clones[0].metadata)

        for (const m of clones) manager.addMesh(m, false, null, null)
        expect(clones.every((m) => dynamic.includes(m))).toBe(true)

        manager.removeMesh(clones[0])
        expect(dynamic.includes(clones[0])).toBe(false)
        expect(dynamic.includes(clones[1]) && dynamic.includes(clones[2])).toBe(true)

        manager.setMeshVisibility(clones[1], false)
        expect(dynamic.includes(clones[1])).toBe(false)
        expect(dynamic.includes(clones[2])).toBe(true)
        manager.setMeshVisibility(clones[1], true)
        expect(dynamic.filter((m) => m === clones[1]).length).toBe(1)
    })
})
