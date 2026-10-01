/*
 *  Cuts a long recorded game down to a target length (plan 10 §3.8): the
 *  interesting moments at 1×, the rest sped up, the speeds solved so the whole
 *  comes out at the target.
 *
 *    1×            the start, the first seconds of each new part of the castle,
 *                  towers going up, the first attackers and the height of each
 *                  night, the finished castle and the end
 *    faster        building (the castle rising), quiet nights, dawns
 *    fastest       mining, walking, chopping, digging sand, crafting, waiting
 *
 *  A sped-up stretch plays real-time sound from its own start (fading in and
 *  out), not a chipmunk: the hammer taps and the ambience sound like themselves.
 *  A "▶▶ 8×" badge shows while it's sped up, and a caption names each new
 *  chapter ("Day 4 · the Palas").
 *
 *  The cut is written to edit.json first: change a segment's speed there and
 *  run again with --from-json to re-render just that.
 *
 *  Usage: node tools/autoplay/edit.mjs <recording dir>[,<dir>…] [--target=30:00] [--out=<file>]
 *                                      [--from-json] [--plan-only]
 *  Several dirs (a run resumed from a checkpoint) are joined in order.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { readJsonl, clock } from './video.mjs'

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

/** relative speeds per class, before the solve scales everything but 1× */
export const CLASS_SPEED = { key: 1, build: 1, night: 1, dawn: 1.5, boring: 4 }
/** limits for the solved speeds */
// (plan 12: a palace game is 5+ hours, twice iteration 10's: building runs to 24×, mining and walking to 80×)
export const SPEED_LIMITS = { build: [3, 24], night: [2, 16], dawn: [4, 24], boring: [8, 80] }
/** seconds of source shown at 1× around a key moment */
const KEY = { start: 20, part: 10, tower: 4, nightStart: 10, peak: 8, end: 25, milestone: 8, firstOf: 8 }

/**
 * pure: what each second of the recording is (see the header).
 * @param {{t: number, phase: string, activity: string, attackers: number, day: number, level: number}[]} tele one per second, t = video time
 * @param {{t: number, type: string, what?: string, title?: string, item?: string, part?: string}[]} events in video time
 * @param {number} duration video seconds
 * @param {{from?: number, first?: boolean, last?: boolean, parts?: Set<string>}} [o] for one of several
 *   joined recordings: where it starts, whether it's the first or the last, and the castle parts
 *   the ones before it already introduced (shared, so each part is shown at 1× once)
 * @returns {{cls: string[], captions: {t: number, text: string}[], views: (string|null)[]}} views: the
 *   camera the builder was using each second (from the palace's chapters; null before the first)
 */
export function classify(tele, events, duration, { from = 0, first = true, last = true, parts = new Set() } = {}) {
    const n = Math.ceil(duration)
    const cls = new Array(n).fill('boring')
    const at = (t) => Math.max(0, Math.min(n - 1, Math.floor(t)))
    for (const s of tele) {
        const i = at(s.t)
        const a = s.activity || ''
        if (s.phase === 'night' || s.phase === 'dusk') cls[i] = 'night'
        else if (s.phase === 'dawn') cls[i] = 'dawn'
        // (on foot, the palace's blocks go in as 'placing': building too, plan 12 §6.6)
        else if (a.startsWith('building') || a === 'placing' || a === 'flyover' || a === 'tour' || a === 'looking') cls[i] = 'build'
        else cls[i] = 'boring'
    }
    const views = new Array(n).fill(null)
    {
        let view = null, i = 0
        for (const e of events.filter((x) => x.type === 'bot' && x.what === 'chapter').sort((a, b) => a.t - b.t)) {
            for (; i < Math.min(n, Math.floor(e.t)); i++) views[i] = view
            if (e.view) view = e.view
        }
        for (; i < n; i++) views[i] = view
    }
    const key = (from, len) => {
        for (let i = at(from); i < Math.min(n, from + len); i++) cls[i] = 'key'
    }
    const captions = []
    if (first) key(0, KEY.start)
    let lastDay = 0
    const shown = new Set()
    for (const e of events) {
        if (e.type === 'bot' && e.what === 'chapter') {
            const title = String(e.title || '')
            const m = title.match(/^building: (.*)$/)
            // the castle's chapters are "building: <part>"; the palace's name the view too (plan 12 §6.10)
            const part = m ? (e.part || m[1].split(', ')[0]) : e.view ? e.part : null
            const seen = e.view ? `${part}|${e.view}` : part
            if (part && !parts.has(seen) && e.t >= from && e.t < duration) {
                parts.add(seen)
                key(e.t, KEY.part)
                captions.push({ t: e.t, text: e.view ? `Day ${e.day} · ${title}` : `Day ${e.day} · ${part}` })
            } else if (/finished/.test(title)) {
                // the moment it's done (the builder is wherever the last block was, often the
                // quarry): a few seconds; the turn round the finished castle: a minute
                key(e.t, /^the finished/.test(title) ? 60 : 6)
                captions.push({ t: e.t, text: title[0].toUpperCase() + title.slice(1) })
            } else if (title === 'sand for the windows' || title === 'wood for gates and towers') {
                if (!captions.some((c) => c.text.endsWith(title))) captions.push({ t: e.t, text: `Day ${e.day} · ${title}` })
            }
        }
        if (e.type === 'bot' && e.what === 'placed' && /tower/.test(e.item || '')) key(e.t - 1, KEY.tower)
        if (e.type === 'phase' && e.phase === 'day' && e.day > lastDay) {
            lastDay = e.day
            captions.push({ t: e.t, text: `Day ${e.day}` })
        }
        if (e.type === 'bot' && e.what === 'export') key(e.t - 5, KEY.end)
        // a moment the bot marks (the flights meeting, the first walk up, the hall from its floor)
        if (e.type === 'bot' && e.what === 'milestone') {
            key(e.t - 1, Number(e.len) || KEY.milestone)
            if (e.caption) captions.push({ t: e.t, text: e.caption })
        }
        // the first fire mage of the game, and the first freeze
        if ((e.type === 'cast' || e.type === 'freeze') && !shown.has(e.type)) {
            shown.add(e.type)
            key(e.t - 2, KEY.firstOf)
            captions.push({ t: e.t, text: e.type === 'cast' ? `Night ${e.level} · the first fire mage` : `Night ${e.level} · frozen` })
        }
        // a night lost is played again the next night: say so
        if (e.type === 'nightOver' && e.result === 'lost' && e.level > 0) {
            const lives = Number(e.lives)
            captions.push({ t: e.t, text: e.unlimitedLives ? `Night ${e.level} lost · rebuilt at dawn` : `Night ${e.level} lost · ${lives} ${lives === 1 ? 'life' : 'lives'} left` })
        }
    }
    // a resumed recording starts mid-day: name the day
    if (from > 0 && !captions.some((c) => c.t >= from && c.t < from + 30)) {
        const s = tele.find((x) => x.t >= from)
        if (s && s.day) captions.push({ t: from, text: `Day ${s.day}` })
    }
    // each night: its first attackers, and its busiest stretch
    const nights = new Map()
    for (const s of tele) {
        if (s.phase !== 'night') continue
        const k = `${s.day}:${s.level}`
        if (!nights.has(k)) nights.set(k, [])
        nights.get(k).push(s)
    }
    for (const [, list] of nights) {
        const first = list.find((s) => s.attackers > 0)
        if (first) {
            key(first.t, KEY.nightStart)
            captions.push({ t: first.t, text: first.level ? `Night ${first.level}` : 'The opening raid' })
        }
        const peak = list.reduce((a, b) => (b.attackers > a.attackers ? b : a), list[0])
        if (peak && peak.attackers > 0) key(peak.t - KEY.peak / 2, KEY.peak)
    }
    if (last) key(duration - KEY.end, KEY.end)
    // a resumed recording: its menu and loading screen are left out
    for (let i = 0; i < Math.min(n, Math.floor(from)); i++) cls[i] = 'skip'
    captions.sort((a, b) => a.t - b.t)
    return { cls, captions: captions.filter((c) => c.t >= from && c.t < duration), views }
}

/**
 * pure: seconds on screen of building (and its key moments) by the view it was built in
 * (plan 12 §6.10: each of the three at least a fifth)
 * @param {{start: number, end: number, speed: number, cls: string, src?: number}[]} segs
 * @param {(string|null)[]} views per source second, the sources joined
 * @param {(string)[]} cls per source second, the sources joined
 * @param {{offset: number}[]} sources
 */
export function viewShare(segs, views, cls, sources) {
    const out = {}
    for (const s of segs) {
        const off = sources[s.src || 0].offset
        for (let i = Math.floor(s.start); i < Math.ceil(s.end); i++) {
            const c = cls[off + i]
            const v = views[off + i]
            if (!v || (c !== 'build' && !(c === 'key' && s.cls === 'key'))) continue
            out[v] = (out[v] || 0) + 1 / s.speed
        }
    }
    return out
}

/**
 * pure: speeds per class so the whole lasts `target` seconds: 1× stays 1×, the
 * others scale together from CLASS_SPEED, each within SPEED_LIMITS.
 * @param {string[]} cls a class per source second
 * @returns {Record<string, number>}
 */
export function solveSpeeds(cls, target) {
    const count = {}
    for (const c of cls) if (c !== 'skip') count[c] = (count[c] || 0) + 1
    const speedsAt = (k) => {
        const out = { key: 1 }
        for (const c of Object.keys(SPEED_LIMITS)) {
            const [lo, hi] = SPEED_LIMITS[c]
            out[c] = Math.min(hi, Math.max(lo, CLASS_SPEED[c] * k))
        }
        return out
    }
    const length = (sp) => Object.entries(count).reduce((a, [c, n]) => a + n / (sp[c] || 1), 0)
    let lo = 0.01, hi = 100
    for (let i = 0; i < 60; i++) {
        const mid = Math.sqrt(lo * hi)
        if (length(speedsAt(mid)) > target) lo = mid
        else hi = mid
    }
    const sp = speedsAt(hi)
    // whole-number speeds read better on the badge
    for (const c of Object.keys(sp)) if (sp[c] > 1) sp[c] = Math.max(2, Math.round(sp[c]))
    return sp
}

/**
 * pure: consecutive seconds of one class as segments; a sped-up stretch shorter
 * than `minOut` seconds of output is folded into its neighbour.
 * @returns {{start: number, end: number, cls: string, speed: number}[]}
 */
export function segments(cls, speeds, minOut = 2.5) {
    const out = []
    for (let i = 0; i < cls.length; i++) {
        const last = out[out.length - 1]
        if (last && last.cls === cls[i]) last.end = i + 1
        else out.push({ start: i, end: i + 1, cls: cls[i], speed: speeds[cls[i]] || 1 })
    }
    // fold short ones into the segment before them (or after, for the first)
    for (let k = 0; k < out.length; k++) {
        const s = out[k]
        if ((s.end - s.start) / s.speed >= minOut || out.length === 1 || s.cls === 'skip') continue
        // (a stretch left out never takes others with it)
        const into = k > 0 && out[k - 1].cls !== 'skip' ? out[k - 1] : k + 1 < out.length && out[k + 1].cls !== 'skip' ? out[k + 1] : null
        if (!into) continue
        into.start = Math.min(into.start, s.start)
        into.end = Math.max(into.end, s.end)
        out.splice(k, 1)
        k = Math.max(-1, k - 2)
    }
    return out
}

// ---- rendering --------------------------------------------------------------------------

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '\u2019').replace(/%/g, '\\%')

function renderSegment(src, seg, captions, file, hasAudio) {
    const dur = seg.end - seg.start
    const outDur = dur / seg.speed
    const vf = [`setpts=(PTS-STARTPTS)/${seg.speed}`, 'fps=30']
    if (seg.speed > 1) {
        vf.push(`drawtext=fontfile=${FONT}:text='\u25B6\u25B6 ${seg.speed}\u00D7':x=w-tw-28:y=100:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=12`)
    }
    // captions that start inside this segment, shown for 3.5 s of output
    for (const c of captions) {
        if (c.t < seg.start || c.t >= seg.end) continue
        const from = (c.t - seg.start) / seg.speed
        vf.push(`drawtext=fontfile=${FONT}:text='${esc(c.text)}':x=40:y=h-250:fontsize=44:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=16:enable='between(t,${from.toFixed(2)},${(from + 3.5).toFixed(2)})'`)
    }
    const args = ['-y', '-v', 'error', '-ss', String(seg.start), '-t', String(dur), '-i', src]
    let af
    if (!hasAudio) {
        args.push('-f', 'lavfi', '-t', String(outDur), '-i', 'anullsrc=r=48000:cl=stereo')
    } else if (seg.speed > 1) {
        // real-time sound from the segment's own start, faded (not pitched up)
        const f = Math.min(0.3, outDur / 3)
        af = `atrim=0:${outDur.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=${f.toFixed(2)},afade=t=out:st=${(outDur - f).toFixed(3)}:d=${f.toFixed(2)}`
    } else af = 'asetpts=PTS-STARTPTS'
    args.push('-vf', vf.join(','))
    if (af) args.push('-af', af)
    args.push('-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0', '-t', outDur.toFixed(3),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-r', '30',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', file)
    execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] })
}

/** a recording's telemetry and events, in video time (0 = the first frame of the capture) */
function load(dir) {
    const events = readJsonl(join(dir, 'events.jsonl'))
    const cap = events.find((e) => e.type === 'capture')
    const zero = cap ? cap.wall : 0
    const tele = readJsonl(join(dir, 'telemetry.jsonl')).map((s) => ({ ...s, t: s.wall - zero }))
    const ev = events.map((e) => ({ ...e, t: e.wall - zero }))
    const video = JSON.parse(readFileSync(join(dir, 'video.json'), 'utf8'))
    return { tele, events: ev, duration: video.duration, mp4: join(dir, 'game.mp4'), audio: !!video.audio }
}

if (process.argv[1] && process.argv[1].endsWith('edit.mjs')) {
    const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
    const dirs = String(process.argv[2]).split(',')
    const [mm, ss] = String(args.target || '30:00').split(':').map(Number)
    const target = mm * 60 + (ss || 0)
    const outFile = args.out || join(dirs[0], 'castle.mp4')
    const planFile = join(dirs[0], 'edit.json')
    let plan
    if (args['from-json'] && existsSync(planFile)) {
        plan = JSON.parse(readFileSync(planFile, 'utf8'))
    } else {
        // several recordings (resumed runs) are cut as one: each keeps its own source
        const all = dirs.map(load)
        const cls = [], captions = [], src = [], views = []
        const parts = new Set()
        all.forEach((r, i) => {
            // a run resumed from a checkpoint: the one before it ends where that checkpoint was taken,
            // and the resumed one starts once its game is playable
            const next = all[i + 1]
            const resumed = next && next.events.find((e) => e.type === 'resume')
            const day = resumed ? Number((String(resumed.file).match(/day-(\d+)/) || [])[1]) : null
            const cut = day ? r.events.find((e) => e.type === 'checkpoint' && e.day === day) : null
            if (cut) r.duration = Math.min(r.duration, cut.t)
            const play = i > 0 ? r.events.find((e) => e.type === 'playable') : null
            const c = classify(r.tele, r.events, r.duration, { from: play ? play.t + 1 : 0, first: i === 0, last: i === all.length - 1, parts })
            c.captions.forEach((x) => captions.push({ ...x, src: src.length }))
            src.push({ mp4: r.mp4, audio: r.audio, offset: cls.length })
            cls.push(...c.cls)
            views.push(...c.views)
        })
        const cut = (speeds) => {
            const segs = []
            for (const [i, s] of src.entries()) {
                const end = i + 1 < src.length ? src[i + 1].offset : cls.length
                for (const seg of segments(cls.slice(s.offset, end), speeds)) if (seg.cls !== 'skip') segs.push({ ...seg, src: i })
            }
            return { segs, length: segs.reduce((a, s) => a + (s.end - s.start) / s.speed, 0) }
        }
        // short sped-up stretches are folded into their neighbours (some at 1×), so the cut runs
        // longer than the speeds were solved for: solve again for less, until it comes out right
        let aim = target
        let speeds = solveSpeeds(cls, aim)
        let { segs, length } = cut(speeds)
        for (let i = 0; i < 8 && Math.abs(length - target) > target * 0.01; i++) {
            aim = Math.max(60, aim - (length - target))
            speeds = solveSpeeds(cls, aim)
            ;({ segs, length } = cut(speeds))
        }
        const share = viewShare(segs, views, cls, src)
        plan = { target, length: +length.toFixed(1), speeds, views: share, sources: src, segments: segs, captions: captions.map((c) => ({ ...c, t: c.t })) }
        writeFileSync(planFile, JSON.stringify(plan, null, 1))
    }
    const count = {}
    for (const s of plan.segments) count[s.cls] = (count[s.cls] || 0) + (s.end - s.start)
    console.log(`cut: ${plan.segments.length} segments, ${clock(plan.length)} (target ${clock(plan.target)}), speeds ${JSON.stringify(plan.speeds)}`)
    console.log(`source seconds by class: ${JSON.stringify(count)}`)
    if (plan.views && Object.keys(plan.views).length) {
        const total = Object.values(plan.views).reduce((a, b) => a + b, 0)
        console.log(`building on screen by view: ${Object.entries(plan.views).map(([v, t]) => `${v} ${clock(t)} (${Math.round((t / total) * 100)}%)`).join(', ')}`)
    }
    if (args['plan-only']) process.exit(0)
    const tmp = join(dirs[0], 'edit-parts')
    rmSync(tmp, { recursive: true, force: true })
    mkdirSync(tmp, { recursive: true })
    const list = []
    let outT = 0
    const chapters = []
    plan.segments.forEach((seg, i) => {
        const src = plan.sources[seg.src]
        const caps = plan.captions.filter((c) => c.src === seg.src).map((c) => ({ ...c, t: c.t }))
        for (const c of caps) if (c.t >= seg.start && c.t < seg.end) chapters.push({ t: outT + (c.t - seg.start) / seg.speed, text: c.text })
        const file = join(tmp, `${String(i).padStart(4, '0')}.mp4`)
        renderSegment(src.mp4, seg, caps, file, src.audio)
        // (concat reads the list's paths from the list's own folder)
        list.push(`file '${basename(file)}'`)
        outT += (seg.end - seg.start) / seg.speed
        if (i % 20 === 0) console.log(`[${i + 1}/${plan.segments.length}] ${clock(outT)}`)
    })
    writeFileSync(join(tmp, 'list.txt'), list.join('\n') + '\n')
    let meta = ';FFMETADATA1\ntitle=Building a castle in Block Defence\n'
    chapters.forEach((c, i) => {
        const s = Math.round(c.t * 1000), e = Math.round((i + 1 < chapters.length ? chapters[i + 1].t : outT) * 1000)
        if (e > s) meta += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${s}\nEND=${e}\ntitle=${c.text.replace(/[=;#\\\n]/g, ' ')}\n`
    })
    writeFileSync(join(tmp, 'chapters.ffmeta'), meta)
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'list.txt'), '-i', join(tmp, 'chapters.ffmeta'),
        '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', '-movflags', '+faststart', outFile], { stdio: ['ignore', 'ignore', 'inherit'] })
    writeFileSync(outFile.replace(/\.mp4$/, '-chapters.txt'), chapters.map((c) => `${clock(c.t)} ${c.text}`).join('\n') + '\n')
    console.log(`video: ${outFile} (${clock(outT)})`)
}
