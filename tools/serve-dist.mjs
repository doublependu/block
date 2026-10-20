/*
 *  Serves dist/ like a real static host: HTTP/2 + TLS (self-signed, localhost)
 *  and brotli, every file compressed up front (a real host serves pre-compressed
 *  files; compressing on the first request would add seconds of server time).
 *
 *  Used by tools/perf/load-test.mjs and tools/autoplay/run.mjs.
 *
 *  `plain`: HTTP/1.1 without TLS, on every address, for tools/autoplay/room-check.mjs. A
 *  page served over HTTPS can't reach a p3p2 server on this machine (plain ws://), and
 *  a room is made for the address its players open the game at, this machine's on the LAN.
 */

import http2 from 'node:http2'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'

export const DIST = new URL('../dist/', import.meta.url).pathname

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' }

/**
 * @param {{port?: number, dir?: string, plain?: string}} [o] plain: the host name to serve plain HTTP as
 * @returns {Promise<{url: string, close: () => void}>}
 */
export async function serveDist({ port = 4180, dir = DIST, plain = '' } = {}) {
    const cache = new Map()
    // a browser takes brotli over HTTPS only
    const pack = plain ? (b) => gzipSync(b, { level: 9 }) : brotliCompressSync
    /** @param {any} req @param {any} res */
    const handle = (req, res) => {
        let path = decodeURIComponent(req.url.split('?')[0])
        if (path.endsWith('/')) path += 'index.html'
        const file = join(dir, path)
        if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
            res.writeHead(404)
            return res.end()
        }
        if (!cache.has(file)) cache.set(file, pack(readFileSync(file)))
        res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'content-encoding': plain ? 'gzip' : 'br', 'cache-control': 'no-store' })
        res.end(cache.get(file))
    }
    let server
    if (plain) server = http.createServer(handle)
    else {
        const keyFile = join(tmpdir(), 'block-perf-key.pem'), certFile = join(tmpdir(), 'block-perf-cert.pem')
        if (!existsSync(certFile)) {
            execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '365', '-subj', '/CN=localhost'], { stdio: 'ignore' })
        }
        server = http2.createSecureServer({ key: readFileSync(keyFile), cert: readFileSync(certFile), allowHTTP1: true }, handle)
    }
    await new Promise((r) => server.listen(port, plain ? '0.0.0.0' : undefined, r))
    const precompress = (d) => {
        for (const name of readdirSync(d)) {
            const full = join(d, name)
            if (statSync(full).isDirectory()) precompress(full)
            else cache.set(full, pack(readFileSync(full)))
        }
    }
    precompress(dir)
    return { url: plain ? `http://${plain}:${port}/` : `https://localhost:${port}/`, close: () => server.close() }
}
