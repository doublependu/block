/*
 *  A long recorded game that can be stopped and carried on (plan 12: the ice
 *  palace is 5+ hours of play). It runs tools/autoplay/run.mjs in parts: when
 *  a part ends before the game is finished (the page died, the machine slept,
 *  you stopped it), the next part continues from the newest dawn checkpoint,
 *  with what the bot knew then. Run the same command again and it carries on
 *  from where it stopped.
 *
 *  Usage:
 *    node tools/autoplay/long-run.mjs --out=<dir> [run.mjs arguments for a new game]
 *        e.g. --out=recordings/palace12 --seed=ice-palace-3618 --name="Ice Palace" --size=256
 *             --lives=unlimited --strategy=palace --record
 *    --status         what has been played so far (nights, days, where it is now), and stop
 *    --post           encode the parts the cut keeps (game.mp4), and stop
 *    --max-restarts   give up after this many parts (default 40)
 *    --no-build       use the existing dist/ (the first part builds it otherwise)
 *    --part-minutes=<m>  a new part at the first dawn after m minutes (run.mjs): each finished part
 *                     is encoded in the background while the next one plays, so the end doesn't wait
 *                     hours for one long encode
 *    --encode-cores=<list>  the cores those encodes may use (taskset, default 4-15; "all" for no limit)
 *    --encode-preset=<p>    x264's preset for the parts' game.mp4 (default medium: the cut encodes again)
 *
 *  To stop it: Ctrl-C (or SIGTERM), or `touch <dir>/STOP`. The part being
 *  played is closed properly; what was played since the last dawn is played
 *  again next time.
 *
 *  Output: <dir>/part-01, part-02, … (one run.mjs output each), <dir>/parts.json
 *  (which parts the cut keeps and where each ends), and <dir>/DONE when the
 *  game is finished. tools/autoplay/edit.mjs takes the kept parts, in order.
 */

import { spawn, execSync, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { readJsonl, clock } from './video.mjs'

/** what a part's run.mjs reports when the game itself is over (anything else is carried on from) */
const FINISHED = new Set(['palace exported', 'castle exported', 'game over', 'time', 'siege-done'])
/** arguments that start a new game: a part continued from a checkpoint leaves them out */
const FRESH_ONLY = new Set(['seed', 'name', 'size', 'lives', 'resume'])
/** a part shorter than this (seconds played) counts as a failed start */
const SHORT = 120

/**
 * pure: the checkpoint to continue from: the last day of the newest part that has one.
 * @param {{dir: string, checkpoints: {day: number}[]}[]} parts in order
 * @returns {{dir: string, day: number} | null}
 */
export function pickCheckpoint(parts) {
    for (let i = parts.length - 1; i >= 0; i--) {
        const days = parts[i].checkpoints.map((c) => c.day)
        if (days.length) return { dir: parts[i].dir, day: Math.max(...days) }
    }
    return null
}

/**
 * pure: where the cut ends each part, and which parts it keeps. A part ends
 * where the checkpoint the next one continued from was taken (what it played
 * after that was played again); a part that never got that far is left out.
 * @param {{dir: string, resumedDay: number | null, playable: number | null, end: number, checkpoints: {day: number, wall: number}[]}[]} parts
 *   in order; times in the part's own seconds
 * @returns {{dir: string, from: number, to: number, kept: boolean}[]}
 */
export function cutParts(parts) {
    return parts.map((p, i) => {
        const next = parts.slice(i + 1).find((q) => q.resumedDay !== null)
        const cut = next ? p.checkpoints.find((c) => c.day === next.resumedDay) : null
        // (a later part continued from a day this one never reached: this one was replayed whole)
        const replayed = next && !cut && p.resumedDay !== null && next.resumedDay <= p.resumedDay
        const from = p.playable ?? p.end
        const to = replayed ? from : cut ? Math.min(p.end, cut.wall) : p.end
        return { dir: p.dir, from, to, kept: p.playable !== null && to - from > 3 }
    })
}

/** the parts of a long run, as their logs tell it */
export function loadParts(out) {
    if (!existsSync(out)) return []
    return readdirSync(out).filter((d) => /^part-\d+$/.test(d)).sort().map((d) => {
        const dir = join(out, d)
        const events = readJsonl(join(dir, 'events.jsonl'))
        const run = existsSync(join(dir, 'run.json')) ? JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) : null
        const resume = events.find((e) => e.type === 'resume')
        const m = resume ? String(resume.file).match(/day-(\d+)\.save\.json$/) : null
        const playable = events.find((e) => e.type === 'playable')
        // only checkpoints whose files are there (a part killed mid-write); looked for in the part's
        // own folder, so a run can be moved or renamed afterwards
        const checkpoints = events.filter((e) => e.type === 'checkpoint' && existsSync(join(dir, 'checkpoints', `day-${e.day}.save.json`))).map((e) => ({ day: e.day, wall: e.wall }))
        const end = events.length ? events[events.length - 1].wall : 0
        return { dir, events, run, reason: run ? run.reason : events.length ? 'still playing, or killed' : 'never started', resumedDay: m ? Number(m[1]) : null, playable: playable ? playable.wall : null, end, checkpoints }
    })
}

/** what was played, the parts joined at their cuts: nights, days, where it is now */
export function summary(out) {
    const parts = loadParts(out)
    const cuts = cutParts(parts)
    const L = []
    const nights = [], days = new Map()
    let played = 0, last = null, progress = null
    parts.forEach((p, i) => {
        const c = cuts[i]
        L.push(`${p.dir.split('/').pop()}: ${p.resumedDay ? `from day ${p.resumedDay}` : 'a new game'}, ${clock(Math.max(0, p.end - (p.playable ?? p.end)))} played, ended: ${p.reason}${c.kept ? `, kept ${clock(c.to - c.from)}` : ', not kept'}`)
        if (!c.kept) return
        played += c.to - c.from
        for (const e of p.events) {
            if (e.wall > c.to) break
            if (e.type === 'nightOver' && !e.opening) nights.push(e)
            // (the bot notes its progress as each day starts: a part continued from a dawn has no phase event for it)
            if (e.type === 'bot' && e.what === 'progress') progress = e
            if (((e.type === 'phase' && e.phase === 'day') || (e.type === 'bot' && e.what === 'progress')) && !days.has(e.day)) days.set(e.day, { placed: 0, mined: 0, failed: 0 })
            if (e.type === 'bot' && days.size) {
                const d = [...days.values()].pop()
                if (e.what === 'placed') d.placed++
                else if (e.what === 'mined') d.mined++
                else if (e.what === 'place-failed') d.failed++
            }
        }
        const tele = readJsonl(join(p.dir, 'telemetry.jsonl')).filter((t) => t.wall <= c.to)
        if (tele.length) last = tele[tele.length - 1]
    })
    L.push('')
    L.push(`played ${clock(played)} in ${cuts.filter((c) => c.kept).length} kept part(s); ${days.size} days; nights: ${nights.filter((n) => n.result === 'survived').length} won, ${nights.filter((n) => n.result !== 'survived').length} lost`)
    if (nights.length) {
        L.push('night  result  town-lowest  attackers  towers  troops  defence  hurt-by')
        for (const n of nights) {
            const by = Object.entries(n.townBy || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ')
            L.push(`${String(n.level).padStart(5)}  ${n.result === 'survived' ? 'won   ' : 'LOST  '}  ${String(Math.round((100 * n.minTown) / n.townMax)).padStart(9)}%  ${String(n.spawned ?? '-').padStart(9)}  ${String(`${n.towersLeft}/${n.towers}`).padStart(6)}  ${String(n.troops ?? '-').padStart(6)}  ${String(n.defence ?? '-').padStart(7)}  ${by}`)
        }
    }
    if (days.size) L.push('blocks placed by day: ' + [...days.entries()].map(([d, v]) => `${d}: ${v.placed}`).join(', '))
    if (progress) L.push(`the build at dawn of day ${progress.day}: ${progress.left} of ${progress.total} blocks to go, ${progress.towers} towers and ${progress.troops} troops to place` + (progress.parts ? ` (${Object.entries(progress.parts).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''))
    if (last) L.push(`now: day ${last.day}, ${last.phase}, ${last.activity}; town ${last.townHp}; towers ${JSON.stringify(last.towerTypes)}; troops ${last.troops}; holding ${JSON.stringify(last.inv)}`)
    return { text: L.join('\n'), parts, cuts, nights, days: days.size, finished: parts.some((p) => FINISHED.has(p.reason)) }
}

/** encode the parts the cut keeps (run.mjs --no-post left them as recorded), and say how to cut them */
function post(out, preset = 'medium') {
    const { parts, cuts } = summary(out)
    const kept = cuts.filter((c) => c.kept).map((c) => c.dir)
    for (const dir of kept) {
        if (existsSync(join(dir, 'video.json')) || !existsSync(join(dir, 'game.webm'))) continue
        console.log(`encoding ${dir} …`)
        execFileSync('node', [new URL('./video.mjs', import.meta.url).pathname, dir, `--preset=${preset}`], { stdio: ['ignore', 'ignore', 'inherit'] })
        execFileSync('node', [new URL('./report.mjs', import.meta.url).pathname, dir], { stdio: ['ignore', 'ignore', 'inherit'] })
    }
    writeFileSync(join(out, 'parts.json'), JSON.stringify({ kept, cuts, reasons: parts.map((p) => [p.dir, p.reason]) }, null, 1))
    console.log(`kept parts: ${kept.join(',')}`)
    console.log(`next: node tools/autoplay/edit.mjs ${kept.join(',')} --target=30:00 --out=${join(out, 'cut.mp4')}`)
    return kept
}

if (process.argv[1] && process.argv[1].endsWith('long-run.mjs')) {
    const ROOT = new URL('../../', import.meta.url).pathname
    const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.length ? v.join('=') : true]))
    if (!args.out) {
        console.error('usage: node tools/autoplay/long-run.mjs --out=<dir> [run.mjs arguments for a new game]')
        process.exit(2)
    }
    const out = String(args.out)
    mkdirSync(out, { recursive: true })
    if (args.status) {
        console.log(summary(out).text)
        process.exit(0)
    }
    if (args.post) {
        post(out, String(args['encode-preset'] || 'medium'))
        process.exit(0)
    }
    const stopFile = join(out, 'STOP')
    // a STOP left from last time was for last time
    rmSync(stopFile, { force: true })
    if (existsSync(join(out, 'DONE'))) {
        console.log(`this game is finished (${readFileSync(join(out, 'DONE'), 'utf8').trim()}). --post encodes it, --status shows it`)
        process.exit(0)
    }
    if (!args['no-build']) {
        console.log('building…')
        execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
    }
    const maxRestarts = Number(args['max-restarts'] || 40)
    const own = new Set(['out', 'status', 'post', 'max-restarts', 'no-build', 'encode-cores', 'encode-preset'])
    const preset = String(args['encode-preset'] || 'medium')
    /** encode a finished part while the game goes on: low priority, on a few cores, so the recording isn't starved */
    const encoding = []
    const encodeInBackground = (dir) => {
        const cores = String(args['encode-cores'] || '4-15')
        const node = ['node', new URL('./video.mjs', import.meta.url).pathname, dir, `--preset=${preset}`]
        const cmd = cores === 'all' ? ['nice', '-n', '19', ...node] : ['taskset', '-c', cores, 'nice', '-n', '19', ...node]
        const log = openSync(join(out, `${dir.split('/').pop()}.video.log`), 'w')
        const p = spawn(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: ['ignore', log, log] })
        p.on('error', (err) => console.error(`encoding ${dir} in the background failed to start: ${err.message}`))
        encoding.push(new Promise((res) => p.on('exit', res)))
        console.log(`encoding ${dir.split('/').pop()} in the background (${cmd.slice(0, 3).join(' ')}…)`)
    }
    const pass = (resumed) => Object.entries(args).filter(([k]) => !own.has(k) && !(resumed && FRESH_ONLY.has(k))).map(([k, v]) => (v === true ? `--${k}` : `--${k}=${v}`))

    let child = null
    let stopping = null
    for (const sig of ['SIGINT', 'SIGTERM']) {
        process.on(sig, () => {
            stopping = sig
            if (child) child.kill('SIGTERM')
        })
    }
    let shortRuns = 0
    for (let n = 0; n < maxRestarts; n++) {
        const parts = loadParts(out)
        const cp = pickCheckpoint(parts)
        const dir = join(out, `part-${String(parts.length + 1).padStart(2, '0')}`)
        const file = cp ? join(cp.dir, 'checkpoints', `day-${cp.day}.save.json`) : null
        const a = [join(ROOT, 'tools/autoplay/run.mjs'), ...pass(!!cp), ...(file ? [`--resume=${file}`] : []), '--checkpoint', '--no-post', '--no-build', `--out=${dir}`]
        console.log(`\n[${new Date().toLocaleTimeString()}] ${dir.split('/').pop()}: ${cp ? `continuing from day ${cp.day} (${file})` : 'a new game'}`)
        const t0 = Date.now()
        child = spawn('node', a, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] })
        // `touch <out>/STOP` stops it too
        const watch = setInterval(() => {
            if (existsSync(stopFile) && child) {
                stopping = 'STOP'
                child.kill('SIGTERM')
            }
        }, 2000)
        const code = await new Promise((res) => child.on('exit', (c) => res(c)))
        clearInterval(watch)
        child = null
        const run = existsSync(join(dir, 'run.json')) ? JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) : null
        const reason = run ? run.reason : `the harness died (exit ${code})`
        const seconds = (Date.now() - t0) / 1000
        console.log(`[${new Date().toLocaleTimeString()}] ${dir.split('/').pop()} ended after ${clock(seconds)}: ${reason}`)
        if (run && FINISHED.has(reason)) {
            writeFileSync(join(out, 'DONE'), `${reason}\n`)
            console.log(summary(out).text)
            // (parts still being encoded in the background first: post() takes what's left)
            await Promise.all(encoding)
            post(out, preset)
            process.exit(0)
        }
        // a part that ended at a dawn on purpose is kept whole: encode it while the next one plays
        if (reason === 'part done' && run.record) encodeInBackground(dir)
        if (stopping) {
            rmSync(stopFile, { force: true })
            console.log(`stopped (${stopping}). Run the same command to carry on from the last dawn.`)
            console.log(summary(out).text)
            process.exit(0)
        }
        // four parts in a row that never got going: something is broken, don't spin
        shortRuns = seconds < SHORT ? shortRuns + 1 : 0
        if (shortRuns >= 4) {
            console.error('four parts in a row ended within two minutes: giving up')
            process.exit(1)
        }
        await new Promise((r) => setTimeout(r, 3000))
    }
    console.error(`gave up after ${maxRestarts} parts`)
    process.exit(1)
}
