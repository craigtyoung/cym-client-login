/* Craig Young Music — Client Preview & Approvals
   Zero-dependency static file server for Railway (or local).
   Serves this folder; PORT comes from Railway's env. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.mp3':'audio/mpeg', '.wav':'audio/wav',
  '.m4a':'audio/mp4', '.txt':'text/plain; charset=utf-8'
};

http.createServer(function(req, res){
  try{
    var urlPath = decodeURIComponent(req.url.split('?')[0]);
    if(urlPath === '/') urlPath = '/index.html';
    var filePath = path.join(ROOT, path.normalize(urlPath));
    if(filePath.indexOf(ROOT) !== 0){ res.writeHead(403); return res.end('Forbidden'); }
    fs.stat(filePath, function(err, st){
      if(err || !st.isFile()){ res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, {'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'});
      fs.createReadStream(filePath).pipe(res);
    });
  }catch(e){ res.writeHead(500); res.end('Server error'); }
}).listen(PORT, function(){ console.log('CYM Client Preview running on port ' + PORT); });
