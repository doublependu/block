/*
 *  The opening raid: a scripted attack that starts every fresh survival game.
 *  It overwhelms the starting town on purpose, so the first thing a player
 *  learns is what the attackers want (the town center) and that the defences
 *  they start with aren't enough.
 */

/**
 * pure: whether a game should start with the opening raid.
 * @param {{mode: string, day: number, nightLevel: number}} def
 * @param {{resumed?: boolean, search?: string}} [o] resumed = loaded from the autosave (Continue)
 */
export function shouldPlayOpening(def, { resumed = false, search = '' } = {}) {
    if (new URLSearchParams(search).get('intro') === '0') return false
    return !resumed && def.mode === 'survival' && def.day === 1 && def.nightLevel === 1
}

/** pure: the four gate directions (the default town has a gate on each side) */
export function openingFront(rnd = Math.random) {
    return Math.floor(rnd() * 4) * (Math.PI / 2)
}

export const OPENING_TEXT = {
    start: 'Raiders are attacking your Town Center — defend it!',
    hint: 'Click or tap a defender to fight as it',
    lostTitle: 'The raiders destroyed your Town Center',
    lostText: 'Your town wasn\'t ready. The raiders will come back every night, a little stronger each time. ' +
        'Use the day to mine, craft walls, towers and troops (B), and place them around the Town Center.',
    day: 'Day 1: build your defences. The first night comes when the timer runs out, or press N / Start night.',
}
