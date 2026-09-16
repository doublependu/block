/*
 *  Quality tiers. A tier is picked at startup from device hints, can be
 *  forced with ?quality=low|med|high, and is stepped down at runtime by the
 *  FPS governor when the frame rate stays low.
 */

export const TIERS = {
    low: {
        name: 'low',
        chunkAddDistance: [2, 1.5],
        chunkRemoveDistance: [2.8, 2],
        hardwareScaling: 1.35,
        useAO: false,
        maxAnimated: 12,
        maxAttackers: 28,
        particles: 0.35,
        fogEnd: 52,
    },
    med: {
        name: 'med',
        chunkAddDistance: [2.5, 1.5],
        chunkRemoveDistance: [3.3, 2.2],
        hardwareScaling: 1,
        useAO: true,
        maxAnimated: 24,
        maxAttackers: 45,
        particles: 0.7,
        fogEnd: 64,
    },
    high: {
        name: 'high',
        chunkAddDistance: [3.5, 2],
        chunkRemoveDistance: [4.3, 2.7],
        hardwareScaling: 1 / Math.min(window.devicePixelRatio || 1, 1.5),
        useAO: true,
        maxAnimated: 48,
        maxAttackers: 70,
        particles: 1,
        fogEnd: 90,
    },
}

const ORDER = ['low', 'med', 'high']

export function isTouchDevice() {
    return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ||
        (navigator.maxTouchPoints || 0) > 0 && !matchMedia('(pointer: fine)').matches
}

export function isWeakGpu(renderer) {
    return /mali-[gt]?[0-9]{2}\b|mali-4|adreno \(tm\) [2-5]\d\d|powervr|swiftshader|llvmpipe|software/i.test(String(renderer))
}

/**
 * Pick a tier from cheap device hints. Deliberately does NOT create a WebGL
 * context (that can cost a second at startup); pass the renderer string once
 * the engine exists to refine the choice.
 * @param {string} [gpuRenderer]
 */
export function detectTier(gpuRenderer = '') {
    const forced = new URLSearchParams(location.search).get('quality')
    if (forced && TIERS[forced]) return TIERS[forced]
    const touch = isTouchDevice()
    const cores = navigator.hardwareConcurrency || 4
    // @ts-ignore deviceMemory is Chromium-only
    const mem = navigator.deviceMemory || 4
    const weakGpu = isWeakGpu(gpuRenderer)
    let score = 0
    if (!touch) score += 2
    if (cores >= 8) score += 1
    if (mem >= 8) score += 1
    if (weakGpu) score -= 2
    const tier = score >= 4 ? 'high' : score >= 2 ? 'med' : 'low'
    return TIERS[tier]
}

/** next lower tier, or null */
export function lowerTier(tier) {
    const i = ORDER.indexOf(tier.name)
    return i > 0 ? TIERS[ORDER[i - 1]] : null
}
