/*
 *  Touch controls: left virtual joystick (movement / aerial pan), drag
 *  anywhere else to look, pinch to zoom, action buttons on the right.
 *  Writes into noa's input state so the rest of the game doesn't care
 *  whether input came from keys or touches.
 */

/** share of the stick's travel past which you run instead of walking */
const RUN_AT = 0.76

export class TouchControls {
    /**
     * @param {HTMLElement} root  overlay element (sibling of the game canvas)
     * @param {import('noa-engine').Engine} noa
     * @param {object} handlers
     * @param {(dx: number, dy: number) => void} handlers.look
     * @param {(scale: number) => void} handlers.pinch
     * @param {(x: number, y: number) => void} handlers.tap
     * @param {(name: string, down: boolean) => void} handlers.button
     * @param {(on: boolean) => void} handlers.run  stick pushed out to the rim
     */
    constructor(root, noa, handlers) {
        this.noa = noa
        this.handlers = handlers
        this.enabled = false
        this.root = root
        root.innerHTML = `
            <div class="t-stick"><div class="t-knob"></div></div>
            <div class="t-buttons">
                <button data-b="jump" class="t-btn t-jump" aria-label="Jump">⤒</button>
                <button data-b="fire" class="t-btn t-fire" aria-label="Mine or attack">⛏</button>
                <button data-b="alt" class="t-btn t-alt" aria-label="Place">▣</button>
            </div>`
        /** @type {HTMLElement} */
        this.fireBtn = root.querySelector('.t-fire')
        /** @type {HTMLElement} */
        this.stick = root.querySelector('.t-stick')
        /** @type {HTMLElement} */
        this.knob = root.querySelector('.t-knob')
        this.stickTouch = null
        this.stickOrigin = [0, 0]
        this.stickT0 = 0
        this.stickMoved = 0
        this.looks = new Map()
        this.pinchDist = 0

        for (const btn of root.querySelectorAll('.t-btn')) {
            const name = btn.getAttribute('data-b')
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault()
                e.stopPropagation()
                btn.classList.add('down')
                handlers.button(name, true)
            }, { passive: false })
            const up = (e) => {
                e.preventDefault()
                btn.classList.remove('down')
                handlers.button(name, false)
            }
            btn.addEventListener('touchend', up, { passive: false })
            btn.addEventListener('touchcancel', up, { passive: false })
        }

        this._onStart = (e) => this._start(e)
        this._onMove = (e) => this._move(e)
        this._onEnd = (e) => this._end(e)
    }

    /** attach look/joystick listeners to the game surface */
    /** the fire button shows what it does: mine, swing, shoot */
    setFireIcon(glyph) {
        if (this.fireBtn) this.fireBtn.textContent = glyph
    }

    attach(surface) {
        this.surface = surface
        surface.addEventListener('touchstart', this._onStart, { passive: false })
        surface.addEventListener('touchmove', this._onMove, { passive: false })
        surface.addEventListener('touchend', this._onEnd, { passive: false })
        surface.addEventListener('touchcancel', this._onEnd, { passive: false })
    }

    enable() {
        this.enabled = true
        this.root.classList.add('on')
        document.body.classList.add('touch')
    }

    _start(e) {
        if (!this.enabled) this.enable()
        e.preventDefault()
        for (const t of e.changedTouches) {
            const leftZone = t.clientX < window.innerWidth * 0.4 && t.clientY > window.innerHeight * 0.35
            if (leftZone && this.stickTouch === null) {
                this.stickTouch = t.identifier
                this.stickOrigin = [t.clientX, t.clientY]
                this.stickT0 = performance.now()
                this.stickMoved = 0
                this.stick.style.left = `${t.clientX - 60}px`
                this.stick.style.top = `${t.clientY - 60}px`
                this.stick.classList.add('active')
            } else {
                this.looks.set(t.identifier, { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t0: performance.now() })
            }
        }
        if (this.looks.size === 2) this.pinchDist = this._pinchDistance()
    }

    _pinchDistance() {
        const [a, b] = [...this.looks.values()]
        return Math.hypot(a.x - b.x, a.y - b.y)
    }

    _move(e) {
        e.preventDefault()
        for (const t of e.changedTouches) {
            if (t.identifier === this.stickTouch) {
                let dx = t.clientX - this.stickOrigin[0], dy = t.clientY - this.stickOrigin[1]
                const len = Math.hypot(dx, dy)
                this.stickMoved = Math.max(this.stickMoved, len)
                const max = 50
                if (len > max) {
                    dx = dx / len * max
                    dy = dy / len * max
                }
                this.knob.style.transform = `translate(${dx}px, ${dy}px)`
                // pushed out to the rim: run, and the knob lights up to say so
                const run = len >= max * RUN_AT
                this.knob.classList.toggle('run', run)
                this.handlers.run(run)
                const s = this.noa.inputs.state
                const dead = 14
                s.forward = dy < -dead
                s.backward = dy > dead
                s.left = dx < -dead
                s.right = dx > dead
            } else if (this.looks.has(t.identifier)) {
                const l = this.looks.get(t.identifier)
                const dx = t.clientX - l.x, dy = t.clientY - l.y
                l.x = t.clientX
                l.y = t.clientY
                if (this.looks.size === 1) this.handlers.look(dx, dy)
            }
        }
        if (this.looks.size === 2) {
            const d = this._pinchDistance()
            if (this.pinchDist > 0 && d > 0) this.handlers.pinch(d / this.pinchDist)
            this.pinchDist = d
        }
    }

    _end(e) {
        e.preventDefault()
        for (const t of e.changedTouches) {
            if (t.identifier === this.stickTouch) {
                this.stickTouch = null
                this.knob.style.transform = ''
                this.knob.classList.remove('run')
                this.stick.classList.remove('active')
                this.handlers.run(false)
                const s = this.noa.inputs.state
                s.forward = s.backward = s.left = s.right = false
                // a quick touch that never moved the stick is a tap (e.g. on a unit)
                if (this.stickMoved < 12 && performance.now() - this.stickT0 < 300) this.handlers.tap(t.clientX, t.clientY)
            } else if (this.looks.has(t.identifier)) {
                const l = this.looks.get(t.identifier)
                this.looks.delete(t.identifier)
                const moved = Math.hypot(t.clientX - l.sx, t.clientY - l.sy)
                if (moved < 12 && performance.now() - l.t0 < 300) this.handlers.tap(t.clientX, t.clientY)
            }
        }
        if (this.looks.size < 2) this.pinchDist = 0
    }
}
