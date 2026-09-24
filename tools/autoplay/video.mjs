/*
 *  After a recorded run: checks the video has no gaps, and encodes game.mp4
 *  (H.264, constant 30 fps, chapters for each phase of the game), contact
 *  sheets (a frame every 30 s) and an 8x copy for a quick watch.
 *
 *  Usage: node tools/autoplay/video.mjs <recording dir>
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** seconds → 1:02:03 / 2:03 */
export function clock(s) {
    s = Math.max(0, Math.floor(s))
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
    return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(sec).padStart(2, '0')}`
}

export function readJsonl(file) {
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
        try {
            return JSON.parse(l)
        } catch {
            return null
        }
    }).filter(Boolean)
}

/**
 * pure: chapters from the event log, in video time (the video starts when capture started)
 * @returns {{start: number, title: string}[]}
 */
export function chaptersFrom(events) {
    const cap = events.find((e) => e.type === 'capture')
    const zero = cap ? cap.wall : 0
    const out = [{ start: 0, title: 'Menu' }]
    const play = events.find((e) => e.type === 'play')
    if (play) out.push({ start: play.wall - zero, title: 'Loading' })
    for (const e of events) {
        if (e.type !== 'phase') continue
        let title
        if (e.phase === 'night') title = e.opening ? 'Opening raid' : `Night ${e.level}`
        else if (e.phase === 'day') title = `Day ${e.day}`
        else if (e.phase === 'dusk') title = `Dusk (night ${e.level})`
        else title = e.opening ? 'Dawn after the raid' : `Dawn after night ${e.level}${e.result ? ` (${e.result === 'survived' ? 'won' : 'lost'})` : ''}`
        out.push({ start: e.wall - zero, title })
    }
    // a night's result belongs in its title
    for (const e of events) {
        if (e.type !== 'nightOver' || e.opening) continue
        const ch = [...out].reverse().find((c) => c.start <= e.wall - zero + 0.01 && c.title === `Night ${e.level}`)
        if (ch) ch.title += e.result === 'survived' ? ' (won)' : ' (lost)'
    }
    return out.filter((c) => c.start >= 0)
}

/** @param {string} dir */
export function finishVideo(dir) {
    const webm = join(dir, 'game.webm')
    const mp4 = join(dir, 'game.mp4')
    // frame timestamps: the capture only sends frames while the page changes, so a gap is a stall
    const pts = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', webm], { maxBuffer: 1 << 28 })
        .toString().split('\n').map(Number).filter((n) => isFinite(n)).sort((a, b) => a - b)
    let maxGap = 0, gaps = 0, maxAt = 0
    const gapList = []
    for (let i = 1; i < pts.length; i++) {
        const d = pts[i] - pts[i - 1]
        if (d > maxGap) {
            maxGap = d
            maxAt = pts[i - 1]
        }
        if (d > 0.25) {
            gaps++
            if (gapList.length < 50) gapList.push([+pts[i - 1].toFixed(2), +d.toFixed(3)])
        }
    }
    const duration = pts.length ? pts[pts.length - 1] : 0

    const events = readJsonl(join(dir, 'events.jsonl'))
    const chapters = chaptersFrom(events)
    const end = duration * 1000
    let meta = ';FFMETADATA1\ntitle=Block: one game, played by the autoplay bot\n'
    chapters.forEach((c, i) => {
        const s = Math.round(c.start * 1000)
        const e = i + 1 < chapters.length ? Math.round(chapters[i + 1].start * 1000) : Math.round(end)
        if (e <= s) return
        meta += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${s}\nEND=${e}\ntitle=${c.title.replace(/[=;#\\\n]/g, ' ')}\n`
    })
    writeFileSync(join(dir, 'chapters.ffmeta'), meta)
    writeFileSync(join(dir, 'chapters.txt'), chapters.map((c) => `${clock(c.start)} ${c.title}`).join('\n') + '\n')

    const hasAudio = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', webm]).toString().trim() !== ''
    execFileSync('ffmpeg', [
        '-y', '-v', 'error', '-i', webm, '-i', join(dir, 'chapters.ffmeta'), '-map_metadata', '1', '-map_chapters', '1',
        '-map', '0:v:0', ...(hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '96k'] : []),
        // slow, CRF 18, tuned for flat colour and hard edges: the second encode costs
        // SSIM 0.004 instead of iteration 7's veryfast CRF 23 at 0.021 (tools/autoplay/capture-test.mjs)
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr', '-r', '30',
        '-movflags', '+faststart', mp4,
    ], { stdio: ['ignore', 'ignore', 'inherit'] })
    // contact sheets: a frame every 30 s, 12 to a sheet (each sheet is 6 minutes of the game)
    mkdirSync(join(dir, 'sheets'), { recursive: true })
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-vf', 'fps=1/30,scale=426:-1,drawtext=text=\'%{pts\\:hms}\':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6,tile=4x3',
        join(dir, 'sheets', 'sheet-%02d.jpg')], { stdio: ['ignore', 'ignore', 'inherit'] })
    // a quick watch: the same video at 8x (no sound), next to the real-time one
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-an', '-vf', 'setpts=PTS/8', '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(dir, 'game-8x.mp4')], { stdio: ['ignore', 'ignore', 'inherit'] })
    const result = { mp4, duration, frames: pts.length, maxGap, maxGapAt: maxAt, gaps, gapList, audio: hasAudio, chapters: chapters.length }
    writeFileSync(join(dir, 'video.json'), JSON.stringify(result, null, 2))
    return result
}

if (process.argv[1] && process.argv[1].endsWith('video.mjs')) {
    const r = finishVideo(process.argv[2])
    console.log(JSON.stringify(r, null, 2))
}
