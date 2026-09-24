/*
 *  Checking sounds nobody here can hear (plan 9 §4.4).
 *
 *  Renders every recipe offline in Chrome (through the sound board's
 *  window.__renderSound), then for each one:
 *    - measures its peak and its loudness (the loudest 50 ms, as RMS dBFS —
 *      for sounds this short that's what the ear goes by)
 *    - sets its `level` so it lands on its category's target: a footstep can't
 *      be louder than a cannon, and nothing clips (src/audio/levels.json)
 *    - draws its spectrogram, all of them on one sheet, to catch two sounds
 *      that came out the same
 *    - writes the WAVs, to listen to outside the game
 *
 *  Usage: node tools/sound-check.mjs [--no-build] [--out=recordings/sound9]
 */

import { chromium } from 'playwright-core'
import { execSync, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { serveDist, DIST } from './serve-dist.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const ROOT = new URL('../', import.meta.url).pathname
const out = args.out || join(ROOT, 'recordings', 'sound9')
const RATE = 44100

/**
 * Loudness targets (the loudest 50 ms, dBFS) by recipe name, first match wins.
 * The ambience is played far away, so its targets are what it is at the source.
 */
const TARGETS = [
    [/^step_/, -30], [/^jump$|^land$/, -26], [/^refuse$/, -28],
    [/^swing_/, -22], [/^blow_heavy$/, -18], [/^hit_you$/, -18], [/^hit_/, -19],
    [/^bow_draw_/, -30], [/^string_/, -20], [/^musket$/, -14],
    [/^fire_(arrow|crossbow)$/, -22], [/^fire_ballista$/, -18], [/^fire_(cannon|mortar)$/, -12], [/^fire_bombard$/, -10],
    [/^impact_/, -24], [/^explosion$/, -10], [/^fuse$/, -26],
    [/^dig_/, -20], [/^break_/, -18], [/^bash_/, -20],
    [/^place_/, -22], [/^tower_build$/, -20], [/^upgrade_/, -22], [/^patch$/, -22],
    [/^hurt_/, -22], [/^death_/, -20], [/^town_bell$/, -16],
    [/^drum_/, -14], [/^war_cry$/, -16], [/^clash$/, -22], [/^bird$/, -30], [/^cricket$/, -34], [/^heartbeat$/, -20],
]
const targetOf = (name) => (TARGETS.find(([re]) => re.test(name)) || [null, -22])[1]

const db = (x) => 20 * Math.log10(Math.max(1e-9, x))

/** peak and loudest-50-ms RMS, dBFS */
function measure(s) {
    let peak = 0
    for (const v of s) peak = Math.max(peak, Math.abs(v))
    const win = Math.round(RATE * 0.05), hop = Math.round(win / 2)
    let best = 0
    for (let i = 0; i < s.length; i += hop) {
        const end = Math.min(s.length, i + win)
        let sum = 0
        for (let j = i; j < end; j++) sum += s[j] * s[j]
        best = Math.max(best, Math.sqrt(sum / win))
    }
    return { peak: db(peak), loud: db(best) }
}

function wav(samples, rate) {
    const b = Buffer.alloc(44 + samples.length * 2)
    b.write('RIFF', 0)
    b.writeUInt32LE(36 + samples.length * 2, 4)
    b.write('WAVEfmt ', 8)
    b.writeUInt32LE(16, 16)
    b.writeUInt16LE(1, 20)
    b.writeUInt16LE(1, 22)
    b.writeUInt32LE(rate, 24)
    b.writeUInt32LE(rate * 2, 28)
    b.writeUInt16LE(2, 32)
    b.writeUInt16LE(16, 34)
    b.write('data', 36)
    b.writeUInt32LE(samples.length * 2, 40)
    samples.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2))
    return b
}

if (!args['no-build'] || !existsSync(join(DIST, 'index.html'))) {
    console.log('building…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'wav'), { recursive: true })
mkdirSync(join(out, 'spectra'), { recursive: true })
const server = await serveDist({ port: 4192 })
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--ignore-certificate-errors'] })
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage()
page.on('pageerror', (e) => console.error('page error:', e.message))
await page.goto(server.url + '?soundboard')
await page.waitForFunction(() => window.__renderSound, null, { timeout: 30000 })
const names = await page.evaluate(() => window.__recipes)

const rows = []
const levels = {}
for (const name of names) {
    const s = await page.evaluate((n) => window.__renderSound(n, 0, 44100), name)
    const m = measure(s)
    const target = targetOf(name)
    // on target, but never peaking above -1 dBFS (a take can be a little louder than take 0)
    const level = Math.min(4, Math.pow(10, (target - m.loud) / 20), Math.pow(10, (-1 - m.peak) / 20))
    levels[name] = +level.toFixed(3)
    const after = { peak: m.peak + db(level), loud: m.loud + db(level) }
    rows.push({ name, ms: Math.round((s.length / RATE) * 1000), ...m, target, level: levels[name], peakAfter: after.peak })
    const file = join(out, 'wav', `${name}.wav`)
    writeFileSync(file, wav(s.map((v) => v * level), RATE))
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-lavfi', `showspectrumpic=s=320x160:legend=0:scale=log:fscale=log,drawtext=text='${name}':x=4:y=4:fontsize=14:fontcolor=white:box=1:boxcolor=black@0.6`, join(out, 'spectra', `${name}.png`)])
}
await browser.close()
server.close()

writeFileSync(join(ROOT, 'src/audio/levels.json'), JSON.stringify(levels, null, 1) + '\n')

// the sheet: eight across
const files = names.map((n) => join(out, 'spectra', `${n}.png`))
const cols = 8
const layout = files.map((_, i) => `${(i % cols) * 320}_${Math.floor(i / cols) * 160}`).join('|')
execFileSync('ffmpeg', ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `xstack=inputs=${files.length}:layout=${layout}:fill=black`, join(out, 'spectra.png')])

let md = '| sound | ms | peak dB | loudest 50 ms dB | target | level | peak after |\n|---|---|---|---|---|---|---|\n'
for (const r of rows) md += `| ${r.name} | ${r.ms} | ${r.peak.toFixed(1)} | ${r.loud.toFixed(1)} | ${r.target} | ${r.level} | ${r.peakAfter.toFixed(1)} |\n`
writeFileSync(join(out, 'levels.md'), md)
const clipping = rows.filter((r) => r.peakAfter > -1)
console.log(md)
console.log(`${rows.length} sounds; ${clipping.length} peak above -1 dBFS at their level${clipping.length ? ': ' + clipping.map((r) => r.name).join(', ') : ''}`)
console.log(`output: ${out}, src/audio/levels.json`)
