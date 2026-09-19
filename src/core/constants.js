/* Constants shared by the boot code and the game (kept dependency-free). */

export const CHUNK_SIZE = 24

/**
 * Babylon rendering groups, drawn in this order:
 *   world    terrain, units, effects
 *   overlay  health bars and rebuild ghosts: after the whole world, tested
 *            against its depth (so hills hide them) but never writing any
 *   hands    the first-person view model, over everything (own depth clear)
 */
export const RENDER_GROUP = { world: 0, overlay: 1, hands: 2 }
