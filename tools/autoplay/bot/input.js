/*
 *  The bot's hands: DOM input events, sent to the same places the browser
 *  sends real ones (keys to the document, mouse to the canvas), so they go
 *  through the game's own bindings. Mouse movement is how it looks around,
 *  with a capped, eased turning speed.
 */

const KEY = { Space: ' ', ShiftLeft: 'Shift', KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyE: 'e', KeyB: 'b', KeyN: 'n', KeyM: 'm', KeyR: 'r', KeyQ: 'q', KeyV: 'v', Escape: 'Escape' }

export class Input {
    /** @param {HTMLCanvasElement} canvas */
    constructor(canvas) {
        this.canvas = canvas
        /** keys held now */
        this.held = new Set()
        /** mouse buttons held now */
        this.buttons = new Set()
        /** fraction of a pixel left over from the last move (movement is sent in whole pixels) */
        this._carry = [0, 0]
        /** every key or click sent, for the logs */
        this.counts = { keys: 0, clicks: 0, hudClicks: 0 }
    }

    _key(type, code) {
        const key = KEY[code] || (code.startsWith('Digit') ? code.slice(5) : code)
        document.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true }))
    }

    keyDown(code) {
        if (this.held.has(code)) return
        this.held.add(code)
        this.counts.keys++
        this._key('keydown', code)
    }

    keyUp(code) {
        if (!this.held.has(code)) return
        this.held.delete(code)
        this._key('keyup', code)
    }

    /** press and release (the release comes on the next frame, like a real key tap) */
    tap(code) {
        this.keyUp(code)
        this.keyDown(code)
        requestAnimationFrame(() => this.keyUp(code))
    }

    /** hold exactly this set of keys (the movement keys), releasing the others */
    setMoveKeys(want) {
        for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft']) {
            if (want.has(code)) this.keyDown(code)
            else this.keyUp(code)
        }
    }

    _pointer(type, button, target) {
        const r = this.canvas.getBoundingClientRect()
        target.dispatchEvent(new PointerEvent(type, {
            pointerId: 1, pointerType: 'mouse', isPrimary: true, button, buttons: this.buttons.size ? 1 : 0,
            clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true,
        }))
    }

    /** 0 = left (dig / attack), 2 = right (place) */
    mouseDown(button = 0) {
        if (this.buttons.has(button)) return
        this.buttons.add(button)
        this.counts.clicks++
        this._pointer('pointerdown', button, this.canvas)
    }

    mouseUp(button = 0) {
        if (!this.buttons.has(button)) return
        this.buttons.delete(button)
        this._pointer('pointerup', button, document)
    }

    /** relative mouse movement in pixels (what pointer lock reports) */
    moveMouse(dx, dy) {
        const x = dx + this._carry[0], y = dy + this._carry[1]
        const ix = Math.round(x), iy = Math.round(y)
        this._carry[0] = x - ix
        this._carry[1] = y - iy
        if (!ix && !iy) return
        const r = this.canvas.getBoundingClientRect()
        this.canvas.dispatchEvent(new PointerEvent('pointermove', {
            pointerId: 1, pointerType: 'mouse', isPrimary: true, movementX: ix, movementY: iy, buttons: this.buttons.size ? 1 : 0,
            clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true,
        }))
    }

    /**
     * The mouse to a point on the screen (the aerial view, where the cursor is
     * free): what the game aims at from there is under it next frame.
     */
    pointerAt(x, y) {
        this.canvas.dispatchEvent(new PointerEvent('pointermove', {
            pointerId: 1, pointerType: 'mouse', isPrimary: true, movementX: 0, movementY: 0, buttons: 0,
            clientX: x, clientY: y, bubbles: true,
        }))
    }

    /**
     * A click at a point on the screen without moving between press and release
     * (so the aerial view takes it as a click, not a drag): 0 = left (pan there),
     * 2 = right (build there). The release comes on the next frame.
     */
    clickAt(x, y, button = 2) {
        this.counts.clicks++
        const ev = (type) => new PointerEvent(type, {
            pointerId: 1, pointerType: 'mouse', isPrimary: true, button, buttons: type === 'pointerdown' ? 1 : 0,
            clientX: x, clientY: y, bubbles: true, cancelable: true,
        })
        this.canvas.dispatchEvent(ev('pointerdown'))
        return new Promise((resolve) => requestAnimationFrame(() => {
            document.dispatchEvent(ev('pointerup'))
            resolve(undefined)
        }))
    }

    /** click a HUD element (a button the player can see) */
    click(el) {
        if (!el) return false
        this.counts.hudClicks++
        el.click()
        return true
    }

    releaseAll() {
        for (const code of [...this.held]) this.keyUp(code)
        for (const b of [...this.buttons]) this.mouseUp(b)
    }
}
