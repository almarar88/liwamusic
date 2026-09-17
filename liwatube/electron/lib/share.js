'use strict';
/**
 * LiwaTube — «مشاركة»: يشغّل خادم LiwaTube داخل تطبيق سطح المكتب فوق مكتبتك مباشرة (بلا رفع)،
 * يعرض عناوين الشبكة المحلية ورمز QR، ويفتح نفق Cloudflare سريعًا (بلا حساب) للوصول من الإنترنت.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const CF_BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
const CF_FILES = { 'win32-x64': 'cloudflared-windows-amd64.exe', 'win32-ia32': 'cloudflared-windows-386.exe', 'linux-x64': 'cloudflared-linux-amd64', 'linux-arm64': 'cloudflared-linux-arm64' };
const TUNNEL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** عناوين IP المحلية (IPv4 غير الداخلية) مرتبة: الشبكات الخاصة أولًا. */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ni.address);
      const virt = /vmware|virtualbox|vethernet|docker|wsl|hyper-v|loopback/i.test(name);
      out.push({ address: ni.address, name, score: (priv ? 2 : 0) + (virt ? -3 : 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.address);
}
/** يستخرج رابط النفق من مخرجات cloudflared. */
function parseTunnelUrl(text) { const m = TUNNEL_RE.exec(String(text || '')); return m ? m[0] : null; }

class Share {
  /**
   * @param {object} o { dataDir, createServer: (opts) => LiwaTubeServer, onChange, log }
   */
  constructor({ dataDir, createServer, onChange = () => {}, log = () => {} }) {
    this.dataDir = dataDir;
    this.binDir = path.join(dataDir, 'bin');
    this.createServer = createServer;
    this.onChange = onChange; this.log = log;
    this.server = null; this.port = 0;
    this.tunnel = { running: false, url: null, error: null, starting: false, progress: null };
    this.proc = null; this.wantTunnel = false;
  }

  status() {
    return {
      running: Boolean(this.server), port: this.port,
      lan: this.server ? lanAddresses().map((ip) => `http://${ip}:${this.port}`) : [],
      tunnel: { ...this.tunnel },
      cloudflaredReady: fs.existsSync(this.cfPath()), platformSupported: Boolean(this.cfName()),
    };
  }
  emit() { try { this.onChange(this.status()); } catch { /* تجاهل */ } }

  async start({ port = 8787, password = '' } = {}) {
    if (this.server) return this.status();
    const srv = this.createServer({ port, host: '0.0.0.0', log: this.log });
    if (password) srv.setAdminPassword(password);
    await srv.listen();
    this.server = srv; this.port = srv.port;
    this.emit();
    return this.status();
  }
  async stop() {
    this.tunnelStop();
    if (this.server) { const s = this.server; this.server = null; await s.close().catch(() => {}); }
    this.port = 0; this.emit();
    return this.status();
  }
  setPassword(password) { if (this.server) this.server.setAdminPassword(password); }

  // ---------- Cloudflare quick tunnel
  cfName() { return CF_FILES[`${process.platform}-${process.arch}`] || null; }
  cfPath() { return path.join(this.binDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'); }
  async ensureCloudflared() {
    const name = this.cfName();
    if (!name) throw new Error('UNSUPPORTED_PLATFORM');
    const dest = this.cfPath();
    if (fs.existsSync(dest)) return dest;
    await fsp.mkdir(this.binDir, { recursive: true });
    this.tunnel.progress = 0; this.emit();
    const res = await fetch(CF_BASE + name, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`DOWNLOAD_FAILED_${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    let got = 0;
    const tmp = `${dest}.part`;
    const counter = new (require('stream').Transform)({ transform: (chunk, _e, cb) => { got += chunk.length; if (total) { this.tunnel.progress = got / total; this.emit(); } cb(null, chunk); } });
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp));
    await fsp.rename(tmp, dest);
    if (process.platform !== 'win32') await fsp.chmod(dest, 0o755);
    this.tunnel.progress = null; this.emit();
    return dest;
  }
  async tunnelStart() {
    if (!this.server) throw new Error('SERVER_NOT_RUNNING');
    if (this.proc) return this.status();
    this.wantTunnel = true;
    this.tunnel = { running: false, url: null, error: null, starting: true, progress: null }; this.emit();
    let bin;
    try { bin = await this.ensureCloudflared(); }
    catch (e) { this.tunnel = { running: false, url: null, error: e.message, starting: false, progress: null }; this.emit(); throw e; }
    const proc = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${this.port}`, '--no-autoupdate', '--protocol', 'http2'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    const onData = (buf) => {
      const text = buf.toString('utf8');
      const url = parseTunnelUrl(text);
      if (url && !this.tunnel.url) { this.tunnel = { running: true, url, error: null, starting: false, progress: null }; this.log(`tunnel: ${url}`); this.emit(); }
      if (/ERR/.test(text) && /failed to (dial|connect)|Unauthorized|rate limit/i.test(text) && !this.tunnel.url) { this.tunnel.error = text.trim().slice(0, 200); this.emit(); }
    };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData);
    proc.on('exit', (code) => {
      this.proc = null;
      this.tunnel = { running: false, url: null, error: this.wantTunnel ? (this.tunnel.error || `EXIT_${code}`) : null, starting: false, progress: null };
      this.emit();
    });
    // انتظر الرابط حتى 40 ثانية
    const t0 = Date.now();
    while (!this.tunnel.url && this.proc && Date.now() - t0 < 40000) await new Promise((r) => setTimeout(r, 300));
    if (!this.tunnel.url) { this.tunnelStop(); this.tunnel.error = this.tunnel.error || 'TUNNEL_TIMEOUT'; this.emit(); throw new Error(this.tunnel.error); }
    return this.status();
  }
  tunnelStop() {
    this.wantTunnel = false;
    if (this.proc) { try { this.proc.kill(); } catch { /* */ } this.proc = null; }
    this.tunnel = { running: false, url: null, error: null, starting: false, progress: null };
    this.emit();
  }
  async qr(text) {
    const QR = require('qrcode');
    return QR.toDataURL(String(text), { margin: 1, width: 240, color: { dark: '#000000', light: '#ffffff' } });
  }
}

module.exports = { Share, lanAddresses, parseTunnelUrl };
