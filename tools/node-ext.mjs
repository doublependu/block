/*
 *  Lets plain node run the game's modules: they import Babylon by paths without
 *  `.js` (vite and vitest resolve those; node's ESM loader doesn't).
 *
 *  Usage: node --import ./tools/node-ext.mjs tools/hand-match.mjs
 */
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
    try {
        return await next(spec, ctx)
    } catch (e) {
        if (e.code !== 'ERR_MODULE_NOT_FOUND' || /\\.[cm]?js$/.test(spec)) throw e
        return next(spec + '.js', ctx)
    }
}`))
