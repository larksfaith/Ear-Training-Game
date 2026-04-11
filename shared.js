// ═══════════════════════════════════════════════════════════════
//  shared.js  –  共用邏輯（密碼系統 / 音訊 / 計時 / 排程 / 統計）
//  由 game1.html 與 game2.html 共同載入
// ═══════════════════════════════════════════════════════════════

// ── 音符常數 ──────────────────────────────────────────────────
const NOTES     = ['C3','D3','E3','F3','G3','A3','B3'];
const NOTE_IDX  = {C3:0,D3:1,E3:2,F3:3,G3:4,A3:5,B3:6};
const NOTE_LBLS = [
  ['C','D','E','F','G','A','B'],
  ['Do','Re','Mi','Fa','Sol','La','Si'],
  ['1','2','3','4','5','6','7'],
  ['','','','','','','']
];
const DISP_MODES = ['CDEFGAB','DoReMi','1234567','空白'];
const BK_NOTES   = ['C#3','D#3','F#3','G#3','A#3'];

function noteToMidi(note) {
  const NM = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
  const m  = note.match(/([A-G])(#?)(\d)/);
  return NM[m[1]] + (m[2]==='#'?1:0) + (parseInt(m[3])+1)*12;
}

// ═══════════════════════════════════════════════════════════════
//  48 小時密碼系統
// ═══════════════════════════════════════════════════════════════
const ACCESS_KEY = 'lark_last_access';
const MS_48H     = 48 * 60 * 60 * 1000;

/** 重現 Java Password48.generateSecurePassword() 的完整算法 */
function generateTodayPassword() {
  const now  = new Date();
  const year = now.getFullYear();
  const month= now.getMonth() + 1;  // 1-12
  const day  = now.getDate();
  const doy  = Math.floor((now - new Date(year, 0, 0)) / 86400000); // day of year

  // 模擬 Java 64-bit signed long 溢位行為
  const M = 2n ** 64n, H = 2n ** 63n;
  const L = n => { n = ((n % M) + M) % M; return n >= H ? n - M : n; };

  const s1 = 0x4C41524Bn; // "LARK"
  const s2 = 0x4C656E69n; // "Leni"
  const s3 = 0x45617247n; // "EarG"
  const d  = BigInt(doy);

  let h = s1;
  h = L(h * 31n + BigInt(year - 2020) * s2);
  h = L(h * 37n + BigInt(month) * s3);
  h = L(h * 41n + BigInt(day) * L(s1 ^ s2));
  h = L(h * 43n + d * L(s2 ^ s3));
  h = L(h * 47n + BigInt(year * month * day % Number(s1)));
  if (h < 0n) h = -h;

  let p1 = Number(h % 9000n) + 1000;
  let p2 = Number((h / 10000n) % 9000n) + 1000;
  p1 = (p1 * 7  + doy * 13)         % 9000 + 1000;
  p2 = (p2 * 11 + (year % 100) * 17) % 9000 + 1000;

  return `LARK-${String(p1).padStart(4,'0')}-${String(p2).padStart(4,'0')}`;
}

function isAccessValid() {
  const t = localStorage.getItem(ACCESS_KEY);
  if (!t) return false;
  return (Date.now() - parseInt(t)) < MS_48H;
}
function refreshAccess() {
  localStorage.setItem(ACCESS_KEY, String(Date.now()));
}
function validatePassword(raw) {
  // 容錯：不分大小寫、忽略空白
  const clean = raw.toUpperCase().replace(/\s/g, '');
  return clean === generateTodayPassword();
}

/** 初始化密碼防護：如果已在有效期內就直接放行，否則顯示 overlay */
function initPasswordGuard(onUnlocked) {
  if (isAccessValid()) {
    refreshAccess();
    document.getElementById('pw-overlay').classList.add('hidden');
    onUnlocked();
    return;
  }
  // 顯示密碼畫面
  document.getElementById('pw-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('pw-input').focus(), 100);

  // 綁定確認按鈕 & Enter 鍵
  document.getElementById('pw-submit').addEventListener('click', () => tryPassword(onUnlocked));
  document.getElementById('pw-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') tryPassword(onUnlocked);
    document.getElementById('pw-err').classList.add('hidden');
  });
}

function tryPassword(onUnlocked) {
  const val = document.getElementById('pw-input').value;
  if (validatePassword(val)) {
    refreshAccess();
    document.getElementById('pw-overlay').classList.add('hidden');
    onUnlocked();
  } else {
    document.getElementById('pw-err').classList.remove('hidden');
    document.getElementById('pw-input').select();
  }
}

// ═══════════════════════════════════════════════════════════════
//  音訊
// ═══════════════════════════════════════════════════════════════
let audioCtx   = null;
let sfPiano    = null;
let audioReady = false;
let useOsc     = false;

function initAudio(onReady) {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const fb = setTimeout(() => {
    if (!audioReady) { useOsc = true; audioReady = true; onReady(); }
  }, 12000);

  Soundfont.instrument(audioCtx, 'acoustic_grand_piano').then(p => {
    clearTimeout(fb);
    sfPiano = p; useOsc = false; audioReady = true; onReady();
  }).catch(() => {
    clearTimeout(fb);
    useOsc = true; audioReady = true; onReady();
  });
}

function resumeCtx() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function playNote(note, dur) {
  if (!audioCtx) return;
  resumeCtx();
  if (!useOsc && sfPiano) {
    sfPiano.play(note, audioCtx.currentTime, {duration: dur, gain: 1.6});
  } else {
    playOsc(note, dur);
  }
}
function stopAllAudio() { if (sfPiano) sfPiano.stop(); }

function playOsc(note, dur) {
  const freq = 440 * Math.pow(2, (noteToMidi(note) - 69) / 12);
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.type = 'triangle'; osc.frequency.value = freq;
  const t = audioCtx.currentTime;
  gain.gain.setValueAtTime(0.28, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.4);
  osc.start(t); osc.stop(t + dur + 0.4);
}

// ═══════════════════════════════════════════════════════════════
//  通用工具
// ═══════════════════════════════════════════════════════════════

// 統計（localStorage）
function loadSt(key) {
  try { const s = localStorage.getItem(key); if (s) return JSON.parse(s); } catch(e) {}
  return [{count:0,best:null},{count:0,best:null},{count:0,best:null}];
}
function saveSt(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch(e) {}
}

// setTimeout 管理（可批次取消）
function mkSched(list) {
  return {
    add(fn, delay) { const id = setTimeout(fn, delay); list.push(id); return id; },
    clear()        { list.forEach(clearTimeout); list.length = 0; }
  };
}

// 計時器（顯示 SS.CC）
function mkTimer(displayId) {
  let iv = null, start = null, ms = 0;
  return {
    start() {
      start = Date.now(); ms = 0;
      iv = setInterval(() => { ms = Date.now() - start; renderTimer(displayId, ms); }, 30);
    },
    stop()  { if (iv) { clearInterval(iv); iv = null; } return ms; },
    reset() { if (iv) { clearInterval(iv); iv = null; } ms = 0; renderTimer(displayId, 0); }
  };
}
function renderTimer(id, ms) {
  const s    = ms / 1000;
  const secs = Math.floor(s);
  const cents= Math.floor((s - secs) * 100);
  document.getElementById(id).textContent =
    String(secs).padStart(2,'0') + '.' + String(cents).padStart(2,'0');
}

// 播放秒數
const durState = {};
function initDur(game) {
  durState[game] = 0.5;
  document.getElementById('g'+game+'-dur-val').textContent = '0.5秒';
}
function adjDur(game, dir, inProgress) {
  if (inProgress && inProgress()) return;
  durState[game] = Math.round((durState[game] + dir * 0.1) * 10) / 10;
  durState[game] = Math.max(0.1, Math.min(2.0, durState[game]));
  document.getElementById('g'+game+'-dur-val').textContent = durState[game].toFixed(1) + '秒';
}
function setDurCtrl(game, on) {
  document.getElementById('g'+game+'-dur-m').disabled = !on;
  document.getElementById('g'+game+'-dur-p').disabled = !on;
}

// 顯示模式
const dispMode = {};
function initMode(game) { dispMode[game] = 1; } // DoReMi 為預設
function cycleMode(game, updateFn) {
  dispMode[game] = (dispMode[game] + 1) % 4;
  document.getElementById('g'+game+'-mode-btn').textContent = DISP_MODES[dispMode[game]];
  updateFn();
}

// 彈出訊息
function showMsg(title, text, buttons) {
  document.getElementById('msg-title').textContent = title;
  document.getElementById('msg-text').textContent  = text;
  const c = document.getElementById('msg-btns');
  c.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className   = 'msg-btn' + (b.primary ? ' primary' : '');
    el.textContent = b.text;
    el.onclick = () => {
      document.getElementById('msg-overlay').classList.add('hidden');
      b.action();
    };
    c.appendChild(el);
  }
  document.getElementById('msg-overlay').classList.remove('hidden');
}
