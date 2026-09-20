/*
 *  The difficulty map: saved towns × night levels, one night each, with the
 *  builder on autopilot (--lab=siege). It measures what a town holds, not how
 *  well someone plays it, in minutes instead of whole games.
 *
 *  Usage:
 *    node tools/autoplay/map.mjs [--towns=default,t1-towers,t2-mixed] [--nights=2,4,6,8,10,12]
 *                                [--runs=2] [--parallel=3] [--label=<name>] [--no-build] [--dist=<dir>] [--quality=high]
 *
 *  Output: recordings/map-<label>/ (one folder per night run, map.md, map.json)
 */

import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJsonl } from './video.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const towns = String(args.towns || 'default,t1-towers,t2-mixed').split(',')
const nights = String(args.nights || '2,4,6,8,10,12').split(',').map(Number)
const runs = Number(args.runs || 2)
const parallel = Number(args.parallel || 3)
const label = args.label || new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13)
const ROOT = new URL('../../', import.meta.url).pathname
const out = join(ROOT, 'recordings', `map-${label}`)
mkdirSync(out, { recursive: true })

if (!args['no-build'] && !args.dist) {
    console.log('building…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}

const jobs = []
for (const town of towns) for (const n of nights) for (let r = 1; r <= runs; r++) jobs.push({ town, n, r, dir: join(out, `${town}-n${n}-r${r}`) })

/** the night's result from a run's events */
function result(job) {
    const f = join(job.dir, 'events.jsonl')
    if (!existsSync(f)) return null
    const ev = readJsonl(f)
    const n = ev.find((e) => e.type === 'nightOver' && !e.opening)
    if (!n) return { failed: true }
    const destroyed = n.destroyed || {}
    const lost = Object.values(destroyed).reduce((a, b) => a + b, 0)
    const sub = ev.filter((e) => e.type === 'banner' && /attackers approaching/.test(e.text || ''))
    const started = ev.find((e) => e.type === 'nightStarted')
    return {
        result: n.result, seconds: n.seconds, spawned: n.spawned, minTown: Math.round((100 * n.minTown) / n.townMax),
        towersLost: n.towers - n.towersLeft, towers: n.towers, blocksLost: lost, defence: n.defence, kills: n.kills,
        subwaves: sub.length, wave: started ? { counts: started.counts, answer: started.answer, extra: started.extra } : null,
    }
}

let next = 0
let done = 0
const t0 = Date.now()
async function worker(slot) {
    while (next < jobs.length) {
        const job = jobs[next++]
        mkdirSync(job.dir, { recursive: true })
        const a = ['tools/autoplay/run.mjs', '--no-build', `--lab=siege:${job.town}:${job.n}`, `--out=${job.dir}`, `--port=${4200 + slot}`, '--minutes=9']
        if (args.quality) a.push(`--quality=${args.quality}`)
        if (args.dist) a.push(`--dist=${args.dist}`)
        await new Promise((resolve) => {
            const p = spawn('node', a, { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] })
            p.on('exit', resolve)
        })
        job.res = result(job)
        done++
        const r = job.res
        console.log(`[${((Date.now() - t0) / 60000).toFixed(1)} min] ${done}/${jobs.length} ${job.town} night ${job.n} #${job.r}: ` +
            (r && !r.failed ? `${r.result}, town ${r.minTown}%, towers lost ${r.towersLost}/${r.towers}, blocks ${r.blocksLost}, ${r.spawned} attackers, ${r.seconds} s` : 'no result'))
    }
}
await Promise.all(Array.from({ length: parallel }, (_, i) => worker(i)))

// the map: a row per town, a column per night; each cell lists the runs
const L = [`# Difficulty map: ${label}`, '', `${runs} run(s) per cell, builder on autopilot. Each run: result, Town Center lowest, towers lost / standing at the start, attackers.`, '']
L.push(`| Town | ${nights.map((n) => `Night ${n}`).join(' | ')} |`)
L.push(`|---|${nights.map(() => '---').join('|')}|`)
for (const town of towns) {
    const cells = nights.map((n) => jobs.filter((j) => j.town === town && j.n === n).map((j) => {
        const r = j.res
        if (!r || r.failed) return '?'
        return `${r.result === 'survived' ? 'W' : '**L**'} ${r.minTown}% · ${r.towersLost}/${r.towers} · ${r.spawned}`
    }).join('<br>'))
    L.push(`| ${town} | ${cells.join(' | ')} |`)
}
L.push('')
writeFileSync(join(out, 'map.md'), L.join('\n'))
writeFileSync(join(out, 'map.json'), JSON.stringify(jobs.map(({ town, n, r, res }) => ({ town, n, r, ...res })), null, 1))
console.log(L.join('\n'))
console.log(`output: ${out}`)
