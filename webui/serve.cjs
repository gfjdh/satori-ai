// Zero-dependency static file server for Satori WebUI
const { createServer } = require('http');
const { readFile } = require('fs');
const { join, extname } = require('path');
const PORT = 5173;
const DIR = join(__dirname, 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

createServer((req, res) => {
  const file = join(DIR, req.url === '/' ? '/index.html' : req.url.split('?')[0]);
  readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`WebUI http://localhost:${PORT}`));
