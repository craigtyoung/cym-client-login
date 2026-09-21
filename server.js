/* Craig Young Music — Client Preview & Approvals  (v3 backend)
   Multi-tenant: Client → Project → Recording (with optional group headings inside a project).
   One admin (Craig) across all clients; each project has its own client access code,
   catalogue and approvals. Data + audio live under DATA_DIR (a Railway Volume in prod). */

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

// walk a project's category tree, calling fn(track) on every track
function eachTrack(project, fn){
  (project.categories||[]).forEach(function(cat){
    if(cat.subcategories) cat.subcategories.forEach(function(s){ s.tracks.forEach(fn); });
    else cat.tracks.forEach(fn);
  });
}
function findTrack(project, id){
  var found=null;
  eachTrack(project, function(tr){ if(tr.id===id) found=tr; });
  return found;
}
function allIds(project){ var ids=[]; eachTrack(project, function(t){ ids.push(t.id); }); return ids; }
function uniqueId(project, title){
  var base = slug(title) || 'piece', id = base, i = 2, ids = allIds(project);
  while(ids.indexOf(id) >= 0){ id = base + '-' + (i++); }
  return id;
}
function listAt(project, catIndex, subIndex){
  var cat = project.categories[catIndex]; if(!cat) return null;
  if(cat.subcategories){ var sub = cat.subcategories[subIndex]; return sub ? sub.tracks : null; }
  return cat.tracks || null;
}
// Structure is Client → Project → Recording. "Groups" (categories) are optional headings inside a project; recordings that
// belong to no group live in one hidden, heading-less category flagged `implicit`.
function implicitCategory(project){
  var c=(project.categories||[]).filter(function(x){ return x.implicit; })[0];
  if(!c){ c={ name:'Recordings', subtitle:'', implicit:true, tracks:[] }; (project.categories=project.categories||[]).push(c); }
  return c;
}
function removeTrackById(project, id){
  var removed = null;
  (project.categories||[]).forEach(function(cat){
    var lists = cat.subcategories ? cat.subcategories.map(function(s){ return s.tracks; }) : [cat.tracks];
    lists.forEach(function(list){
      var i = list.findIndex(function(t){ return t.id === id; });
      if(i >= 0) removed = list.splice(i,1)[0];
    });
  });
  return removed;
}
function newTrack(project, title, raw){
  return {
    id: uniqueId(project, title), title: String(title).slice(0,200),
    note: '', description:'',
    raw: raw || 'none', cleaned:false, music:false, final:false, art:false,
    samples: ['','',''], recommended:0,
    audio: { raw:'', cleaned:'', music:'', final:'' }, cover:''
  };
}
function countPieces(project){ var n=0; eachTrack(project, function(){ n++; }); return n; }
// per-project numbers for the admin home (same definitions as the per-project dashboard)
// track details count as done once the client confirmed them (or, for older data, once a title was saved)
function detailsDone(a){ return !!(a && (a.detailsConfirmed || (a.metadata && a.metadata.title))); }
function projectStats(project){
  var s={ total:0, complete:0, toReview:0, rerecord:0, awaitingClient:0, changes:0, readyForFinal:0 }, A=project.approvals||{};
  eachTrack(project, function(tr){
    var a=A[tr.id]||{}; s.total++;
    if(a.finalApproved) s.complete++;
    if(tr.raw==='received') s.toReview++;
    if(tr.raw==='rerecord') s.rerecord++;
    if(tr.cleaned && !detailsDone(a)) s.awaitingClient++;
    // everything the final master depends on is in: vocal approved, music chosen, details confirmed
    if(a.cleanedApproved && a.musicSeen && detailsDone(a) && !tr.final) s.readyForFinal++;
    if(tr.cleaned && !a.cleanedApproved) s.awaitingClient++;
    if(tr.final && !a.finalApproved) s.awaitingClient++;
    if(tr.art && !a.artApproved) s.awaitingClient++;
    ['cleaned','music','final','art'].forEach(function(k){ if(a[k+'Note']) s.changes++; });
  });
  return s;
}
const RAW_STATUSES = ['none','received','accepted','rerecord'];   // none = no recording received yet
// A replaced or removed file must be re-approved: clear the client's approval for that stage.
function resetStageApprovals(project, trackId, stage, sampleIndex){
  var a = project.approvals && project.approvals[trackId]; if(!a) return;
  if(stage==='cleaned') a.cleanedApproved=false;
  else if(stage==='art') a.artApproved=false;
  else if(stage==='final'){ a.finalApproved=false; a.levelsApproved=false; a.wordingApproved=false; }
  else if(stage==='music' && a.musicSelected===sampleIndex){ a.musicSelected=-1; a.musicSeen=false; }
}
function removeStoreFile(name){ if(name){ try{ fs.unlinkSync(path.join(AUDIO_DIR, path.basename(name))); }catch(e){} } }
function removeTrackFiles(tr){
  var names=[]; if(tr.audio) ['raw','cleaned','music','final'].forEach(function(k){ names.push(tr.audio[k]); });
  (tr.samples||[]).forEach(function(f){ names.push(f); }); names.push(tr.cover);
  names.forEach(removeStoreFile);
}
function removeProjectFiles(project){ eachTrack(project, removeTrackFiles); removeStoreFile(project.art); }

// ---------- multi-tenant lookups ----------
function allProjects(){
  var out=[];
  (DATA.clients||[]).forEach(function(c){ (c.projects||[]).forEach(function(p){ out.push({client:c, project:p}); }); });
  return out;
}
function findProject(id){ var r=null; allProjects().forEach(function(x){ if(x.project.id===id) r=x; }); return r; }
function firstProject(){ var a=allProjects(); return a.length?a[0]:null; }
function uniqueClientId(name){ var base=slug(name)||'client', id=base, i=2, ids=(DATA.clients||[]).map(function(c){return c.id;}); while(ids.indexOf(id)>=0){ id=base+'-'+(i++); } return id; }
function uniqueProjectId(name){ var base=slug(name)||'project', id=base, i=2, ids=allProjects().map(function(x){return x.project.id;}); while(ids.indexOf(id)>=0){ id=base+'-'+(i++); } return id; }

// ---------- migration + normalization ----------
function normalizeProjectTracks(project){
  var changed=false;
  eachTrack(project, function(tr){
    if(!('art' in tr)){ tr.art=false; changed=true; }
    if(!('cover' in tr)){ tr.cover=''; changed=true; }
    if(!('description' in tr)){ tr.description=''; changed=true; }
    if(!Array.isArray(tr.samples)){ tr.samples=['','','']; if(tr.audio && tr.audio.music) tr.samples[0]=tr.audio.music; changed=true; }
    while(tr.samples.length<3){ tr.samples.push(''); changed=true; }
    if(!('recommended' in tr)){ tr.recommended=0; changed=true; }
    if(!tr.audio){ tr.audio={raw:'',cleaned:'',music:'',final:''}; changed=true; }
    ['raw','cleaned','music','final'].forEach(function(k){ if(!(k in tr.audio)){ tr.audio[k]=''; changed=true; } });
    if('induction' in tr){ delete tr.induction; changed=true; }
    if('endMusic' in tr){ delete tr.endMusic; changed=true; }
  });
  return changed;
}
// forward-migrate any older store to the nested Client → Project shape, then backfill fields.
function migrateData(data){
  var changed=false;
  if(!data.clients){
    changed=true;
    var oc = data.client || {name:'Client', project:'Project', preparedBy:'Craig Young', intro:''};
    var project = {
      id: slug(oc.project)||'project',
      name: oc.project||'Project',
      intro: oc.intro||'',
      preparedBy: oc.preparedBy||'Craig Young',
      auth: { clientHash: (data.auth && data.auth.clientHash) || null },
      categories: data.categories || [],
      approvals: data.approvals || {}
    };
    var client = {
      id: slug(oc.name)||'client',
      name: oc.name||'Client',
      contact: data.contact || {method:'WhatsApp'},
      projects: [project]
    };
    data.clients = [client];
    data.admin = { adminHash: (data.auth && data.auth.adminHash) || null };
    delete data.client; delete data.contact; delete data.categories; delete data.approvals; delete data.auth;
  }
  if(!data.admin){ data.admin={adminHash:null}; changed=true; }
  (data.clients||[]).forEach(function(c){
    if(!c.contact){ c.contact={method:'WhatsApp'}; changed=true; }
    (c.projects||[]).forEach(function(p){
      if(!p.approvals){ p.approvals={}; changed=true; }
      if(!p.auth){ p.auth={}; changed=true; }
      if(typeof p.preparedBy!=='string'){ p.preparedBy='Craig Young'; changed=true; }
      if(!('payUrl' in p)){ p.payUrl=''; changed=true; }
      if(!('payLabel' in p)){ p.payLabel=''; changed=true; }
      if(normalizeProjectTracks(p)) changed=true;
    });
  });
  return changed;
}

// ---------- seed on first run ----------
function seedData(){
  const seed = require('./seed.js');
  const project = {
    id: slug(seed.client.project)||'project',
    name: seed.client.project,
    intro: seed.client.intro,
    preparedBy: seed.client.preparedBy,
    auth: {},
    categories: JSON.parse(JSON.stringify(seed.categories)),
    approvals: {}
  };
  eachTrack(project, function(tr){ tr.id = slug(tr.title); });
  // copy any bundled demo audio into the store + wire it
  ensureDir(AUDIO_DIR);
  const demo = seed.demoAudio || {};
  Object.keys(demo).forEach(function(tid){
    Object.keys(demo[tid]).forEach(function(stage){
      const fname = demo[tid][stage];
      const srcs = [path.join(__dirname,'audio',fname), path.join(__dirname,fname)];
      const src = srcs.find(function(p){ return fs.existsSync(p); });
      if(src){ try{ fs.copyFileSync(src, path.join(AUDIO_DIR, fname)); }catch(e){} }
      const tr = findTrack(project, tid);
      if(tr){ if(stage==='art'){ tr.cover=fname; tr.art=true; } else { tr.audio[stage]=fname; tr[stage]=true; } }
    });
  });
  const client = { id: slug(seed.client.name)||'client', name: seed.client.name, contact: seed.contact || {method:'WhatsApp'}, projects:[project] };
  return { brand: seed.brand, admin:{adminHash:null}, clients:[client] };
}
function loadData(){
  ensureDir(DATA_DIR); ensureDir(AUDIO_DIR);
  if(!fs.existsSync(DATA_FILE)){
    const seeded = seedData();
    migrateData(seeded);
    fs.writeFileSync(DATA_FILE, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
  if(migrateData(data)) fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  return data;
}
function saveData(data){ fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

let DATA = loadData();

// ---------- auth ----------
const sessions = {}; // token -> { role, projectId }
function parseCookies(req){
  const out={}; const h=req.headers.cookie; if(!h) return out;
  h.split(';').forEach(function(p){ const i=p.indexOf('='); if(i>-1) out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim()); });
  return out;
}
function sessionOf(req){ const sid=parseCookies(req).sid; return sid && sessions[sid] ? sessions[sid] : null; }
function roleOf(req){ const s=sessionOf(req); return s?s.role:null; }
function requireAuth(req,res,next){ const s=sessionOf(req); if(!s) return res.status(401).json({error:'not logged in'}); req.role=s.role; req.session=s; next(); }
function requireAdmin(req,res,next){ const s=sessionOf(req); if(!s||s.role!=='admin') return res.status(403).json({error:'admin only'}); req.role='admin'; req.session=s; next(); }
function requireClient(req,res,next){ const s=sessionOf(req); if(!s||s.role!=='client') return res.status(403).json({error:'client only'}); req.role='client'; req.session=s; next(); }
// self-service access codes (hashed). Env ADMIN_CODE/CLIENT_CODE always work as a recovery fallback.
function hashCode(code){ const salt=crypto.randomBytes(16).toString('hex'); return salt+':'+crypto.scryptSync(String(code),salt,32).toString('hex'); }
function verifyCode(code, stored){
  if(!stored||!code) return false;
  const parts=String(stored).split(':'); if(parts.length!==2) return false;
  const h=crypto.scryptSync(String(code),parts[0],32).toString('hex');
  try{ return crypto.timingSafeEqual(Buffer.from(h,'hex'),Buffer.from(parts[1],'hex')); }catch(e){ return false; }
}
// resolve the project (+ owning client) this request operates on
function currentContext(req){
  const s = req.session || sessionOf(req);
  if(!s) return null;
  if(s.role==='client') return findProject(s.projectId);
  let ctx = s.projectId ? findProject(s.projectId) : null;      // admin: active project
  if(!ctx){ const f=firstProject(); if(f){ s.projectId=f.project.id; ctx=f; } }
  return ctx;
}

// ---------- app ----------
const app = express();
app.use(express.json());

app.post('/api/login', function(req,res){
  const code = (req.body && req.body.code || '').trim();
  let role=null, projectId=null;
  if(code === ADMIN_CODE || verifyCode(code, DATA.admin && DATA.admin.adminHash)){
    role='admin'; const f=firstProject(); projectId=f?f.project.id:null;
  }else{
    let match=null;
    allProjects().forEach(function(x){ if(verifyCode(code, x.project.auth && x.project.auth.clientHash)) match=x.project; });
    if(!match && code===CLIENT_CODE){ const f=firstProject(); if(f) match=f.project; } // env recovery → default project
    if(match){ role='client'; projectId=match.id; }
  }
  if(!role) return res.status(401).json({error:'Incorrect access code'});
  const token = crypto.randomBytes(24).toString('hex');
  sessions[token]={role:role, projectId:projectId};
  res.setHeader('Set-Cookie', 'sid='+token+'; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax');
  res.json({role:role});
});
app.get('/api/me', function(req,res){ res.json({role: roleOf(req)}); });
app.post('/api/logout', function(req,res){
  const sid=parseCookies(req).sid; if(sid) delete sessions[sid];
  res.setHeader('Set-Cookie','sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ok:true});
});
// change your own access code (persisted, hashed). Env code still works as recovery.
app.post('/api/change-code', requireAuth, function(req,res){
  const nc=(req.body && req.body.newCode || '').trim();
  if(nc.length<4) return res.status(400).json({error:'Code must be at least 4 characters'});
  if(req.role==='admin'){ if(!DATA.admin) DATA.admin={}; DATA.admin.adminHash=hashCode(nc); }
  else { const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'}); if(!ctx.project.auth) ctx.project.auth={}; ctx.project.auth.clientHash=hashCode(nc); }
  saveData(DATA); res.json({ok:true});
});

// full data for the active/own project. admin also gets the client+project index for switching.
app.get('/api/data', requireAuth, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const proj=ctx.project, client=ctx.client;
  const out={ role:req.role, brand:DATA.brand,
    client:{ id:client.id, name:client.name, logo:client.logo||'' },
    project:{ id:proj.id, name:proj.name, intro:proj.intro, preparedBy:proj.preparedBy, subtitle:proj.subtitle||'', art:proj.art||'', metaDefaults:proj.metaDefaults||{}, payUrl:proj.payUrl||'', payLabel:proj.payLabel||'' },
    contact: client.contact || {method:'WhatsApp'},
    categories: proj.categories, approvals: proj.approvals };
  if(req.role==='client') out.proposals = client.proposals || [];   // a client only ever sees their own proposals
  if(req.role==='admin'){
    out.activeProjectId=proj.id;
    out.clients=DATA.clients.map(function(c){
      return { id:c.id, name:c.name, logo:c.logo||'', proposals:c.proposals||[], contact:c.contact||{},
        projects:c.projects.map(function(p){ return { id:p.id, name:p.name, intro:p.intro, preparedBy:p.preparedBy||'', subtitle:p.subtitle||'', art:p.art||'', hasCode:!!(p.auth&&p.auth.clientHash), pieces:countPieces(p), stats:projectStats(p) }; }) };
    });
  }
  res.json(out);
});

// ---- client actions (operate on the caller's own project) ----
app.post('/api/approve', requireAuth, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const proj=ctx.project, {trackId, stage, approved} = req.body||{};
  if(['cleaned','final','art','levels','wording'].indexOf(stage)<0) return res.status(400).json({error:'bad stage'});
  const a = proj.approvals[trackId] || (proj.approvals[trackId]={});
  a[stage+'Approved'] = !!approved;
  // Final is approved only when BOTH levels and wording are approved.
  if(stage==='levels'||stage==='wording'){ a.finalApproved = !!(a.levelsApproved && a.wordingApproved); }
  saveData(DATA); res.json({ok:true, approvals:proj.approvals[trackId]});
});
app.post('/api/note', requireAuth, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const proj=ctx.project, {trackId, stage, note} = req.body||{};
  if(['cleaned','music','final','art'].indexOf(stage)<0) return res.status(400).json({error:'bad stage'});
  const a = proj.approvals[trackId] || (proj.approvals[trackId]={});
  a[stage+'Note'] = String(note||'').slice(0,2000);
  saveData(DATA); res.json({ok:true});
});
app.post('/api/music-seen', requireAuth, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const proj=ctx.project, {trackId, seen} = req.body||{};
  const a = proj.approvals[trackId] || (proj.approvals[trackId]={});
  a.musicSeen = !!seen; saveData(DATA); res.json({ok:true});
});
// client picks one of the (up to 3) music samples
app.post('/api/select-sample', requireAuth, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const proj=ctx.project, {trackId, index} = req.body||{};
  var i=parseInt(index,10); if(!(i>=0&&i<=2)) i=-1;
  const a = proj.approvals[trackId] || (proj.approvals[trackId]={});
  a.musicSelected = i; a.musicSeen = i>=0; saveData(DATA); res.json({ok:true, approvals:a});
});
// client submits final metadata (title/artist/album/genre/year)
app.post('/api/metadata', requireAuth, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const proj=ctx.project, {trackId, metadata, confirm} = req.body||{};
  if(!findTrack(proj, trackId)) return res.status(404).json({error:'no track'});
  const m = metadata||{}, s=function(v,n){ return String(v==null?'':v).slice(0,n); };
  const a = proj.approvals[trackId] || (proj.approvals[trackId]={});
  a.metadata = { title:s(m.title,200), artist:s(m.artist,200), album:s(m.album,200), genre:s(m.genre,80), year:s(m.year,10) };
  if(confirm) a.detailsConfirmed = !!a.metadata.title;   // "Confirm details" (client, or admin filling in on their behalf); a title is required
  saveData(DATA); res.json({ok:true, metadata:a.metadata, detailsConfirmed:!!a.detailsConfirmed});
});

// ---- project proposals + quotes (per client): requested → quoted → accepted | declined → converted (a real project) ----
// A quote must carry a price AND written terms, and the client's acceptance is recorded with a timestamp, so nothing is agreed without both in writing.
function findProposal(id){
  var out=null;
  (DATA.clients||[]).forEach(function(c){ (c.proposals||[]).forEach(function(p){ if(p.id===id) out={client:c, proposal:p}; }); });
  return out;
}
const PROPOSAL_STATUSES=['requested','quoted','accepted','declined','converted'];
app.post('/api/proposal-add', requireClient, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const b=req.body||{}, sv=function(v,n){ return String(v==null?'':v).trim().slice(0,n); };
  const title=sv(b.title,140); if(!title) return res.status(400).json({error:'Give the project a name'});
  const description=sv(b.description,2000); if(!description) return res.status(400).json({error:'Describe what you have in mind'});
  const c=ctx.client; if(!Array.isArray(c.proposals)) c.proposals=[];
  if(c.proposals.filter(function(p){ return p.status==='requested'; }).length>=10) return res.status(429).json({error:'You already have several requests waiting. Please wait for a quote first.'});
  const p={ id:'prop-'+crypto.randomBytes(4).toString('hex'), title:title, description:description, recordings:sv(b.recordings,50), timeline:sv(b.timeline,100),
    status:'requested', createdAt:new Date().toISOString(), fromProject:ctx.project.id };
  c.proposals.unshift(p); saveData(DATA); res.json({ok:true, proposal:p});
});
app.post('/api/proposal-respond', requireClient, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const {id, action, note}=req.body||{};
  const p=(ctx.client.proposals||[]).filter(function(x){ return x.id===id; })[0];
  if(!p) return res.status(404).json({error:'no proposal'});
  if(p.status!=='quoted') return res.status(409).json({error:'There is no quote to respond to'});
  if(action==='accept'){ p.status='accepted'; p.acceptedAt=new Date().toISOString(); p.acceptedBy=ctx.client.name; }
  else if(action==='decline'){ p.status='declined'; p.declinedAt=new Date().toISOString(); }
  else return res.status(400).json({error:'bad action'});
  if(note) p.responseNote=String(note).trim().slice(0,1000);
  saveData(DATA); res.json({ok:true, proposal:p});
});
app.post('/api/proposal-quote', requireAdmin, function(req,res){
  const {id, price, includes, terms, validUntil}=req.body||{};
  const f=findProposal(id); if(!f) return res.status(404).json({error:'no proposal'});
  if(f.proposal.status!=='requested' && f.proposal.status!=='quoted') return res.status(409).json({error:'This proposal can no longer be quoted'});
  const sv=function(v,n){ return String(v==null?'':v).trim().slice(0,n); };
  const q={ price:sv(price,120), includes:sv(includes,2000), terms:sv(terms,2000), validUntil:sv(validUntil,40), quotedAt:new Date().toISOString() };
  if(!q.price) return res.status(400).json({error:'A quote needs a price'});
  if(!q.terms) return res.status(400).json({error:'A quote needs written terms'});
  f.proposal.quote=q; f.proposal.status='quoted';
  delete f.proposal.responseNote; delete f.proposal.declinedAt;
  saveData(DATA); res.json({ok:true, proposal:f.proposal});
});
app.post('/api/proposal-create-project', requireAdmin, function(req,res){
  const f=findProposal((req.body||{}).id); if(!f) return res.status(404).json({error:'no proposal'});
  if(f.proposal.status!=='accepted') return res.status(409).json({error:'Create the project once the client has accepted the quote'});
  const id=uniqueProjectId(f.proposal.title);
  f.client.projects.push({ id:id, name:f.proposal.title, intro:f.proposal.description.slice(0,2000), preparedBy:'Craig Young', auth:{}, categories:[], approvals:{} });
  f.proposal.status='converted'; f.proposal.projectId=id; f.proposal.convertedAt=new Date().toISOString();
  if(req.session) req.session.projectId=id;
  saveData(DATA); res.json({ok:true, projectId:id});
});
app.post('/api/proposal-delete', requireAdmin, function(req,res){
  const f=findProposal((req.body||{}).id); if(!f) return res.status(404).json({error:'no proposal'});
  f.client.proposals=f.client.proposals.filter(function(p){ return p!==f.proposal; });
  saveData(DATA); res.json({ok:true});
});

// ---- admin: piece edits (operate on the active project) ----
app.post('/api/track/:id', requireAdmin, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const proj=ctx.project, tr = findTrack(proj, req.params.id);
  if(!tr) return res.status(404).json({error:'no track'});
  const p = req.body||{};
  if(p.raw!=null && RAW_STATUSES.indexOf(p.raw)>=0) tr.raw=p.raw;
  ['cleaned','music','final','art'].forEach(function(k){ if(p[k]!=null) tr[k]=!!p[k]; });
  if(p.title!=null) tr.title = String(p.title).slice(0,200);
  ['note'].forEach(function(k){ if(p[k]!=null) tr[k]=String(p[k]).slice(0,300); });
  if(p.description!=null) tr.description = String(p.description).slice(0,2000);
  if(p.producerNote && typeof p.producerNote==='object'){   // note to the client shown with a stage: { final:'…' }
    if(!tr.producerNote || typeof tr.producerNote!=='object') tr.producerNote={};
    ['cleaned','music','art','final'].forEach(function(k){ if(p.producerNote[k]!=null) tr.producerNote[k]=String(p.producerNote[k]).slice(0,2000); });
  }
  if(p.recommended!=null){ var ri=parseInt(p.recommended,10); if(ri>=0&&ri<=2) tr.recommended=ri; }
  saveData(DATA); res.json({ok:true, track:tr});
});
app.post('/api/track-add', requireAdmin, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const proj=ctx.project, {catIndex, subIndex, title, titles, raw} = req.body||{};
  // one title, or several at once (titles: [...]) — blank lines dropped, max 50 per request
  const names=(Array.isArray(titles)?titles:[title]).map(function(t){ return String(t==null?'':t).trim().slice(0,200); }).filter(Boolean).slice(0,50);
  if(!names.length) return res.status(400).json({error:'title required'});
  // no group given = the project's plain recording list (created on first use); a group index puts it under that heading
  const hasGroup = catIndex!=null && catIndex!=='' && catIndex!=='none';
  const list = hasGroup ? listAt(proj, catIndex, subIndex) : implicitCategory(proj).tracks;
  if(!list) return res.status(400).json({error:'bad location'});
  const made=names.map(function(n){ var tr=newTrack(proj, n, raw); list.push(tr); return tr; });
  saveData(DATA); res.json({ok:true, track:made[0], tracks:made});
});
app.post('/api/track-delete', requireAdmin, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const proj=ctx.project, id = (req.body||{}).id;
  const removed = removeTrackById(proj, id);
  if(!removed) return res.status(404).json({error:'no track'});
  delete proj.approvals[id];
  removeTrackFiles(removed);   // includes the raw recording, which the old inline cleanup missed
  saveData(DATA); res.json({ok:true});
});
app.post('/api/category-add', requireAdmin, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const proj=ctx.project, {name, subtitle, kind} = req.body||{};
  if(!name || !String(name).trim()) return res.status(400).json({error:'name required'});
  const cat = { name: String(name).trim(), subtitle: String(subtitle||'').slice(0,140) };
  if(kind === 'parent') cat.subcategories = []; else cat.tracks = [];
  proj.categories.push(cat); saveData(DATA); res.json({ok:true});
});
// remove a plain group heading but KEEP its recordings (they move to the project's ungrouped list)
app.post('/api/category-ungroup', requireAdmin, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const proj=ctx.project, cat=proj.categories[parseInt((req.body||{}).catIndex,10)];
  if(!cat) return res.status(404).json({error:'no group'});
  if(cat.implicit || cat.subcategories) return res.status(400).json({error:'Only a plain group can be removed this way'});
  const moved=(cat.tracks||[]).length;
  if(moved){ const imp=implicitCategory(proj); imp.tracks=imp.tracks.concat(cat.tracks); }
  proj.categories=proj.categories.filter(function(c){ return c!==cat; });
  saveData(DATA); res.json({ok:true, moved:moved});
});
app.post('/api/subcategory-add', requireAdmin, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const proj=ctx.project, {catIndex, name} = req.body||{};
  const cat = proj.categories[catIndex];
  if(!cat || !cat.subcategories) return res.status(400).json({error:'category has no sub-collections'});
  if(!name || !String(name).trim()) return res.status(400).json({error:'name required'});
  cat.subcategories.push({ name: String(name).trim(), tracks: [] });
  saveData(DATA); res.json({ok:true});
});

// ---- admin: clients + projects ----
app.post('/api/client-add', requireAdmin, function(req,res){
  const name=(req.body && req.body.name || '').trim();
  if(!name) return res.status(400).json({error:'client name required'});
  const id=uniqueClientId(name);
  DATA.clients.push({ id:id, name:name, contact:{method:(req.body && req.body.method) || 'WhatsApp'}, projects:[] });
  saveData(DATA); res.json({ok:true, id:id});
});
app.post('/api/client-update', requireAdmin, function(req,res){
  const {clientId, name} = req.body||{};
  const c=(DATA.clients||[]).find(function(x){ return x.id===clientId; });
  if(!c) return res.status(404).json({error:'no client'});
  const nm=String(name||'').trim(); if(!nm) return res.status(400).json({error:'client name required'});
  c.name=nm.slice(0,120); saveData(DATA); res.json({ok:true});
});
// client logo: png/jpg/webp/gif (no SVG — it can carry script), stored in the same volume and served from /media
const LOGO_EXT = ['.png','.jpg','.jpeg','.webp','.gif'];
app.post('/api/client-logo', requireAdmin, function(req,res,next){ upload.single('file')(req,res,function(err){ if(err) return res.status(400).json({error: err.code==='LIMIT_FILE_SIZE'?'File too large':'Upload failed'}); next(); }); }, function(req,res){
  const cleanup=function(){ if(req.file){ try{ fs.unlinkSync(req.file.path); }catch(e){} } };
  const c=(DATA.clients||[]).find(function(x){ return x.id===(req.body||{}).clientId; });
  if(!c){ cleanup(); return res.status(404).json({error:'no client'}); }
  if(!req.file) return res.status(400).json({error:'no file'});
  const ext=path.extname(req.file.originalname||'').toLowerCase();
  if(LOGO_EXT.indexOf(ext)<0 || !/^image\//.test(req.file.mimetype||'')){ cleanup(); return res.status(400).json({error:'Logo must be a PNG, JPG, WebP or GIF image'}); }
  if(req.file.size>5*1024*1024){ cleanup(); return res.status(400).json({error:'Logo must be under 5 MB'}); }
  const finalName='client-'+c.id+'-logo'+ext, dest=path.join(AUDIO_DIR, finalName), prev=c.logo;
  try{ if(fs.existsSync(dest)) fs.unlinkSync(dest); fs.renameSync(req.file.path, dest); }
  catch(e){ cleanup(); return res.status(500).json({error:'save failed'}); }
  if(prev && prev!==finalName) removeStoreFile(prev);
  c.logo=finalName; saveData(DATA); res.json({ok:true, logo:finalName});
});
// project artwork (the series / album cover shown as a small thumbnail beside the project title). Same image rules as logos, up to 10 MB.
app.post('/api/project-art', requireAdmin, function(req,res,next){ upload.single('file')(req,res,function(err){ if(err) return res.status(400).json({error: err.code==='LIMIT_FILE_SIZE'?'File too large':'Upload failed'}); next(); }); }, function(req,res){
  const cleanup=function(){ if(req.file){ try{ fs.unlinkSync(req.file.path); }catch(e){} } };
  const found=findProject((req.body||{}).projectId);
  if(!found){ cleanup(); return res.status(404).json({error:'no project'}); }
  if(!req.file) return res.status(400).json({error:'no file'});
  const ext=path.extname(req.file.originalname||'').toLowerCase();
  if(LOGO_EXT.indexOf(ext)<0 || !/^image\//.test(req.file.mimetype||'')){ cleanup(); return res.status(400).json({error:'Artwork must be a PNG, JPG, WebP or GIF image'}); }
  if(req.file.size>10*1024*1024){ cleanup(); return res.status(400).json({error:'Artwork must be under 10 MB'}); }
  const proj=found.project, finalName='project-'+proj.id+'-art'+ext, dest=path.join(AUDIO_DIR, finalName), prev=proj.art;
  try{ if(fs.existsSync(dest)) fs.unlinkSync(dest); fs.renameSync(req.file.path, dest); }
  catch(e){ cleanup(); return res.status(500).json({error:'save failed'}); }
  if(prev && prev!==finalName) removeStoreFile(prev);
  proj.art=finalName; saveData(DATA); res.json({ok:true, art:finalName});
});
app.post('/api/project-art-delete', requireAdmin, function(req,res){
  const found=findProject((req.body||{}).projectId);
  if(!found) return res.status(404).json({error:'no project'});
  removeStoreFile(found.project.art); found.project.art=''; saveData(DATA); res.json({ok:true});
});
app.post('/api/client-logo-delete', requireAdmin, function(req,res){
  const c=(DATA.clients||[]).find(function(x){ return x.id===(req.body||{}).clientId; });
  if(!c) return res.status(404).json({error:'no client'});
  removeStoreFile(c.logo); c.logo=''; saveData(DATA); res.json({ok:true});
});
app.post('/api/project-add', requireAdmin, function(req,res){
  const {clientId, name, intro} = req.body||{};
  const nm=(name||'').trim(); if(!nm) return res.status(400).json({error:'project name required'});
  const c=(DATA.clients||[]).find(function(x){ return x.id===clientId; });
  if(!c) return res.status(404).json({error:'no client'});
  const id=uniqueProjectId(nm);
  c.projects.push({ id:id, name:nm, intro:(intro||'').trim(), preparedBy:'Craig Young', auth:{}, categories:[], approvals:{} });
  if(req.session) req.session.projectId=id;   // make the new project active
  saveData(DATA); res.json({ok:true, id:id});
});
// Permanent: removes the project, its pieces, approvals and every uploaded file. Always keeps at least one project so the admin has somewhere to land.
app.post('/api/project-delete', requireAdmin, function(req,res){
  const found=findProject((req.body||{}).projectId);
  if(!found) return res.status(404).json({error:'no project'});
  if(allProjects().length<=1) return res.status(400).json({error:'This is the only project. Add another project before deleting it.'});
  removeProjectFiles(found.project);
  found.client.projects=found.client.projects.filter(function(p){ return p!==found.project; });
  Object.keys(sessions).forEach(function(k){ if(sessions[k].projectId===found.project.id) sessions[k].projectId=null; });
  saveData(DATA); res.json({ok:true});
});
// Permanent: removes the client, their logo, and all of their projects (with files). Refuses if it would leave no project at all.
app.post('/api/client-delete', requireAdmin, function(req,res){
  const c=(DATA.clients||[]).find(function(x){ return x.id===(req.body||{}).clientId; });
  if(!c) return res.status(404).json({error:'no client'});
  if(allProjects().filter(function(x){ return x.client!==c; }).length<1) return res.status(400).json({error:'This client has the only project. Add another client or project before deleting.'});
  const ids=(c.projects||[]).map(function(p){ return p.id; });
  (c.projects||[]).forEach(function(p){ removeProjectFiles(p); });
  removeStoreFile(c.logo);
  DATA.clients=DATA.clients.filter(function(x){ return x!==c; });
  Object.keys(sessions).forEach(function(k){ if(ids.indexOf(sessions[k].projectId)>=0) sessions[k].projectId=null; });
  saveData(DATA); res.json({ok:true});
});
app.post('/api/project-select', requireAdmin, function(req,res){
  const {projectId} = req.body||{};
  if(!findProject(projectId)) return res.status(404).json({error:'no project'});
  if(req.session) req.session.projectId=projectId;
  res.json({ok:true});
});
app.post('/api/project-update', requireAdmin, function(req,res){
  const p=req.body||{};
  const found = p.projectId ? findProject(p.projectId) : currentContext(req);
  if(!found) return res.status(404).json({error:'no project'});
  const proj=found.project;
  if(p.name!=null && String(p.name).trim()) proj.name=String(p.name).trim().slice(0,140);
  if(p.intro!=null) proj.intro=String(p.intro).slice(0,2000);
  if(p.preparedBy!=null) proj.preparedBy=String(p.preparedBy).slice(0,120);
  if(p.subtitle!=null) proj.subtitle=String(p.subtitle).slice(0,200);   // blank = auto "Prepared for … · produced by …"
  if(p.metaDefaults && typeof p.metaDefaults==='object'){   // pre-filled into every recording's Track Details (artist / album / genre / year)
    var md=p.metaDefaults, sv=function(v,n){ return String(v==null?'':v).trim().slice(0,n); };
    proj.metaDefaults={ artist:sv(md.artist,200), album:sv(md.album,200), genre:sv(md.genre,80), year:sv(md.year,10) };
  }
  if(p.payUrl!=null){
    var u=String(p.payUrl).trim().slice(0,500);
    if(u==='' || /^https?:\/\//i.test(u)) proj.payUrl=u;
    else return res.status(400).json({error:'Payment link must start with https://'});
  }
  if(p.payLabel!=null) proj.payLabel=String(p.payLabel).slice(0,120);
  saveData(DATA); res.json({ok:true});
});
app.post('/api/project-set-code', requireAdmin, function(req,res){
  const {projectId, code} = req.body||{};
  const c=(code||'').trim(); if(c.length<4) return res.status(400).json({error:'Code must be at least 4 characters'});
  const found=findProject(projectId); if(!found) return res.status(404).json({error:'no project'});
  if(!found.project.auth) found.project.auth={};
  found.project.auth.clientHash=hashCode(c);
  saveData(DATA); res.json({ok:true});
});

// ---- uploads (operate on the active/own project; files namespaced by project) ----
const upload = multer({
  storage: multer.diskStorage({
    destination: function(req,file,cb){ ensureDir(AUDIO_DIR); cb(null, AUDIO_DIR); },
    filename: function(req,file,cb){ cb(null, 'tmp-'+crypto.randomBytes(8).toString('hex')+path.extname(file.originalname||'.mp3')); }
  }),
  limits: { fileSize: 120*1024*1024 } // 120MB
});
app.post('/api/upload', requireAuth, upload.single('file'), function(req,res){
  const ctx=currentContext(req);
  const {trackId, stage} = req.body||{};
  const cleanup = function(){ if(req.file){ try{ fs.unlinkSync(req.file.path); }catch(e){} } };
  if(!ctx){ cleanup(); return res.status(404).json({error:'no project'}); }
  if(['raw','cleaned','music','final','art'].indexOf(stage)<0){ cleanup(); return res.status(400).json({error:'bad stage'}); }
  // client may only upload the RAW recording; producing stages (incl. artwork) are admin-only
  if(stage!=='raw' && req.role!=='admin'){ cleanup(); return res.status(403).json({error:'admin only for this stage'}); }
  const proj=ctx.project, tr = findTrack(proj, trackId);
  if(!tr){ cleanup(); return res.status(404).json({error:'no track'}); }
  if(!req.file) return res.status(400).json({error:'no file'});
  const ext = path.extname(req.file.originalname||'') || (stage==='art'?'.png':'.mp3');
  var si = -1;
  if(stage==='music'){ si=parseInt((req.body||{}).sampleIndex,10); if(!(si>=0&&si<=2)) si=0; }
  const finalName = proj.id+'-'+trackId+'-'+stage+(stage==='music'?si:'')+ext;   // namespaced so projects never collide
  const dest = path.join(AUDIO_DIR, finalName);
  if(!tr.audio) tr.audio={};
  if(!Array.isArray(tr.samples)) tr.samples=['','',''];
  var prev = stage==='art' ? tr.cover : (stage==='music' ? tr.samples[si] : tr.audio[stage]);   // file being replaced, if any
  try{ if(fs.existsSync(dest)) fs.unlinkSync(dest); fs.renameSync(req.file.path, dest); }
  catch(e){ return res.status(500).json({error:'save failed'}); }
  if(prev && prev!==finalName) removeStoreFile(prev);   // different extension: don't leave the old file orphaned
  if(stage==='art'){
    tr.cover = finalName; tr.art = true;
  }else if(stage==='music'){
    tr.samples[si] = finalName;
    tr.audio.music = tr.audio.music || finalName;   // keep a legacy single-file pointer
    tr.music = true;                                // ready once a sample lands (admin can untoggle)
  }else{
    tr.audio[stage] = finalName;
    if(stage==='raw'){ tr.raw='received'; }         // a new recording (either side) needs a fresh quality check
    else { tr[stage] = true; }
  }
  if(stage!=='raw') resetStageApprovals(proj, trackId, stage, si);
  saveData(DATA); res.json({ok:true, file:finalName, track:tr});
});

// A client (or the admin) sends in a brand-new recording: creates the recording as Received (awaiting the admin's quality check) and stores the audio in one step.
const AUDIO_EXT=['.mp3','.wav','.m4a','.aac','.flac','.ogg','.oga','.aif','.aiff','.webm','.caf'];
app.post('/api/submit-recording', requireAuth, function(req,res,next){ upload.single('file')(req,res,function(err){ if(err) return res.status(400).json({error: err.code==='LIMIT_FILE_SIZE'?'That file is too large (120 MB max)':'Upload failed'}); next(); }); }, function(req,res){
  const cleanup=function(){ if(req.file){ try{ fs.unlinkSync(req.file.path); }catch(e){} } };
  const ctx=currentContext(req); if(!ctx){ cleanup(); return res.status(404).json({error:'no project'}); }
  const proj=ctx.project, b=req.body||{};
  const title=String(b.title||'').trim().slice(0,200);
  if(!title){ cleanup(); return res.status(400).json({error:'Give the recording a title'}); }
  if(!req.file) return res.status(400).json({error:'Choose an audio file to send'});
  const ext=path.extname(req.file.originalname||'').toLowerCase();
  if(AUDIO_EXT.indexOf(ext)<0){ cleanup(); return res.status(400).json({error:'Please send an audio file (MP3, WAV, M4A, AAC, FLAC or OGG)'}); }
  const g=String(b.group==null?'':b.group);
  let list;
  if(g==='' || g==='none') list=implicitCategory(proj).tracks;
  else{ const m=/^(\d+):(\d*)$/.exec(g); list=m?listAt(proj, parseInt(m[1],10), m[2]===''?null:parseInt(m[2],10)):null; }
  if(!list){ cleanup(); return res.status(400).json({error:'That group was not found'}); }
  const tr=newTrack(proj, title, 'received');
  if(req.role==='client') tr.fromClient=true;
  if(b.note && String(b.note).trim()) tr.note=('From client: '+String(b.note).trim()).slice(0,300);
  const finalName=proj.id+'-'+tr.id+'-raw'+ext;
  try{ fs.renameSync(req.file.path, path.join(AUDIO_DIR, finalName)); }
  catch(e){ cleanup(); return res.status(500).json({error:'save failed'}); }
  tr.audio.raw=finalName; list.push(tr);
  saveData(DATA); res.json({ok:true, track:tr});
});

// admin: remove an uploaded file and take that stage back to "not ready"
app.post('/api/upload-delete', requireAdmin, function(req,res){
  const ctx=currentContext(req); if(!ctx) return res.status(404).json({error:'no project'});
  const proj=ctx.project, {trackId, stage} = req.body||{};
  if(['raw','cleaned','music','final','art'].indexOf(stage)<0) return res.status(400).json({error:'bad stage'});
  const tr = findTrack(proj, trackId);
  if(!tr) return res.status(404).json({error:'no track'});
  if(!tr.audio) tr.audio={};
  if(!Array.isArray(tr.samples)) tr.samples=['','',''];
  var si=-1, file='';
  if(stage==='art'){ file=tr.cover; tr.cover=''; tr.art=false; }
  else if(stage==='music'){
    si=parseInt((req.body||{}).sampleIndex,10); if(!(si>=0&&si<=2)) return res.status(400).json({error:'bad sample'});
    file=tr.samples[si]; tr.samples[si]='';
    tr.audio.music = tr.samples.filter(Boolean)[0] || '';   // legacy single-file pointer follows what's left
    if(!tr.audio.music) tr.music=false;
  }else{
    file=tr.audio[stage]; tr.audio[stage]='';
    if(stage==='raw') tr.raw='none'; else tr[stage]=false;
  }
  removeStoreFile(file);
  if(stage!=='raw') resetStageApprovals(proj, trackId, stage, si);
  saveData(DATA); res.json({ok:true, track:tr});
});

// ---- audio + media (covers) — both served from the store dir ----
function serveStoreFile(req,res){
  const f = path.basename(req.params.file);
  const p = path.join(AUDIO_DIR, f);
  if(!fs.existsSync(p)) return res.status(404).end();
  res.set('Cache-Control','no-cache');   // replaced files keep their name — always revalidate so a swap shows up straight away
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

app.listen(PORT, function(){ console.log('CYM Client Preview (v3) on port '+PORT+'  data='+DATA_DIR); });
