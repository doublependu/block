/*
 *  The idle baseline: builds nothing, starts every night straight away and
 *  watches it from above while the builder fights on autopilot. Shows how far
 *  the starting town gets with no player.
 */

export class IdleStrategy {
    /** @param {import('./bot.js').Bot} bot */
    constructor(bot) {
        this.bot = bot
        this.see = bot.see
    }

    want() {
        const s = this.see
        if (s.opening) return { key: 'raid', run: () => this.rest() }
        if (s.phase === 'day') return { key: `day:${s.day}`, run: () => this.day() }
        if (s.phase === 'dusk' || s.phase === 'night') return { key: `night:${s.activeLevel}`, run: () => this.watch() }
        return { key: `dawn:${s.day}`, run: () => this.rest() }
    }

    roleChoice() {
        return 'aerial'
    }

    async rest() {
        for (;;) await this.bot.wait(1)
    }

    async day() {
        await this.bot.wait(3)
        if (this.see.phase === 'day') this.bot.input.tap('KeyN')
        await this.rest()
    }

    async watch() {
        await this.bot.wait(1)
        if (this.see.mode === 'self') this.bot.input.tap('KeyM')
        await this.rest()
    }
}
