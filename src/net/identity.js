/*
 *  IdentityService - login, profile and avatar (character GLB) lookup.
 *
 *  The generic identity server knows nothing about this game: a profile is a
 *  display name plus an optional avatar GLB URL that must follow
 *  docs/character-contract.md.
 */

/**
 * @typedef {object} Profile
 *  @property {string} id
 *  @property {string} displayName
 *  @property {{glbUrl: string} | null} avatar
 */

/**
 * @typedef {object} IdentityService
 *  @property {boolean} online
 *  @property {() => Promise<Profile>} getProfile
 *  @property {() => Promise<{id: string, name: string, glbUrl: string}[]>} listAvatars
 */

const LOCAL_KEY = 'block.profile'

/** @implements {IdentityService} */
export class LocalIdentity {
    constructor() {
        this.online = false
    }

    async getProfile() {
        let saved = {}
        try {
            saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}')
        } catch { /* storage unavailable */ }
        const avatarUrl = new URLSearchParams(location.search).get('avatar')
        return {
            id: 'local',
            displayName: saved.displayName || 'Player',
            avatar: avatarUrl ? { glbUrl: avatarUrl } : saved.avatar || null,
        }
    }

    async listAvatars() {
        return []
    }
}
