/*
 *  Records this tab (the 3D view and the HUD together) with MediaRecorder and
 *  hands each 1 s chunk to the harness, which appends it to one file. Needs
 *  Chrome's --auto-accept-this-tab-capture flag (no picker).
 *
 *  Sound: headless Chrome has no audio output, so tab capture records silence.
 *  The recorder makes its own audio track at the start instead, and once the
 *  game has created its sound (on the first click or key) it taps the game's
 *  master output into that track. The tap only listens: the game's sound
 *  graph and what it plays don't change.
 */

function toBase64(u8) {
    let s = ''
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
    return btoa(s)
}

export function installCapture() {
    let rec = null
    let stream = null
    let chain = Promise.resolve()
    let tapTimer = 0
    const w = /** @type {any} */ (window)
    w.__apCapture = {
        async start({ fps = 30, bitrate = 4_000_000 } = {}) {
            const video = { frameRate: { ideal: fps, max: fps }, width: { ideal: 1280 }, height: { ideal: 720 } }
            stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' })
            // the recording's own sound track (silent until the game's sound is tapped in)
            const mix = new AudioContext()
            await mix.resume().catch(() => {})
            const out = mix.createMediaStreamDestination()
            const tracks = [stream.getVideoTracks()[0], out.stream.getAudioTracks()[0]]
            let tapped = false
            tapTimer = setInterval(() => {
                const a = w.game && w.game.audio
                if (tapped || !a || !a.ctx || !a.master) return
                tapped = true
                const tap = a.ctx.createMediaStreamDestination()
                a.master.connect(tap)
                mix.createMediaStreamSource(tap.stream).connect(out)
                clearInterval(tapTimer)
            }, 250)
            const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']
            const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t))
            rec = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: bitrate, audioBitsPerSecond: 96_000 })
            rec.ondataavailable = (e) => {
                if (!e.data || !e.data.size) return
                // in order, one at a time
                chain = chain.then(async () => {
                    const buf = new Uint8Array(await e.data.arrayBuffer())
                    await w.__apChunk(toBase64(buf))
                })
            }
            rec.start(1000)
            const s = stream.getVideoTracks()[0].getSettings()
            return { mimeType, audio: 'game output', mixState: mix.state, width: s.width, height: s.height, fps: s.frameRate, surface: s.displaySurface }
        },
        async stop() {
            if (!rec) return
            clearInterval(tapTimer)
            const stopped = new Promise((r) => (rec.onstop = r))
            rec.stop()
            await stopped
            await chain
            for (const t of stream.getTracks()) t.stop()
        },
    }
}
