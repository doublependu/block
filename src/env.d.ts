declare module 'virtual:world-list' {
    const worlds: Array<{
        id: string, name: string, description: string, seed: string,
        generator: { id: string, version: number }, size: number, mode: string, day: number,
        townCenter: number[], edits: number, units: number, isDefault: boolean, url: string,
    }>
    export default worlds
}

// noa is vendored plain JS; typed loosely here so the game code is checked, not the engine
declare module 'noa-engine' {
    export class Engine {
        constructor(opts?: any)
        [key: string]: any
    }
}

// the 'events' npm package (browser EventEmitter) ships no types
declare module 'events' {
    export class EventEmitter {
        on(event: string, listener: (...args: any[]) => void): this
        once(event: string, listener: (...args: any[]) => void): this
        off(event: string, listener: (...args: any[]) => void): this
        emit(event: string, ...args: any[]): boolean
        removeAllListeners(event?: string): this
    }
}

declare module 'gltf-validator'
