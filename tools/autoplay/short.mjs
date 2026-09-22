/*
 *  Cuts a recorded hour-long run down to a ~45 s clip to post on X: a shot list
 *  of moments from game.mp4, a caption over each, and an end card. Every shot is
 *  rendered on its own (so a bad one can be re-cut alone), then concatenated.
 *
 *  The default shot list is the one for recordings/final7-rec (iteration 7).
 *  Times are seconds into game.mp4 — the chapter list in chapters.txt and
 *  telemetry.jsonl (activity, attackers, mode, panel) are how they were found.
 *
 *  Usage: node tools/autoplay/short.mjs [recording dir] [--out=file] [--only=2,5]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const W = 1280, H = 720, FPS = 30
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

/** the menu's palette, so the end card looks like the game */
const INK = '0x1c1f29', PAPER = '0xf1efe7', GOLD = '0xf2c14e', MUTED = '0xa9a79d'

/**
 * The cut. `at` and `dur` are seconds in the source; `dur` is source time, so a
 * shot at speed 3 lasts dur/3 in the short. `zoom` is the push-in over the shot.
 * @type {{at: number, dur: number, speed?: number, zoom?: number, text?: string}[]}
 */
export const SHOTS = [
    // the opening raid, at the moment the town centre goes down
    { at: 80.8, dur: 5.2, zoom: 1.12, text: 'A raid levels your town in the first 90 seconds' },
    // dawn after the raid: the town rebuilds itself
    { at: 88.0, dur: 3.4, text: 'At dawn it rebuilds itself, block by block' },
    // day 2: chopping a tree, then the wall it paid for
    { at: 634.5, dur: 13.5, speed: 3, text: 'Mine and chop by day' },
    // day 10: archers going up on the wall
    { at: 2647, dur: 7, speed: 2.5, text: 'Craft walls, towers, troops and weapons' },
    // dusk before night 13: the banner says what is coming
    { at: 3350.5, dur: 5, text: 'The attackers answer what you build' },
    // night 11, 140 attackers, fighting with the bow
    { at: 2994.5, dur: 6.5, text: 'Fight as yourself — safest from the wall, with a bow' },
    // night 11: grunts, skeletons and a brute coming up the path
    { at: 3073.8, dur: 2.6 },
    // night 10 at the gate: a breach patched while the next wave is called
    { at: 2828, dur: 3.8, text: 'Patch the breaches. Every night is stronger.' },
    // night 13 survived
    { at: 3522.6, dur: 3.2 },
    // dawn rebuilding the gate
    { at: 3526.5, dur: 4.6, text: '13 nights survived · 140 attackers in the last wave' },
]

/** the end card, over the menu's background colour */
const END = { dur: 3.6, title: 'BLOCK DEFENCE', sub: 'Mine and build by day. Survive the night.', foot: 'voxel tower defence · plays in a browser · maize.live' }

/** ffmpeg takes these four characters as syntax inside a filter argument */
export function esc(text) {
    return String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\\\\\'").replace(/:/g, '\\:').replace(/%/g, '\\%')
}

/** a caption that fades in and out with the shot (the first one starts up, so it is on the poster frame) */
function caption(text, dur, fadeIn) {
    const a = `alpha='min(1,${fadeIn ? `min(t/0.35,(${dur}-t)/0.35)` : `(${dur}-t)/0.35`})'`
    return `drawtext=fontfile=${FONT}:text='${esc(text)}':fontsize=34:fontcolor=${PAPER}:${a}` +
        `:box=1:boxcolor=${INK}@0.72:boxborderw=20:x=(w-text_w)/2:y=h*0.70`
}

/** atempo only takes 0.5–2, so a faster shot needs a chain */
export function atempo(speed) {
    const out = []
    let left = speed
    while (left > 2.0001) {
        out.push('atempo=2')
        left /= 2
    }
    if (Math.abs(left - 1) > 0.001) out.push(`atempo=${left.toFixed(4)}`)
    return out
}

function run(args) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] })
}

/** one shot, rendered to its own file */
function renderShot(src, shot, file, first) {
    const speed = shot.speed || 1
    const out = shot.dur / speed
    const v = ['fps=' + FPS, `scale=${W}:${H}`, 'setsar=1']
    if (speed !== 1) v.unshift(`setpts=PTS/${speed}`)
    if (shot.zoom) {
        // a slow push-in: zoompan steps the zoom once per frame, d=1
        const step = ((shot.zoom - 1) / (out * FPS)).toFixed(6)
        v.push(`zoompan=z='min(zoom+${step},${shot.zoom})':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`)
    }
    if (shot.text) v.push(caption(shot.text, out, !first))
    v.push('format=yuv420p')

    const a = ['aformat=sample_rates=48000:channel_layouts=stereo', ...atempo(speed)]
    run([
        '-ss', String(shot.at), '-t', String(shot.dur), '-i', src,
        '-map', '0:v:0', '-map', '0:a:0', '-dn', '-sn', '-map_chapters', '-1',
        '-vf', v.join(','), '-af', a.join(','),
        '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(FPS),
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-t', out.toFixed(3), file,
    ])
}

/** the end card: flat colour, three lines, its own silence */
function renderEnd(file) {
    const d = END.dur
    const fade = `fade=t=in:st=0:d=0.35,fade=t=out:st=${(d - 0.5).toFixed(2)}:d=0.5`
    const lines = [
        `drawtext=fontfile=${FONT}:text='${esc(END.title)}':fontsize=76:fontcolor=${GOLD}:x=(w-text_w)/2:y=h/2-96:shadowcolor=black:shadowx=4:shadowy=4`,
        `drawtext=fontfile=${FONT}:text='${esc(END.sub)}':fontsize=32:fontcolor=${PAPER}:x=(w-text_w)/2:y=h/2+4`,
        `drawtext=fontfile=${FONT}:text='${esc(END.foot)}':fontsize=24:fontcolor=${MUTED}:x=(w-text_w)/2:y=h/2+70`,
    ]
    run([
        '-f', 'lavfi', '-i', `color=c=${INK}:s=${W}x${H}:r=${FPS}:d=${d}`,
        '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${d}`,
        '-vf', [...lines, fade, 'format=yuv420p'].join(','),
        '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-t', String(d), file,
    ])
}

/**
 * @param {string} dir  a recording directory (must hold game.mp4)
 * @param {{out?: string, only?: number[]}} opts
 */
export function makeShort(dir, opts = {}) {
    const src = existsSync(dir) && dir.endsWith('.mp4') ? dir : join(dir, 'game.mp4')
    if (!existsSync(src)) throw new Error(`no video at ${src}`)
    const base = src.endsWith('.mp4') ? resolve(src, '..') : dir
    const parts = join(base, 'short-parts')
    mkdirSync(parts, { recursive: true })

    const files = []
    SHOTS.forEach((shot, i) => {
        const file = join(parts, `shot-${String(i + 1).padStart(2, '0')}.mp4`)
        if (!opts.only || opts.only.includes(i + 1)) {
            process.stdout.write(`shot ${i + 1}/${SHOTS.length}: ${shot.at}s +${shot.dur}s${shot.speed ? ` ×${shot.speed}` : ''}\n`)
            renderShot(src, shot, file, i === 0)
        }
        files.push(file)
    })
    const end = join(parts, 'end.mp4')
    if (!opts.only) renderEnd(end)
    files.push(end)

    const out = opts.out || join(base, 'short.mp4')
    const n = files.length
    const streams = files.map((_, i) => `[v${i}][a${i}]`).join('')
    const pre = files.map((_, i) => `[${i}:v:0]setsar=1[v${i}];[${i}:a:0]aresample=48000[a${i}]`).join(';')
    const total = SHOTS.reduce((s, x) => s + x.dur / (x.speed || 1), 0) + END.dur
    // no fade in on the picture: the first frame is what X shows before it plays
    const filter = `${pre};${streams}concat=n=${n}:v=1:a=1[v][ca];` +
        `[ca]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,afade=t=in:st=0:d=0.4,afade=t=out:st=${(total - 0.6).toFixed(2)}:d=0.6[a]`
    run([
        ...files.flatMap((f) => ['-i', f]),
        '-filter_complex', filter, '-map', '[v]', '-map', '[a]', '-dn', '-sn', '-map_chapters', '-1',
        '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-profile:v', 'high', '-level', '4.0',
        '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2),
        '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart', out,
    ])

    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', out]).toString())
    const meta = {
        out,
        duration: +probe.format.duration,
        sizeMB: +(probe.format.size / 1e6).toFixed(1),
        shots: SHOTS.map((s, i) => ({ n: i + 1, at: s.at, dur: +(s.dur / (s.speed || 1)).toFixed(2), text: s.text || '' })),
    }
    writeFileSync(join(base, 'short.json'), JSON.stringify(meta, null, 2))
    return meta
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2)
    const dir = args.find((a) => !a.startsWith('--')) || 'recordings/final7-rec'
    const out = args.find((a) => a.startsWith('--out='))?.slice(6)
    const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',').map(Number)
    const meta = makeShort(dir, { out, only })
    console.log(`\n${meta.out} — ${meta.duration.toFixed(1)} s, ${meta.sizeMB} MB`)
}
