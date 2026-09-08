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
function allIds(data){ var ids=[]; eachTrack(data, function(t){ ids.push(t.id); }); return ids; }
function uniqueId(data, title){
  var base = slug(title) || 'piece', id = base, i = 2, ids = allIds(data);
  while(ids.indexOf(id) >= 0){ id = base + '-' + (i++); }
  return id;
}
function listAt(data, catIndex, subIndex){
  var cat = data.categories[catIndex]; if(!cat) return null;
  if(cat.subcategories){ var sub = cat.subcategories[subIndex]; return sub ? sub.tracks : null; }
  return cat.tracks || null;
}
function removeTrackById(data, id){
  var removed = null;
  data.categories.forEach(function(cat){
    var lists = cat.subcategories ? cat.subcategories.map(function(s){ return s.tracks; }) : [cat.tracks];
    lists.forEach(function(list){
      var i = list.findIndex(function(t){ return t.id === id; });
      if(i >= 0) removed = list.splice(i,1)[0];
    });
  });
  return removed;
}
function newTrack(data, title, raw){
  return {
    id: uniqueId(data, title), title: String(title).slice(0,200),
    note: '',
    raw: raw || 'received', cleaned:false, music:false, final:false, art:false,
    audio: { raw:'', cleaned:'', music:'', final:'' }, cover:''
  };
}
// backfill new fields / drop retired ones on an already-seeded store
function normalizeData(data){
  var changed=false;
  eachTrack(data, function(tr){
    if(!('art' in tr)){ tr.art=false; changed=true; }
    if(!('cover' in tr)){ tr.cover=''; changed=true; }
    if(!tr.audio){ tr.audio={raw:'',cleaned:'',music:'',final:''}; changed=true; }
    ['raw','cleaned','music','final'].forEach(function(k){ if(!(k in tr.audio)){ tr.audio[k]=''; changed=true; } });
    if('induction' in tr){ delete tr.induction; changed=true; }
    if('endMusic' in tr){ delete tr.endMusic; changed=true; }
  });
  if(!data.approvals){ data.approvals={}; changed=true; }
  if(!data.auth){ data.auth={}; changed=true; }
  return changed;
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
    normalizeData(seeded);
    fs.writeFileSync(DATA_FILE, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
  if(normalizeData(data)) fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  return data;
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
// self-service access codes (hashed). Env ADMIN_CODE/CLIENT_CODE always work as a recovery fallback.
function hashCode(code){ const salt=crypto.randomBytes(16).toString('hex'); return salt+':'+crypto.scryptSync(String(code),salt,32).toString('hex'); }
function verifyCode(code, stored){
  if(!stored||!code) return false;
  const parts=String(stored).split(':'); if(parts.length!==2) return false;
  const h=crypto.scryptSync(String(code),parts[0],32).toString('hex');
  try{ return crypto.timingSafeEqual(Buffer.from(h,'hex'),Buffer.from(parts[1],'hex')); }catch(e){ return false; }
}

// ---------- app ----------
const app = express();
app.use(express.json());

app.post('/api/login', function(req,res){
  const code = (req.body && req.body.code || '').trim();
  let role=null;
  if(code === ADMIN_CODE || verifyCode(code, DATA.auth && DATA.auth.adminHash)) role='admin';
  else if(code === CLIENT_CODE || verifyCode(code, DATA.auth && DATA.auth.clientHash)) role='client';
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
// change your own role's access code (persisted, hashed). Env code still works as recovery.
app.post('/api/change-code', requireAuth, function(req,res){
  const nc=(req.body && req.body.newCode || '').trim();
  if(nc.length<4) return res.status(400).json({error:'Code must be at least 4 characters'});
  if(!DATA.auth) DATA.auth={};
  DATA.auth[req.role+'Hash']=hashCode(nc);
  saveData(DATA); res.json({ok:true});
});

// full data (both roles). client gets same catalogue; role tells UI what to show.
app.get('/api/data', requireAuth, function(req,res){
  res.json({ role:req.role, brand:DATA.brand, client:DATA.client, contact:DATA.contact,
             categories:DATA.categories, approvals:DATA.approvals });
});

// ---- client actions ----
app.post('/api/approve', requireAuth, function(req,res){
  const {trackId, stage, approved} = req.body||{};
  if(['cleaned','final','art'].indexOf(stage)<0) return res.status(400).json({error:'bad stage'});
  const a = DATA.approvals[trackId] || (DATA.approvals[trackId]={});
  a[stage+'Approved'] = !!approved;
  saveData(DATA); res.json({ok:true, approvals:DATA.approvals[trackId]});
});
app.post('/api/note', requireAuth, function(req,res){
  const {trackId, stage, note} = req.body||{};
  if(['cleaned','music','final','art'].indexOf(stage)<0) return res.status(400).json({error:'bad stage'});
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
  ['cleaned','music','final','art'].forEach(function(k){ if(p[k]!=null) tr[k]=!!p[k]; });
  if(p.title!=null) tr.title = String(p.title).slice(0,200);
  ['note'].forEach(function(k){ if(p[k]!=null) tr[k]=String(p[k]).slice(0,300); });
  saveData(DATA); res.json({ok:true, track:tr});
});

// ---- admin content editor ----
app.post('/api/track-add', requireAdmin, function(req,res){
  const {catIndex, subIndex, title, raw} = req.body||{};
  if(!title || !String(title).trim()) return res.status(400).json({error:'title required'});
  const list = listAt(DATA, catIndex, subIndex);
  if(!list) return res.status(400).json({error:'bad location'});
  const tr = newTrack(DATA, String(title).trim(), raw);
  list.push(tr); saveData(DATA); res.json({ok:true, track:tr});
});
app.post('/api/track-delete', requireAdmin, function(req,res){
  const id = (req.body||{}).id;
  const removed = removeTrackById(DATA, id);
  if(!removed) return res.status(404).json({error:'no track'});
  delete DATA.approvals[id];
  // best-effort remove its audio + cover files
  ['cleaned','music','final'].forEach(function(stage){
    var f = removed.audio && removed.audio[stage];
    if(f){ try{ fs.unlinkSync(path.join(AUDIO_DIR, f)); }catch(e){} }
  });
  if(removed.cover){ try{ fs.unlinkSync(path.join(AUDIO_DIR, removed.cover)); }catch(e){} }
  saveData(DATA); res.json({ok:true});
});
app.post('/api/category-add', requireAdmin, function(req,res){
  const {name, subtitle, kind} = req.body||{};
  if(!name || !String(name).trim()) return res.status(400).json({error:'name required'});
  const cat = { name: String(name).trim(), subtitle: String(subtitle||'').slice(0,140) };
  if(kind === 'parent') cat.subcategories = []; else cat.tracks = [];
  DATA.categories.push(cat); saveData(DATA); res.json({ok:true});
});
app.post('/api/subcategory-add', requireAdmin, function(req,res){
  const {catIndex, name} = req.body||{};
  const cat = DATA.categories[catIndex];
  if(!cat || !cat.subcategories) return res.status(400).json({error:'category has no sub-collections'});
  if(!name || !String(name).trim()) return res.status(400).json({error:'name required'});
  cat.subcategories.push({ name: String(name).trim(), tracks: [] });
  saveData(DATA); res.json({ok:true});
});

const upload = multer({
  storage: multer.diskStorage({
    destination: function(req,file,cb){ ensureDir(AUDIO_DIR); cb(null, AUDIO_DIR); },
    filename: function(req,file,cb){ cb(null, 'tmp-'+crypto.randomBytes(8).toString('hex')+path.extname(file.originalname||'.mp3')); }
  }),
  limits: { fileSize: 120*1024*1024 } // 120MB
});
app.post('/api/upload', requireAuth, upload.single('file'), function(req,res){
  const {trackId, stage} = req.body||{};
  const cleanup = function(){ if(req.file){ try{ fs.unlinkSync(req.file.path); }catch(e){} } };
  if(['raw','cleaned','music','final','art'].indexOf(stage)<0){ cleanup(); return res.status(400).json({error:'bad stage'}); }
  // client may only upload the RAW recording; producing stages (incl. artwork) are admin-only
  if(stage!=='raw' && req.role!=='admin'){ cleanup(); return res.status(403).json({error:'admin only for this stage'}); }
  const tr = findTrack(DATA, trackId);
  if(!tr){ cleanup(); return res.status(404).json({error:'no track'}); }
  if(!req.file) return res.status(400).json({error:'no file'});
  const ext = path.extname(req.file.originalname||'') || (stage==='art'?'.png':'.mp3');
  const finalName = trackId+'-'+stage+ext;
  const dest = path.join(AUDIO_DIR, finalName);
  try{ if(fs.existsSync(dest)) fs.unlinkSync(dest); fs.renameSync(req.file.path, dest); }
  catch(e){ return res.status(500).json({error:'save failed'}); }
  if(stage==='art'){
    tr.cover = finalName; tr.art = true;                         // uploading the cover marks it ready for the client
  }else{
    if(!tr.audio) tr.audio={};
    tr.audio[stage] = finalName;
    if(stage==='raw'){ if(req.role==='client') tr.raw='received'; } // client (re)submission returns it to your review
    else { tr[stage] = true; }                                     // producing a stage marks it ready for the client
  }
  saveData(DATA); res.json({ok:true, file:finalName, track:tr});
});

// ---- audio + media (covers) — both served from the store dir ----
function serveStoreFile(req,res){
  const f = path.basename(req.params.file);
  const p = path.join(AUDIO_DIR, f);
  if(!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(p);
}
app.get('/audio/:file', serveStoreFile);
app.get('/media/:file', serveStoreFile);

// ---- static assets (allow-list; never serve server.js/seed.js/data) ----
app.get('/', function(req,res){ res.sendFile(path.join(__dirname,'index.html')); });
app.get(/\.(png|jpe?g|webp|svg|ico|css|html)$/i, function(req,res){
  const f = path.basename(decodeURIComponent(req.path));
  const p = path.join(__dirname, f);
  if(fs.existsSync(p)) return res.sendFile(p);
  res.status(404).end();
});

app.listen(PORT, function(){ console.log('CYM Client Preview (v2) on port '+PORT+'  data='+DATA_DIR); });
