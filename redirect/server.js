const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 10000;
const TARGET_HOST = 'talkinpro-server.onrender.com';

const server = http.createServer((req, res) => {
  // Collect request body
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    
    // Forward headers, fix host
    const fwdHeaders = { ...req.headers };
    fwdHeaders.host = TARGET_HOST;
    if (body.length > 0) {
      fwdHeaders['content-length'] = body.length;
    }
    
    const options = {
      hostname: TARGET_HOST,
      port: 443,
      path: req.url,
      method: req.method,
      headers: fwdHeaders,
    };
    
    console.log(`${req.method} ${req.url} -> ${TARGET_HOST}`);
    
    const proxyReq = https.request(options, (proxyRes) => {
      // Copy status and headers
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });
    
    proxyReq.on('error', (e) => {
      console.error('Proxy error:', e.message, req.url);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Bad gateway' }));
    });
    
    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PORT, () => {
  console.log(`Reverse proxy running on port ${PORT} -> https://${TARGET_HOST}`);
});
