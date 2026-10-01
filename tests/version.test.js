import { describe, it, expect } from 'vitest'
import { resolveCommit, versionLabel } from '../src/boot/version.js'

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
