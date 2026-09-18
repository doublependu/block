/*
 *  Player settings that outlive a session (localStorage). Storage can be
 *  unavailable (private mode, blocked site data), so every access is guarded
 *  and falls back to the defaults.
 */

const KEY = 'block.settings'

export const DEFAULT_SETTINGS = {
    /** health bars over units */
    hpBars: true,
    muted: false,
    fps: false,
}

/** @type {typeof DEFAULT_SETTINGS | null} */
let cache = null

function read() {
    if (cache) return cache
    cache = { ...DEFAULT_SETTINGS }
    try {
        Object.assign(cache, JSON.parse(localStorage.getItem(KEY) || '{}'))
    } catch {
        // no storage: defaults
    }
    // ?hpbars=0 / ?fps for test runs; not saved
    try {
        const q = new URLSearchParams(location.search)
        if (q.has('hpbars')) cache.hpBars = q.get('hpbars') !== '0'
        if (q.has('fps')) cache.fps = q.get('fps') !== '0'
    } catch {
        // no location (tests)
    }
    return cache
}

/** @param {keyof typeof DEFAULT_SETTINGS} name */
export function getSetting(name) {
    const v = read()[name]
    return v === undefined ? DEFAULT_SETTINGS[name] : v
}

/** @param {keyof typeof DEFAULT_SETTINGS} name */
export function setSetting(name, value) {
    read()[name] = value
    try {
        localStorage.setItem(KEY, JSON.stringify(cache))
    } catch {
        // not saved, but it still applies for this session
    }
}

/** for tests */
export function resetSettings() {
    cache = null
}
