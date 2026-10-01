/*
 *  The game's version, shown in a corner (plan 12 §1): "v." and the first four
 *  characters of the commit the build was made from.
 */

/**
 * pure: the commit a build is made from. Cloudflare's git builds say which one
 * (Workers, then Pages); a build on your own machine asks git.
 * @param {Record<string, string | undefined>} env
 * @param {() => string} gitHead
 */
export function resolveCommit(env, gitHead) {
    const fromEnv = env.WORKERS_CI_COMMIT_SHA || env.CF_PAGES_COMMIT_SHA
    if (fromEnv) return fromEnv.trim()
    try {
        return gitHead().trim()
    } catch {
        return ''
    }
}

/** pure: the label for a commit hash ("" when the build didn't know one) */
export function versionLabel(commit) {
    return commit ? `v.${commit.slice(0, 4)}` : 'v.dev'
}
