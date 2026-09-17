/** خادم تخزين وهمي متوافق مع S3 لاختبار مسار R2 بلا إنترنت. */
import http from 'node:http';

export function createMockS3() {
  const objects = new Map();      // key -> { body: Buffer, type: string }
  const calls = [];               // سجل الطلبات للفحص
  let cors = null;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const bucket = parts[0];
    const key = parts.slice(1).map(decodeURIComponent).join('/');
    const signed = url.searchParams.has('X-Amz-Signature');
    const authed = signed || (req.headers.authorization || '').startsWith('AWS4-HMAC-SHA256');
    calls.push({ method: req.method, key, signed, cors: url.searchParams.has('cors') });
    const end = (code, body, headers = {}) => { res.writeHead(code, headers); res.end(body); };
    if (!authed) return end(403, 'AccessDenied');
    if (url.searchParams.has('cors')) {
      if (req.method === 'PUT') { cors = await read(req); return end(200, ''); }
      return end(200, cors || '');
    }
    if (!bucket) return end(400, 'NoBucket');
    if (req.method === 'PUT') {
      const body = await read(req);
      objects.set(key, { body, type: req.headers['content-type'] || 'application/octet-stream' });
      return end(200, '', { ETag: '"mock"' });
    }
    const o = objects.get(key);
    if (req.method === 'GET') return o ? end(200, o.body, { 'Content-Type': o.type, 'Content-Length': String(o.body.length) }) : end(404, 'NoSuchKey');
    if (req.method === 'HEAD') { if (!o) return end(404, ''); res.writeHead(200, { 'Content-Type': o.type, 'Content-Length': String(o.body.length) }); return res.end(); }
    if (req.method === 'DELETE') { objects.delete(key); return end(204, ''); }
    return end(405, '');
  });
  const read = (req) => new Promise((resolve) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => resolve(Buffer.concat(c))); });
  return {
    server, objects, calls,
    get cors() { return cors; },
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))),
    close: () => new Promise((r) => server.close(r)),
  };
}
