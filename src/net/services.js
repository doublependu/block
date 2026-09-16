/*
 *  Service discovery. Reads optional `config.json` next to index.html:
 *
 *    { "identityUrl": "https://id.example.com", "syncUrl": "wss://sync.example.com", "gameId": "block" }
 *
 *  Probing happens in the background after first render and never delays
 *  startup. If nothing is configured or the servers don't answer, the game
 *  stays single player with local services.
 */

import { LocalSync } from './sync.js'
import { LocalIdentity } from './identity.js'

const PROBE_TIMEOUT_MS = 1500

export function localServices() {
    return { identity: new LocalIdentity(), sync: new LocalSync(), online: false, config: null }
}

async function fetchWithTimeout(url, ms) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), ms)
    try {
        return await fetch(url, { signal: ctl.signal, cache: 'no-store' })
    } finally {
        clearTimeout(t)
    }
}

/**
 * Look for configured servers. Resolves to { config, reachable } and never rejects.
 */
export async function probeServices() {
    let config = null
    try {
        const res = await fetchWithTimeout('./config.json', PROBE_TIMEOUT_MS)
        if (res.ok) config = await res.json()
    } catch { /* no config: single player */ }
    if (!config || !config.identityUrl) return { config, reachable: false }
    try {
        const res = await fetchWithTimeout(config.identityUrl.replace(/\/$/, '') + '/health', PROBE_TIMEOUT_MS)
        return { config, reachable: res.ok }
    } catch {
        return { config, reachable: false }
    }
}
