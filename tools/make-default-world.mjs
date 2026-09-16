// Regenerates worlds/default.world.json from src/world/defaultWorld.js
import { writeFileSync } from 'node:fs'
import { buildDefaultWorld } from '../src/world/defaultWorld.js'
import { serializeWorld } from '../src/world/worldFile.js'

const def = buildDefaultWorld()
const out = new URL('../worlds/default.world.json', import.meta.url)
writeFileSync(out, serializeWorld(def))
console.log(`wrote ${out.pathname}: ${def.edits.length} edits, ${def.units.length} units`)
