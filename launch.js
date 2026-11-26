'use strict';
/* مشغّل المعلم: يشغّل الخادم ويبقيه حيًا، يمنع نوم الجهاز، يفتح لوحة المعلم، ويطبع رابط الطلاب */
const { spawn, execSync } = require('child_process');
const os = require('os');
const path = require('path');

const PORT = process.env.PORT || '3000';
const major = +process.versions.node.split('.')[0], minor = +process.versions.node.split('.')[1];
if (major < 22 || (major === 22 && minor < 5)) {
  console.log('\n[تنبيه] نسخة Node عندك ' + process.versions.node + ' والمطلوب 22.5 أو أحدث (للحفظ في قاعدة البيانات).');
  console.log('اللعبة ستعمل لكن النتائج تُحفظ في ملف نصي. للتحديث: nodejs.org\n');
}

function lanIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(n => ifs[n].forEach(i => { if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) out.push(i.address); }));
  return out;
}
function banner() {
  const ips = lanIPs();
  const line = '='.repeat(60);
  console.log('\n' + line);
  console.log('  METALS FOOTBALL CHAMPIONSHIP — جاهزة');
  console.log(line);
  console.log('  لوحة المعلم (افتحها أنت):   http://localhost:' + PORT + '/host');
  if (ips.length) { console.log('  رابط الطلاب (نفس الواي فاي):'); ips.forEach(ip => console.log('       http://' + ip + ':' + PORT)); }
  else console.log('  (لم يُعثر على شبكة. تأكد أن الجهاز متصل بالواي فاي)');
  console.log('  لا تغلق هذه النافذة أثناء المباراة.  للإيقاف: Ctrl+C');
  console.log(line + '\n');
}

// ----- منع نوم الجهاز -----
function keepAwake() {
  try {
    if (process.platform === 'darwin') spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { stdio: 'ignore', detached: false });
    else if (process.platform === 'win32') {
      const ps = "Add-Type -Namespace W -Name P -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);'; while($true){ [W.P]::SetThreadExecutionState(0x80000003) | Out-Null; Start-Sleep -Seconds 30 }";
      const p = spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { stdio: 'ignore', windowsHide: true });
      process.on('exit', () => { try { p.kill(); } catch (e) { /* */ } });
    } else {
      const p = spawn('systemd-inhibit', ['--what=idle:sleep', '--why=Metals Football', 'sleep', 'infinity'], { stdio: 'ignore' });
      p.on('error', () => { }); process.on('exit', () => { try { p.kill(); } catch (e) { /* */ } });
    }
  } catch (e) { /* غير حرج */ }
}
function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  } catch (e) { /* */ }
}

let child = null, stopping = false, restarts = 0, opened = false;
function start() {
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { stdio: 'inherit', env: Object.assign({}, process.env, { PORT }) });
  child.on('exit', code => {
    if (stopping) return;
    restarts++;
    console.log('\n[المشغّل] توقّف الخادم (code ' + code + '). إعادة تشغيل تلقائية رقم ' + restarts + '…');
    setTimeout(start, 1000);
  });
  if (!opened) { opened = true; setTimeout(() => { banner(); openBrowser('http://localhost:' + PORT + '/host'); }, 1200); }
}
function stop() { stopping = true; if (child) try { child.kill(); } catch (e) { /* */ } process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
process.on('uncaughtException', e => console.error('[المشغّل]', e.message));
keepAwake(); start();
