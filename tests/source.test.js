import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname

function files(dir) {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        return statSync(full).isDirectory() ? files(full) : full.endsWith('.js') ? [full] : []
    })
}

/** a line that would be read as part of the one before it, with no semicolon in between */
const STARTS_CONTINUATION = /^\s*(\(|\[|`|\/\*\*.*\*\/\s*\()/
/** the line before ends a statement that could go on (a name, a call, an index, a string) */
const ENDS_OPEN = /[\w$)\]'"]$/

/**
 * pure: lines where automatic semicolon insertion joins two statements, e.g.
 *   a.b = c
 *   /** @type {X} *\/ (el).checked = d      →  a.b = c(el).checked = d
 * Template literal bodies are skipped.
 */
function asiHazards(text) {
    const out = []
    let prev = ''
    let inTemplate = false
    text.split('\n').forEach((line, i) => {
        const wasInTemplate = inTemplate
        // backticks outside quotes and comments toggle a template literal (good enough for this code)
        const code = line.replace(/\/\/.*$/, '').replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""')
        for (const ch of code) if (ch === '`') inTemplate = !inTemplate
        if (wasInTemplate) return
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') && !STARTS_CONTINUATION.test(line)) return
        if (STARTS_CONTINUATION.test(line) && ENDS_OPEN.test(prev)) out.push(i + 1)
        prev = code.trim()
    })
    return out
}

describe('source', () => {
    it('finds the pattern', () => {
        expect(asiHazards('a.b = c\n/** @type {X} */ (el).checked = d')).toEqual([2])
        expect(asiHazards('f(x)\n[1, 2].forEach(g)')).toEqual([2])
        expect(asiHazards('a = b;\n(c)')).toEqual([])
        expect(asiHazards('f(\n    (x) => x,\n)')).toEqual([])
        expect(asiHazards('const t = `\n(not code)\n`')).toEqual([])
    })

    it('has no statement that runs into the line before it', () => {
        const found = []
        for (const f of files(SRC)) {
            for (const n of asiHazards(readFileSync(f, 'utf8'))) found.push(`${relative(SRC, f)}:${n}`)
        }
        expect(found).toEqual([])
    })
})
