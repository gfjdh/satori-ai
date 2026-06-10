// Static file server + /api proxy for Satori WebUI
const { createServer, request } = require('http');
const { readFile } = require('fs');
const { join, extname } = require('path');

const PORT = 5173;
const DIR = join(__dirname, 'dist');
const BACKEND_PORT = 3682;
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

createServer((req, res) => {
  // Proxy /api requests to backend
  if (req.url.startsWith('/api/') || req.url === '/api') {
    const options = {
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers
    };
    const proxy = request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxy.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Backend unavailable');
      }
    });
    req.pipe(proxy);
    return;
  }

  // Static file serving
  const file = join(DIR, req.url === '/' ? '/index.html' : req.url.split('?')[0]);
  readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`WebUI http://localhost:${PORT}`));
