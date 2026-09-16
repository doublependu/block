import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))
const WORLDS_DIR = r('./worlds')

/**
 * `virtual:world-list`: metadata for every worlds/*.world.json, plus a URL for
 * each file (emitted as a hashed asset, fetched only when that world is picked).
 */
function worldList() {
    const id = 'virtual:world-list'
    const rid = '\0' + id
    return {
        name: 'world-list',
        resolveId(source) {
            if (source === id) return rid
        },
        load(loadId) {
            if (loadId !== rid) return
            const files = readdirSync(WORLDS_DIR).filter((f) => f.endsWith('.world.json')).sort()
            const imports = []
            const entries = []
            files.forEach((file, i) => {
                const full = join(WORLDS_DIR, file)
                this.addWatchFile(full)
                const o = JSON.parse(readFileSync(full, 'utf8'))
                imports.push(`import url${i} from '/worlds/${file}?url'`)
                const meta = {
                    id: file.replace(/\.world\.json$/, ''),
                    name: o.name, description: o.description || '', seed: o.seed,
                    generator: o.generator, size: o.size, mode: o.mode, day: o.day,
                    townCenter: o.townCenter, edits: (o.edits || []).length, units: (o.units || []).length,
                    isDefault: file === 'default.world.json',
                }
                entries.push(`{ ...${JSON.stringify(meta)}, url: url${i} }`)
            })
            return `${imports.join('\n')}\nexport default [${entries.join(',\n')}]\n`
        },
        configureServer(server) {
            server.watcher.add(WORLDS_DIR)
            const reload = (file) => {
                if (!file.endsWith('.world.json')) return
                const mod = server.moduleGraph.getModuleById(rid)
                if (mod) server.moduleGraph.invalidateModule(mod)
                server.ws.send({ type: 'full-reload' })
            }
            server.watcher.on('add', reload)
            server.watcher.on('unlink', reload)
            server.watcher.on('change', reload)
        },
    }
}

export default defineConfig({
    base: './',
    plugins: [worldList()],
    resolve: {
        alias: {
            'noa-engine': r('./vendor/noa/src/index.js'),
        },
        dedupe: ['@babylonjs/core'],
    },
    worker: {
        format: 'es',
    },
    build: {
        target: 'es2022',
        manifest: true,
        chunkSizeWarningLimit: 1400,
        assetsInlineLimit: 0,
        modulePreload: { polyfill: false },
    },
    server: { port: 5173, host: '0.0.0.0' },
})
