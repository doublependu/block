/*
 *  Minimal IndexedDB key-value store (autosave). All calls resolve, never
 *  reject: storage can be unavailable (private mode, blocked site data).
 */

const DB = 'block'
const STORE = 'kv'

function open() {
    return new Promise((resolve) => {
        try {
            const req = indexedDB.open(DB, 1)
            req.onupgradeneeded = () => req.result.createObjectStore(STORE)
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => resolve(null)
        } catch {
            resolve(null)
        }
    })
}

export async function idbGet(key) {
    const db = await open()
    if (!db) return undefined
    return new Promise((resolve) => {
        try {
            const req = db.transaction(STORE).objectStore(STORE).get(key)
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => resolve(undefined)
        } catch {
            resolve(undefined)
        }
    })
}

export async function idbSet(key, value) {
    const db = await open()
    if (!db) return false
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE, 'readwrite')
            tx.objectStore(STORE).put(value, key)
            tx.oncomplete = () => resolve(true)
            tx.onerror = () => resolve(false)
        } catch {
            resolve(false)
        }
    })
}

export async function idbDelete(key) {
    const db = await open()
    if (!db) return false
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE, 'readwrite')
            tx.objectStore(STORE).delete(key)
            tx.oncomplete = () => resolve(true)
            tx.onerror = () => resolve(false)
        } catch {
            resolve(false)
        }
    })
}
