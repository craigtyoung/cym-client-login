/* Craig Young Music — Client Preview & Approvals  (v2 backend)
   Express app: admin/client logins, audio uploads, persistent JSON store.
   Data + audio live under DATA_DIR (point this at a Railway Volume in prod). */

const express = require('express');
const multer  = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT      = process.env.PORT || 3000;
const DATA_DIR  = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const ADMIN_CODE  = process.env.ADMIN_CODE  || 'craig-admin';
const CLIENT_CODE = process.env.CLIENT_CODE || 'sanctuary';

// ---------- helpers ----------
function slug(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function ensureDir(d){ if(!fs.existsSync(d)) fs.mkdirSync(d, {recursive:true}); }

// walk a category tree, calling fn(track) on every track
function eachTrack(data, fn){
  data.categories.forEach(function(cat){
    if(cat.subcategories) cat.subcategories.forEach(function(s){ s.tracks.forEach(fn); });
    else cat.tracks.forEach(fn);
  });
}
function findTrack(data, id){
  var found=null;
  eachTrack(data, function(tr){ if(tr.id===id) found=tr; });
  return found;
}

// ---------- seed on first run ----------
function seedData(){
  const seed = require('./seed.js');
  const data = JSON.parse(JSON.stringify({
    brand: seed.brand, client: seed.client, contact: seed.contact, categories: seed.categories
  }));
  data.approvals = {};
  eachTrack(data, function(tr){ tr.id = slug(tr.title); });
  // copy any bundled demo audio into the store + wire it
  ensureDir(AUDIO_DIR);
  const demo = seed.demoAudio || {};
  Object.keys(demo).forEach(function(tid){
    Object.keys(demo[tid]).forEach(function(stage){
      const fname = demo[tid][stage];
      const srcs = [path.join(__dirname,'audio',fname), path.join(__dirname,fname)];
      const src = srcs.find(function(p){ return fs.existsSync(p); });
      if(src){ try{ fs.copyFileSync(src, path.join(AUDIO_DIR, fname)); }catch(e){} }
      const tr = findTrack(data, tid);
      if(tr){ tr.audio[stage] = fname; tr[stage] = true; }
    });
  });
  return data;
}
function loadData(){
  ensureDir(DATA_DIR); ensureDir(AUDIO_DIR);
  if(!fs.existsSync(DATA_FILE)){
    const seeded = seedData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
}
function saveData(data){ fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

let DATA = loadData();

// ---------- auth ----------
const sessions = {}; // token -> role
function parseCookies(req){
  const out={}; const h=req.headers.cookie; if(!h) return out;
  h.split(';').forEach(function(p){ const i=p.indexOf('='); if(i>-1) out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim()); });
  return out;
}
function roleOf(req){ const sid=parseCookies(req).sid; return sid && sessions[sid] ? sessions[sid] : null; }
function requireAuth(req,res,next){ const r=roleOf(req); if(!r) return res.status(401).json({error:'not logged in'}); req.role=r; next(); }
function requireAdmin(req,res,next){ if(roleOf(req)!=='admin') return res.status(403).json({error:'admin only'}); next(); }

// ---------- app ----------
const app = express();
app.use(express.json());

app.post('/api/login', function(req,res){
  const code = (req.body && req.body.code || '').trim();
  let role=null;
  if(code === ADMIN_CODE) role='admin';
  else if(code === CLIENT_CODE) role='client';
  if(!role) return res.status(401).json({error:'Incorrect access code'});
  const token = crypto.randomBytes(24).toString('hex');
  sessions[token]=role;
  res.setHeader('Set-Cookie', 'sid='+token+'; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax');
  res.json({role:role});
});
app.get('/api/me', function(req,res){ res.json({role: roleOf(req)}); });
app.post('/api/logout', function(req,res){
  const sid=parseCookies(req).sid; if(sid) delete sessions[sid];
  res.setHeader('Set-Cookie','sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ok:true});
});

// full data (both roles). client gets same catalogue; role tells UI what to show.
app.get('/api/data', requireAuth, function(req,res){
  res.json({ role:req.role, brand:DATA.brand, client:DATA.client, contact:DATA.contact,
             categories:DATA.categories, approvals:DATA.approvals });
});

// ---- client actions ----
app.post('/api/approve', requireAuth, function(req,res){
  const {trackId, stage, approved} = req.body||{};
  if(['cleaned','final'].indexOf(stage)<0) return res.status(400).json({error:'bad stage'});
  const a = DATA.approvals[trackId] || (DATA.approvals[trackId]={});
  a[stage==='cleaned'?'cleanedApproved':'finalApproved'] = !!approved;
  saveData(DATA); res.json({ok:true, approvals:DATA.approvals[trackId]});
});
app.post('/api/note', requireAuth, function(req,res){
  const {trackId, stage, note} = req.body||{};
  if(['cleaned','music','final'].indexOf(stage)<0) return res.status(400).json({error:'bad stage'});
  const a = DATA.approvals[trackId] || (DATA.approvals[trackId]={});
  a[stage+'Note'] = String(note||'').slice(0,2000);
  saveData(DATA); res.json({ok:true});
});
app.post('/api/music-seen', requireAuth, function(req,res){
  const {trackId, seen} = req.body||{};
  const a = DATA.approvals[trackId] || (DATA.approvals[trackId]={});
  a.musicSeen = !!seen; saveData(DATA); res.json({ok:true});
});

// ---- admin actions ----
app.post('/api/track/:id', requireAdmin, function(req,res){
  const tr = findTrack(DATA, req.params.id);
  if(!tr) return res.status(404).json({error:'no track'});
  const p = req.body||{};
  ['raw'].forEach(function(k){ if(p[k]!=null) tr[k]=p[k]; });
  ['cleaned','music','final'].forEach(function(k){ if(p[k]!=null) tr[k]=!!p[k]; });
  ['induction','endMusic','note'].forEach(function(k){ if(p[k]!=null) tr[k]=String(p[k]).slice(0,300); });
  saveData(DATA); res.json({ok:true, track:tr});
});

const upload = multer({
  storage: multer.diskStorage({
    destination: function(req,file,cb){ ensureDir(AUDIO_DIR); cb(null, AUDIO_DIR); },
    filename: function(req,file,cb){ cb(null, 'tmp-'+crypto.randomBytes(8).toString('hex')+path.extname(file.originalname||'.mp3')); }
  }),
  limits: { fileSize: 120*1024*1024 } // 120MB
});
app.post('/api/upload', requireAdmin, upload.single('file'), function(req,res){
  const {trackId, stage} = req.body||{};
  if(['cleaned','music','final'].indexOf(stage)<0){ if(req.file) fs.unlinkSync(req.file.path); return res.status(400).json({error:'bad stage'}); }
  const tr = findTrack(DATA, trackId);
  if(!tr){ if(req.file) fs.unlinkSync(req.file.path); return res.status(404).json({error:'no track'}); }
  if(!req.file) return res.status(400).json({error:'no file'});
  const ext = path.extname(req.file.originalname||'.mp3') || '.mp3';
  const finalName = trackId+'-'+stage+ext;
  const dest = path.join(AUDIO_DIR, finalName);
  try{ if(fs.existsSync(dest)) fs.unlinkSync(dest); fs.renameSync(req.file.path, dest); }
  catch(e){ return res.status(500).json({error:'save failed'}); }
  tr.audio[stage] = finalName; tr[stage] = true;   // uploading a stage marks it ready
  saveData(DATA); res.json({ok:true, file:finalName, track:tr});
});

// ---- audio ----
app.get('/audio/:file', function(req,res){
  const f = path.basename(req.params.file);
  const p = path.join(AUDIO_DIR, f);
  if(!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(p);
});

// ---- static assets (allow-list; never serve server.js/seed.js/data) ----
app.get('/', function(req,res){ res.sendFile(path.join(__dirname,'index.html')); });
app.get(/\.(png|jpe?g|webp|svg|ico|css|html)$/i, function(req,res){
  const f = path.basename(decodeURIComponent(req.path));
  const p = path.join(__dirname, f);
  if(fs.existsSync(p)) return res.sendFile(p);
  res.status(404).end();
});

app.listen(PORT, function(){ console.log('CYM Client Preview (v2) on port '+PORT+'  data='+DATA_DIR); });
