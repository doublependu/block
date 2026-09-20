/*
 *  Entry point, injected into the page before the game loads (run.mjs).
 *  Sets up tab capture at once (it starts at the menu), then waits for the
 *  game to be playable and starts the logger and the bot.
 */

import { installCapture } from './capture.js'
import { Logger } from './log.js'
import { Bot } from './bot.js'
import { PlayStrategy } from './play.js'
import { FullStrategy } from './full.js'
import { IdleStrategy } from './idle.js'
import { SkillTests } from './tests.js'

const w = /** @type {any} */ (window)
const config = w.__AP_CONFIG || {}
installCapture()

let bot = null
let logger = null
let labReady = !config.lab

w.__ap = {
    status: () => (bot ? bot.status() : { phase: 'menu', needLock: false, done: null, survived: 0, nights: 0, activity: 'menu' }),
    flush: () => logger && logger.flush(),
    labReady: () => {
        labReady = true
    },
}

function boot() {
    if (!w.game || !w.__timings || !(w.__timings.playable > 0)) {
        setTimeout(boot, 100)
        return
    }
    logger = new Logger(w.game)
    logger.start()
    bot = new Bot(w.game, logger)
    logger.bot = bot
    bot.start()
    const pick = () => {
        if (!labReady) {
            setTimeout(pick, 100)
            return
        }
        const [name, arg] = (config.lab || '').split(':')
        try {
            if (name === 'siege') {
                // one night against a saved town: watch it, and stop when it's over
                w.game.cycle.on('nightOver', () => setTimeout(() => (bot.done = 'siege-done'), 1500))
            }
            bot.strategy = name === 'skills' ? new SkillTests(bot, arg)
                : config.strategy === 'idle' || name === 'siege' ? new IdleStrategy(bot)
                    : config.strategy === 'towers' ? new PlayStrategy(bot) : new FullStrategy(bot)
            bot.note('strategy', { name: name || config.strategy })
        } catch (err) {
            bot.note('error', { message: 'strategy: ' + String(err && err.message), stack: String(err && err.stack) })
        }
    }
    pick()
}

if (location.protocol.startsWith('http')) boot()
