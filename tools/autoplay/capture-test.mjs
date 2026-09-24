/*
 *  How much each stage of the recording loses (prompt 9, issue 2).
 *
 *  Takes runs made with `run.mjs --record --lab=... --stills=...`: the game
 *  was frozen at a few moments and a lossless PNG taken of what was on screen.
 *  For each still it pulls the video frame from the same moment out of
 *
 *    webm        what the browser's recorder wrote (MediaRecorder, VP9, realtime)
 *    mp4-fast    that re-encoded the way video.mjs did up to iteration 8 (x264 veryfast, CRF 23)
 *    mp4-slow    re-encoded with the settings video.mjs uses now (x264 slow, CRF 18, tune animation)
 *
 *  and scores it against the PNG (SSIM: 1 is identical; PSNR in dB, higher is
 *  closer). The video's clock doesn't line up with the harness's (the capture
 *  starts late, and sends no frames while the picture doesn't change), so the
 *  frame used is the one in the whole video that matches the still best. The
 *  frozen frame is the last one sent before a pause, so it's encoded like any
 *  frame in motion.
 *
 *  It also writes crops of the same spot at each stage (crops/), and for two
 *  runs at different resolutions, both scaled to 1920×1080 the way a
 *  full-screen player shows them.
 *
 *  Usage: node tools/autoplay/capture-test.mjs <run dir> [<run dir> …]
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
/** SSIM and PSNR of a frame against the reference (scaled to the reference's size): ffmpeg's log */
function scoreOf(frame, ref) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', frame, '-i', ref, '-lavfi', '[0:v][1:v]scale2ref=flags=bicubic[a][b];[a]split[a1][a2];[b]split[b1][b2];[a1][b1]ssim;[a2][b2]psnr', '-f', 'null', '-'])
    return String(r.stderr)
}

/** the time of the video frame most like the still (SSIM over every frame) */
function bestMatch(video, ref) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', video, '-loop', '1', '-i', ref,
        '-lavfi', '[0:v]setpts=PTS-STARTPTS,scale=640:360:flags=area[a];[1:v]scale=640:360:flags=area[b];[a][b]ssim=stats_file=-:shortest=1', '-f', 'null', '-'], { maxBuffer: 1 << 28 })
    let best = { t: 0, ssim: -1 }
    const lines = String(r.stdout).split('\n')
    // stats lines follow the video's frames in order; their times come from a second pass
    const times = String(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', video], { maxBuffer: 1 << 26 }).stdout).trim().split('\n').map((l) => parseFloat(l))
    lines.forEach((l, i) => {
        const m = /All:([\d.]+)/.exec(l)
        if (m && Number(m[1]) > best.ssim) best = { t: times[i] - times[0], ssim: Number(m[1]) }
    })
    return best
}

const bitrateOf = (file, seconds) => (statSync(file).size * 8) / seconds / 1e6

const results = []
const runs = process.argv.slice(2)
if (!runs.length) {
    console.error('usage: node tools/autoplay/capture-test.mjs <run dir> [<run dir> …]')
    process.exit(2)
}

for (const dir of runs) {
    const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'))
    const webm = join(dir, 'game.webm')
    const work = join(dir, 'capture-test')
    mkdirSync(work, { recursive: true })
    const seconds = run.minutes * 60
    const fast = join(work, 'mp4-fast.mp4')
    const slow = join(work, 'mp4-slow.mp4')
    if (!existsSync(fast)) {
        ff(['-v', 'error', '-i', webm, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr', '-r', '30', fast])
    }
    if (!existsSync(slow)) {
        ff(['-v', 'error', '-i', webm, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr', '-r', '30', slow])
    }
    const sources = { webm, 'mp4-fast': fast, 'mp4-slow': slow }
    const rates = { webm: bitrateOf(webm, seconds), 'mp4-fast': bitrateOf(fast, seconds), 'mp4-slow': bitrateOf(slow, seconds) }
    const size = String(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', webm])).trim().replace('x', '×')
    for (const s of run.stills) {
        const ref = join(dir, 'stills', `${String(s.at).padStart(4, '0')}.png`)
        for (const [name, src] of Object.entries(sources)) {
            const best = bestMatch(src, ref)
            const frame = join(work, `${s.at}-${name}.png`)
            ff(['-v', 'error', '-i', src, '-ss', String(best.t), '-frames:v', '1', frame])
            const text = scoreOf(frame, ref)
            const ssim = Number((/SSIM .*All:([\d.]+)/.exec(text) || [])[1])
            const psnr = Number((/PSNR .*average:([\d.inf]+)/.exec(text) || [])[1])
            results.push({ run: basename(dir), dpr: run.dpr, capture: size, still: s.at, t: best.t, stage: name, ssim, psnr, mbps: rates[name] })
        }
    }
}

// ---- the table: mean over the stills, per run and stage
const key = (r) => `${r.run}|${r.stage}`
const groups = new Map()
for (const r of results) {
    if (!groups.has(key(r))) groups.set(key(r), [])
    groups.get(key(r)).push(r)
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
let md = '| run | picture | stage | Mbps | SSIM | PSNR dB |\n|---|---|---|---|---|---|\n'
for (const [, rs] of groups) {
    const r = rs[0]
    md += `| ${r.run} | ${r.capture} | ${r.stage} | ${r.mbps.toFixed(1)} | ${mean(rs.map((x) => x.ssim)).toFixed(4)} | ${mean(rs.map((x) => x.psnr)).toFixed(2)} |\n`
}
console.log(md)
const outDir = runs[0]
writeFileSync(join(outDir, 'capture-test.md'), md)
writeFileSync(join(outDir, 'capture-test.json'), JSON.stringify(results, null, 2))

// ---- crops: the same spot at each stage, and each run as a full-screen player shows it
const crops = join(outDir, 'crops')
mkdirSync(crops, { recursive: true })
for (const dir of runs) {
    const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'))
    const s = run.stills[Math.floor(run.stills.length / 2)]
    const work = join(dir, 'capture-test')
    const ref = join(dir, 'stills', `${String(s.at).padStart(4, '0')}.png`)
    // everything at 1920×1080 (a full-screen 1080p player), then the middle 640×360 at 2× so pixels show
    const crop = 'scale=1920:1080:flags=bicubic,crop=640:360:640:360,scale=1280:720:flags=neighbor'
    const inputs = [ref, join(work, `${s.at}-webm.png`), join(work, `${s.at}-mp4-fast.png`), join(work, `${s.at}-mp4-slow.png`)]
    const labels = ['lossless', 'webm', 'mp4 fast', 'mp4 slow']
    const parts = inputs.map((f, i) => {
        const o = join(crops, `${basename(dir)}-${i}.png`)
        ff(['-v', 'error', '-i', f, '-vf', `${crop},drawtext=text='${basename(dir)} ${labels[i]}':x=10:y=10:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.6`, o])
        return o
    })
    ff(['-v', 'error', ...parts.flatMap((p) => ['-i', p]), '-filter_complex', 'xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0', join(crops, `${basename(dir)}-stages.png`)])
}
console.log(`crops: ${crops}`)
