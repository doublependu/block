/*
 *  Defence towers: tower blocks (from world edits) get a rotating head that
 *  fires at attackers. Tower registry follows world state, not chunk loading,
 *  so towers keep working anywhere in the play area.
 */

import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { TOWERS } from './balance.js'
import { BLOCK_BY_ID } from '../world/blocks.js'
import { lerpAngle } from './units.js'

export class Towers {
    /**
     * @param {object} ctx
     * @param {import('noa-engine').Engine} ctx.noa
     * @param {import('../world/worldState.js').WorldState} ctx.world
     * @param {import('./units.js').UnitManager} ctx.units
     * @param {import('./effects.js').Effects} ctx.effects
     */
    constructor({ noa, world, units, effects }) {
        this.noa = noa
        this.world = world
        this.units = units
        this.effects = effects
        /** @type {Map<string, any>} */
        this.towers = new Map()
        const scene = noa.rendering.getScene()
        const mat = (name, c) => {
            const m = noa.rendering.makeStandardMaterial(name)
            m.diffuseColor = new Color3(c[0], c[1], c[2])
            m.freeze()
            return m
        }
        this.mats = { wood: mat('tower-wood', [0.55, 0.4, 0.24]), metal: mat('tower-metal', [0.25, 0.26, 0.3]), string: mat('tower-string', [0.9, 0.88, 0.8]) }
        this.scene = scene

        world.edits.forEach((x, y, z, id) => this._check(x, y, z, id))
        world.on('blockChanged', (x, y, z, id, prev) => {
            const key = `${x},${y},${z}`
            if (BLOCK_BY_ID[prev]?.tower && this.towers.has(key)) {
                const t = this.towers.get(key)
                // destroyed at night: keep the entry, deactivate until restored
                if (world.damage.has(x, y, z)) this._setActive(t, false)
                else this._remove(key)
            }
            this._check(x, y, z, id)
        })
    }

    get count() {
        return this.towers.size
    }

    /** towers standing right now (destroyed ones come back at dawn) */
    get activeCount() {
        let n = 0
        for (const t of this.towers.values()) if (t.active) n++
        return n
    }

    get list() {
        return [...this.towers.values()]
    }

    _check(x, y, z, id) {
        const b = BLOCK_BY_ID[id]
        if (!b || !b.tower) return
        const key = `${x},${y},${z}`
        const existing = this.towers.get(key)
        if (existing) {
            this._setActive(existing, true)
            return
        }
        const spec = TOWERS[b.tower]
        const head = this._makeHead(b.tower, key)
        head.position.set(x + 0.5, y + 1, z + 0.5)
        this.towers.set(key, { key, x, y, z, type: b.tower, spec, head, cooldown: Math.random(), yaw: 0, active: true })
    }

    _makeHead(type, key) {
        const root = new TransformNode('tower-' + key, this.scene)
        const add = (mesh, mat) => {
            mesh.material = mat
            mesh.parent = root
            mesh.isPickable = false
            this.noa.rendering.addMeshToScene(mesh)
            return mesh
        }
        if (type === 'arrow') {
            const post = add(CreateBox('t', { width: 0.2, height: 0.45, depth: 0.2 }, this.scene), this.mats.wood)
            post.position.y = 0.22
            const bow = add(CreateBox('t', { width: 0.9, height: 0.1, depth: 0.12 }, this.scene), this.mats.wood)
            bow.position.set(0, 0.5, 0.15)
            const stock = add(CreateBox('t', { width: 0.12, height: 0.12, depth: 0.8 }, this.scene), this.mats.metal)
            stock.position.set(0, 0.5, 0)
            const str = add(CreateBox('t', { width: 0.85, height: 0.03, depth: 0.03 }, this.scene), this.mats.string)
            str.position.set(0, 0.5, -0.05)
        } else {
            const base = add(CreateCylinder('t', { diameter: 0.8, height: 0.3, tessellation: 10 }, this.scene), this.mats.wood)
            base.position.y = 0.15
            const barrel = add(CreateCylinder('t', { diameter: 0.35, height: 1.1, tessellation: 10 }, this.scene), this.mats.metal)
            barrel.rotation.x = Math.PI / 2 - 0.25
            barrel.position.set(0, 0.5, 0.25)
        }
        root.metadata = { meshes: root.getChildMeshes() }
        return root
    }

    _setActive(t, active) {
        t.active = active
        for (const m of t.head.metadata.meshes) this.noa.rendering.setMeshVisibility(m, active)
    }

    _remove(key) {
        const t = this.towers.get(key)
        if (!t) return
        t.head.dispose(false, false)
        this.towers.delete(key)
    }

    /** @param {number} dt seconds */
    tick(dt) {
        if (!this.units.combat) return
        for (const t of this.towers.values()) {
            if (!t.active) continue
            t.cooldown -= dt
            const from = [t.x + 0.5, t.y + 1.5, t.z + 0.5]
            if (t.cooldown > 0 && t.target && t.target.alive) {
                const q = this.units.posOf(t.target)
                t.yaw = lerpAngle(t.yaw, Math.atan2(q[0] - from[0], q[2] - from[2]), Math.min(1, dt * 8))
                t.head.rotation.y = t.yaw
                continue
            }
            if (t.cooldown > 0) continue
            // find nearest attacker in range and sight
            let best = null, bestD = t.spec.range * t.spec.range
            for (const u of this.units.units) {
                if (!u.alive || !u.active || u.side !== 'attacker') continue
                const q = this.units.posOf(u)
                const d = (q[0] - from[0]) ** 2 + (q[1] - from[1]) ** 2 + (q[2] - from[2]) ** 2
                if (d < bestD && this.units.lineOfSight(from, [q[0], q[1] + 1, q[2]])) {
                    bestD = d
                    best = u
                }
            }
            t.target = best
            if (!best) {
                t.cooldown = 0.3
                continue
            }
            t.cooldown = t.spec.cooldown
            const q = this.units.posOf(best)
            // lead the target a little
            const body = this.noa.entities.getPhysics(best.entity)?.body
            const lead = Math.sqrt(bestD) / 25
            const aim = [q[0] + (body ? body.velocity[0] * lead : 0), q[1] + best.height * 0.5, q[2] + (body ? body.velocity[2] * lead : 0)]
            this.effects.fire(t.spec.projectile, from, aim, { damage: t.spec.damage, side: 'defender', owner: t })
            this.units.emit('towerFired', t)
        }
    }

    dispose() {
        for (const key of [...this.towers.keys()]) this._remove(key)
    }
}
