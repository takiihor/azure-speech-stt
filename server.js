import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const assets = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/styles.css', ['styles.css', 'text/css']]]);
export function createServer({key = process.env.AZURE_SPEECH_KEY, region = process.env.AZURE_SPEECH_REGION || 'eastasia', fetcher = fetch} = {}) {
  let cached;
  let pending;
  const issueToken = async () => {
    if (cached && cached.expiresAt > Date.now() + 60000) return cached;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetcher(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
        method: 'POST', headers: {'Ocp-Apim-Subscription-Key': key}, signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error('Azure rejected the credentials or region. Check your Speech resource settings.');
      const token = await response.text();
      if (!token.trim()) throw new Error('Azure returned an empty authorization token.');
      cached = {token, region, expiresAt: Date.now() + 9 * 60 * 1000};
      return cached;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Permissions-Policy', 'microphone=(self)');
    const json = (status, data) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(data)); };
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/token') {
      // A local-only endpoint. Reject cross-origin requests and DNS rebinding hosts.
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return json(403, {error: 'Only localhost access is enabled.'});
      const origin = req.headers.origin;
      if ((origin && origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') return json(403, {error: 'Cross-origin requests are not allowed.'});
      if (req.method !== 'POST') return json(405, {error: 'Use POST.'});
      if (!key) return json(503, {error: 'Set AZURE_SPEECH_KEY in the server .env file, then restart.'});
      if (!/^[a-z0-9-]+$/.test(region)) return json(503, {error: 'Invalid Azure region.'});
      try { return json(200, await issueToken()); }
      catch (error) { return json(502, {error: error.name === 'TimeoutError' ? 'Azure timed out. Please try again.' : 'Unable to authorize with Azure. Check the key, region, and network connection.'}); }
    }
    if (req.method !== 'GET' || !assets.has(pathname)) {res.writeHead(404); return res.end('Not found');}
    const [file, type] = assets.get(pathname);
    try { const body = await readFile(new URL(`./public/${file}`, import.meta.url)); res.writeHead(200, {'Content-Type': `${type}; charset=utf-8`}); res.end(body); }
    catch {res.writeHead(503); res.end('Run npm run build first.');}
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3030);
  createServer().listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Speech Notes is ready at http://localhost:${port}`));
}
