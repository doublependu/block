/*
 *  Turns a run's logs into report.md: each night's result and who did the
 *  killing, how the days were spent, performance over the game, and anything
 *  that went wrong.
 *
 *  Usage: node tools/autoplay/report.mjs <recording dir>
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJsonl, clock } from './video.mjs'

const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '-')
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0)

function killsBy(kills) {
    const g = { builder: 0, towers: 0, troops: 0, spikes: 0, other: 0 }
    for (const [k, v] of Object.entries(kills || {})) {
        if (k === 'builder') g.builder += v
        else if (k.startsWith('tower:')) g.towers += v
        else if (k.startsWith('troop:')) g.troops += v
        else if (k === 'spikes') g.spikes += v
        else g.other += v
    }
    return g
}

/** @param {string} dir */
export function writeReport(dir) {
    const events = readJsonl(join(dir, 'events.jsonl'))
    const tele = readJsonl(join(dir, 'telemetry.jsonl'))
    const run = existsSync(join(dir, 'run.json')) ? JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) : {}
    const video = existsSync(join(dir, 'video.json')) ? JSON.parse(readFileSync(join(dir, 'video.json'), 'utf8')) : null
    const cap = events.find((e) => e.type === 'capture')
    const zero = cap ? cap.wall : (events.find((e) => e.type === 'play') || { wall: 0 }).wall
    const at = (e) => clock(e.wall - zero)
    const L = []
    L.push(`# Autoplay run: ${run.strategy || '?'}${run.lab ? ` (lab ${run.lab})` : ''}${run.record ? ', recorded' : ''}`, '')

    const nights = events.filter((e) => e.type === 'nightOver' && !e.opening)
    const won = nights.filter((n) => n.result === 'survived')
    const maxWon = won.reduce((m, n) => Math.max(m, n.level), 0)
    L.push(`- Played ${(run.minutes || 0).toFixed(1)} min, stopped: ${run.reason || '?'}`)
    L.push(`- Nights: ${nights.length} (${won.length} won, ${nights.length - won.length} lost); highest night won: ${maxWon || 'none'}`)
    if (video) L.push(`- Video: ${video.duration.toFixed(1)} s, ${video.frames} frames, largest gap ${video.maxGap.toFixed(3)} s at ${clock(video.maxGapAt)}, ${video.gaps} gaps over 0.25 s, audio ${video.audio ? 'yes' : 'no'}`)
    L.push('')

    L.push('## Nights', '')
    L.push('| Night | At | Result | Length | Attackers | Kills: builder / towers / troops / spikes / other | Town Center lowest | Blocks lost | Towers standing | Troops | Builder knocked out | Defence value |')
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
    const raid = events.find((e) => e.type === 'nightOver' && e.opening)
    for (const n of [raid, ...nights].filter(Boolean)) {
        const k = killsBy(n.kills)
        L.push(`| ${n.opening ? 'raid' : n.level} | ${at(n)} | ${n.opening ? 'lost (scripted)' : n.result === 'survived' ? 'won' : '**lost**'} | ${n.seconds} s | ${n.spawned ?? '-'} | ${k.builder} / ${k.towers} / ${k.troops} / ${k.spikes} / ${k.other} | ${pct(n.minTown, n.townMax)} | ${sum(n.destroyed)} | ${n.towersLeft}/${n.towers} | ${n.troops ?? '-'} | ${n.builderDeaths ?? 0} | ${n.defence ?? '-'} |`)
    }
    L.push('')

    // days: what the bot did
    L.push('## Days', '')
    L.push('| Day | Starts | Work before starting the night | Crafted | Placed | Mined |')
    L.push('|---|---|---|---|---|---|')
    const phases = events.filter((e) => e.type === 'phase')
    for (let i = 0; i < phases.length; i++) {
        const p = phases[i]
        if (p.phase !== 'day') continue
        // in-page time: events sent in the same batch share a wall time
        const end = phases[i + 1] ? phases[i + 1].t : Infinity
        const inDay = events.filter((e) => e.type === 'bot' && e.t >= p.t && e.t <= end)
        const count = (what, key) => {
            const o = {}
            for (const e of inDay.filter((x) => x.what === what)) o[e[key]] = (o[e[key]] || 0) + 1
            return Object.entries(o).map(([a, b]) => `${b} ${a}`).join(', ') || '-'
        }
        const sn = inDay.find((e) => e.what === 'start-night')
        L.push(`| ${p.day} | ${at(p)} | ${sn ? sn.workSeconds + ' s (pressed N)' : 'timer'} | ${count('crafted', 'item')} | ${count('placed', 'item')} | ${count('mined', 'block')} |`)
    }
    L.push('')

    // time per activity and phase
    const act = {}
    for (const t of tele) {
        const k = `${t.phase}`
        act[k] = act[k] || {}
        act[k][t.activity] = (act[k][t.activity] || 0) + 1
    }
    L.push('## Where the time went (seconds, from telemetry)', '')
    for (const [ph, o] of Object.entries(act)) L.push(`- **${ph}**: ` + Object.entries(o).sort((a, b) => b[1] - a[1]).map(([a, b]) => `${a} ${b}`).join(', '))
    L.push('')

    // performance
    if (tele.length) {
        const fps = tele.map((t) => t.fps).filter((f) => f > 0)
        const avg = fps.reduce((a, b) => a + b, 0) / fps.length
        const sorted = [...fps].sort((a, b) => a - b)
        const low = sorted[Math.floor(sorted.length * 0.01)] || 0
        const maxFrame = Math.max(...tele.map((t) => t.maxFrame || 0))
        const over = tele.reduce((a, t) => a + (t.over50 || 0), 0)
        const heaps = tele.map((t) => t.heapMB).filter((h) => h)
        const bot = tele.reduce((a, t) => a + (t.botMs || 0), 0) / tele.length
        const tiers = [...new Set(tele.map((t) => t.tier))].join(' → ')
        L.push('## Performance', '')
        L.push(`- fps: average ${avg.toFixed(1)}, 1% low ${low.toFixed(1)}, lowest ${sorted[0].toFixed(1)}`)
        L.push(`- longest frame ${maxFrame.toFixed(0)} ms, ${over} frames over 50 ms`)
        if (heaps.length) L.push(`- JS heap: ${heaps[0]} MB at the start, ${heaps[heaps.length - 1]} MB at the end, ${Math.max(...heaps)} MB at most`)
        L.push(`- quality tier: ${tiers}; units at most ${Math.max(...tele.map((t) => t.units))}, attackers alive at most ${Math.max(...tele.map((t) => t.attackers))}`)
        L.push(`- bot: ${bot.toFixed(1)} ms of work per second on average`)
        L.push('')
    }

    // problems
    const errs = events.filter((e) => ['pageerror', 'crash', 'harness-error', 'logger-error'].includes(e.type) || (e.type === 'bot' && ['error', 'task-error'].includes(e.what)) || (e.type === 'console' && e.level === 'error'))
    const blocked = tele.length ? tele[tele.length - 1].blocked : 0
    L.push('## Problems', '')
    L.push(`- read-only view: ${blocked} blocked writes`)
    const stuck = events.filter((e) => e.type === 'bot' && (e.what === 'stuck' || e.what === 'nopath')).length
    L.push(`- bot stuck / no path: ${stuck}`)
    const locks = events.filter((e) => e.type === 'lock-click').length
    L.push(`- pointer lock clicks by the harness: ${locks}`)
    if (!errs.length) L.push('- no errors')
    for (const e of errs.slice(0, 40)) L.push(`- ${at(e)} ${e.type}${e.what ? '/' + e.what : ''}: ${(e.message || e.text || '').slice(0, 300)}`)
    L.push('')

    if (existsSync(join(dir, 'chapters.txt'))) {
        L.push('## Chapters', '', '```', readFileSync(join(dir, 'chapters.txt'), 'utf8').trim(), '```', '')
    }
    writeFileSync(join(dir, 'report.md'), L.join('\n'))
    return `nights ${won.length}/${nights.length} won, highest ${maxWon || 'none'}; ${errs.length} errors; report: ${join(dir, 'report.md')}`
}

if (process.argv[1] && process.argv[1].endsWith('report.mjs')) console.log(writeReport(process.argv[2]))
