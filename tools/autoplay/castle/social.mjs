/*
 *  The castle video's shorts: one turn round the finished castle (studio.mjs
 *  --orbit), then the castle walked back, a part at a time, to the raid on day 1.
 *  Two cuts of one shot list:
 *
 *    yt  1080×1920 for YouTube Shorts: the turn full frame, gameplay as a 3:4
 *        crop between two bands, the captions in the top band
 *    x   1920×1080 for X: everything full frame, the captions over the picture
 *
 *  Times are seconds into each recording's game.mp4 (inside the stretch of it
 *  that edit.mjs kept for castle.mp4). Telemetry's "building:<part>" activity is
 *  how the build shots were found; the camera holds still in each.
 *
 *  Usage: node tools/autoplay/castle/social.mjs [--only=yt|x] [--title-font=<ttf>]
 *  Output: recordings/castle10/social/short-yt.mp4, short-x.mp4
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { esc } from '../short.mjs'

const ROOT = new URL('../../../', import.meta.url).pathname
const OUT = join(ROOT, 'recordings', 'castle10', 'social')
const rec = (name) => join(ROOT, 'recordings', name, 'game.mp4')
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))

const FPS = 30
const BODY = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
/** a condensed display face for the title (Anton, OFL); DejaVu if it isn't there */
const TITLE = [args['title-font'], join(OUT, 'fonts', 'Anton-Regular.ttf')].find((f) => f && existsSync(f)) || BODY
const INK = '0x1c1f29', PAPER = '0xf1efe7', GOLD = '0xf2c14e', MUTED = '0xa9a79d'

/** the turn: its length, and the day ambience under it (castle10-rec9b, the bot's own turn round it) */
const ORBIT = { secs: 10, audio: { src: rec('castle10-rec9b'), at: 362 } }

/**
 * Walking back. `dur` is source seconds, shown at `speed`; the sound is the
 * source's own at 1× from `at`. `cx` centres the 3:4 crop for the tall cut.
 * @type {{src: string, at: number, dur: number, speed: number, when: string, what: string, cx?: number}[]}
 */
export const SHOTS = [
    // night 16, the last before the castle was finished: ballistas on the walls, the Town Center under attack
    { src: rec('castle10-rec8a'), at: 512, dur: 6, speed: 2, when: 'The night before', what: 'the castle holds' },
    { src: rec('castle10-rec8a'), at: 244.5, dur: 5, speed: 1.6, when: 'Day 18', what: 'the tall tower' },
    { src: rec('castle10-rec7b'), at: 736.2, dur: 4.8, speed: 1.5, when: 'Day 17', what: 'the square tower' },
    { src: rec('castle10-rec7b'), at: 193.3, dur: 6.4, speed: 2, when: 'Day 16', what: 'the knights’ wing' },
    { src: rec('castle10-rec2'), at: 1047.6, dur: 3.8, speed: 1.25, when: 'Day 14', what: 'the stair towers' },
    // the Town Center going down, and the game's own "Night 12: the Town Center fell. 2 lives left."
    { src: rec('castle10-rec'), at: 7602, dur: 8, speed: 2, when: 'Night 12', what: 'the town falls · 2 lives left' },
    { src: rec('castle10-rec'), at: 7193.5, dur: 6, speed: 2, when: 'Day 12', what: 'the Palas' },
    { src: rec('castle10-rec'), at: 3316, dur: 6, speed: 2, when: 'Day 6', what: 'the gatehouse' },
    { src: rec('castle10-rec'), at: 2679, dur: 6, speed: 2, when: 'Day 5', what: 'the curtain wall' },
    { src: rec('castle10-rec'), at: 1527, dur: 10, speed: 3, when: 'Day 3', what: 'the outline' },
    { src: rec('castle10-rec'), at: 328.5, dur: 4, speed: 1.33, when: 'Day 1', what: 'the first blocks' },
    // the opening raid: the starting town's Town Center blown up
    { src: rec('castle10-rec'), at: 33.5, dur: 8, speed: 1.6, when: 'The start', what: 'a raid flattens the town' },
]

const CARDS = [
    { from: 0, to: 4.7, title: 'NEUSCHWANSTEIN', sub: 'built block by block in survival' },
    // the blueprint is 3,088 blocks, 64 of them left as gaps (next_10.md §5)
    { from: 4.9, to: 9.6, title: '3,000+ BLOCKS', sub: '19 days · a raid every night' },
]
const END = { dur: 3.4, title: 'BLOCK DEFENCE', sub: 'Mine and build by day. Survive the night.', foot: 'voxel tower defence · plays in a browser · maize.live' }

const FORMATS = {
    yt: { W: 1080, H: 1920, orbit: 'orbit-1080x1920.mp4', band: 240, title: 132, sub: 50, titleY: 250, subY: 410 },
    x: { W: 1920, H: 1080, orbit: 'orbit-1920x1080.mp4', title: 120, sub: 48, titleY: 46, subY: 190 },
}

function ff(list) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...list], { stdio: ['ignore', 'inherit', 'inherit'] })
}

/** the mean level of a stretch of sound, in dB (volumedetect reports on stderr) */
function meanDb(src, at, dur) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(at), '-t', String(dur), '-i', src, '-vn', '-af', 'volumedetect', '-f', 'null', '-'])
    return Number((/mean_volume: (-?[\d.]+)/.exec(String(r.stderr)) || [])[1] ?? -40)
}

/** quiet day sound is lifted, loud nights left alone, so the cut doesn't jump about */
function levelled(src, at, dur) {
    const gain = Math.max(0, Math.min(14, -30 - meanDb(src, at, dur)))
    return `volume=${gain.toFixed(1)}dB`
}

const draw = (font, text, size, color, x, y, extra = '') =>
    `drawtext=fontfile=${font}:text='${esc(text)}':fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}${extra}`

const AUDIO_OUT = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2']
const VIDEO_TMP = ['-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(FPS)]

/** the turn with its two title cards; the first is up from frame one (it's the poster) */
function renderOrbit(f, file) {
    const t = ORBIT.secs
    const fade = (c) => `:alpha='if(lt(t,${c.from + 0.3}),${c.from === 0 ? 1 : `(t-${c.from})/0.3`},if(gt(t,${c.to - 0.3}),(${c.to}-t)/0.3,1))':enable='between(t,${c.from},${c.to})'`
    const border = ':borderw=7:bordercolor=0x10131c'
    const v = [`scale=${f.W}:${f.H}`, 'setsar=1']
    for (const c of CARDS) {
        v.push(draw(TITLE, c.title, f.title, 'white', '(w-text_w)/2', f.titleY, border + fade(c)))
        v.push(draw(BODY, c.sub, f.sub, GOLD, '(w-text_w)/2', f.subY, ':borderw=5:bordercolor=0x10131c' + fade(c)))
    }
    v.push('format=yuv420p')
    const a = ORBIT.audio
    ff(['-t', String(t), '-i', join(OUT, f.orbit), '-ss', String(a.at), '-t', String(t), '-i', a.src,
        '-map', '0:v:0', '-map', '1:a:0', '-vf', v.join(','),
        '-af', `aformat=sample_rates=48000:channel_layouts=stereo,${levelled(a.src, a.at, t)},afade=t=out:st=${t - 0.2}:d=0.2`,
        ...VIDEO_TMP, ...AUDIO_OUT, '-t', String(t), file])
}

/** the turn's last second played backwards, fast: the cue that we're going back */
function renderRewind(f, file) {
    const d = 0.45
    const v = [`trim=start=${ORBIT.secs - 1.35}:end=${ORBIT.secs}`, 'setpts=PTS-STARTPTS', 'reverse', `setpts=PTS/3`, `scale=${f.W}:${f.H}`, 'setsar=1',
        'eq=saturation=0.5:brightness=0.04',
        draw(BODY, '◀◀', Math.round(f.W / 6), 'white@0.92', '(w-text_w)/2', '(h-text_h)/2', ':borderw=6:bordercolor=0x10131c'),
        'format=yuv420p']
    // a falling sweep, the tape running back
    const sweep = `aevalsrc='0.18*sin(2*PI*(1500*t-1400*t*t))*(1-t/${d})':s=48000:d=${d},aformat=channel_layouts=stereo`
    ff(['-i', join(OUT, f.orbit), '-f', 'lavfi', '-i', sweep, '-filter_complex', `[0:v]${v.join(',')}[v]`, '-map', '[v]', '-map', '1:a',
        ...VIDEO_TMP, ...AUDIO_OUT, '-t', String(d), file])
}

/** one step back: sped up, the caption naming the day and the part */
function renderShot(f, s, file) {
    const out = s.dur / s.speed
    const v = [`setpts=PTS/${s.speed}`, `fps=${FPS}`]
    if (f.band) {
        // 3:4 out of the 16:9 recording, between two bands
        const cw = 810, cx = Math.max(cw / 2, Math.min(1920 - cw / 2, s.cx ?? 960))
        const ph = f.H - 2 * f.band
        v.push(`crop=${cw}:1080:${cx - cw / 2}:0`, `scale=${f.W}:${ph}:flags=lanczos`, `pad=${f.W}:${f.H}:0:${f.band}:color=${INK}`, 'setsar=1')
        v.push(draw(BODY, `◀◀  ${s.when}`, 64, GOLD, '(w-text_w)/2', 52))
        v.push(draw(BODY, s.what, 44, PAPER, '(w-text_w)/2', 146))
    } else {
        v.push(`scale=${f.W}:${f.H}`, 'setsar=1')
        v.push(draw(BODY, `◀◀  ${s.when} · ${s.what}`, 50, PAPER, '(w-text_w)/2', 'h*0.72', `:box=1:boxcolor=${INK}@0.78:boxborderw=22`))
    }
    v.push('format=yuv420p')
    ff(['-ss', String(s.at), '-t', String(s.dur), '-i', s.src, '-ss', String(s.at), '-t', String(out), '-i', s.src,
        '-map', '0:v:0', '-map', '1:a:0', '-dn', '-sn', '-map_chapters', '-1', '-vf', v.join(','),
        '-af', `aformat=sample_rates=48000:channel_layouts=stereo,${levelled(s.src, s.at, out)},afade=t=in:d=0.06,afade=t=out:st=${(out - 0.08).toFixed(3)}:d=0.08`,
        ...VIDEO_TMP, ...AUDIO_OUT, '-t', out.toFixed(3), file])
}

/** the end card: the game's name over the menu's colour */
function renderEnd(f, file) {
    const d = END.dur
    const k = f.W > f.H ? 1 : 0.8
    const fade = `fade=t=in:st=0:d=0.3,fade=t=out:st=${(d - 0.45).toFixed(2)}:d=0.45`
    const lines = [
        draw(TITLE, END.title, Math.round(150 * k), GOLD, '(w-text_w)/2', `h/2-${Math.round(170 * k)}`, ':shadowcolor=black:shadowx=5:shadowy=5'),
        draw(BODY, END.sub, Math.round(48 * k), PAPER, '(w-text_w)/2', `h/2+${Math.round(30 * k)}`),
        draw(BODY, END.foot, Math.round(34 * k), MUTED, '(w-text_w)/2', `h/2+${Math.round(110 * k)}`),
    ]
    ff(['-f', 'lavfi', '-i', `color=c=${INK}:s=${f.W}x${f.H}:r=${FPS}:d=${d}`, '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${d}`,
        '-vf', [...lines, fade, 'format=yuv420p'].join(','), ...VIDEO_TMP, ...AUDIO_OUT, '-t', String(d), file])
}

function build(name) {
    const f = FORMATS[name]
    const parts = join(OUT, `parts-${name}`)
    mkdirSync(parts, { recursive: true })
    const files = []
    const part = (n) => { const p = join(parts, `${n}.mp4`); files.push(p); return p }
    console.log(`${name}: the turn`)
    renderOrbit(f, part('00-orbit'))
    renderRewind(f, part('01-rewind'))
    SHOTS.forEach((s, i) => {
        console.log(`${name}: ${s.when} · ${s.what}`)
        renderShot(f, s, part(`${String(i + 2).padStart(2, '0')}-shot`))
    })
    renderEnd(f, part('99-end'))

    const out = join(OUT, `short-${name}.mp4`)
    const n = files.length
    const pre = files.map((_, i) => `[${i}:v:0]setsar=1[v${i}];[${i}:a:0]aresample=48000[a${i}]`).join(';')
    const streams = files.map((_, i) => `[v${i}][a${i}]`).join('')
    const filter = `${pre};${streams}concat=n=${n}:v=1:a=1[v][ca];[ca]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]`
    ff([...files.flatMap((p) => ['-i', p]), '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-crf', '19', '-preset', 'slow', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2),
        '-maxrate', '14M', '-bufsize', '28M', ...AUDIO_OUT, '-movflags', '+faststart', out])
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', out]).toString())
    const meta = { out, duration: +(+probe.format.duration).toFixed(2), sizeMB: +(probe.format.size / 1e6).toFixed(1) }
    console.log(`${out}: ${meta.duration} s, ${meta.sizeMB} MB`)
    return meta
}

const which = args.only ? [String(args.only)] : Object.keys(FORMATS)
const result = {}
for (const name of which) result[name] = build(name)
writeFileSync(join(OUT, 'shorts.json'), JSON.stringify({ result, shots: SHOTS.map(({ src, ...s }) => ({ src: src.replace(ROOT, ''), ...s })) }, null, 2))
