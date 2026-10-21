// ── Constants ─────────────────────────────────────────────────
const CATS = [
  { id: 'upstate',       label: '🍂 Upstate',       hex: '#5EBF8A' },
  { id: 'fair',          label: '🎡 Fair',           hex: '#E8884A' },
  { id: 'halloween',     label: '🎃 Halloween',      hex: '#B07FD8' },
  { id: 'friendsgiving', label: '🥧 Friendsgiving',  hex: '#E87878' },
  { id: 'other',         label: '✦ Other',           hex: '#78AADC' },
];
const MONTHS = [
  { m: 8,  name: 'September', label: 'Sep' },
  { m: 9,  name: 'October',   label: 'Oct' },
  { m: 10, name: 'November',  label: 'Nov' },
];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const Y = 2026;
const FRIEND_COLORS = ['#5EBF8A','#E8884A','#B07FD8','#78AADC','#E87878','#c8a84b','#78DCB0','#DC7878'];

// ── State ─────────────────────────────────────────────────────
let allEvents = {}, goalsData = {}, friendsList = [], tagsData = {}, notesData = {};
let selKey = null, selCat = 'other', selFriendId = null, isFriend = true, viewStart = 0;
let activeTab = 'calendar', editingPlanIdx = null;
let gcalConnected = false, gcalEmail = null, gcalByDate = {};
let gcalToken = null, tokenClient = null;
let weatherByDate = {};
let gcalRefreshInterval = null;
let weekStart = null;
let lastViewStart = -1;
let lastCountdownVal = -1;
let calendarRenderedOnce = false;
const suggCache = {};
const now = new Date();
const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
// Default view: current month (clamped so 2 months always fit)
viewStart = Math.min(Math.max(MONTHS.findIndex(x => x.m === now.getMonth()), 0), MONTHS.length - 2);

// ── Animations ────────────────────────────────────────────────
function countUp(el, target, dur = 700) {
  if (!el) return;
  const start = performance.now();
  const from = parseInt(el.textContent) || 0;
  const tick = (now) => {
    const p = Math.min(1, (now - start) / dur);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (target - from) * ease);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function addRipple(tile, e) {
  const r = document.createElement('div');
  r.className = 'ripple';
  const rect = tile.getBoundingClientRect();
  r.style.left = `${e.clientX - rect.left}px`;
  r.style.top = `${e.clientY - rect.top}px`;
  tile.appendChild(r);
  setTimeout(() => r.remove(), 600);
}

function initLeaves() {
  const canvas = document.getElementById('leaves-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const COLORS = ['#E8884A','#c8a84b','#E87878','#5EBF8A','#B07FD8'];
  let W, H, leaves = [];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  for (let i = 0; i < 22; i++) {
    leaves.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      size: 3.5 + Math.random() * 5,
      vy: 0.35 + Math.random() * 0.65,
      vx: (Math.random() - 0.5) * 0.5,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.025,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: 0.25 + Math.random() * 0.3,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    leaves.forEach(l => {
      l.y += l.vy; l.x += l.vx; l.rot += l.rotV;
      if (l.y > H + 10) { l.y = -10; l.x = Math.random() * W; }
      if (l.x < -10) l.x = W + 10;
      if (l.x > W + 10) l.x = -10;
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.rot);
      ctx.globalAlpha = l.alpha;
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, l.size, l.size * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    requestAnimationFrame(draw);
  }
  draw();
}

function initParallax() {
  const bg = document.getElementById('bg');
  if (!bg) return;
  window.addEventListener('scroll', () => {
    bg.style.transform = `scale(1.06) translateY(${window.scrollY * 0.25}px)`;
  }, { passive: true });
}

// ── Config ────────────────────────────────────────────────────
const GCAL_CLIENT_ID = window.GCAL_CLIENT_ID || '';

// ── localStorage helpers ──────────────────────────────────────
const LS = {
  get: (k, d = null) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

// ── Weather helpers ───────────────────────────────────────────
function weatherEmoji(code) {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 55) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '🌨️';
  if (code <= 82) return '🌦️';
  if (code <= 86) return '❄️';
  return '⛈️';
}
function weatherDesc(code) {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Foggy';
  if (code <= 55) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorm';
}

async function loadAll() {
  allEvents = LS.get('fc_events', {});
  Object.keys(allEvents).forEach(k => { allEvents[k] = sortPlans(allEvents[k]); });
  friendsList = LS.get('fc_friends', []);
  goalsData = LS.get('fc_goals', {});
  tagsData = LS.get('fc_tags', {});
  notesData = LS.get('fc_notes', {});
  renderAll();
  fetchWeather().catch(() => {});
  initGcalAuth();
}

// ── Helpers ───────────────────────────────────────────────────
function dayKey(y, m, d) { return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function isPast(y, m, d) { return new Date(y, m, d) < todayMidnight; }
function isToday(y, m, d) { return new Date(y, m, d).getTime() === todayMidnight.getTime(); }
function isConfirmed(p) { return p.confirmed !== false; }
function goalKey(m) { return `${Y}-${String(m+1).padStart(2,'0')}`; }
function monthGoal(m) { return goalsData[goalKey(m)] || 0; }
function friendName(id) { return (friendsList.find(x => x.id === id) || {}).name || ''; }

function isCoveredDay(key, gcalEvts) {
  const timedEvts = (gcalEvts || []).filter(e => !e.allDay && e.startMin != null && e.endMin != null);
  if (!timedEvts.length) return false;
  const [, mStr, dStr] = key.split('-');
  const m = parseInt(mStr) - 1, d = parseInt(dStr);
  const dow = new Date(Y, m, d).getDay();
  const isWeekend = dow === 0 || dow === 6;
  const windowStart = isWeekend ? 780 : 960;   // 1pm : 4pm
  const windowEnd   = isWeekend ? 1380 : 1260; // 11pm : 9pm
  const threshold   = isWeekend ? 360 : 180;   // 60% of 600 : 60% of 300
  const intervals = [];
  for (const ev of timedEvts) {
    const s = Math.max(ev.startMin, windowStart);
    const e = Math.min(ev.endMin, windowEnd);
    if (s < e) intervals.push([s, e]);
  }
  if (!intervals.length) return false;
  intervals.sort((a, b) => a[0] - b[0]);
  let coverage = 0, cs = intervals[0][0], ce = intervals[0][1];
  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i];
    if (s <= ce) ce = Math.max(ce, e);
    else { coverage += ce - cs; cs = s; ce = e; }
  }
  coverage += ce - cs;
  return coverage >= threshold;
}

function isSuccessDay(key) {
  const gcalEvts = gcalByDate[key] || [];
  const dbPlans = allEvents[key] || [];
  return isCoveredDay(key, gcalEvts) || dbPlans.some(p => p.friend && isConfirmed(p));
}

function monthSuccessCount(m) {
  const days = new Date(Y, m + 1, 0).getDate();
  let n = 0;
  for (let d = 1; d <= days; d++) {
    if (isSuccessDay(dayKey(Y, m, d))) n++;
  }
  return n;
}

function calcStreak() {
  let streak = 0;
  const d = new Date(todayMidnight);
  d.setDate(d.getDate() - 1);
  for (let i = 0; i < 92; i++) {
    const k = dayKey(d.getFullYear(), d.getMonth(), d.getDate());
    if (isSuccessDay(k)) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

function calcGaps() {
  const gaps = []; let gapStart = null, gapLen = 0;
  for (let mo = 8; mo <= 10; mo++) {
    const daysInMo = new Date(Y, mo + 1, 0).getDate();
    for (let d = 1; d <= daysInMo; d++) {
      if (isPast(Y, mo, d)) continue;
      const plans = allEvents[dayKey(Y, mo, d)] || [];
      if (!plans.length) { gapLen++; if (!gapStart) gapStart = { mo, d }; }
      else { if (gapLen >= 5) gaps.push({ len: gapLen, start: gapStart }); gapLen = 0; gapStart = null; }
    }
  }
  if (gapLen >= 5) gaps.push({ len: gapLen, start: gapStart });
  return gaps;
}

function friendDebtMap() {
  const lastSeen = {};
  Object.entries(tagsData).forEach(([tagKey, tag]) => {
    const parts = tagKey.split('::');
    const dateKey = parts[parts.length - 1];
    if (!dateKey.match(/^\d{4}-\d{2}-\d{2}$/)) return;
    (tag.friends || []).forEach(name => {
      if (!lastSeen[name] || dateKey > lastSeen[name]) lastSeen[name] = dateKey;
    });
  });
  Object.entries(allEvents).forEach(([dateKey, plans]) => {
    plans.forEach(p => {
      if (p.friendName) {
        if (!lastSeen[p.friendName] || dateKey > lastSeen[p.friendName]) lastSeen[p.friendName] = dateKey;
      }
    });
  });
  const result = {};
  friendsList.forEach(f => {
    const ls = lastSeen[f.name];
    if (ls) {
      const [fy, fm, fd] = ls.split('-').map(Number);
      const diff = Math.max(0, Math.floor((todayMidnight - new Date(fy, fm - 1, fd)) / 864e5));
      result[f.id] = { name: f.name, color: f.color, daysSince: diff, lastDate: ls };
    } else {
      result[f.id] = { name: f.name, color: f.color, daysSince: null, lastDate: null };
    }
  });
  return result;
}

function friendFrequency() {
  const counts = {};
  Object.values(allEvents).flat().forEach(p => { if (p.friendName) counts[p.friendName] = (counts[p.friendName] || 0) + 1; });
  Object.values(tagsData).forEach(tag => { (tag.friends || []).forEach(f => { counts[f] = (counts[f] || 0) + 1; }); });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function catBreakdown() {
  const counts = {}; CATS.forEach(c => { counts[c.id] = 0; });
  Object.values(allEvents).flat().forEach(p => { if (p.cat) counts[p.cat] = (counts[p.cat] || 0) + 1; });
  Object.values(tagsData).forEach(tag => { if (tag.cat && counts[tag.cat] !== undefined) counts[tag.cat]++; });
  return counts;
}

async function saveTag(gcalId, dateKey, friends, cat) {
  const tagKey = `${gcalId}::${dateKey}`;
  tagsData[tagKey] = { friends, cat };
  LS.set('fc_tags', tagsData);
}

// ── Persist ───────────────────────────────────────────────────
function timeToMinutes(t) {
  if (!t) return 9999;
  const s = t.trim().toLowerCase().replace(/\s+/g, '');
  // "5:00am", "10:30pm", "2pm", "9am"
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!m) return 9999;
  let h = parseInt(m[1]), min = parseInt(m[2] || '0');
  const ampm = m[3];
  if (ampm === 'pm' && h !== 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

function sortPlans(plans) {
  return [...plans].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

async function persistDay(key, plans) {
  const sorted = sortPlans(plans);
  const oldPlans = allEvents[key] || [];
  const wasSuccess = isSuccessDay(key);
  allEvents[key] = sorted;
  const stored = LS.get('fc_events', {});
  if (sorted.length === 0) delete stored[key]; else stored[key] = sorted;
  LS.set('fc_events', stored);
  renderAll();
  if (!wasSuccess && isSuccessDay(key)) setTimeout(() => burstConfetti(key), 80);
  if (sorted.length > 0) {
    const tiles = document.querySelectorAll('.tile.success');
    tiles.forEach(t => {
      if (t.querySelector('.dn')?.textContent === String(parseInt(key.slice(8)))) {
        t.classList.remove('pulse-in'); void t.offsetWidth; t.classList.add('pulse-in');
      }
    });
  }
  if (gcalConnected) syncDayToGCal(key, oldPlans, sorted);
  // Animate newly added plan row
  if (sorted.length > oldPlans.length) {
    const items = document.querySelectorAll('#panel .plan-item');
    const newItem = items[items.length - 1];
    if (newItem) { newItem.classList.remove('plan-row-new'); void newItem.offsetWidth; newItem.classList.add('plan-row-new'); }
  }
}

function parseEventTimeForGCal(date, timeStr) {
  if (!timeStr || !timeStr.trim()) return { start: { date }, end: { date } };
  const t = timeStr.trim().toLowerCase();
  let h = 0, m = 0;
  const m12 = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m12) {
    h = parseInt(m12[1]); m = parseInt(m12[2] || '0');
    if (m12[3] === 'pm' && h !== 12) h += 12;
    if (m12[3] === 'am' && h === 12) h = 0;
  } else if (m24) {
    h = parseInt(m24[1]); m = parseInt(m24[2]);
  } else return { start: { date }, end: { date } };
  const pad = n => String(n).padStart(2, '0');
  return {
    start: { dateTime: `${date}T${pad(h)}:${pad(m)}:00`, timeZone: 'America/New_York' },
    end: { dateTime: `${date}T${pad(h < 23 ? h + 1 : 23)}:${pad(m)}:00`, timeZone: 'America/New_York' },
  };
}

async function syncDayToGCal(key, oldPlans, newPlans) {
  if (!gcalToken) return;
  const gcalBase = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  const headers = { Authorization: `Bearer ${gcalToken}`, 'Content-Type': 'application/json' };

  for (const op of oldPlans) {
    if (!op.gcalCreated || !op.gcalId) continue;
    if (!newPlans.some(np => np.gcalId === op.gcalId)) {
      try { await fetch(`${gcalBase}/${encodeURIComponent(op.gcalId)}`, { method: 'DELETE', headers }); } catch {}
    }
  }

  const current = [...(allEvents[key] || [])];
  let changed = false;
  for (let i = 0; i < current.length; i++) {
    const p = current[i];
    if (!p.gcalId) {
      try {
        const res = await fetch(gcalBase, { method: 'POST', headers, body: JSON.stringify({ summary: p.name, ...parseEventTimeForGCal(key, p.time) }) });
        if (res.ok) { const ev = await res.json(); if (ev.id) { current[i] = { ...p, gcalId: ev.id, gcalCreated: true }; changed = true; } }
      } catch {}
    } else if (p.gcalCreated) {
      const oldP = oldPlans.find(op => op.gcalId === p.gcalId);
      if (oldP && (oldP.name !== p.name || oldP.time !== p.time)) {
        try { await fetch(`${gcalBase}/${encodeURIComponent(p.gcalId)}`, { method: 'PATCH', headers, body: JSON.stringify({ summary: p.name, ...parseEventTimeForGCal(key, p.time) }) }); } catch {}
      }
    }
  }

  if (changed) {
    allEvents[key] = sortPlans(current);
    const stored = LS.get('fc_events', {}); stored[key] = allEvents[key]; LS.set('fc_events', stored);
  }
}

async function persistGoal(m, target) {
  goalsData[goalKey(m)] = target;
  LS.set('fc_goals', goalsData);
  renderAll();
}

// ── Stats ─────────────────────────────────────────────────────
function updateStats() {
  let success = 0, total = 0, remain = 0;
  for (let mo = 8; mo <= 10; mo++) {
    const days = new Date(Y, mo + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const key = dayKey(Y, mo, d);
      const plans = allEvents[key] || [];
      total += plans.length;
      if (isSuccessDay(key)) success++;
      if (!isPast(Y, mo, d)) remain++;
    }
  }
  countUp(document.getElementById('stat-success'), success);
  countUp(document.getElementById('stat-plans'), total);
  countUp(document.getElementById('stat-remain'), remain);
  const streak = calcStreak();
  const se = document.getElementById('stat-streak');
  if (se) { countUp(se, streak); se.classList.toggle('streak-fire', streak >= 3); }
  const fallEnd = new Date(Y, 11, 1);
  const daysToEnd = Math.max(0, Math.ceil((fallEnd - todayMidnight) / 864e5));
  const ce = document.getElementById('stat-countdown');
  if (ce) {
    countUp(ce, daysToEnd);
    if (daysToEnd !== lastCountdownVal && lastCountdownVal >= 0) {
      ce.classList.remove('stat-flip-anim'); void ce.offsetWidth; ce.classList.add('stat-flip-anim');
      ce.addEventListener('animationend', () => ce.classList.remove('stat-flip-anim'), { once: true });
    }
    lastCountdownVal = daysToEnd;
  }
  const gapEl = document.getElementById('gap-alert');
  if (gapEl) {
    const gaps = calcGaps();
    if (gaps.length > 0) {
      const g = gaps.reduce((a, b) => b.len > a.len ? b : a);
      const mo = MONTHS.find(x => x.m === g.start.mo);
      gapEl.textContent = `⚠ ${g.len}-day gap: ${mo ? mo.label : ''} ${g.start.d}`;
      gapEl.hidden = false;
    } else gapEl.hidden = true;
  }
}

// ── Calendar ──────────────────────────────────────────────────
function renderCalendar() {
  const container = document.getElementById('months');
  const slideDir = viewStart > lastViewStart ? 'months-slide' : viewStart < lastViewStart ? 'months-slide-left' : null;
  lastViewStart = viewStart;
  container.innerHTML = '';
  MONTHS.slice(viewStart, viewStart + 2).forEach(({ m, name }) => {
    const block = document.createElement('div'); block.className = 'month-block';
    const mhd = document.createElement('div'); mhd.className = 'month-header';
    const mn = document.createElement('div'); mn.className = 'month-name'; mn.textContent = name; mhd.appendChild(mn);
    const goal = monthGoal(m), done = monthSuccessCount(m);
    if (goal > 0) {
      const pct = Math.min(100, Math.round((done / goal) * 100));
      const gw = document.createElement('div'); gw.className = 'goal-wrap';
      gw.innerHTML = `<div class="goal-bar"><div class="goal-fill" style="width:0%"></div></div><div class="goal-label">${done}/${goal}</div>`;
      requestAnimationFrame(() => { const f = gw.querySelector('.goal-fill'); if (f) f.style.width = `${pct}%`; });
      mhd.appendChild(gw);
    }
    const gset = document.createElement('button'); gset.className = 'goal-set-btn';
    gset.textContent = goal > 0 ? `Goal:${goal}` : '+ Goal';
    gset.addEventListener('click', () => {
      const val = prompt(`${name} success day goal:`, goal || '');
      const n = parseInt(val); if (!isNaN(n) && n >= 0) persistGoal(m, n);
    });
    mhd.appendChild(gset); block.appendChild(mhd);
    const dr = document.createElement('div'); dr.className = 'dow-row';
    DAYS.forEach(d => { const el = document.createElement('div'); el.className = 'dow'; el.textContent = d[0]; dr.appendChild(el); });
    block.appendChild(dr);
    const grid = document.createElement('div'); grid.className = 'day-grid';
    const firstDay = new Date(Y, m, 1).getDay(), daysInMonth = new Date(Y, m + 1, 0).getDate();
    for (let i = 0; i < firstDay; i++) { const e = document.createElement('div'); e.className = 'tile empty'; grid.appendChild(e); }
    for (let d = 1; d <= daysInMonth; d++) {
      const slot = firstDay + d - 1, row = Math.floor(slot / 7);
      const key = dayKey(Y, m, d), plans = allEvents[key] || [];
      const past = isPast(Y, m, d), today = isToday(Y, m, d);
      const hasFriend = plans.some(p => p.friend && isConfirmed(p));
      const shouldAnimate = !calendarRenderedOnce || lastViewStart !== viewStart;
      const tile = document.createElement('div'); tile.className = shouldAnimate ? 'tile stagger' : 'tile';
      if (shouldAnimate) tile.style.animationDelay = `${row * 35}ms`;
      if (past) tile.classList.add('past');
      if (today) tile.classList.add('today');
      const gcalEvts = gcalByDate[key] || [];
      const gcalAllDay = gcalEvts.filter(e => e.allDay);
      const covered = isCoveredDay(key, gcalEvts);
      const dbFriend = plans.some(p => p.friend && isConfirmed(p));
      if (covered || dbFriend || plans.length > 0) tile.classList.add('success');
      else if (gcalEvts.length > 0 || gcalAllDay.length > 0) tile.classList.add('gcal-multiday');
      if (selKey === key) tile.classList.add('selected');
      const dn = document.createElement('div'); dn.className = 'dn'; dn.textContent = d; tile.appendChild(dn);
      const importedIds = new Set((allEvents[key] || []).map(p => p.gcalId).filter(Boolean));
      const unimported = gcalEvts.filter(e => !importedIds.has(e.id));
      const gcalTimed = gcalEvts.filter(e => !e.allDay);
      if (plans.length > 0 || gcalTimed.length > 0) {
        const dots = document.createElement('div'); dots.className = 'dots';
        plans.slice(0, 4).forEach(p => {
          const cat = CATS.find(c => c.id === p.cat) || CATS[4];
          const dot = document.createElement('div'); dot.className = 'dot';
          if (!isConfirmed(p)) dot.classList.add('tentative-dot');
          dot.style.background = past ? 'rgba(255,255,255,0.18)' : cat.hex;
          dots.appendChild(dot);
        });
        const unimportedTimed = unimported.filter(e => !e.allDay);
        unimportedTimed.slice(0, 3 - Math.min(plans.length, 4)).forEach(() => {
          const dot = document.createElement('div'); dot.className = 'dot';
          dot.style.background = past ? 'rgba(255,255,255,0.12)' : 'rgba(160,200,255,0.7)';
          dot.style.border = past ? 'none' : '1px solid rgba(160,200,255,0.9)';
          dots.appendChild(dot);
        });
        tile.appendChild(dots);
      }
      const wx = weatherByDate[key];
      if (wx) {
        const wb = document.createElement('div'); wb.className = 'wx-badge';
        const we = document.createElement('span'); we.className = 'wx-emoji'; we.textContent = wx.emoji;
        const wt = document.createElement('span'); wt.className = 'wx-temp'; wt.textContent = `${wx.hi}°`;
        wb.appendChild(we); wb.appendChild(wt); tile.appendChild(wb);
        // Rain alert: plans or gcal events + high precip in window
        if (!past && wx.precip > 60 && (plans.length > 0 || gcalEvts.length > 0)) {
          const ra = document.createElement('div'); ra.className = 'rain-alert'; ra.textContent = '🌧'; ra.title = `${wx.precip}% rain – plans may be affected`; tile.appendChild(ra);
        }
      }
      // Note dot
      if (notesData[key]) { const nd = document.createElement('div'); nd.className = 'note-dot'; tile.appendChild(nd); }
      if (!past) tile.addEventListener('click', (e) => {
        addRipple(tile, e);
        if (selKey === key) { selKey = null; closePanel(); renderCalendar(); }
        else selectDay(key);
      });
      grid.appendChild(tile);
    }
    block.appendChild(grid); container.appendChild(block);
  });
  if (slideDir) { container.classList.remove('months-slide','months-slide-left'); void container.offsetWidth; container.classList.add(slideDir); }
  // Disable back if the month we'd reveal is fully past
  const prevAllPast = viewStart === 0 || (() => {
    const { m } = MONTHS[viewStart - 1];
    return isPast(Y, m, new Date(Y, m + 1, 0).getDate());
  })();
  document.getElementById('nav-prev').disabled = prevAllPast;
  document.getElementById('nav-next').disabled = viewStart === 1;
  document.getElementById('nav-range').textContent = MONTHS.slice(viewStart, viewStart + 2).map(x => x.label).join(' – ');
  calendarRenderedOnce = true;
}

function renderAll() {
  if (activeTab === 'week') { renderWeekView(); updateStats(); return; }
  if (activeTab === 'friends') { renderFriendsBoard(); updateStats(); return; }
  if (activeTab === 'breakdown') { renderBreakdown(); updateStats(); return; }
  if (activeTab === 'insights') { renderInsights(); updateStats(); return; }
  renderCalendar(); updateStats(); if (selKey) renderPanel(selKey);
}

function openPanel() { document.getElementById('panel-wrap').classList.add('open'); }
function closePanel() { document.getElementById('panel-wrap').classList.remove('open'); }

function selectDay(key) {
  selKey = key;
  activeTab = 'calendar';
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'calendar'));
  const mw = document.getElementById('months-wrap');
  const monthsNav = document.querySelector('.months-nav');
  const monthsDiv = document.getElementById('months');
  const weekWrap = document.getElementById('week-wrap');
  if (mw) mw.style.display = '';
  if (monthsNav) monthsNav.style.display = '';
  if (monthsDiv) monthsDiv.style.display = '';
  if (weekWrap) weekWrap.style.display = 'none';
  // navigate to the month containing this key
  const km = parseInt(key.split('-')[1]) - 1;
  const idx = MONTHS.findIndex(x => x.m === km);
  if (idx >= 0) viewStart = Math.min(idx, MONTHS.length - 2);
  renderCalendar();
  renderPanel(key);
  openPanel();
}

// ── Panel ─────────────────────────────────────────────────────
function renderPanel(key) {
  const panel = document.getElementById('panel');
  const plans = allEvents[key] || [];
  const [, mStr, dStr] = key.split('-');
  const m = parseInt(mStr) - 1, d = parseInt(dStr);
  const mo = MONTHS.find(x => x.m === m);
  const past = isPast(Y, m, d);
  const dayName = DAYS[new Date(Y, m, d).getDay()];
  const gcalEvtsPanel = gcalByDate[key] || [];
  const success = isSuccessDay(key);

  const wx = weatherByDate[key];
  const wxStr = wx ? `${wx.emoji} ${wx.hi}°/${wx.lo}° · ${wx.desc}${wx.precip > 30 ? ` · ${wx.precip}% rain` : ''}` : '';
  let html = `<div class="panel-head">
    <div class="panel-date">${mo ? mo.name : ''} ${d}, ${Y}</div>
    <div class="panel-dow">${dayName}${past ? ' · Past' : ''}${success ? ' · <span style="color:var(--accent)">★ Success</span>' : ''}</div>
    ${wxStr ? `<div style="font-size:10px;color:var(--ink-3);margin-top:4px;display:flex;align-items:center;gap:4px">${wxStr}</div>` : ''}
    ${wxWindowHtml(key)}
  </div>
  ${dayTimelineHtml(key)}
  <div class="plans-section"><div class="section-label">Plans</div>`;

  if (!plans.length) {
    html += `<div style="font-size:10.5px;color:var(--ink-3);font-style:italic">No plans yet</div>`;
  } else {
    plans.forEach((p, i) => {
      const cat = CATS.find(c => c.id === p.cat) || CATS[4];
      const conf = isConfirmed(p);
      html += `<div class="plan-item${conf ? '' : ' plan-tentative'}" style="animation-delay:${i * 55}ms">
        <div class="plan-dot" style="background:${cat.hex};${conf ? '' : 'opacity:0.45'}"></div>
        <div class="plan-info">
          <div class="plan-name">${p.name}</div>
          ${p.time ? `<div class="plan-meta">${p.time}${p.location ? ` · ${p.location}` : ''}</div>` : (p.location ? `<div class="plan-meta">${p.location}</div>` : '')}
          ${p.notes ? `<div class="plan-notes">${p.notes}</div>` : ''}
          ${p.friendName ? `<div class="plan-meta" style="color:var(--accent)">with ${p.friendName}</div>` : ''}
          ${p.recurring ? `<div class="plan-meta" style="color:rgba(200,168,75,0.8)">↻ Weekly</div>` : ''}
          ${!conf ? `<div class="plan-meta" style="color:rgba(232,136,74,0.7)">Tentative</div>` : ''}
        </div>
        ${p.friend ? '<div class="plan-friend">★</div>' : ''}
        ${!past ? `<div class="plan-actions">
          ${i > 0 ? `<button class="plan-mv" data-i="${i}" data-dir="-1" data-key="${key}">↑</button>` : '<span></span>'}
          ${i < plans.length - 1 ? `<button class="plan-mv" data-i="${i}" data-dir="1" data-key="${key}">↓</button>` : '<span></span>'}
          <button class="plan-edit" data-i="${i}" data-key="${key}">✎</button>
          <button class="plan-del" data-i="${i}" data-key="${key}">×</button>
        </div>` : ''}
      </div>`;
    });
  }
  html += `</div>`;

  // GCal live events for this day
  const gcalEvts = gcalByDate[key] || [];
  const importedIds = new Set(plans.map(p => p.gcalId).filter(Boolean));
  if (gcalEvts.length > 0) {
    html += `<div class="plans-section"><div class="section-label" style="color:rgba(160,200,255,0.6)">From Google Calendar</div>`;
    gcalEvts.forEach(ev => {
      const isImported = importedIds.has(ev.id);
      const timeStr = ev.allDay ? 'all day' : (ev.start ? `${ev.start}${ev.end ? '–'+ev.end : ''}` : '');
      const tagKey = `${ev.id}::${key}`;
      const tag = tagsData[tagKey] || { friends: [], cat: 'other' };
      html += `<div class="plan-item gcal-evt-item" data-gcal-id="${ev.id}" data-key="${key}" style="flex-direction:column;align-items:stretch;gap:0">
        <div style="display:flex;align-items:flex-start;gap:8px">
          <div class="plan-dot" style="background:rgba(160,200,255,${isImported?'0.3':'0.8'});flex-shrink:0;margin-top:3px"></div>
          <div class="plan-info" style="flex:1;min-width:0">
            <div class="plan-name" style="color:${isImported?'var(--ink-3)':'var(--ink)'}">${ev.summary}</div>
            ${timeStr ? `<div class="plan-meta">${timeStr}</div>` : ''}
            ${ev.location ? `<div class="plan-meta" style="color:rgba(232,234,240,0.45)">📍 ${ev.location}</div>` : ''}
            ${ev.description ? `<div class="plan-meta" style="color:rgba(232,234,240,0.35);font-style:italic;white-space:pre-wrap;max-height:40px;overflow:hidden">${ev.description.slice(0,120)}${ev.description.length>120?'…':''}</div>` : ''}
            ${ev.attendees && ev.attendees.length ? `<div class="plan-meta" style="color:rgba(160,200,255,0.5)">👥 ${ev.attendees.slice(0,4).join(', ')}${ev.attendees.length>4?' +more':''}</div>` : ''}
            ${isImported ? `<div class="plan-meta" style="color:rgba(94,191,138,0.5)">✓ added to plans</div>` : ''}
          </div>
          ${!isImported && !past ? `<button class="gcal-quick-add plan-edit" data-gcal-id="${ev.id}" data-gcal-summary="${ev.summary.replace(/"/g,'&quot;')}" data-gcal-time="${timeStr==='all day'?'':timeStr}" data-key="${key}" title="Add to plans" style="font-size:11px;color:rgba(160,200,255,0.7);flex-shrink:0">+</button>` : ''}
        </div>
        <div class="gcal-tag-row" style="margin-top:6px;padding-left:18px">
          <div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:3px">
            ${CATS.map(c => `<button class="gcal-tag-cat${tag.cat===c.id?' active':''}" data-gcal-id="${ev.id}" data-key="${key}" data-cat="${c.id}" style="font-size:8.5px;padding:1px 6px;border-radius:10px;border:1px solid ${tag.cat===c.id?c.hex+'88':'rgba(255,255,255,0.12)'};background:${tag.cat===c.id?c.hex+'22':'transparent'};color:${tag.cat===c.id?c.hex:'rgba(232,234,240,0.4)'};cursor:pointer">${c.label}</button>`).join('')}
          </div>
          ${friendsList.length ? `<div style="display:flex;flex-wrap:wrap;gap:3px">
            ${friendsList.map(f => `<label style="display:flex;align-items:center;gap:3px;cursor:pointer;font-size:8.5px;color:${tag.friends.includes(f.name)?f.color:'rgba(232,234,240,0.4)'}">
              <input type="checkbox" class="gcal-tag-friend" data-gcal-id="${ev.id}" data-key="${key}" data-fname="${f.name}" ${tag.friends.includes(f.name)?'checked':''} style="accent-color:${f.color};width:10px;height:10px">
              ${f.name}
            </label>`).join('')}
          </div>` : ''}
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  // Quick-add to GCal (future days, GCal connected)
  if (!past && gcalConnected) {
    html += `<div class="add-section" style="margin-top:4px">
      <div class="section-label" style="color:rgba(160,200,255,0.6)">Add to Google Calendar</div>
      <input class="add-input" id="gcal-new-title" placeholder="Event title" maxlength="80">
      <div class="plan-row2">
        <input class="add-input-sm" id="gcal-new-time" placeholder="Time (e.g. 7pm)">
      </div>
      <button class="add-btn" id="gcal-add-btn" style="background:rgba(160,200,255,0.15);border-color:rgba(160,200,255,0.3)">+ Add to GCal</button>
    </div>`;
  }

  if (editingPlanIdx !== null && !past) {
    const ep = plans[editingPlanIdx];
    if (ep) {
      html += `<div class="add-section"><div class="section-label">Edit Plan</div>
        <input class="add-input" id="plan-input" value="${ep.name.replace(/"/g, '&quot;')}" maxlength="60">
        <div class="plan-row2">
          <input class="add-input-sm" id="plan-time" placeholder="Time" value="${ep.time || ''}">
          <input class="add-input-sm" id="plan-location" placeholder="Location" value="${ep.location || ''}">
        </div>
        <input class="add-input" id="plan-notes" placeholder="Notes" maxlength="128" value="${(ep.notes || '').replace(/"/g, '&quot;')}">
        <div class="cat-row">${CATS.map(c => `<button class="cat-btn${(ep.cat||selCat)===c.id?' active':''}" data-cat="${c.id}" style="${(ep.cat||selCat)===c.id?`background:${c.hex};color:#000`:''}">${c.label}</button>`).join('')}</div>
        <label class="friend-toggle"><input type="checkbox" id="friend-cb"${ep.friend ? ' checked' : ''}><div class="toggle-track"></div><span class="toggle-label">Friend plan</span></label>
        <label class="friend-toggle"><input type="checkbox" id="confirmed-cb"${isConfirmed(ep) ? ' checked' : ''}><div class="toggle-track"></div><span class="toggle-label">Confirmed</span></label>
        <div class="btn-row"><button class="add-btn" id="save-edit-btn">Save</button><button class="cancel-btn" id="cancel-edit-btn">Cancel</button></div>
      </div>`;
    }
  } else if (!past) {
    const fPicker = friendsList.length > 0 ? `<div class="friend-pick-row"><span class="section-label" style="margin-bottom:0;flex-shrink:0">With:</span>
      ${friendsList.map(f => `<button class="friend-chip${selFriendId===f.id?' active':''}" data-fid="${f.id}" style="border-color:${f.color};${selFriendId===f.id?`background:${f.color};color:#000`:''}">${f.name}</button>`).join('')}
      <button class="friend-chip${!selFriendId?' active':''}" data-fid="">—</button></div>` : '';
    html += `<div class="add-section"><div class="section-label">Add Plan</div>
      <input class="add-input" id="plan-input" placeholder="What's the plan?" maxlength="60">
      <div class="plan-row2">
        <input class="add-input-sm" id="plan-time" placeholder="Time (e.g. 2pm)">
        <input class="add-input-sm" id="plan-location" placeholder="Location">
      </div>
      <input class="add-input" id="plan-notes" placeholder="Notes (optional)" maxlength="128">
      <div class="cat-row">${CATS.map(c => `<button class="cat-btn${selCat===c.id?' active':''}" data-cat="${c.id}" style="${selCat===c.id?`background:${c.hex};color:#000`:''}">${c.label}</button>`).join('')}</div>
      <label class="friend-toggle"><input type="checkbox" id="friend-cb"${isFriend ? ' checked' : ''}><div class="toggle-track"></div><span class="toggle-label">Friend plan (counts as success)</span></label>
      <label class="friend-toggle"><input type="checkbox" id="confirmed-cb" checked><div class="toggle-track"></div><span class="toggle-label">Confirmed (uncheck = tentative)</span></label>
      ${fPicker}
      <label class="friend-toggle"><input type="checkbox" id="recurring-cb"><div class="toggle-track"></div><span class="toggle-label">Repeat weekly through Nov</span></label>
      <button class="add-btn" id="add-btn">Add Plan</button>
    </div>`;
  }

  if (!past) {
    const cached = suggCache[key];
    html += `<div class="sugg-section"><div class="section-label">NY Suggestions</div>`;
    if (cached) {
      html += cached.map(s => {
        const cat = CATS.find(c => c.id === s.category) || CATS[4];
        return `<div class="sugg-item" data-name="${(s.title||'').replace(/"/g,'&quot;')}" data-cat="${s.category||'other'}">
          <div class="sugg-title">${s.title||''}</div>
          <div class="sugg-desc">${s.description||''}</div>
          <span class="sugg-cat" style="background:${cat.hex}22;color:${cat.hex}">${cat.label}</span>
        </div>`;
      }).join('');
    } else {
      html += `<div class="sugg-loading" id="sugg-loading">Finding things to do…</div>`;
      fetchSuggestions(key, dayName, mo ? mo.name : '', d);
    }
    html += `</div>`;
  }

  if (m === 10) html += `<button class="recap-btn" id="recap-btn">✦ Generate Season Recap</button>`;

  // Per-day notes
  html += `<div class="plans-section">
    <div class="section-label">Notes</div>
    <textarea id="day-note" rows="3" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;color:var(--ink);font-size:10.5px;padding:7px 9px;resize:vertical;font-family:inherit;outline:none" placeholder="Jot something down…">${(notesData[key] || '').replace(/</g,'&lt;')}</textarea>
  </div>`;

  panel.innerHTML = html;
  panel.classList.remove('panel-fade'); void panel.offsetWidth; panel.classList.add('panel-fade');
  attachPanelEvents(key, plans, past);
}

function attachPanelEvents(key, plans, past) {
  const panel = document.getElementById('panel');

  panel.querySelectorAll('.plan-del:not([data-fi])').forEach(btn => {
    btn.addEventListener('click', async () => {
      const arr = [...(allEvents[btn.dataset.key] || [])];
      arr.splice(parseInt(btn.dataset.i), 1);
      editingPlanIdx = null;
      await persistDay(btn.dataset.key, arr);
    });
  });

  panel.querySelectorAll('.plan-mv').forEach(btn => {
    btn.addEventListener('click', async () => {
      const arr = [...(allEvents[btn.dataset.key] || [])];
      const i = parseInt(btn.dataset.i), dir = parseInt(btn.dataset.dir);
      if (i + dir < 0 || i + dir >= arr.length) return;
      [arr[i], arr[i + dir]] = [arr[i + dir], arr[i]];
      await persistDay(btn.dataset.key, arr);
    });
  });

  panel.querySelectorAll('.plan-edit').forEach(btn => {
    btn.addEventListener('click', () => { editingPlanIdx = parseInt(btn.dataset.i); renderPanel(btn.dataset.key); });
  });

  panel.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => { selCat = btn.dataset.cat; renderPanel(key); });
  });

  panel.querySelectorAll('.friend-chip').forEach(btn => {
    btn.addEventListener('click', () => { selFriendId = btn.dataset.fid || null; renderPanel(key); });
  });

  panel.querySelectorAll('.gcal-quick-add').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { gcalId, gcalSummary, gcalTime, key: k } = btn.dataset;
      const arr = [...(allEvents[k] || [])];
      if (arr.some(p => p.gcalId === gcalId)) return;
      const plan = { name: gcalSummary, cat: 'other', friend: false, confirmed: true, gcalId };
      if (gcalTime) plan.time = gcalTime;
      arr.push(plan);
      await persistDay(k, arr);
    });
  });

  const fcb = panel.querySelector('#friend-cb');
  if (fcb) fcb.addEventListener('change', () => { isFriend = fcb.checked; });

  const saveBtn = panel.querySelector('#save-edit-btn');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const arr = [...(allEvents[key] || [])];
    const ep = arr[editingPlanIdx]; if (!ep) return;
    ep.name = panel.querySelector('#plan-input')?.value.trim() || ep.name;
    ep.time = panel.querySelector('#plan-time')?.value.trim() || '';
    ep.location = panel.querySelector('#plan-location')?.value.trim() || '';
    ep.notes = panel.querySelector('#plan-notes')?.value.trim() || '';
    ep.friend = panel.querySelector('#friend-cb')?.checked ?? ep.friend;
    ep.confirmed = panel.querySelector('#confirmed-cb')?.checked ?? true;
    const cb = panel.querySelector('.cat-btn.active'); if (cb) ep.cat = cb.dataset.cat;
    editingPlanIdx = null;
    await persistDay(key, arr);
  });

  const cancelBtn = panel.querySelector('#cancel-edit-btn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { editingPlanIdx = null; renderPanel(key); });

  const addBtn = panel.querySelector('#add-btn');
  if (addBtn) addBtn.addEventListener('click', async () => {
    const name = panel.querySelector('#plan-input')?.value.trim(); if (!name) return;
    addBtn.disabled = true; addBtn.textContent = 'Adding…';
    const timeVal = panel.querySelector('#plan-time')?.value.trim() || '';
    const locVal = panel.querySelector('#plan-location')?.value.trim() || '';
    const notesVal = panel.querySelector('#plan-notes')?.value.trim() || '';
    const confirmedVal = panel.querySelector('#confirmed-cb')?.checked ?? true;
    const recurringVal = panel.querySelector('#recurring-cb')?.checked ?? false;
    const fName = friendName(selFriendId);
    const plan = { name, cat: selCat, friend: isFriend, confirmed: confirmedVal };
    if (timeVal) plan.time = timeVal;
    if (locVal) plan.location = locVal;
    if (notesVal) plan.notes = notesVal;
    if (fName) plan.friendName = fName;
    if (recurringVal) plan.recurring = 'weekly';

    const arr = [...(allEvents[key] || [])]; arr.push(plan); allEvents[key] = arr;
    await persistDay(key, arr);

    if (recurringVal) {
      const [ky, km, kd] = key.split('-').map(Number);
      let cur = new Date(ky, km - 1, kd + 7);
      while (cur <= new Date(2026, 10, 30)) {
        const rk = dayKey(cur.getFullYear(), cur.getMonth(), cur.getDate());
        const rArr = [...(allEvents[rk] || [])];
        rArr.push({ ...plan, recurring: 'weekly' });
        allEvents[rk] = rArr;
        await persistDay(rk, rArr);
        cur.setDate(cur.getDate() + 7);
      }
    }
    addBtn.disabled = false; addBtn.textContent = 'Add Plan';
    renderPanel(key);
  });

  const pi = panel.querySelector('#plan-input');
  if (pi) { pi.addEventListener('keydown', e => { if (e.key === 'Enter') (addBtn || saveBtn)?.click(); }); setTimeout(() => pi.focus(), 50); }

  panel.querySelectorAll('.sugg-item').forEach(item => {
    item.addEventListener('click', () => {
      const inp = panel.querySelector('#plan-input');
      if (inp) { inp.value = item.dataset.name; inp.focus(); }
      panel.querySelector(`.cat-btn[data-cat="${item.dataset.cat}"]`)?.click();
    });
  });

  const recapBtn = panel.querySelector('#recap-btn');
  if (recapBtn) recapBtn.addEventListener('click', () => generateRecap(panel));

  // GCal tag: cat pills
  panel.querySelectorAll('.gcal-tag-cat').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { gcalId, key: k, cat } = btn.dataset;
      const tagKey = `${gcalId}::${k}`;
      const cur = tagsData[tagKey] || { friends: [], cat: 'other' };
      await saveTag(gcalId, k, cur.friends, cat);
      renderPanel(k);
    });
  });

  // GCal tag: friend checkboxes
  panel.querySelectorAll('.gcal-tag-friend').forEach(cb => {
    cb.addEventListener('change', async () => {
      const { gcalId, key: k, fname } = cb.dataset;
      const tagKey = `${gcalId}::${k}`;
      const cur = tagsData[tagKey] || { friends: [], cat: 'other' };
      const friends = cb.checked
        ? [...new Set([...cur.friends, fname])]
        : cur.friends.filter(f => f !== fname);
      await saveTag(gcalId, k, friends, cur.cat);
      tagsData[tagKey] = { friends, cat: cur.cat };
    });
  });

  // Quick-add to GCal
  const gcalAddBtn = panel.querySelector('#gcal-add-btn');
  if (gcalAddBtn) gcalAddBtn.addEventListener('click', async () => {
    const titleEl = panel.querySelector('#gcal-new-title');
    const timeEl = panel.querySelector('#gcal-new-time');
    const title = titleEl?.value.trim(); if (!title) return;
    gcalAddBtn.disabled = true; gcalAddBtn.textContent = 'Adding…';
    try {
      const timing = parseEventTimeForGCal(key, timeEl?.value.trim() || '');
      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${gcalToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: title, ...timing }),
      });
      if (res.ok) {
        if (titleEl) titleEl.value = '';
        if (timeEl) timeEl.value = '';
        await refreshGCalEvents(true);
        if (selKey) renderPanel(selKey);
      }
    } catch {}
    gcalAddBtn.disabled = false; gcalAddBtn.textContent = '+ Add to GCal';
  });

  // Day notes auto-save
  const noteEl = panel.querySelector('#day-note');
  if (noteEl) {
    noteEl.addEventListener('blur', async () => {
      const note = noteEl.value;
      notesData[key] = note;
      LS.set('fc_notes', notesData);
      renderCalendar();
    });
  }
}

// ── AI ────────────────────────────────────────────────────────
async function fetchSuggestions(key, dayName, monthName, dayNum) {
  const freq = friendFrequency().slice(0, 3).map(([n]) => n);
  try {
    const res = await fetch('/api/ai/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dayName, monthName, dayNum, friends: freq }),
    });
    const data = await res.json();
    suggCache[key] = data.suggestions || [];
    if (selKey === key) renderPanel(key);
  } catch {}
}

async function generateRecap(panel) {
  let success = 0, total = 0;
  for (let mo = 8; mo <= 10; mo++) {
    const days = new Date(Y, mo + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const key = dayKey(Y, mo, d);
      const p = allEvents[key] || [];
      total += p.length;
      if (isSuccessDay(key)) success++;
    }
  }
  const freq = friendFrequency().slice(0, 5).map(([n,c]) => `${n}(${c}x)`).join(', ');
  const bd = catBreakdown();
  const breakdown = Object.entries(bd).filter(([,v]) => v > 0).map(([k,v]) => `${k}:${v}`).join(', ');

  const recapBtn = panel.querySelector('#recap-btn');
  if (recapBtn) { recapBtn.disabled = true; recapBtn.textContent = 'Generating…'; }
  let div = document.getElementById('recap-text');
  if (!div) { div = document.createElement('div'); div.id = 'recap-text'; div.className = 'recap-text'; panel.appendChild(div); }
  div.textContent = '';

  try {
    const res = await fetch('/api/ai/recap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success, total, topFriends: freq, breakdown }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      div.textContent += dec.decode(value, { stream: true });
    }
  } catch (e) { div.textContent = `Error: ${e.message}`; }
  if (recapBtn) { recapBtn.disabled = false; recapBtn.textContent = '↻ Regenerate Recap'; }
}

// ── Confetti ──────────────────────────────────────────────────
function burstConfetti(key) {
  const tiles = document.querySelectorAll('.tile');
  let tile = null;
  tiles.forEach(t => { if (t.querySelector('.dn')?.textContent === String(parseInt(key.slice(8)))) tile = t; });
  if (!tile) return;
  const COLORS = ['#5EBF8A','#E8884A','#B07FD8','#E87878','#78AADC','#c8a84b'];
  for (let i = 0; i < 22; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-particle';
    el.style.cssText = `
      background:${COLORS[i % COLORS.length]};
      left:${40 + Math.random() * 20}%;top:${40 + Math.random() * 20}%;
      --dx:${(Math.random() - 0.5) * 60}px;
      --dy:${-20 - Math.random() * 50}px;
      --dr:${(Math.random() - 0.5) * 360}deg;
      animation-duration:${0.5 + Math.random() * 0.4}s;
      animation-delay:${Math.random() * 120}ms;
    `;
    tile.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}

// ── Weather ───────────────────────────────────────────────────
async function fetchWeather() {
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
  const base = `https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060&timezone=America%2FNew_York&temperature_unit=fahrenheit&start_date=${today}&end_date=${end}`;
  const [dailyRes, hourlyRes] = await Promise.all([
    fetch(base + '&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max'),
    fetch(base + '&hourly=temperature_2m,weathercode,precipitation_probability'),
  ]);
  if (!dailyRes.ok) return;
  const daily = await dailyRes.json();
  const byDate = {};
  (daily.daily?.time || []).forEach((date, i) => {
    byDate[date] = {
      hi: Math.round(daily.daily.temperature_2m_max[i]),
      lo: Math.round(daily.daily.temperature_2m_min[i]),
      code: daily.daily.weathercode[i],
      emoji: weatherEmoji(daily.daily.weathercode[i]),
      desc: weatherDesc(daily.daily.weathercode[i]),
      precip: daily.daily.precipitation_probability_max[i] ?? 0,
      hourly: {},
    };
  });
  if (hourlyRes.ok) {
    const hourly = await hourlyRes.json();
    (hourly.hourly?.time || []).forEach((timeStr, i) => {
      const date = timeStr.slice(0, 10);
      const hour = parseInt(timeStr.slice(11, 13));
      if (byDate[date]) {
        byDate[date].hourly[hour] = {
          temp: Math.round(hourly.hourly.temperature_2m[i]),
          code: hourly.hourly.weathercode[i],
          emoji: weatherEmoji(hourly.hourly.weathercode[i]),
          precip: hourly.hourly.precipitation_probability[i] ?? 0,
        };
      }
    });
  }
  weatherByDate = byDate;
  renderAll();
}

// ── Google Calendar ───────────────────────────────────────────
function initGcalAuth() {
  if (!GCAL_CLIENT_ID) { updateGCalBtn(); return; }
  const stored = LS.get('fc_gcal_token', null);
  if (stored && stored.expiry > Date.now() + 60000) {
    gcalToken = stored.token;
    gcalEmail = stored.email || null;
    gcalConnected = true;
    updateGCalBtn();
    refreshGCalEvents();
    if (!gcalRefreshInterval) gcalRefreshInterval = setInterval(() => refreshGCalEvents(true), 5 * 60 * 1000);
  } else {
    updateGCalBtn();
  }
  if (typeof google !== 'undefined') {
    initTokenClient();
  } else {
    window.onGoogleLibraryLoad = initTokenClient;
  }
}

function initTokenClient() {
  if (typeof google === 'undefined' || !GCAL_CLIENT_ID) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GCAL_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/calendar',
    callback: async (resp) => {
      if (resp.error || !resp.access_token) {
        gcalConnected = false; gcalToken = null;
        LS.del('fc_gcal_token');
        updateGCalBtn();
        return;
      }
      gcalToken = resp.access_token;
      gcalConnected = true;
      const expiry = Date.now() + (resp.expires_in - 60) * 1000;
      LS.set('fc_gcal_token', { token: gcalToken, expiry, email: gcalEmail });
      updateGCalBtn();
      await refreshGCalEvents(false);
      if (!gcalRefreshInterval) gcalRefreshInterval = setInterval(() => refreshGCalEvents(true), 5 * 60 * 1000);
    },
  });
  // Silent re-auth if we have a stored (possibly expired) token
  if (gcalConnected || LS.get('fc_gcal_token')) {
    tokenClient.requestAccessToken({ prompt: '' });
  }
}

async function fetchGCalEvents() {
  if (!gcalToken) return null;
  const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events?' + new URLSearchParams({
    singleEvents: 'true', orderBy: 'startTime',
    timeMin: '2026-09-01T00:00:00-04:00',
    timeMax: '2026-11-30T23:59:59-05:00',
    maxResults: '500',
  });
  const res = await fetch(url, { headers: { Authorization: `Bearer ${gcalToken}` } });
  if (res.status === 401) {
    gcalToken = null; gcalConnected = false;
    LS.del('fc_gcal_token');
    updateGCalBtn();
    if (tokenClient) tokenClient.requestAccessToken({ prompt: '' });
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json();
  function minsNYC(dtStr) {
    const s = new Date(dtStr).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' });
    const [h, m] = s.split(':').map(Number);
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
  }
  const byDate = {};
  for (const ev of data.items ?? []) {
    if (!ev.start || ev.status === 'cancelled') continue;
    const allDay = !!ev.start.date;
    const rawStart = ev.start.date ?? ev.start.dateTime ?? '';
    const date = rawStart.slice(0, 10);
    if (!date) continue;
    const entry = {
      id: ev.id ?? '',
      summary: ev.summary ?? '(No title)',
      start: ev.start.dateTime ? new Date(ev.start.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '',
      end: ev.end?.dateTime ? new Date(ev.end.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '',
      allDay,
      startMin: ev.start.dateTime ? minsNYC(ev.start.dateTime) : null,
      endMin: ev.end?.dateTime ? minsNYC(ev.end.dateTime) : null,
      description: ev.description || null,
      location: ev.location || null,
      attendees: (ev.attendees ?? []).map(a => a.displayName || a.email || '').filter(Boolean),
    };
    if (allDay && ev.end?.date && ev.end.date > rawStart) {
      const cur = new Date(rawStart + 'T12:00:00Z');
      const endD = new Date(ev.end.date + 'T12:00:00Z');
      while (cur < endD) {
        const d = cur.toISOString().slice(0, 10);
        (byDate[d] = byDate[d] ?? []).push({ ...entry, multiDay: true });
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    } else {
      (byDate[date] = byDate[date] ?? []).push(entry);
    }
  }
  return { byDate };
}

async function refreshGCalEvents(silent = true) {
  const btn = document.getElementById('gcal-btn');
  if (!silent && btn) { btn.textContent = '⟳ Syncing…'; btn.disabled = true; }
  try {
    const data = await fetchGCalEvents();
    if (data?.byDate) {
      gcalByDate = data.byDate;
      renderAll();
      if (selKey) renderPanel(selKey);
    }
  } catch {}
  if (!silent) updateGCalBtn();
}

function updateGCalBtn() {
  const btn = document.getElementById('gcal-btn');
  if (!btn) return;
  btn.disabled = false;
  if (gcalConnected) {
    btn.textContent = `⟳ GCal${gcalEmail ? ': ' + gcalEmail.split('@')[0] : ''}`;
    btn.title = 'Click to refresh · Double-click to import';
    btn.onclick = async () => { await refreshGCalEvents(false); };
    btn.ondblclick = (e) => { e.preventDefault(); showGCalSync(); };
  } else {
    btn.textContent = '+ GCal';
    btn.title = 'Connect Google Calendar';
    btn.onclick = () => {
      if (!tokenClient) { alert('Google Sign-In not ready. Refresh the page.'); return; }
      tokenClient.requestAccessToken({ prompt: 'consent' });
    };
  }
}

async function showGCalSync() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `<div style="background:#12192e;border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:20px;max-width:520px;width:100%;color:#e8eaf0;max-height:80vh;display:flex;flex-direction:column">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <strong style="font-size:14px">🗓 Google Calendar — Fall 2026</strong>
      <button id="gcal-close" style="background:none;border:none;color:rgba(232,234,240,0.5);font-size:20px;cursor:pointer;line-height:1">×</button>
    </div>
    <div id="gcal-body" style="overflow-y:auto;flex:1;font-size:12px">Loading events…</div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button id="gcal-import" style="flex:1;padding:8px;background:#5EBF8A;border:none;border-radius:6px;color:#000;font-weight:600;cursor:pointer;display:none">Import Selected</button>
      <button id="gcal-selectall" style="padding:8px 12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#e8eaf0;cursor:pointer;display:none">Deselect All</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#gcal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const body = overlay.querySelector('#gcal-body');
  const importBtn = overlay.querySelector('#gcal-import');
  const selectAll = overlay.querySelector('#gcal-selectall');

  let gcalData = {};
  try {
    if (!gcalToken) throw new Error('Not connected to Google Calendar');
    const data = await fetchGCalEvents();
    if (!data) throw new Error('Failed to fetch events');
    gcalData = data.byDate || {};
  } catch (e) {
    body.innerHTML = `<div style="color:#E87878">Error: ${e.message}</div>`;
    return;
  }

  const dates = Object.keys(gcalData).sort();
  if (!dates.length) { body.innerHTML = '<div style="color:rgba(232,234,240,0.45);font-style:italic">No events found Sep–Nov 2026.</div>'; return; }

  const existingGcalIds = new Set(Object.values(allEvents).flat().map(p => p.gcalId).filter(Boolean));
  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MO_NAMES = { '09': 'Sep', '10': 'Oct', '11': 'Nov' };

  // Build eventId → dates map for multi-day detection
  const eventDates = {};
  Object.entries(gcalData).forEach(([date, evts]) => {
    evts.forEach(ev => {
      if (!eventDates[ev.id]) eventDates[ev.id] = { dates: [], summary: ev.summary };
      if (!eventDates[ev.id].dates.includes(date)) eventDates[ev.id].dates.push(date);
    });
  });

  let html = '';
  let lastMo = '';
  dates.forEach(date => {
    const [yr, mo, d] = date.split('-');
    const moLabel = { '09': 'September', '10': 'October', '11': 'November' }[mo] || mo;
    if (moLabel !== lastMo) {
      html += `<div style="font-weight:700;color:rgba(232,234,240,0.45);font-size:9.5px;text-transform:uppercase;letter-spacing:.1em;margin:${lastMo?'14px':'0px'} 0 6px">${moLabel}</div>`;
      lastMo = moLabel;
    }
    const dow = DOW[new Date(+yr, +mo - 1, +d).getDay()];
    const existingPlans = allEvents[date] || [];
    const hasPlans = existingPlans.length > 0;
    const borderColor = hasPlans ? 'rgba(94,191,138,0.45)' : 'rgba(255,255,255,0.07)';
    const bgColor = hasPlans ? 'rgba(94,191,138,0.07)' : 'rgba(255,255,255,0.03)';

    html += `<div style="border:1px solid ${borderColor};background:${bgColor};border-radius:8px;padding:8px 10px;margin-bottom:6px">`;
    // Date header
    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <div style="background:rgba(255,255,255,0.08);border-radius:5px;padding:2px 7px;font-size:11px;font-weight:700;color:${hasPlans?'#5EBF8A':'rgba(232,234,240,0.7)'}">${MO_NAMES[mo]} ${+d}</div>
      <div style="font-size:10px;color:rgba(232,234,240,0.4)">${dow}</div>
      ${hasPlans ? `<div style="margin-left:auto;font-size:9.5px;color:#5EBF8A;font-weight:600">● ${existingPlans.length} plan${existingPlans.length>1?'s':''}</div>` : ''}
    </div>`;
    // Existing plans preview
    if (hasPlans) {
      html += `<div style="margin-bottom:6px;padding:4px 6px;background:rgba(94,191,138,0.08);border-radius:4px;border-left:2px solid rgba(94,191,138,0.4)">`;
      existingPlans.forEach(p => {
        html += `<div style="font-size:10px;color:rgba(94,191,138,0.85);line-height:1.6">${p.time ? `<span style="color:rgba(232,234,240,0.35)">${p.time} · </span>` : ''}${p.name}</div>`;
      });
      html += `</div>`;
    }
    // GCal events (skip multi-day duplicates — only show on first/earliest date)
    gcalData[date].forEach(ev => {
      const firstDate = eventDates[ev.id]?.dates[0];
      if (firstDate && firstDate !== date) return; // show only on first day
      const spanDatesForCheck = eventDates[ev.id]?.dates || [date];
      const alreadyImported = spanDatesForCheck.every(d => (allEvents[d]||[]).some(p => p.gcalId === ev.id));
      const spanDates = eventDates[ev.id]?.dates || [];
      const isMultiDay = spanDates.length > 1;
      const timeStr = ev.allDay ? (isMultiDay ? `${spanDates[0].slice(5).replace('-','/')}–${spanDates[spanDates.length-1].slice(5).replace('-','/')}` : 'all day') : (ev.start ? `${ev.start}${ev.end ? '–'+ev.end : ''}` : '');
      html += `<label style="display:flex;align-items:center;gap:8px;padding:3px 0;cursor:${alreadyImported?'default':'pointer'};opacity:${alreadyImported?'0.38':'1'}">
        <input type="checkbox" data-date="${date}" data-id="${ev.id}" data-summary="${ev.summary.replace(/"/g,'&quot;')}" data-time="${ev.allDay?'':ev.start||''}" ${alreadyImported?'checked disabled':'checked'} style="accent-color:#5EBF8A;width:13px;height:13px;flex-shrink:0">
        <span style="font-size:11.5px;color:#e8eaf0;flex:1">${ev.summary}</span>
        ${timeStr ? `<span style="font-size:10px;color:rgba(232,234,240,0.35);flex-shrink:0">${timeStr}</span>` : ''}
        ${alreadyImported ? `<span style="font-size:9px;color:rgba(94,191,138,0.5);flex-shrink:0">imported</span>` : ''}
      </label>`;
    });
    html += `</div>`;
  });
  body.innerHTML = html;
  importBtn.style.display = 'block';
  selectAll.style.display = 'block';

  selectAll.addEventListener('click', () => {
    const boxes = body.querySelectorAll('input[type=checkbox]:not([disabled])');
    const allChecked = [...boxes].every(b => b.checked);
    boxes.forEach(b => b.checked = !allChecked);
    selectAll.textContent = allChecked ? 'Select All' : 'Deselect All';
  });

  importBtn.addEventListener('click', async () => {
    const checked = [...body.querySelectorAll('input[type=checkbox]:checked:not([disabled])')];
    if (!checked.length) return;
    importBtn.disabled = true; importBtn.textContent = 'Importing…';
    const seenIds = new Set();
    for (const cb of checked) {
      const { id, summary, time } = cb.dataset;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      // Import on all dates the event spans (handles multi-day events)
      const allDates = eventDates[id]?.dates || [cb.dataset.date];
      for (const date of allDates) {
        const existing = [...(allEvents[date] || [])];
        if (existing.some(p => p.gcalId === id)) continue;
        const plan = { name: summary, cat: 'other', friend: false, confirmed: true, gcalId: id };
        if (time) plan.time = time;
        existing.push(plan);
        allEvents[date] = existing;
      }
    }
    const stored = LS.get('fc_events', {});
    Object.keys(allEvents).forEach(k => { stored[k] = allEvents[k]; });
    LS.set('fc_events', stored);
    renderAll();
    overlay.remove();
  });
}

// ── Friends Board ─────────────────────────────────────────────
function renderFriendsBoard() {
  const panel = document.getElementById('panel');
  const freq = friendFrequency();
  const debt = friendDebtMap();
  let html = `<div class="panel-head"><div class="panel-date">Friends</div><div class="panel-dow">Hangout frequency · last seen</div></div>`;
  html += `<div class="plans-section">`;
  if (!freq.length) html += `<div style="font-size:10.5px;color:var(--ink-3);font-style:italic">No friend data yet.</div>`;
  else {
    const max = freq[0][1];
    freq.forEach(([name, count]) => {
      const f = friendsList.find(x => x.name === name);
      const pct = Math.round((count / max) * 100);
      const d = f ? debt[f.id] : null;
      let debtBadge = '';
      if (d) {
        const ds = d.daysSince;
        if (ds === null) {
          debtBadge = `<span style="font-size:7.5px;padding:1px 5px;border-radius:20px;background:rgba(255,255,255,0.06);color:var(--ink-3);margin-left:4px">never</span>`;
        } else {
          const label = ds === 0 ? 'today' : ds === 1 ? '1d' : ds < 7 ? `${ds}d` : ds < 14 ? '1w' : ds < 21 ? '2w' : ds < 30 ? '3w' : `${Math.round(ds/7)}w`;
          const col = ds <= 3 ? 'rgba(94,191,138,0.85)' : ds <= 10 ? 'rgba(200,168,75,0.85)' : 'rgba(232,136,74,0.85)';
          debtBadge = `<span style="font-size:7.5px;padding:1px 5px;border-radius:20px;background:${col}22;color:${col};border:1px solid ${col}44;margin-left:4px">${label}</span>`;
        }
      }
      html += `<div class="freq-row"><div class="freq-name" style="display:flex;align-items:center">${name}${debtBadge}</div><div class="freq-bar-wrap"><div class="freq-bar" style="width:${pct}%;background:${f?.color || '#78AADC'}"></div></div><div class="freq-count">${count}</div></div>`;
    });
  }
  // Friend debt section — friends overdue for a hang
  const overdue = friendsList.map(f => ({ f, d: debt[f.id] })).filter(({ d }) => d && d.daysSince !== null && d.daysSince > 7).sort((a, b) => b.d.daysSince - a.d.daysSince);
  if (overdue.length) {
    html += `</div><div class="plans-section"><div class="section-label">Overdue hangs</div>`;
    overdue.forEach(({ f, d }) => {
      const ds = d.daysSince;
      const label = ds < 14 ? '1 week' : ds < 21 ? '2 weeks' : ds < 30 ? '3 weeks' : `${Math.round(ds / 7)} weeks`;
      const urgency = ds > 21 ? 'rgba(232,136,74,0.85)' : 'rgba(200,168,75,0.75)';
      html += `<div class="overdue-pulse" style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:7px">
          <div style="width:8px;height:8px;border-radius:50%;background:${f.color};flex-shrink:0"></div>
          <div style="font-size:11px;font-weight:600;color:var(--ink)">${f.name}</div>
        </div>
        <div style="font-size:8.5px;color:${urgency};font-weight:700">${label} ago</div>
      </div>`;
    });
  }
  html += `</div><div class="plans-section"><div class="section-label">Social graph · co-appearances</div><canvas class="social-canvas" id="social-canvas"></canvas></div>`;
  html += `<div class="add-section"><div class="section-label">Manage Friends</div>`;
  friendsList.forEach((f, i) => {
    html += `<div class="friend-manage-row"><span class="friend-chip active" style="background:${f.color};color:#000;border-color:${f.color}">${f.name}</span><button class="plan-del" data-fi="${i}">×</button></div>`;
  });
  html += `<div class="plan-row2"><input class="add-input-sm" id="new-friend-name" placeholder="Friend's name"><button class="add-btn" id="add-friend-btn" style="flex-shrink:0">+ Add</button></div></div>`;
  panel.innerHTML = html;
  requestAnimationFrame(() => { const c = document.getElementById('social-canvas'); if (c) drawSocialGraph(c); });

  panel.querySelectorAll('.plan-del[data-fi]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fi = parseInt(btn.dataset.fi);
      const f = friendsList[fi];
      friendsList.splice(fi, 1);
      LS.set('fc_friends', friendsList);
      renderFriendsBoard();
    });
  });

  const addFriendBtn = panel.querySelector('#add-friend-btn');
  if (addFriendBtn) addFriendBtn.addEventListener('click', async () => {
    const inp = panel.querySelector('#new-friend-name');
    const name = inp?.value.trim(); if (!name) return;
    const id = `f${Date.now()}`, color = FRIEND_COLORS[friendsList.length % FRIEND_COLORS.length];
    friendsList.push({ id, name, color });
    LS.set('fc_friends', friendsList);
    renderFriendsBoard();
  });
}

// ── Breakdown ─────────────────────────────────────────────────
function getCatGoals() {
  try { return JSON.parse(localStorage.getItem('catGoals2026') || '{}'); } catch { return {}; }
}
function saveCatGoals(g) { try { localStorage.setItem('catGoals2026', JSON.stringify(g)); } catch {} }

function renderBreakdown() {
  const panel = document.getElementById('panel');
  const counts = catBreakdown();
  const goals = getCatGoals();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  let html = `<div class="panel-head"><div class="panel-date">Breakdown</div><div class="panel-dow">Plans by category · tap to set goal</div></div><div class="plans-section">`;
  if (!total) html += `<div style="font-size:10.5px;color:var(--ink-3);font-style:italic">No plans yet.</div>`;
  else {
    CATS.forEach(cat => {
      const n = counts[cat.id] || 0;
      const goal = goals[cat.id] || 0;
      const pct = total ? Math.round((n / total) * 100) : 0;
      const goalPct = goal ? Math.min(Math.round((n / goal) * 100), 100) : 0;
      const met = goal > 0 && n >= goal;
      html += `<div class="freq-row" style="flex-wrap:wrap">
        <div class="freq-name" style="font-size:12px;width:100%;display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
          <span>${cat.label}</span>
          <div style="display:flex;align-items:center;gap:5px">
            ${goal > 0 ? `<span style="font-size:8px;color:${met?'var(--accent)':'var(--ink-3)'};font-weight:700">${n}/${goal}${met?' ✓':''}</span>` : `<span style="font-size:9.5px;font-weight:700;color:var(--ink)">${n}</span>`}
            <button class="goal-set-btn" data-cat="${cat.id}" style="font-size:8px;padding:1px 5px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:var(--ink-3);cursor:pointer">goal</button>
          </div>
        </div>
        <div class="freq-bar-wrap" style="flex:1">
          <div class="freq-bar" style="width:${pct}%;background:${cat.hex}66;position:relative">
            ${goal > 0 ? `<div style="position:absolute;top:0;left:0;height:100%;width:${goalPct}%;background:${cat.hex};border-radius:inherit"></div>` : ''}
          </div>
        </div>
      </div>`;
    });
    html += `<div style="font-size:10px;color:var(--ink-3);margin-top:8px">${total} plans total</div>`;
  }
  html += `</div>`;
  panel.innerHTML = html;
  panel.querySelectorAll('.goal-set-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = getCatGoals();
      const cur = g[btn.dataset.cat] || 0;
      const val = prompt(`Goal for ${btn.dataset.cat} (0 to clear):`, cur);
      if (val === null) return;
      const n = parseInt(val);
      if (isNaN(n) || n <= 0) { delete g[btn.dataset.cat]; } else { g[btn.dataset.cat] = n; }
      saveCatGoals(g);
      renderBreakdown();
    });
  });
}

// ── Export ────────────────────────────────────────────────────
function exportMonth(m) {
  const mo = MONTHS.find(x => x.m === m);
  const canvas = document.createElement('canvas');
  const W = 800, CELL = 90, DOWH = 28, HEADER = 80;
  const firstDay = new Date(Y, m, 1).getDay(), daysInMonth = new Date(Y, m + 1, 0).getDate();
  const rows = Math.ceil((daysInMonth + firstDay) / 7);
  canvas.width = W; canvas.height = HEADER + DOWH + rows * CELL + 20;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#080e1c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e8eaf0'; ctx.font = 'bold 28px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(`${mo?.name || ''} ${Y}`, W / 2, 44);
  const goal = monthGoal(m), done = monthSuccessCount(m);
  if (goal > 0) { ctx.fillStyle = 'rgba(232,234,240,0.4)'; ctx.font = '12px system-ui'; ctx.fillText(`${done}/${goal} success days`, W / 2, 66); }
  const dayW = W / 7;
  DAYS.forEach((d, i) => { ctx.fillStyle = 'rgba(232,234,240,0.35)'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(d, dayW * i + dayW / 2, HEADER + 18); });
  for (let d = 1; d <= daysInMonth; d++) {
    const slot = firstDay + d - 1, col = slot % 7, row = Math.floor(slot / 7);
    const x = col * dayW + 4, y = HEADER + DOWH + row * CELL + 4;
    const key = dayKey(Y, m, d), plans = allEvents[key] || [];
    const hasFriend = plans.some(p => p.friend && isConfirmed(p)), past = isPast(Y, m, d);
    ctx.fillStyle = hasFriend ? 'rgba(94,191,138,0.18)' : (past ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)');
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, dayW - 8, CELL - 8, 8); else ctx.rect(x, y, dayW - 8, CELL - 8); ctx.fill();
    if (hasFriend) { ctx.strokeStyle = 'rgba(94,191,138,0.35)'; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.fillStyle = past ? 'rgba(232,234,240,0.3)' : '#e8eaf0'; ctx.font = '13px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(String(d), x + 8, y + 20);
    plans.slice(0, 4).forEach((p, pi) => {
      const cat = CATS.find(c => c.id === p.cat) || CATS[4];
      ctx.fillStyle = past ? 'rgba(255,255,255,0.15)' : cat.hex;
      ctx.beginPath(); ctx.arc(x + 10 + pi * 10, y + CELL - 18, 3.5, 0, Math.PI * 2); ctx.fill();
    });
  }
  canvas.toBlob(blob => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `fall-${mo?.label || 'month'}-2026.png`; a.click();
  }, 'image/png');
}

// ── Tests ─────────────────────────────────────────────────────
function runTests() {
  const tests = [];
  function t(name, cond, got, exp) { tests.push({ name, pass: !!cond, got: JSON.stringify(got), exp: JSON.stringify(exp) }); }

  t('dayKey Sep 1', dayKey(2026,8,1)==='2026-09-01', dayKey(2026,8,1), '2026-09-01');
  t('dayKey Nov 30', dayKey(2026,10,30)==='2026-11-30', dayKey(2026,10,30), '2026-11-30');
  t('isPast Sep 1', isPast(2026,8,1)===true, true, true);
  t('isPast Nov 30', isPast(2026,10,30)===false, false, false);
  t('isConfirmed default', isConfirmed({name:'x'})===true, true, true);
  t('isConfirmed false', isConfirmed({name:'x',confirmed:false})===false, false, false);
  t('goalKey Sep', goalKey(8)==='2026-09', goalKey(8), '2026-09');

  const saved = JSON.parse(JSON.stringify(allEvents));
  allEvents['2026-09-01'] = [{name:'a',cat:'other',friend:true,confirmed:true}];
  allEvents['2026-09-02'] = [{name:'b',cat:'other',friend:true,confirmed:false}];
  t('monthSuccessCount confirmed only', monthSuccessCount(8)===1, monthSuccessCount(8), 1);
  allEvents['2026-10-01'] = [{name:'c',cat:'other',friend:true,friendName:'Alice'}];
  allEvents['2026-10-02'] = [{name:'d',cat:'upstate',friend:true,friendName:'Alice'}];
  allEvents['2026-10-03'] = [{name:'e',cat:'upstate',friend:true,friendName:'Bob'}];
  const freq = friendFrequency();
  t('friendFrequency top is Alice', freq[0]?.[0]==='Alice'&&freq[0]?.[1]===2, freq[0], ['Alice',2]);
  const bd = catBreakdown();
  t('catBreakdown upstate=2', bd.upstate===2, bd.upstate, 2);
  allEvents = saved;

  const passed = tests.filter(x => x.pass).length;
  let html = `<div style="font-family:monospace;font-size:11px;padding:12px">`;
  html += `<div style="font-weight:700;font-size:13px;margin-bottom:8px;color:${passed===tests.length?'#5EBF8A':'#E8884A'}">${passed}/${tests.length} passed</div>`;
  tests.forEach(tt => { html += `<div style="padding:2px 0;color:${tt.pass?'#5EBF8A':'#E87878'}">${tt.pass?'✓':'✗'} ${tt.name}${!tt.pass?` — got ${tt.got}`:''}</div>`; });
  html += `</div>`;
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `<div style="background:#12192e;border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:20px;max-width:440px;width:100%;color:#e8eaf0;max-height:80vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <strong style="font-size:14px">Test Results</strong>
      <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;color:rgba(232,234,240,0.5);font-size:20px;cursor:pointer">×</button>
    </div>${html}</div>`;
  document.body.appendChild(modal);
}

// ── Insights ──────────────────────────────────────────────────
const INSIGHTS_RECS = [
  {
    icon: '🏐', title: 'Book indoor volleyball for November',
    why: 'Grass VB at Prospect Park + Clinton Cove appeared 10+ times this summer. Cold ends outdoor season — reserve a gym court before spots fill.',
    cat: 'other', suggestDate: '2026-11-07', planName: 'Indoor Volleyball'
  },
  {
    icon: '☕', title: 'Lock in monthly Nicole brunch',
    why: 'Brunch with Nicole is already a genuine recurring pattern. Make it official — first Sunday of each month.',
    cat: 'other', suggestDate: '2026-10-04', planName: 'Brunch with Nicole'
  },
  {
    icon: '🍂', title: 'Catskills or Hudson Valley weekend',
    why: 'Post-Europe trip you had a low-key stretch. A fall weekend trip with Kwan / Sally / Gayoon fits the season and your travel pattern.',
    cat: 'upstate', suggestDate: '2026-10-17', planName: 'Catskills Weekend Trip'
  },
  {
    icon: '🎧', title: "Track Ray's fall DJ set schedule",
    why: "Ray sets appeared 4+ times in your calendar (Slate, Mr. Purple). Add proactively as they're announced — you always go.",
    cat: 'other', suggestDate: null, planName: "Ray DJ Set"
  },
  {
    icon: '🖼', title: '1 museum day per month',
    why: 'You hit Guggenheim, MoMA PS1, and New Museum this summer. Fall brings strong new exhibitions — block one Sunday/month.',
    cat: 'other', suggestDate: '2026-10-11', planName: 'Museum Day'
  },
  {
    icon: '🥧', title: 'Plan Friendsgiving by Oct 15',
    why: 'Your hosting + gathering patterns say you\'d naturally do one. Popular dates fill fast — lock down venue or apartment plan early.',
    cat: 'friendsgiving', suggestDate: '2026-11-21', planName: 'Friendsgiving'
  },
  {
    icon: '🎃', title: 'Halloween: plan 2 weeks out',
    why: 'Halloweekend Oct 30 is already on your calendar but your parties are always packed. Costume + logistics need a 2-week runway.',
    cat: 'halloween', suggestDate: '2026-10-30', planName: 'Halloween Party'
  },
];

function renderInsights() {
  const panel = document.getElementById('panel');

  const freq = friendFrequency();
  let success = 0, total = 0;
  for (let mo = 8; mo <= 10; mo++) {
    const days = new Date(Y, mo + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const key = dayKey(Y, mo, d);
      const p = allEvents[key] || [];
      total += p.length;
      if (isSuccessDay(key)) success++;
    }
  }
  const topFriends = freq.slice(0, 5);
  const streak = calcStreak();

  const HABITS = [
    ['🏐','Volleyball','Prospect Park + Clinton Cove · 10×'],
    ['🎧','Ray DJ sets','Slate, Mr. Purple · 4 nights'],
    ['☕','Nicole brunch','Monthly · already a pattern'],
    ['✈️','Big trips','Lollapalooza + 12-day Europe'],
    ['🎂','Birthdays','3–4/month · you never miss one'],
  ];

  let html = `<div style="display:flex;flex-direction:column;gap:14px;padding-bottom:12px">`;

  // Header
  html += `<div style="border-bottom:1px solid var(--border);padding-bottom:10px">
    <div style="font-size:15px;font-weight:800;color:var(--ink);letter-spacing:-0.02em">✦ Insights</div>
    <div style="font-size:9.5px;color:var(--ink-3);margin-top:2px">Summer analysis · fall recommendations</div>
  </div>`;

  // Golden combo
  html += goldenComboHtml();

  // Free windows
  html += freeWindowsHtml();

  // Radial season ring
  html += `<div class="radial-wrap">${radialRingSVG()}</div>`;

  // Stats 3-up
  html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">
    <div style="background:rgba(94,191,138,0.08);border:1px solid rgba(94,191,138,0.22);border-radius:8px;padding:8px 6px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:var(--accent);line-height:1">${success}</div>
      <div style="font-size:7.5px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.07em;margin-top:3px">Wins</div>
    </div>
    <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;padding:8px 6px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:var(--ink);line-height:1">${total}</div>
      <div style="font-size:7.5px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.07em;margin-top:3px">Plans</div>
    </div>
    <div style="background:${streak>=3?'rgba(255,140,0,0.1)':'rgba(255,255,255,0.04)'};border:1px solid ${streak>=3?'rgba(255,140,0,0.28)':'var(--border)'};border-radius:8px;padding:8px 6px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:${streak>=3?'#FF8C00':'var(--ink)'};line-height:1">${streak}</div>
      <div style="font-size:7.5px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.07em;margin-top:3px">${streak>=3?'🔥 Streak':'Streak'}</div>
    </div>
  </div>`;

  // Plan velocity
  html += velocitySparklineHtml();

  // Top crew
  if (topFriends.length) {
    html += `<div>
      <div class="section-label" style="margin-bottom:7px">Top crew</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">`;
    topFriends.forEach(([name, count]) => {
      const f = friendsList.find(x => x.name === name);
      const col = f?.color || '#78AADC';
      html += `<span style="font-size:10.5px;font-weight:600;padding:3px 9px;border-radius:20px;background:${col}18;border:1px solid ${col}33;color:${col}">${name}<span style="opacity:0.5;font-weight:400"> ·${count}</span></span>`;
    });
    html += `</div></div>`;
  }

  // Summer habits
  html += `<div>
    <div class="section-label" style="margin-bottom:7px">Your summer habits</div>
    <div style="display:flex;flex-direction:column;gap:1px;border-radius:9px;overflow:hidden;border:1px solid var(--border)">`;
  HABITS.forEach(([icon, label, sub], i) => {
    html += `<div style="display:flex;align-items:center;gap:9px;padding:7px 10px;background:rgba(255,255,255,${i%2===0?'0.02':'0.035'})">
      <span style="font-size:15px;width:18px;text-align:center;flex-shrink:0">${icon}</span>
      <div>
        <div style="font-size:10.5px;font-weight:600;color:var(--ink);line-height:1.3">${label}</div>
        <div style="font-size:9px;color:var(--ink-3)">${sub}</div>
      </div>
    </div>`;
  });
  html += `</div></div>`;

  // Activity heatmap
  html += `<div>
    <div class="section-label" style="margin-bottom:7px">Activity heatmap · Sep–Nov</div>
    <div style="display:flex;gap:3px;margin-bottom:4px">
      ${['S','M','T','W','T','F','S'].map(l=>`<div style="flex:1;text-align:center;font-size:7px;color:var(--ink-3)">${l}</div>`).join('')}
    </div>
    <div class="heatmap-grid" id="heatmap-grid">`;
  const hmStart = new Date(Y, 8, 1); // Sep 1
  const hmStartDow = hmStart.getDay();
  for (let i = 0; i < hmStartDow; i++) html += `<div class="hm-cell" style="background:transparent"></div>`;
  for (let mo = 8; mo <= 10; mo++) {
    const days = new Date(Y, mo + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const k = dayKey(Y, mo, d);
      const n = (allEvents[k] || []).length;
      const alpha = n === 0 ? 0.06 : n === 1 ? 0.25 : n === 2 ? 0.5 : 0.85;
      const title = `${MONTHS.find(x=>x.m===mo)?.label} ${d}: ${n} plan${n!==1?'s':''}`;
      html += `<div class="hm-cell" title="${title}" style="background:rgba(94,191,138,${alpha})"></div>`;
    }
  }
  html += `</div></div>`;

  // Recurring patterns
  html += recurringPatternsHtml();

  // Time-of-day heatmap
  html += timesOfDayHtml();

  // Bucket list
  html += bucketListHtml();

  // Weather forecast overview
  html += wxForecastHtml();

  // Smart recs
  html += `<div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
      <div class="section-label" style="margin-bottom:0">Smart recs for fall</div>
      <button id="refresh-recs-btn" style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:20px;border:1px solid rgba(94,191,138,0.35);background:rgba(94,191,138,0.08);color:var(--accent);cursor:pointer">✦ Refresh</button>
    </div>
    <div id="recs-list" style="display:flex;flex-direction:column;gap:5px">`;

  function recHtml(rec) {
    const cat = CATS.find(c => c.id === rec.cat) || CATS[4];
    const done = rec.suggestDate && (allEvents[rec.suggestDate] || []).some(p => p.name === rec.planName);
    return `<div style="border:1px solid ${done?'rgba(94,191,138,0.3)':'var(--border)'};border-radius:9px;padding:9px 11px;background:${done?'rgba(94,191,138,0.04)':'rgba(255,255,255,0.025)'}">
      <div style="display:flex;gap:9px;align-items:flex-start">
        <span style="font-size:17px;flex-shrink:0;line-height:1.15">${rec.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:700;color:${done?'rgba(94,191,138,0.75)':'var(--ink)'};margin-bottom:3px;line-height:1.3">${rec.title}</div>
          <div style="font-size:9.5px;color:var(--ink-3);line-height:1.45;margin-bottom:${done?'0':'7px'}">${rec.why}</div>
          ${done
            ? `<span style="font-size:9px;color:rgba(94,191,138,0.65);font-weight:700">✓ Planned</span>`
            : rec.suggestDate
              ? `<button class="insight-plan-btn" data-date="${rec.suggestDate}" data-name="${rec.planName.replace(/"/g,'&quot;')}" data-cat="${rec.cat}" style="font-size:9.5px;font-weight:700;padding:3px 11px;border-radius:20px;border:1px solid ${cat.hex}44;background:${cat.hex}12;color:${cat.hex};cursor:pointer">+ ${rec.suggestDate.slice(5).replace('-','/')}</button>`
              : `<span style="font-size:9px;color:var(--ink-3);font-style:italic">Add when announced</span>`
          }
        </div>
      </div>
    </div>`;
  }

  INSIGHTS_RECS.forEach(rec => { html += recHtml(rec); });
  html += `</div></div>`;

  html += `</div>`;

  panel.innerHTML = html;
  // Stagger-animate each top-level insights section
  const insightsFlex = panel.querySelector('[style*="flex-direction:column"]');
  if (insightsFlex) {
    [...insightsFlex.children].forEach((el, i) => {
      el.classList.add('insights-section');
      el.style.animationDelay = `${i * 45}ms`;
    });
  }

  panel.querySelectorAll('.free-window-card, .golden-open').forEach(card => {
    card.addEventListener('click', () => selectDay(card.dataset.key));
  });

  panel.querySelectorAll('.bucket-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const label = cb.closest('label');
      if (label) { label.classList.remove('bucket-check-pop'); void label.offsetWidth; label.classList.add('bucket-check-pop'); }
      const items = getBucketList();
      items[parseInt(cb.dataset.i)].checked = cb.checked;
      saveBucketList(items);
      setTimeout(() => renderInsights(), 300);
    });
  });
  panel.querySelectorAll('.bucket-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const items = getBucketList();
      items.splice(parseInt(btn.dataset.i), 1);
      saveBucketList(items);
      renderInsights();
    });
  });
  const bucketAdd = panel.querySelector('#bucket-add');
  const bucketInp = panel.querySelector('#bucket-inp');
  if (bucketAdd && bucketInp) {
    const doAdd = () => {
      const text = bucketInp.value.trim(); if (!text) return;
      const items = getBucketList();
      items.push({ id: `u${Date.now()}`, text, checked: false });
      saveBucketList(items);
      renderInsights();
    };
    bucketAdd.addEventListener('click', doAdd);
    bucketInp.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  }

  panel.querySelectorAll('.insight-plan-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { date, name, cat } = btn.dataset;
      const arr = [...(allEvents[date] || [])];
      arr.push({ name, cat, friend: true, confirmed: false });
      await persistDay(date, arr);
      btn.textContent = '✓ Added';
      btn.style.color = '#5EBF8A';
      btn.style.borderColor = 'rgba(94,191,138,0.4)';
      btn.style.background = 'rgba(94,191,138,0.1)';
      btn.disabled = true;
    });
  });

  // AI-powered recs refresh
  const refreshBtn = panel.querySelector('#refresh-recs-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.textContent = '⟳ Thinking…'; refreshBtn.disabled = true;
      const recsList = panel.querySelector('#recs-list');
      try {
        const planSummary = Object.entries(allEvents).map(([k,ps]) => `${k}: ${ps.map(p=>p.name).join(', ')}`).join('; ');
        const topCats = Object.entries(catBreakdown()).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}(${v})`).join(', ');
        const friends = friendsList.map(f=>f.name).join(', ');
        const data = await fetch('/api/ai/insights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plans: planSummary, friends, topCats }) }).then(r => r.json());
        if (data.recs?.length) {
          recsList.innerHTML = data.recs.map(recHtml).join('');
          recsList.querySelectorAll('.insight-plan-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const { date, name, cat } = btn.dataset;
              const arr = [...(allEvents[date] || [])];
              arr.push({ name, cat, friend: true, confirmed: false });
              await persistDay(date, arr);
              btn.textContent = '✓ Added'; btn.disabled = true;
            });
          });
        } else if (data.error) {
          recsList.innerHTML = `<div style="font-size:9.5px;color:var(--ink-3);font-style:italic;padding:8px 0">${data.error}</div>`;
        } else {
          recsList.innerHTML = `<div style="font-size:9.5px;color:var(--ink-3);font-style:italic;padding:8px 0">No recs generated — try adding more plans first.</div>`;
        }
      } catch (e) {
        const recsList2 = panel.querySelector('#recs-list');
        if (recsList2) recsList2.innerHTML = `<div style="font-size:9.5px;color:rgba(232,136,74,0.7);padding:8px 0">Failed to load recs. Check ANTHROPIC_API_KEY.</div>`;
      }
      refreshBtn.textContent = '✦ Refresh'; refreshBtn.disabled = false;
    });
  }
}

// ── Day Timeline ─────────────────────────────────────────────
function dayTimelineHtml(key) {
  const gcalEvts = gcalByDate[key] || [];
  const timed = gcalEvts.filter(e => !e.allDay && e.startMin != null && e.endMin != null);
  if (!timed.length) return '';
  const [, mStr, dStr] = key.split('-');
  const m = parseInt(mStr) - 1, d = parseInt(dStr);
  const dow = new Date(Y, m, d).getDay();
  const isWknd = dow === 0 || dow === 6;
  const winS = isWknd ? 780 : 960, winE = isWknd ? 1380 : 1260;
  const BASE = 360, SPAN = 1080; // 6am–midnight
  const pct = min => ((min - BASE) / SPAN * 100).toFixed(2) + '%';
  const plen = dur => (dur / SPAN * 100).toFixed(2) + '%';
  const covered = isCoveredDay(key, gcalEvts);
  // compute coverage pct in window
  const ints = timed.map(ev => { const s = Math.max(ev.startMin, winS), e = Math.min(ev.endMin, winE); return s < e ? [s,e] : null; }).filter(Boolean);
  ints.sort((a,b) => a[0]-b[0]);
  let cov = 0, cs, ce;
  if (ints.length) { [cs,ce]=ints[0]; for (let i=1;i<ints.length;i++){const[s,e]=ints[i];if(s<=ce)ce=Math.max(ce,e);else{cov+=ce-cs;cs=s;ce=e;}}cov+=ce-cs; }
  const covPct = Math.round(cov / (winE - winS) * 100);
  const TICKS = [360,480,600,720,840,960,1080,1200,1320,1440];
  const TLABELS = {360:'6a',480:'8a',600:'10a',720:'12p',840:'2p',960:'4p',1080:'6p',1200:'8p',1320:'10p',1440:'12a'};
  return `<div style="margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
      <div style="font-size:7.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(232,234,240,0.3)">Timeline · ${isWknd?'1–11pm':'4–9pm'} window</div>
      <div style="font-size:8.5px;font-weight:700;color:${covered?'var(--accent)':'rgba(232,136,74,0.7)'}">${covPct}%</div>
    </div>
    <div class="day-tl-wrap">
      <div class="day-tl-window" style="left:${pct(winS)};width:${plen(winE-winS)};background:rgba(94,191,138,${covered?'0.1':'0.04'});border-left:1px solid rgba(94,191,138,${covered?'0.3':'0.12'});border-right:1px solid rgba(94,191,138,${covered?'0.3':'0.12'})"></div>
      ${timed.map(ev => {
        const s=Math.max(ev.startMin,BASE),e=Math.min(ev.endMin,BASE+SPAN);
        if(s>=BASE+SPAN||e<=BASE)return'';
        const tagKey=`${ev.id}::${key}`;const tag=tagsData[tagKey]||{cat:'other'};
        const cat=CATS.find(c=>c.id===tag.cat)||CATS[4];
        return `<div class="day-tl-event" title="${ev.summary}" style="left:${pct(s)};width:${Math.max(parseFloat(plen(e-s)),0.5)}%;background:${cat.hex};opacity:0.8"></div>`;
      }).join('')}
      ${TICKS.map(h=>`<div class="day-tl-tick" style="left:${pct(h)}"></div><div class="day-tl-label" style="left:calc(${pct(h)} + 2px)">${TLABELS[h]}</div>`).join('')}
    </div>
  </div>${(() => {
    // Conflict detection
    const sorted = [...timed].sort((a,b) => a.startMin - b.startMin);
    const clashes = [];
    for (let i = 1; i < sorted.length; i++) if (sorted[i].startMin < sorted[i-1].endMin) clashes.push([sorted[i-1].summary, sorted[i].summary]);
    return clashes.length ? `<div style="font-size:8px;color:rgba(232,136,74,0.9);margin-top:3px;padding:3px 6px;background:rgba(232,136,74,0.08);border-radius:5px">⚠ Overlap: ${clashes[0][0]} & ${clashes[0][1]}</div>` : '';
  })()}`;
}

// ── Plan velocity sparkline ───────────────────────────────────
function plansPerWeekData() {
  const seasonStart = new Date(Y, 8, 1), seasonEnd = new Date(Y, 11, 1);
  const ws = new Date(seasonStart);
  ws.setDate(ws.getDate() - ws.getDay()); // roll back to Sunday
  const weeks = [];
  while (ws < seasonEnd) {
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws); d.setDate(d.getDate() + i);
      if (d.getMonth() < 8 || d.getMonth() > 10) continue;
      count += (allEvents[dayKey(d.getFullYear(), d.getMonth(), d.getDate())] || []).length;
    }
    weeks.push({ start: new Date(ws), count });
    ws.setDate(ws.getDate() + 7);
  }
  return weeks;
}

function velocitySparklineHtml() {
  const weeks = plansPerWeekData();
  if (!weeks.length) return '';
  const max = Math.max(...weeks.map(w => w.count), 1);
  const W = 220, H = 44, BAR = Math.max(Math.floor((W - weeks.length) / weeks.length), 2);
  const today = new Date(todayMidnight);
  const past = weeks.filter(w => w.start <= today);
  let trend = '→', trendColor = 'var(--ink-3)';
  if (past.length >= 6) {
    const r = past.slice(-3).reduce((a, w) => a + w.count, 0);
    const p = past.slice(-6, -3).reduce((a, w) => a + w.count, 0);
    if (r > p * 1.2) { trend = '↑ picking up'; trendColor = 'var(--accent)'; }
    else if (r < p * 0.8) { trend = '↓ slowing'; trendColor = 'rgba(232,136,74,0.8)'; }
    else { trend = '→ steady'; }
  }
  const bars = weeks.map((w, i) => {
    const isCur = today >= w.start && today < new Date(w.start.getTime() + 7 * 864e5);
    const isPast = new Date(w.start.getTime() + 7 * 864e5) <= today;
    const barH = w.count === 0 ? 2 : Math.round((w.count / max) * (H - 6)) + 2;
    const x = i * (BAR + 1), y = H - barH;
    const fill = isCur ? '#5EBF8A' : isPast ? '#5EBF8A66' : 'rgba(94,191,138,0.2)';
    return `<rect x="${x}" y="${y}" width="${BAR}" height="${barH}" rx="1" fill="${fill}" style="transform-box:fill-box;transform-origin:50% 100%;animation:bar-grow 0.45s ease-out ${i * 18}ms both"/>`;
  }).join('');
  const moLabels = ['Sep', 'Oct', 'Nov'].map((mo, mi) => {
    const idx = weeks.findIndex(w => w.start.getMonth() === 8 + mi);
    return idx >= 0 ? `<text x="${idx * (BAR + 1)}" y="${H + 10}" font-size="7" fill="rgba(232,234,240,0.3)" font-family="system-ui">${mo}</text>` : '';
  }).join('');
  const total = weeks.reduce((a, w) => a + w.count, 0);
  return `<div>
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:5px">
      <div class="section-label" style="margin-bottom:0">Plan velocity</div>
      <div style="font-size:8.5px;color:${trendColor};font-weight:700">${trend}</div>
    </div>
    <svg width="100%" viewBox="0 0 ${W} ${H + 14}" style="display:block;overflow:visible">${bars}${moLabels}</svg>
    <div style="font-size:8px;color:var(--ink-3);margin-top:1px">${total} plans · ${weeks.filter(w => w.count > 0).length} active weeks · bar = 1 week</div>
  </div>`;
}

// ── Seasonal bucket list ──────────────────────────────────────
const BUCKET_DEFAULTS = [
  '🍎 Apple picking', '🎃 Pumpkin carving', '🌽 Corn maze', '🍂 Fall foliage hike',
  '👻 Halloween party', '🕯 Haunted house', '🥧 Friendsgiving', '☕ Cider donuts',
  '🎬 Cozy movie night', '🦃 Thanksgiving dinner',
];

function getBucketList() {
  try {
    const s = localStorage.getItem('fallBucketList2026');
    return s ? JSON.parse(s) : BUCKET_DEFAULTS.map((text, i) => ({ id: `d${i}`, text, checked: false }));
  } catch { return BUCKET_DEFAULTS.map((text, i) => ({ id: `d${i}`, text, checked: false })); }
}

function saveBucketList(items) {
  try { localStorage.setItem('fallBucketList2026', JSON.stringify(items)); } catch {}
}

function bucketListHtml() {
  const items = getBucketList();
  const done = items.filter(x => x.checked).length;
  const pct = items.length ? Math.round(done / items.length * 100) : 0;
  const rows = items.map((item, i) => `<label style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer">
    <input type="checkbox" class="bucket-check" data-i="${i}" ${item.checked ? 'checked' : ''} style="accent-color:var(--accent);width:12px;height:12px;flex-shrink:0;cursor:pointer">
    <span style="font-size:10.5px;color:${item.checked ? 'var(--ink-3)' : 'var(--ink)'};text-decoration:${item.checked ? 'line-through' : 'none'}">${item.text}</span>
    <button class="bucket-del" data-i="${i}" style="margin-left:auto;font-size:11px;color:var(--ink-3);background:none;border:none;cursor:pointer;padding:0 2px;line-height:1;opacity:0.45">×</button>
  </label>`).join('');
  return `<div>
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:5px">
      <div class="section-label" style="margin-bottom:0">🍂 Fall bucket list</div>
      <div style="font-size:8.5px;color:var(--ink-3)">${done}/${items.length} done</div>
    </div>
    <div style="height:4px;border-radius:2px;background:var(--border);margin-bottom:9px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:2px"></div>
    </div>
    <div id="bucket-list">${rows}</div>
    <div style="display:flex;gap:4px;margin-top:7px">
      <input id="bucket-inp" class="add-input-sm" placeholder="Add item…" style="flex:1">
      <button id="bucket-add" class="add-btn" style="flex-shrink:0">+</button>
    </div>
  </div>`;
}

// ── Golden combo (free + great wx + overdue friend) ───────────
function goldenComboHtml() {
  const debt = friendDebtMap();
  const overdue = friendsList.filter(f => { const d = debt[f.id]; return d && d.daysSince !== null && d.daysSince > 7; }).sort((a, b) => (debt[b.id]?.daysSince || 0) - (debt[a.id]?.daysSince || 0));
  if (!overdue.length) return '';
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const combos = [];
  Object.entries(weatherByDate).forEach(([date, wx]) => {
    const [Y2, m2, d2] = date.split('-').map(Number);
    if (m2 - 1 < 8 || m2 - 1 > 10) return;
    const dow = new Date(Y2, m2 - 1, d2).getDay();
    const isWknd = dow === 0 || dow === 6;
    if (!isWknd) return;
    const key = date;
    if (isCoveredDay(key, gcalByDate[key] || [])) return;
    if ((allEvents[key] || []).length > 0) return;
    let temps = [], maxPrecip = 0;
    for (let h = 13; h < 24; h++) { const he = wx.hourly?.[h]; if (he) { temps.push(he.temp); maxPrecip = Math.max(maxPrecip, he.precip || 0); } }
    const winHi = temps.length ? Math.max(...temps) : null;
    if (maxPrecip > 30 || winHi === null || winHi < 52) return;
    combos.push({ key, date, wx, winHi, maxPrecip });
  });
  if (!combos.length) return '';
  const best = combos[0], friend = overdue[0];
  const [, bm, bd] = best.date.split('-').map(Number);
  const dow = new Date(Y, bm - 1, bd).getDay();
  return `<div style="border:1px solid rgba(94,191,138,0.45);border-radius:11px;padding:11px 13px;background:rgba(94,191,138,0.07)">
    <div style="font-size:7.5px;font-weight:700;color:var(--accent);letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px">✦ Golden window</div>
    <div style="font-size:12.5px;font-weight:700;color:var(--ink);margin-bottom:3px">${best.wx.emoji} ${DAYS[dow]} ${MON[bm-1]} ${bd} — ${best.winHi}° · ${best.maxPrecip}% rain</div>
    <div style="font-size:9.5px;color:var(--ink-3);margin-bottom:9px">You're free · <span style="color:${friend.color}">${friend.name}</span> overdue ${debt[friend.id].daysSince}d</div>
    <div class="golden-open" data-key="${best.key}" style="font-size:9.5px;font-weight:700;padding:4px 14px;border-radius:20px;border:1px solid rgba(94,191,138,0.4);background:rgba(94,191,138,0.12);color:var(--accent);cursor:pointer;display:inline-block">Plan it →</div>
  </div>`;
}

// ── Auto-recurring patterns ───────────────────────────────────
function recurringPatternsHtml() {
  const patterns = {};
  Object.entries(gcalByDate).forEach(([key, evts]) => {
    const [, ms, ds] = key.split('-');
    const dow = new Date(Y, parseInt(ms) - 1, parseInt(ds)).getDay();
    evts.forEach(e => {
      if (!e.summary || e.allDay) return;
      const pk = `${e.summary.slice(0, 30)}::${dow}`;
      if (!patterns[pk]) patterns[pk] = { summary: e.summary, dow, dates: [] };
      patterns[pk].dates.push(key);
    });
  });
  const recurring = Object.values(patterns).filter(p => p.dates.length >= 2).sort((a, b) => b.dates.length - a.dates.length).slice(0, 6);
  if (!recurring.length) return '';
  return `<div>
    <div class="section-label" style="margin-bottom:7px">↻ Recurring patterns</div>
    <div style="display:flex;flex-direction:column;gap:4px">
      ${recurring.map(p => `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:rgba(255,255,255,0.025);border:1px solid var(--border);border-radius:8px">
        <div>
          <div style="font-size:10.5px;font-weight:600;color:var(--ink)">${p.summary}</div>
          <div style="font-size:8.5px;color:var(--ink-3)">${DAYS[p.dow]}s · ${p.dates.length}×</div>
        </div>
        <span style="font-size:9px;color:var(--accent);font-weight:700">${p.dates.length}×</span>
      </div>`).join('')}
    </div>
  </div>`;
}

// ── Free window finder ────────────────────────────────────────
function freeWindowsHtml() {
  const MON_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const windows = [];
  for (let i = 0; i <= 28; i++) {
    const d = new Date(todayMidnight);
    d.setDate(d.getDate() + i);
    const key = dayKey(d.getFullYear(), d.getMonth(), d.getDate());
    // skip if outside our fall window
    if (d.getMonth() < 8 || d.getMonth() > 10) continue;
    const gcalEvts = gcalByDate[key] || [];
    const covered = isCoveredDay(key, gcalEvts);
    if (covered) continue;
    const wx = weatherByDate[key];
    const dow = d.getDay();
    const isWknd = dow === 0 || dow === 6;
    let winTemps = [], winMaxPrecip = 0;
    if (wx?.hourly) {
      const winS = isWknd ? 13 : 16, winE = isWknd ? 24 : 22;
      for (let h = winS; h < winE; h++) {
        const he = wx.hourly[h];
        if (he) { winTemps.push(he.temp); winMaxPrecip = Math.max(winMaxPrecip, he.precip || 0); }
      }
    }
    const winHi = winTemps.length ? Math.max(...winTemps) : null;
    const wxScore = wx ? (100 - winMaxPrecip) + (winHi ? Math.min(winHi, 75) : 0) : 0;
    windows.push({ key, d, wx, isWknd, winHi, winMaxPrecip, wxScore });
  }
  windows.sort((a, b) => {
    if (a.isWknd !== b.isWknd) return a.isWknd ? -1 : 1;
    return b.wxScore - a.wxScore;
  });
  const shown = windows.slice(0, 12);
  if (!shown.length) return `<div><div class="section-label">🗓 Free windows</div><div style="font-size:9.5px;color:var(--ink-3);font-style:italic">No open days in next 28 days.</div></div>`;
  const cards = shown.map(({ key, d, wx, isWknd, winHi, winMaxPrecip }) => {
    const isGreat = winMaxPrecip <= 20 && winHi !== null && winHi >= 52 && winHi <= 82;
    const isRainy = winMaxPrecip > 50;
    const border = isGreat ? 'rgba(94,191,138,0.4)' : isRainy ? 'rgba(120,170,220,0.3)' : 'var(--border)';
    const bg = isGreat ? 'rgba(94,191,138,0.07)' : isRainy ? 'rgba(120,170,220,0.05)' : 'rgba(255,255,255,0.02)';
    return `<div class="free-window-card" data-key="${key}" style="flex-shrink:0;width:64px;border:1px solid ${border};border-radius:10px;padding:8px 5px;background:${bg};text-align:center;cursor:pointer;transition:opacity .15s" onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">
      <div style="font-size:7.5px;font-weight:700;color:${isWknd ? 'var(--accent)' : 'var(--ink-3)'};text-transform:uppercase;letter-spacing:.05em">${DAYS[d.getDay()].slice(0,3)}</div>
      <div style="font-size:7.5px;color:var(--ink-3);margin-bottom:4px">${MON_ABBR[d.getMonth()]} ${d.getDate()}</div>
      ${wx ? `<div style="font-size:18px;line-height:1.2">${wx.emoji}</div><div style="font-size:9px;font-weight:700;color:var(--ink);margin-top:2px">${wx.hi}°/${wx.lo}°</div>` : '<div style="font-size:18px;line-height:1.3">📅</div>'}
      ${winMaxPrecip > 20 ? `<div style="font-size:7px;color:#78AADC;margin-top:2px">💧${winMaxPrecip}%</div>`
        : isGreat ? `<div style="font-size:7px;color:var(--accent);font-weight:700;margin-top:2px">✓ clear</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="free-windows-section">
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:5px">
      <div class="section-label" style="margin-bottom:0">🗓 Free windows</div>
      <div style="font-size:8.5px;color:var(--ink-3)">${windows.length} open · click to plan</div>
    </div>
    <div style="display:flex;gap:5px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin">${cards}</div>
  </div>`;
}

// ── Weather window breakdown (per-day panel) ──────────────────
function wxWindowHtml(key) {
  const wx = weatherByDate[key];
  if (!wx || !wx.hourly || !Object.keys(wx.hourly).length) return '';
  const [, mStr, dStr] = key.split('-');
  const m = parseInt(mStr) - 1, d = parseInt(dStr);
  const dow = new Date(Y, m, d).getDay();
  const isWknd = dow === 0 || dow === 6;
  const winS = isWknd ? 13 : 16, winE = isWknd ? 24 : 22;
  const step = isWknd ? 2 : 1;
  const slots = [];
  for (let h = winS; h < winE; h += step) {
    const entry = wx.hourly[h];
    if (!entry) continue;
    const label = h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;
    slots.push(`<div style="display:flex;flex-direction:column;align-items:center;gap:1px;min-width:30px">
      <div style="font-size:7.5px;color:var(--ink-3)">${label}</div>
      <div style="font-size:13px;line-height:1.2">${entry.emoji}</div>
      <div style="font-size:9px;font-weight:700;color:var(--ink)">${entry.temp}°</div>
      ${entry.precip > 30 ? `<div style="font-size:7px;color:#78AADC">${entry.precip}%</div>` : ''}
    </div>`);
  }
  if (!slots.length) return '';
  return `<div style="margin-top:5px;padding-top:5px;border-top:1px solid var(--border)">
    <div style="font-size:7.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(232,234,240,0.3);margin-bottom:5px">Hourly · ${isWknd ? '1–11pm' : '4–9pm'} window</div>
    <div style="display:flex;gap:4px;overflow-x:auto;padding-bottom:2px">${slots.join('')}</div>
  </div>`;
}

// ── Weather forecast overview (insights panel) ────────────────
function wxForecastHtml() {
  const entries = Object.entries(weatherByDate).sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) return '';
  const MON_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let goodCount = 0;
  const cards = entries.map(([date, wx]) => {
    const [Y2, m2, d2] = date.split('-').map(Number);
    const dow = new Date(Y2, m2 - 1, d2).getDay();
    const isWknd = dow === 0 || dow === 6;
    const winS = isWknd ? 13 : 16, winE = isWknd ? 24 : 22;
    const dayLabel = DAYS[dow].slice(0, 3);
    const dateLabel = `${MON_ABBR[m2 - 1]} ${d2}`;
    let winTemps = [], winMaxPrecip = 0;
    for (let h = winS; h < winE; h++) {
      const he = wx.hourly?.[h];
      if (he) { winTemps.push(he.temp); winMaxPrecip = Math.max(winMaxPrecip, he.precip || 0); }
    }
    const winLo = winTemps.length ? Math.min(...winTemps) : null;
    const winHi = winTemps.length ? Math.max(...winTemps) : null;
    const isGreat = winMaxPrecip <= 20 && winHi !== null && winHi >= 52 && winHi <= 82;
    const isRainy = winMaxPrecip > 50;
    if (isGreat) goodCount++;
    const border = isGreat ? 'rgba(94,191,138,0.4)' : isRainy ? 'rgba(120,170,220,0.35)' : 'var(--border)';
    const bg = isGreat ? 'rgba(94,191,138,0.07)' : isRainy ? 'rgba(120,170,220,0.06)' : 'rgba(255,255,255,0.025)';
    return `<div style="flex-shrink:0;width:68px;border:1px solid ${border};border-radius:10px;padding:8px 5px;background:${bg};text-align:center">
      <div style="font-size:7.5px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em">${dayLabel}</div>
      <div style="font-size:7.5px;color:var(--ink-3);margin-bottom:4px">${dateLabel}</div>
      <div style="font-size:19px;line-height:1.2">${wx.emoji}</div>
      <div style="font-size:9px;font-weight:700;color:var(--ink);margin-top:2px">${wx.hi}°/${wx.lo}°</div>
      ${winLo !== null ? `
        <div style="font-size:7px;color:var(--ink-3);margin-top:3px">${isWknd ? '1–11p' : '4–9p'}</div>
        <div style="font-size:8.5px;font-weight:700;color:${isGreat ? 'var(--accent)' : isRainy ? '#78AADC' : 'var(--ink-3)'}">${winLo}–${winHi}°</div>` : ''}
      ${winMaxPrecip > 20 ? `<div style="font-size:7.5px;color:#78AADC;margin-top:1px">💧${winMaxPrecip}%</div>`
        : isGreat ? `<div style="font-size:7.5px;color:var(--accent);margin-top:2px;font-weight:700">✓</div>` : ''}
    </div>`;
  }).join('');
  return `<div>
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:5px">
      <div class="section-label" style="margin-bottom:0">🌤 Weather forecast</div>
      <div style="font-size:8.5px;color:var(--accent);font-weight:700">${goodCount} great day${goodCount !== 1 ? 's' : ''}</div>
    </div>
    <div style="font-size:8.5px;color:var(--ink-3);margin-bottom:8px">Plans window weather · next ${entries.length} days</div>
    <div style="display:flex;gap:5px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin">${cards}</div>
  </div>`;
}

// ── Week View ─────────────────────────────────────────────────
function renderWeekView() {
  const wrap = document.getElementById('week-wrap');
  if (!wrap) return;
  if (!weekStart) {
    weekStart = new Date(todayMidnight);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  }
  const BASE = 360, END = 1440, SPAN = END - BASE;
  const PX_PER_MIN = 50 / 60;
  const TOTAL_H = SPAN * PX_PER_MIN;
  const days = Array.from({length: 7}, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  const wLabel = days[0].toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' – ' + days[6].toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const DOWS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const HOUR_LABELS = {};
  for (let h = 6; h <= 24; h++) HOUR_LABELS[h*60] = h===24?'12a':h<12?`${h}a`:h===12?'12p':`${h-12}p`;

  const headerCols = `grid-template-columns: 36px repeat(7, 1fr)`;

  const dayHeaders = days.map((d, di) => {
    const k = dayKey(d.getFullYear(), d.getMonth(), d.getDate());
    const isT = d.getTime() === todayMidnight.getTime();
    const suc = isSuccessDay(k);
    const hasEvts = (gcalByDate[k] || []).length > 0;
    return `<div class="week-day-hdr" data-week-day="${k}">
      <div style="font-size:8px;color:var(--ink-3);letter-spacing:0.05em;text-transform:uppercase">${DOWS[d.getDay()]}</div>
      <div style="font-size:15px;font-weight:800;color:${isT?'var(--accent)':'var(--ink)'};line-height:1.2${isT?';text-shadow:0 0 12px rgba(94,191,138,0.5)':''}">${d.getDate()}</div>
      <div style="width:5px;height:5px;border-radius:50%;margin:2px auto 0;background:${suc?'var(--accent)':hasEvts?'rgba(220,185,50,0.7)':'transparent'}"></div>
    </div>`;
  }).join('');

  const cols = days.map((d, di) => {
    const k = dayKey(d.getFullYear(), d.getMonth(), d.getDate());
    const evts = gcalByDate[k] || [];
    const dow = d.getDay();
    const isWknd = dow === 0 || dow === 6;
    const winS = isWknd ? 780 : 960, winE = isWknd ? 1380 : 1260;
    const left = `calc(36px + ${di} * ((100% - 36px) / 7))`;
    const width = `calc((100% - 36px) / 7)`;
    const winTop = (Math.max(winS, BASE) - BASE) * PX_PER_MIN;
    const winH = (winE - winS) * PX_PER_MIN;
    const timedEvts = evts.filter(ev => !ev.allDay && ev.startMin != null);
    const events = timedEvts.map(ev => {
      const s = ev.startMin, e = ev.endMin ?? s + 60;
      if (e <= BASE || s >= END) return '';
      const top = (Math.max(s, BASE) - BASE) * PX_PER_MIN;
      const h = (Math.min(e, END) - Math.max(s, BASE)) * PX_PER_MIN;
      const tagKey = `${ev.id}::${k}`;
      const tag = tagsData[tagKey] || {cat:'other'};
      const cat = CATS.find(c => c.id === tag.cat) || CATS[4];
      return `<div class="week-event" data-key="${k}" data-gcal-id="${ev.id}" style="left:1px;right:1px;top:${top.toFixed(1)}px;height:${Math.max(h,10).toFixed(1)}px;background:${cat.hex}cc;border:1px solid ${cat.hex};">
        <div style="font-size:7.5px;font-weight:700;color:#000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.25">${ev.summary}</div>
        ${h > 24 ? `<div style="font-size:6.5px;color:rgba(0,0,0,0.6)">${ev.start}${ev.end?'–'+ev.end:''}</div>` : ''}
      </div>`;
    }).join('');
    return `<div style="position:absolute;top:0;bottom:0;left:${left};width:${width};border-left:1px solid rgba(255,255,255,0.06)">
      <div style="position:absolute;left:0;right:0;top:${winTop.toFixed(1)}px;height:${winH.toFixed(1)}px;background:rgba(94,191,138,0.04);border-top:1px dashed rgba(94,191,138,0.15);border-bottom:1px dashed rgba(94,191,138,0.15);pointer-events:none"></div>
      ${events}
    </div>`;
  }).join('');

  // Hour lines + labels
  const hourLines = [];
  for (let h = 6; h <= 24; h++) {
    const top = (h * 60 - BASE) * PX_PER_MIN;
    const label = HOUR_LABELS[h*60] || '';
    hourLines.push(`<div style="position:absolute;left:0;right:0;top:${top.toFixed(1)}px;height:1px;background:rgba(255,255,255,0.05)"></div>`);
    hourLines.push(`<div style="position:absolute;left:0;width:36px;top:${top.toFixed(1)}px;font-size:7.5px;color:rgba(232,234,240,0.28);text-align:right;padding-right:5px;transform:translateY(-50%)">${label}</div>`);
  }

  // Today time line
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const todayKey2 = dayKey(now.getFullYear(), now.getMonth(), now.getDate());
  const todayDi = days.findIndex(d => dayKey(d.getFullYear(), d.getMonth(), d.getDate()) === todayKey2);
  const timeLine = todayDi >= 0 && nowMins >= BASE && nowMins < END ? (() => {
    const top = (nowMins - BASE) * PX_PER_MIN;
    const left = `calc(36px + ${todayDi} * ((100% - 36px) / 7))`;
    const width = `calc((100% - 36px) / 7)`;
    return `<div style="position:absolute;left:${left};width:${width};top:${top.toFixed(1)}px;height:2px;background:rgba(255,80,80,0.7);z-index:6;pointer-events:none">
      <div style="position:absolute;left:-3px;top:-3px;width:7px;height:7px;border-radius:50%;background:rgba(255,80,80,0.85)"></div>
    </div>`;
  })() : '';

  wrap.innerHTML = `<div style="display:flex;flex-direction:column;height:100%">
    <div class="week-nav"><button id="week-prev" class="nav-btn">←</button><span class="week-range">${wLabel}</span><button id="week-next" class="nav-btn">→</button></div>
    <div class="week-header-grid" style="${headerCols}"><div></div>${dayHeaders}</div>
    <div class="week-body" id="week-body">
      <div style="position:relative;height:${TOTAL_H}px">
        ${hourLines.join('')}${cols}${timeLine}
      </div>
    </div>
  </div>`;

  requestAnimationFrame(() => {
    const body = document.getElementById('week-body');
    if (body) body.scrollTop = Math.max(0, (8 * 60 - BASE) * PX_PER_MIN - 40);
  });

  wrap.querySelector('#week-prev')?.addEventListener('click', () => { weekStart.setDate(weekStart.getDate()-7); renderWeekView(); });
  wrap.querySelector('#week-next')?.addEventListener('click', () => { weekStart.setDate(weekStart.getDate()+7); renderWeekView(); });
  wrap.querySelectorAll('[data-week-day]').forEach(el => el.addEventListener('click', () => selectDay(el.dataset.weekDay)));
  wrap.querySelectorAll('.week-event').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); selectDay(el.dataset.key); }));
}

// ── Social Graph ──────────────────────────────────────────────
function drawSocialGraph(canvas) {
  const W = canvas.offsetWidth || 230, H = 160;
  canvas.width = W * window.devicePixelRatio; canvas.height = H * window.devicePixelRatio;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  if (!friendsList.length) {
    ctx.fillStyle = 'rgba(232,234,240,0.18)'; ctx.font = '11px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Add friends to see social graph', W/2, H/2); return;
  }
  // Co-occurrence
  const pairCounts = {};
  const nodeCounts = {};
  Object.values(tagsData).forEach(tag => {
    const fr = tag.friends || [];
    fr.forEach(f => { nodeCounts[f] = (nodeCounts[f]||0)+1; });
    for (let i=0;i<fr.length;i++) for (let j=i+1;j<fr.length;j++) {
      const key = [fr[i],fr[j]].sort().join('|||');
      pairCounts[key] = (pairCounts[key]||0)+1;
    }
  });
  const nodes = friendsList.map(f => ({
    id: f.name, color: f.color, freq: nodeCounts[f.name]||0,
    x: W/2 + (Math.random()-0.5)*W*0.6, y: H/2 + (Math.random()-0.5)*H*0.6, vx:0, vy:0
  }));
  const edges = Object.entries(pairCounts).map(([k,w]) => { const [a,b]=k.split('|||'); return {a,b,w}; });
  // Force sim
  for (let iter=0; iter<180; iter++) {
    nodes.forEach(n => { n.fx=0; n.fy=0; });
    for (let i=0;i<nodes.length;i++) for (let j=i+1;j<nodes.length;j++) {
      const dx=nodes[j].x-nodes[i].x, dy=nodes[j].y-nodes[i].y;
      const dist=Math.sqrt(dx*dx+dy*dy)||1;
      const f=700/(dist*dist);
      const fx=f*dx/dist, fy=f*dy/dist;
      nodes[i].fx-=fx; nodes[i].fy-=fy; nodes[j].fx+=fx; nodes[j].fy+=fy;
    }
    edges.forEach(e => {
      const na=nodes.find(n=>n.id===e.a), nb=nodes.find(n=>n.id===e.b); if(!na||!nb) return;
      const dx=nb.x-na.x, dy=nb.y-na.y, dist=Math.sqrt(dx*dx+dy*dy)||1;
      const target=70/Math.sqrt(e.w), f=0.04*(dist-target);
      const fx=f*dx/dist, fy=f*dy/dist;
      na.fx+=fx; na.fy+=fy; nb.fx-=fx; nb.fy-=fy;
    });
    nodes.forEach(n => {
      n.fx+=(W/2-n.x)*0.008; n.fy+=(H/2-n.y)*0.008;
      n.vx=(n.vx+n.fx)*0.82; n.vy=(n.vy+n.fy)*0.82;
      n.x=Math.max(18,Math.min(W-18,n.x+n.vx)); n.y=Math.max(18,Math.min(H-18,n.y+n.vy));
    });
  }
  ctx.clearRect(0,0,W,H);
  // Edges
  edges.forEach(e => {
    const na=nodes.find(n=>n.id===e.a), nb=nodes.find(n=>n.id===e.b); if(!na||!nb) return;
    ctx.beginPath(); ctx.moveTo(na.x,na.y); ctx.lineTo(nb.x,nb.y);
    ctx.strokeStyle=`rgba(255,255,255,${Math.min(0.08+0.06*e.w,0.35)})`; ctx.lineWidth=Math.min(e.w,3); ctx.stroke();
  });
  // Nodes
  nodes.forEach(n => {
    const r = Math.max(7, Math.min(7+n.freq*1.8, 18));
    const grd=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,r*2.2);
    grd.addColorStop(0,n.color+'55'); grd.addColorStop(1,'transparent');
    ctx.beginPath(); ctx.arc(n.x,n.y,r*2.2,0,Math.PI*2); ctx.fillStyle=grd; ctx.fill();
    ctx.beginPath(); ctx.arc(n.x,n.y,r,0,Math.PI*2);
    ctx.fillStyle=n.color+'dd'; ctx.fill();
    ctx.strokeStyle=n.color; ctx.lineWidth=1.5; ctx.stroke();
    if (n.freq>0) { ctx.font=`bold ${Math.round(r*0.8)}px Inter`; ctx.fillStyle='rgba(0,0,0,0.8)'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(n.freq,n.x,n.y); }
    const name = n.id.length>9 ? n.id.slice(0,8)+'…' : n.id;
    ctx.font=`${Math.round(r*0.75)}px Inter`; ctx.fillStyle='rgba(232,234,240,0.7)'; ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillText(name, n.x, n.y+r+3);
  });
}

// ── Radial Season Ring ────────────────────────────────────────
function radialRingSVG() {
  const cx=100, cy=108, R=82, r=52, DAYS=91;
  let paths='', labels='', successTotal=0;
  for (let i=0;i<DAYS;i++) {
    const d=new Date(Y,8,1+i);
    const k=dayKey(d.getFullYear(),d.getMonth(),d.getDate());
    const past=d<todayMidnight, isT=d.getTime()===todayMidnight.getTime();
    const suc=isSuccessDay(k);
    const gcalEvts=gcalByDate[k]||[];
    if (past&&suc) successTotal++;
    let fill;
    if (suc) fill=past?'rgba(94,191,138,0.75)':'rgba(94,191,138,0.9)';
    else if (gcalEvts.length) fill=past?'rgba(220,185,50,0.5)':'rgba(220,185,50,0.7)';
    else fill=past?'rgba(255,255,255,0.07)':'rgba(255,255,255,0.04)';
    const sa=(i/DAYS*360-90)*Math.PI/180, ea=((i+1)/DAYS*360-90)*Math.PI/180;
    const x1=cx+R*Math.cos(sa),y1=cy+R*Math.sin(sa),x2=cx+R*Math.cos(ea),y2=cy+R*Math.sin(ea);
    const x3=cx+r*Math.cos(ea),y3=cy+r*Math.sin(ea),x4=cx+r*Math.cos(sa),y4=cy+r*Math.sin(sa);
    const la=(ea-sa)>Math.PI?1:0;
    const stroke=isT?'rgba(255,255,255,0.9)':'none', sw=isT?'1.5':'0';
    paths+=`<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${la},1 ${x2.toFixed(1)},${y2.toFixed(1)} L${x3.toFixed(1)},${y3.toFixed(1)} A${r},${r} 0 ${la},0 ${x4.toFixed(1)},${y4.toFixed(1)} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"><title>${k}${suc?' ★':''}</title></path>`;
  }
  // Month dividers + labels
  const moStarts=[0,30,61], moMids=[15,45.5,75.5], moNames=['Sep','Oct','Nov'];
  moStarts.forEach(i => {
    const a=(i/DAYS*360-90)*Math.PI/180;
    paths+=`<line x1="${(cx+(r-5)*Math.cos(a)).toFixed(1)}" y1="${(cy+(r-5)*Math.sin(a)).toFixed(1)}" x2="${(cx+(R+5)*Math.cos(a)).toFixed(1)}" y2="${(cy+(R+5)*Math.sin(a)).toFixed(1)}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>`;
  });
  moMids.forEach((mi,i) => {
    const a=(mi/DAYS*360-90)*Math.PI/180, lr=R+13;
    labels+=`<text x="${(cx+lr*Math.cos(a)).toFixed(1)}" y="${(cy+lr*Math.sin(a)).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="rgba(232,234,240,0.5)" font-size="8" font-weight="700" font-family="Inter,system-ui">${moNames[i]}</text>`;
  });
  return `<svg viewBox="0 0 200 220" width="200" height="220">${paths}${labels}
    <text x="${cx}" y="${cy-6}" text-anchor="middle" fill="rgba(232,234,240,0.8)" font-size="22" font-weight="800" font-family="Inter,system-ui">${successTotal}</text>
    <text x="${cx}" y="${cy+12}" text-anchor="middle" fill="rgba(232,234,240,0.35)" font-size="7.5" font-weight="700" font-family="Inter,system-ui" letter-spacing="0.12em">WINS SO FAR</text>
  </svg>`;
}

// ── Time-of-Day Heatmap ───────────────────────────────────────
function timesOfDayHtml() {
  const counts = Array(7).fill(null).map(()=>Array(24).fill(0));
  Object.entries(gcalByDate).forEach(([date,evts]) => {
    const [yr,mo,d]=date.split('-').map(Number);
    const dow=new Date(yr,mo-1,d).getDay();
    evts.forEach(ev => { if(!ev.allDay&&ev.startMin!=null){const h=Math.floor(ev.startMin/60)%24;if(h>=0&&h<24)counts[dow][h]++;} });
  });
  const maxC=Math.max(1,...counts.flat());
  const DOWS=['Su','Mo','Tu','We','Th','Fr','Sa'];
  const hourLabels=Array(24).fill('').map((_,h)=>{
    if(h===0)return'12a'; if(h===6)return'6a'; if(h===12)return'12p'; if(h===18)return'6p'; if(h===23)return''; return'';
  });
  return `<div>
    <div class="section-label" style="margin-bottom:5px">When you're out · hour × weekday</div>
    <div class="tod-grid" style="grid-template-columns:18px repeat(24,1fr)">
      <div></div>${hourLabels.map(l=>`<div style="font-size:6px;color:rgba(232,234,240,0.3);text-align:center;padding-bottom:2px">${l}</div>`).join('')}
      ${DOWS.map((dw,di)=>`<div style="font-size:6.5px;color:rgba(232,234,240,0.35);display:flex;align-items:center;justify-content:flex-end;padding-right:2px">${dw}</div>${counts[di].map(n=>{const a=n===0?0.05:0.12+(n/maxC)*0.72;return`<div style="aspect-ratio:1;border-radius:2px;background:rgba(94,191,138,${a.toFixed(2)})" title="${n}"></div>`;}).join('')}`).join('')}
    </div>
  </div>`;
}

// ── Nav ───────────────────────────────────────────────────────
document.getElementById('nav-prev').addEventListener('click', () => { if (viewStart > 0) { viewStart--; renderCalendar(); } });
document.getElementById('nav-next').addEventListener('click', () => { if (viewStart < 1) { viewStart++; renderCalendar(); } });
document.addEventListener('keydown', e => { if (e.shiftKey && e.altKey && e.key === 'T') runTests(); });

// ── Keyboard navigation ───────────────────────────────────────
function adjDay(delta) {
  if (!selKey) {
    const d = new Date(todayMidnight); selectDay(dayKey(d.getFullYear(), d.getMonth(), d.getDate())); return;
  }
  const [, ms, ds] = selKey.split('-').map(Number);
  const cur = new Date(Y, ms - 1, ds);
  cur.setDate(cur.getDate() + delta);
  if (cur.getMonth() < 8 || cur.getMonth() > 10) return;
  selectDay(dayKey(cur.getFullYear(), cur.getMonth(), cur.getDate()));
}

document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  if (['INPUT','TEXTAREA','SELECT'].includes(tag)) return;
  if (document.getElementById('search-modal')?.style.display !== 'none') return;
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openSearch(); return; }
  if (e.key === 'Escape') { selKey = null; closePanel(); if (activeTab === 'calendar') renderCalendar(); return; }
  if (e.key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); adjDay(1); return; }
  if (e.key === 'k' || e.key === 'ArrowLeft') { e.preventDefault(); adjDay(-1); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); adjDay(7); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); adjDay(-7); return; }
});

// ── Search (Cmd+K) ────────────────────────────────────────────
let searchIdx = -1;
function openSearch() {
  const modal = document.getElementById('search-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  const inner = modal.querySelector('div');
  if (inner) { inner.classList.remove('search-modal-inner'); void inner.offsetWidth; inner.classList.add('search-modal-inner'); }
  const inp = document.getElementById('search-inp');
  if (inp) { inp.value = ''; inp.focus(); renderSearchResults(''); }
}
function closeSearch() {
  const modal = document.getElementById('search-modal');
  if (modal) modal.style.display = 'none';
  searchIdx = -1;
}
function renderSearchResults(q) {
  const container = document.getElementById('search-results');
  if (!container) return;
  const results = [];
  if (q.trim()) {
    const lq = q.toLowerCase();
    Object.entries(allEvents).forEach(([key, plans]) => {
      plans.forEach(p => { if (p.name?.toLowerCase().includes(lq)) results.push({ key, text: p.name, sub: key.slice(5).replace('-','/'), icon: '📌' }); });
    });
    Object.entries(gcalByDate).forEach(([key, evts]) => {
      evts.forEach(e => { if (e.summary?.toLowerCase().includes(lq)) results.push({ key, text: e.summary, sub: key.slice(5).replace('-','/') + ' · GCal', icon: '📅' }); });
    });
    Object.entries(notesData).forEach(([key, note]) => {
      if (note?.toLowerCase().includes(lq)) results.push({ key, text: note.slice(0,60), sub: key.slice(5).replace('-','/') + ' · note', icon: '📝' });
    });
  }
  const shown = results.slice(0, 8);
  searchIdx = -1;
  if (!shown.length) {
    container.innerHTML = `<div style="padding:16px 14px;text-align:center;font-size:10px;color:var(--ink-3)">${q ? 'No results' : 'Start typing to search…'}</div>`;
    return;
  }
  container.innerHTML = shown.map((r, i) => `<div class="search-result" data-key="${r.key}" data-i="${i}">
    <span class="search-result-icon">${r.icon}</span>
    <div><div class="search-result-text">${r.text}</div><div class="search-result-sub">${r.sub}</div></div>
  </div>`).join('');
  container.querySelectorAll('.search-result').forEach(row => {
    row.addEventListener('click', () => { closeSearch(); selectDay(row.dataset.key); });
  });
}
document.getElementById('search-inp')?.addEventListener('input', e => renderSearchResults(e.target.value));
document.getElementById('search-inp')?.addEventListener('keydown', e => {
  const rows = document.querySelectorAll('.search-result');
  if (e.key === 'ArrowDown') { e.preventDefault(); searchIdx = Math.min(searchIdx + 1, rows.length - 1); rows.forEach((r, i) => r.classList.toggle('active', i === searchIdx)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); searchIdx = Math.max(searchIdx - 1, 0); rows.forEach((r, i) => r.classList.toggle('active', i === searchIdx)); }
  else if (e.key === 'Enter') { const active = document.querySelector('.search-result.active') || rows[0]; if (active) { closeSearch(); selectDay(active.dataset.key); } }
  else if (e.key === 'Escape') closeSearch();
});
document.getElementById('search-modal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeSearch(); });

document.getElementById('tab-row').querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    const mw = document.getElementById('months-wrap');
    const monthsNav = document.querySelector('.months-nav');
    const monthsDiv = document.getElementById('months');
    const weekWrap = document.getElementById('week-wrap');
    const isWeek = activeTab === 'week';
    const isCalendar = activeTab === 'calendar';
    if (mw) mw.style.display = (isCalendar || isWeek) ? '' : 'none';
    if (monthsNav) monthsNav.style.display = isWeek ? 'none' : '';
    if (monthsDiv) monthsDiv.style.display = isWeek ? 'none' : '';
    if (weekWrap) weekWrap.style.display = isWeek ? 'flex' : 'none';
    if (activeTab === 'week') { renderWeekView(); if (selKey) { renderPanel(selKey); openPanel(); } else closePanel(); }
    else if (activeTab === 'friends') { renderFriendsBoard(); openPanel(); }
    else if (activeTab === 'breakdown') { renderBreakdown(); openPanel(); }
    else if (activeTab === 'insights') { renderInsights(); openPanel(); }
    else {
      if (selKey) { renderPanel(selKey); openPanel(); }
      else { closePanel(); document.getElementById('panel').innerHTML = '<div class="panel-empty"><div class="panel-empty-icon">🍂</div><div class="panel-empty-text">Pick a day to plan something</div></div>'; }
    }
  });
});

document.querySelectorAll('.export-btn').forEach(btn => {
  btn.addEventListener('click', () => exportMonth(parseInt(btn.dataset.m)));
});

// ── Boot ──────────────────────────────────────────────────────
updateGCalBtn();
initLeaves();
initParallax();
loadAll().catch(err => console.error('Load failed:', err));
