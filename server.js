'use strict';
/* METALS FOOTBALL CHAMPIONSHIP — الخادم المركزي
   HTTP لملفات الواجهة + WebSocket للمزامنة اللحظية. المعلم (HOST) هو المتحكم بالمباراة. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { WebSocketServer } = require('ws');
const Sim = require('./lib/sim');
const DB = require('./lib/db');
const MData = require('./public/js/data.js');

const PORT = +process.env.PORT || 3000;
const HOST_PASSWORD = process.env.HOST_PASSWORD || '';      // اختياري: كلمة سر لإنشاء المباريات
const PUBLIC = path.join(__dirname, 'public');
const MAX_STUDENTS = 60;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

// ---------------- HTTP ----------------
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (url === '/api/config') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ hostPasswordRequired: !!HOST_PASSWORD, db: DB.mode() }));
  }
  if (url === '/api/lan') {
    const ips = []; const ifs = os.networkInterfaces();
    Object.keys(ifs).forEach(n => ifs[n].forEach(i => { if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) ips.push(i.address); }));
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ips, port: PORT }));
  }
  if (url === '/') url = '/index.html';
  if (url === '/host') url = '/host.html';
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('404'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});

// ---------------- الغرف ----------------
const rooms = new Map();
const newToken = () => crypto.randomBytes(12).toString('hex');
function newPin() { let p; do { p = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(p)); return p; }

function createRoom() {
  const room = { pin: newPin(), hostToken: newToken(), createdAt: Date.now(), students: new Map(), hosts: new Set(), match: Sim.createMatch({ duration: 600 }), saved: false, seq: 0, lastActive: Date.now() };
  rooms.set(room.pin, room);
  return room;
}
const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function lineupOf(room) {
  const m = room.match;
  return [0, 1].map(team => Sim.FORM.map((f, i) => {
    const p = m.players[team * 11 + i];
    return { num: Sim.NUMS[i], role: f.role, u: f.u, v: f.v, name: p.sid ? p.name : null, online: !!(p.sid && p.online) };
  }));
}
function roomInfo(room, forStudent) {
  const m = room.match;
  const students = [];
  room.students.forEach(s => students.push({ id: s.id, name: s.name, team: s.team, online: s.online, pid: m.bySid[s.id] === undefined ? -1 : m.bySid[s.id] }));
  const names = {};
  m.players.forEach(p => { if (p.sid) names[p.id] = p.name; });
  const info = {
    t: 'room', pin: room.pin, status: m.status, duration: m.duration, students, names,
    counts: [Sim.teamHumanCount(m, 0), Sim.teamHumanCount(m, 1)], lineup: lineupOf(room), score: m.score
  };
  if (forStudent) { info.me = { id: forStudent.id, name: forStudent.name, team: forStudent.team, pid: m.bySid[forStudent.id] === undefined ? -1 : m.bySid[forStudent.id], element: forStudent.element }; }
  return info;
}
function broadcastRoom(room) {
  room.hosts.forEach(ws => send(ws, roomInfo(room, null)));
  room.students.forEach(s => { if (s.ws) send(s.ws, roomInfo(room, s)); });
}
function broadcastSnap(room) {
  const snap = Sim.snapshot(room.match);
  const str = JSON.stringify(snap);
  room.hosts.forEach(ws => { if (ws.readyState === 1) ws.send(str); });
  room.students.forEach(s => { if (s.ws && s.ws.readyState === 1) s.ws.send(str); });
}

// ---------------- WebSocket ----------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

wss.on('connection', ws => {
  ws.ctx = { role: null, pin: null, sid: null };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    try { handle(ws, msg); } catch (e) { console.error('[ws] handler error', e); }
  });
  ws.on('close', () => onClose(ws));
});

function onClose(ws) {
  const { role, pin, sid } = ws.ctx;
  const room = rooms.get(pin); if (!room) return;
  if (role === 'host') room.hosts.delete(ws);
  if (role === 'student') {
    const s = room.students.get(sid);
    if (s && s.ws === ws) { s.ws = null; s.online = false; Sim.setOnline(room.match, sid, false); broadcastRoom(room); }
  }
}

function handle(ws, msg) {
  const ctx = ws.ctx;
  switch (msg.t) {
    // ---------- المعلم ----------
    case 'host_create': {
      if (HOST_PASSWORD && msg.pwd !== HOST_PASSWORD) return send(ws, { t: 'err', code: 'bad_password', msg: 'كلمة سر المعلم غير صحيحة' });
      const room = createRoom();
      ctx.role = 'host'; ctx.pin = room.pin; room.hosts.add(ws);
      send(ws, { t: 'host_ok', pin: room.pin, token: room.hostToken });
      broadcastRoom(room);
      break;
    }
    case 'host_resume': {
      const room = rooms.get(String(msg.pin));
      if (!room || room.hostToken !== msg.token) return send(ws, { t: 'err', code: 'no_room', msg: 'تعذّر استعادة المباراة' });
      ctx.role = 'host'; ctx.pin = room.pin; room.hosts.add(ws);
      send(ws, { t: 'host_ok', pin: room.pin, token: room.hostToken, resumed: true });
      broadcastRoom(room);
      break;
    }
    case 'host_cmd': {
      const room = rooms.get(ctx.pin); if (!room || ctx.role !== 'host') return;
      const m = room.match;
      if (msg.cmd === 'start') {
        if (m.status !== 'lobby') return;
        if (room.students.size === 0) return send(ws, { t: 'err', code: 'no_students', msg: 'لا يوجد طلاب في المباراة بعد' });
        autoBalance(room);
        Sim.startMatch(m); room.saved = false;
      } else if (msg.cmd === 'pause') Sim.pause(m);
      else if (msg.cmd === 'resume') Sim.resume(m);
      else if (msg.cmd === 'end') { Sim.endMatch(m); }
      else if (msg.cmd === 'restart') { autoBalance(room); Sim.startMatch(m); room.saved = false; }
      else if (msg.cmd === 'duration') { if (m.status === 'lobby' || m.status === 'finished') Sim.setDuration(m, +msg.value * 60); }
      else if (msg.cmd === 'back_to_lobby') { if (m.status === 'finished') { const dur = m.duration; room.match = Sim.createMatch({ duration: dur }); rebuildAssignments(room); } }
      else if (msg.cmd === 'kick') { // إخراج طالب
        const s = room.students.get(msg.sid);
        if (s) { Sim.release(m, s.id); if (s.ws) { send(s.ws, { t: 'kicked' }); s.ws.close(); } room.students.delete(s.id); }
      }
      broadcastRoom(room);
      break;
    }
    // ---------- الطالب ----------
    case 'join': {
      const room = rooms.get(String(msg.pin).trim());
      if (!room) return send(ws, { t: 'err', code: 'no_room', msg: 'رمز المباراة غير صحيح' });
      let s = null;
      if (msg.token) { room.students.forEach(x => { if (x.token === msg.token) s = x; }); }
      if (s) {                                // إعادة اتصال
        if (s.ws && s.ws !== ws) { try { s.ws.close(); } catch (e) { /* */ } }
        s.ws = ws; s.online = true; Sim.setOnline(room.match, s.id, true);
      } else {
        let name = String(msg.name || '').trim().replace(/\s+/g, ' ').slice(0, 16);
        if (!name) return send(ws, { t: 'err', code: 'no_name', msg: 'اكتب اسمك أولًا' });
        if (room.students.size >= MAX_STUDENTS) return send(ws, { t: 'err', code: 'full', msg: 'المباراة ممتلئة' });
        let base = name, n = 2; const taken = () => [...room.students.values()].some(x => x.name === name);
        while (taken()) name = base + ' ' + (n++);
        s = { id: 's' + (++room.seq), name, token: newToken(), team: null, online: true, ws, element: null };
        room.students.set(s.id, s);
      }
      ctx.role = 'student'; ctx.pin = room.pin; ctx.sid = s.id;
      send(ws, { t: 'joined', id: s.id, token: s.token, pin: room.pin, name: s.name, team: s.team, element: s.element });
      broadcastRoom(room);
      break;
    }
    case 'intro_hit': {
      const room = rooms.get(ctx.pin); const s = room && room.students.get(ctx.sid); if (!s) return;
      const id = MData.ELEMENT_IDS[Math.floor(Math.random() * MData.ELEMENT_IDS.length)];
      s.element = id;
      send(ws, { t: 'element', id });
      break;
    }
    case 'pick_team': {
      const room = rooms.get(ctx.pin); const s = room && room.students.get(ctx.sid); if (!s) return;
      const team = +msg.team; if (team !== 0 && team !== 1) return;
      if (s.team === team) return broadcastRoom(room);
      if (Sim.teamHumanCount(room.match, team) >= 11) return send(ws, { t: 'err', code: 'team_full', msg: 'هذا الفريق ممتلئ، اختر الفريق الآخر' });
      const pid = Sim.assign(room.match, s.id, s.name, team);
      if (pid < 0) return send(ws, { t: 'err', code: 'team_full', msg: 'هذا الفريق ممتلئ' });
      s.team = team;
      broadcastRoom(room);
      break;
    }
    case 'in': {
      const room = rooms.get(ctx.pin); if (!room || ctx.role !== 'student') return;
      Sim.setInput(room.match, ctx.sid, msg);
      break;
    }
    case 'act': {
      const room = rooms.get(ctx.pin); if (!room || ctx.role !== 'student') return;
      Sim.queueAct(room.match, ctx.sid, msg.a);
      break;
    }
    case 'answer': {
      const room = rooms.get(ctx.pin); if (!room || ctx.role !== 'student') return;
      if (room.match.q && (msg.qid === undefined || msg.qid === room.match.q.id)) Sim.answer(room.match, ctx.sid, msg.choice);
      break;
    }
    case 'ping': send(ws, { t: 'pong', c: msg.c }); break;
    default: break;
  }
}

// طالب بلا فريق عند البدء: يُوزَّع على الفريق الأقل عددًا
function autoBalance(room) {
  room.students.forEach(s => {
    if (s.team === null) {
      const t = Sim.teamHumanCount(room.match, 0) <= Sim.teamHumanCount(room.match, 1) ? 0 : 1;
      if (Sim.assign(room.match, s.id, s.name, t) >= 0) s.team = t;
    }
  });
}
function rebuildAssignments(room) {
  room.students.forEach(s => {
    if (s.team !== null) { const pid = Sim.assign(room.match, s.id, s.name, s.team); if (pid >= 0) Sim.setOnline(room.match, s.id, s.online); }
  });
}

// ---------------- حلقة المحاكاة ----------------
let last = Date.now(), acc = 0, tickN = 0;
setInterval(() => {
  const now = Date.now();
  acc += Math.min(0.2, (now - last) / 1000); last = now;
  while (acc >= Sim.TICK) {
    acc -= Sim.TICK; tickN++;
    rooms.forEach(room => {
      const m = room.match;
      if (['lobby', 'finished', 'paused'].includes(m.status)) return;
      Sim.step(m, Sim.TICK);
      if (m.status === 'finished' && !room.saved) { room.saved = true; DB.saveMatch(room); broadcastRoom(room); }
      if (tickN % 2 === 0) broadcastSnap(room);
    });
  }
  // حالة الإيقاف المؤقت/الانتهاء: لقطة بطيئة للحفاظ على شاشة الجميع
  if (tickN % 20 === 0) rooms.forEach(room => { if (['paused', 'finished'].includes(room.match.status)) broadcastSnap(room); });
}, 20);

// فحص الاتصال + تنظيف الغرف القديمة
setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; try { ws.ping(); } catch (e) { /* */ } });
  const cutoff = Date.now() - 6 * 3600 * 1000;
  rooms.forEach((room, pin) => {
    const active = room.hosts.size > 0 || [...room.students.values()].some(s => s.online);
    if (active) room.lastActive = Date.now();
    if (room.lastActive < cutoff) rooms.delete(pin);
  });
}, 20000);

server.listen(PORT, () => {
  console.log(`METALS FOOTBALL CHAMPIONSHIP يعمل على المنفذ ${PORT}`);
  console.log(`  الطلاب:  http://localhost:${PORT}/`);
  console.log(`  المعلم:  http://localhost:${PORT}/host`);
  console.log(`  التخزين: ${DB.mode()}${HOST_PASSWORD ? ' | كلمة سر المعلم مفعّلة' : ''}`);
});
