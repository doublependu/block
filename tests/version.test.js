import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveCommit, versionLabel } from '../src/boot/version.js'
import { forkLine } from '../src/ui/fork.js'

describe('the version label (plan 12 §1)', () => {
    it('is v. and the first four characters of the commit', () => {
        expect(versionLabel('5ab68ff5246c3d1c68f5bb7d50f54743d35d0ada')).toBe('v.5ab6')
        expect(versionLabel('')).toBe('v.dev')
    })
    it('takes the commit from Cloudflare Workers, then Pages, then git', () => {
        const git = () => 'aaaa1111\n'
        expect(resolveCommit({ WORKERS_CI_COMMIT_SHA: 'bbbb2222', CF_PAGES_COMMIT_SHA: 'cccc3333' }, git)).toBe('bbbb2222')
        expect(resolveCommit({ CF_PAGES_COMMIT_SHA: 'cccc3333' }, git)).toBe('cccc3333')
        expect(resolveCommit({}, git)).toBe('aaaa1111')
        expect(resolveCommit({}, () => { throw new Error('not a git checkout') })).toBe('')
    })
})

describe('fork me on GitHub (plan 13 §5)', () => {
    const repo = 'https://github.com/doublependu/block'

    it('links the repository from package.json, opening a new tab', () => {
        const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
        expect(pkg.repository.url).toBe(repo)
        const html = forkLine(repo)
        expect(html).toContain(`href="${repo}"`)
        expect(html).toContain('Fork me on GitHub')
        expect(html).toContain('open source, GPL-3.0')
        expect(html).toContain('target="_blank" rel="noopener"')
        // drawn inline: no image or font to fetch
        expect(html).toContain('<svg')
        expect(html).not.toMatch(/<img|url\(/)
        expect(html.length).toBeLessThan(1400)
    })

    it('links the version to its commit in the pause panel, and shows nothing without an address', () => {
        const c = '9b1d2d6aaaa'
        expect(forkLine(repo, { commit: c, label: versionLabel(c) })).toContain(`<a href="${repo}/commit/${c}" target="_blank" rel="noopener">v.9b1d</a>`)
        expect(forkLine(repo, { commit: '', label: versionLabel('') })).toContain('· v.dev')
        expect(forkLine('')).toBe('')
    })
})
