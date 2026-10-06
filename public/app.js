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
let allEvents = {}, goalsData = {}, friendsList = [];
let selKey = null, selCat = 'other', selFriendId = null, isFriend = true, viewStart = 0;
let activeTab = 'calendar', editingPlanIdx = null;
let gcalConnected = false, gcalEmail = null, gcalByDate = {};
let weatherByDate = {};
let lastViewStart = -1;
let calendarRenderedOnce = false;
const suggCache = {};
const now = new Date();
const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

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

// ── API ───────────────────────────────────────────────────────
async function api(path, method = 'GET', body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

async function loadAll() {
  const [evts, frnds, goals] = await Promise.all([
    api('/api/events'),
    api('/api/friends'),
    api('/api/goals'),
  ]);
  allEvents = evts || {};
  Object.keys(allEvents).forEach(k => { allEvents[k] = sortPlans(allEvents[k]); });
  friendsList = frnds || [];
  goalsData = goals || {};
  renderAll();
  // Weather (non-blocking)
  fetch('/api/weather').then(r => r.json()).then(w => {
    if (w.byDate) { weatherByDate = w.byDate; renderAll(); }
  }).catch(() => {});
  // GCal status + live events (non-blocking)
  fetch('/api/gcal/status').then(r => r.json()).then(s => {
    gcalConnected = s.connected || false;
    gcalEmail = s.email || null;
    updateGCalBtn();
    if (gcalConnected && new URLSearchParams(location.search).get('gcal') === 'connected') {
      history.replaceState(null, '', '/');
      showGCalSync();
    }
    if (gcalConnected) refreshGCalEvents();
  }).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────
function dayKey(y, m, d) { return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function isPast(y, m, d) { return new Date(y, m, d) < todayMidnight; }
function isToday(y, m, d) { return new Date(y, m, d).getTime() === todayMidnight.getTime(); }
function isConfirmed(p) { return p.confirmed !== false; }
function goalKey(m) { return `${Y}-${String(m+1).padStart(2,'0')}`; }
function monthGoal(m) { return goalsData[goalKey(m)] || 0; }
function friendName(id) { return (friendsList.find(x => x.id === id) || {}).name || ''; }

function monthSuccessCount(m) {
  const days = new Date(Y, m + 1, 0).getDate();
  let n = 0;
  for (let d = 1; d <= days; d++) {
    if ((allEvents[dayKey(Y,m,d)] || []).some(p => p.friend && isConfirmed(p))) n++;
  }
  return n;
}

function calcStreak() {
  let streak = 0;
  const d = new Date(todayMidnight);
  d.setDate(d.getDate() - 1);
  for (let i = 0; i < 92; i++) {
    const k = dayKey(d.getFullYear(), d.getMonth(), d.getDate());
    if ((allEvents[k] || []).some(p => p.friend && isConfirmed(p))) { streak++; d.setDate(d.getDate() - 1); }
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

function friendFrequency() {
  const counts = {};
  Object.values(allEvents).flat().forEach(p => { if (p.friendName) counts[p.friendName] = (counts[p.friendName] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function catBreakdown() {
  const counts = {}; CATS.forEach(c => { counts[c.id] = 0; });
  Object.values(allEvents).flat().forEach(p => { if (p.cat) counts[p.cat] = (counts[p.cat] || 0) + 1; });
  return counts;
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
  allEvents[key] = sorted;
  await api(`/api/events/${key}`, 'PUT', { plans: sorted });
  renderAll();
  if (sorted.length > 0) {
    const tiles = document.querySelectorAll('.tile.success');
    tiles.forEach(t => {
      if (t.querySelector('.dn')?.textContent === String(parseInt(key.slice(8)))) {
        t.classList.remove('pulse-in'); void t.offsetWidth; t.classList.add('pulse-in');
      }
    });
  }
  if (gcalConnected) syncDayToGCal(key, oldPlans, sorted);
}

async function syncDayToGCal(key, oldPlans, newPlans) {
  // Delete removed app-created events
  for (const op of oldPlans) {
    if (!op.gcalCreated || !op.gcalId) continue;
    if (!newPlans.some(np => np.gcalId === op.gcalId)) {
      try { await api(`/api/gcal/delete/${encodeURIComponent(op.gcalId)}`, 'DELETE'); } catch {}
    }
  }

  // Create new plans / update changed ones
  const current = [...(allEvents[key] || [])];
  let changed = false;
  for (let i = 0; i < current.length; i++) {
    const p = current[i];
    if (!p.gcalId) {
      try {
        const res = await api('/api/gcal/create', 'POST', { date: key, title: p.name, time: p.time });
        if (res.gcalId) { current[i] = { ...p, gcalId: res.gcalId, gcalCreated: true }; changed = true; }
      } catch {}
    } else if (p.gcalCreated) {
      const oldP = oldPlans.find(op => op.gcalId === p.gcalId);
      if (oldP && (oldP.name !== p.name || oldP.time !== p.time)) {
        try { await api(`/api/gcal/update/${encodeURIComponent(p.gcalId)}`, 'PATCH', { title: p.name, date: key, time: p.time }); } catch {}
      }
    }
  }

  if (changed) {
    allEvents[key] = sortPlans(current);
    await api(`/api/events/${key}`, 'PUT', { plans: allEvents[key] });
  }
}

async function persistGoal(m, target) {
  goalsData[goalKey(m)] = target;
  await api(`/api/goals/${goalKey(m)}`, 'PUT', { target });
  renderAll();
}

// ── Stats ─────────────────────────────────────────────────────
function updateStats() {
  let success = 0, total = 0, remain = 0;
  for (let mo = 8; mo <= 10; mo++) {
    const days = new Date(Y, mo + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const plans = allEvents[dayKey(Y, mo, d)] || [];
      total += plans.length;
      if (plans.some(p => p.friend && isConfirmed(p))) success++;
      if (!isPast(Y, mo, d)) remain++;
    }
  }
  countUp(document.getElementById('stat-success'), success);
  countUp(document.getElementById('stat-plans'), total);
  countUp(document.getElementById('stat-remain'), remain);
  const streak = calcStreak();
  const se = document.getElementById('stat-streak');
  if (se) { countUp(se, streak); se.classList.toggle('streak-fire', streak >= 3); }
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
      if (plans.length > 0) tile.classList.add('success');
      if (selKey === key) tile.classList.add('selected');
      const dn = document.createElement('div'); dn.className = 'dn'; dn.textContent = d; tile.appendChild(dn);
      const gcalEvts = gcalByDate[key] || [];
      const importedIds = new Set((allEvents[key] || []).map(p => p.gcalId).filter(Boolean));
      const unimported = gcalEvts.filter(e => !importedIds.has(e.id));
      if (unimported.length > 0 && plans.length === 0) tile.classList.add('gcal-only');
      if (plans.length > 0 || unimported.length > 0) {
        const dots = document.createElement('div'); dots.className = 'dots';
        plans.slice(0, 4).forEach(p => {
          const cat = CATS.find(c => c.id === p.cat) || CATS[4];
          const dot = document.createElement('div'); dot.className = 'dot';
          if (!isConfirmed(p)) dot.classList.add('tentative-dot');
          dot.style.background = past ? 'rgba(255,255,255,0.18)' : cat.hex;
          dots.appendChild(dot);
        });
        unimported.slice(0, 3).forEach(() => {
          const dot = document.createElement('div'); dot.className = 'dot';
          dot.style.background = past ? 'rgba(255,255,255,0.12)' : 'rgba(160,200,255,0.7)';
          dot.style.border = past ? 'none' : '1px solid rgba(160,200,255,0.9)';
          dots.appendChild(dot);
        });
        tile.appendChild(dots);
      }
      // Weather badge (upcoming days only)
      const wx = weatherByDate[key];
      if (wx && !past) {
        const wb = document.createElement('div'); wb.className = 'wx-badge';
        const we = document.createElement('span'); we.className = 'wx-emoji'; we.textContent = wx.emoji;
        const wt = document.createElement('span'); wt.className = 'wx-temp'; wt.textContent = `${wx.hi}°`;
        wb.appendChild(we); wb.appendChild(wt); tile.appendChild(wb);
      }
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
  document.getElementById('nav-prev').disabled = viewStart === 0;
  document.getElementById('nav-next').disabled = viewStart === 1;
  document.getElementById('nav-range').textContent = MONTHS.slice(viewStart, viewStart + 2).map(x => x.label).join(' – ');
  calendarRenderedOnce = true;
}

function renderAll() {
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
  document.querySelector('.tab-btn[data-tab="calendar"]')?.classList.add('active');
  document.getElementById('months-wrap').style.display = '';
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
  const hasFriend = plans.some(p => p.friend && isConfirmed(p));

  const wx = weatherByDate[key];
  const wxStr = wx ? `${wx.emoji} ${wx.hi}°/${wx.lo}° · ${wx.desc}${wx.precip > 30 ? ` · ${wx.precip}% rain` : ''}` : '';
  let html = `<div class="panel-head">
    <div class="panel-date">${mo ? mo.name : ''} ${d}, ${Y}</div>
    <div class="panel-dow">${dayName}${past ? ' · Past' : ''}${hasFriend ? ' · <span style="color:var(--accent)">★ Success</span>' : ''}</div>
    ${wxStr ? `<div style="font-size:10px;color:var(--ink-3);margin-top:4px;display:flex;align-items:center;gap:4px">${wxStr}</div>` : ''}
  </div>
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
  const unimported = gcalEvts.filter(e => !importedIds.has(e.id));
  const imported = gcalEvts.filter(e => importedIds.has(e.id));
  if (gcalEvts.length > 0) {
    html += `<div class="plans-section"><div class="section-label" style="color:rgba(160,200,255,0.6)">From Google Calendar</div>`;
    gcalEvts.forEach(ev => {
      const isImported = importedIds.has(ev.id);
      const timeStr = ev.allDay ? 'all day' : (ev.start ? `${ev.start}${ev.end ? '–'+ev.end : ''}` : '');
      html += `<div class="plan-item" style="opacity:${isImported?'0.45':'1'}">
        <div class="plan-dot" style="background:rgba(160,200,255,${isImported?'0.3':'0.8'});flex-shrink:0"></div>
        <div class="plan-info">
          <div class="plan-name" style="color:${isImported?'var(--ink-3)':'var(--ink)'}">${ev.summary}</div>
          ${timeStr ? `<div class="plan-meta">${timeStr}</div>` : ''}
          ${isImported ? `<div class="plan-meta" style="color:rgba(94,191,138,0.5)">✓ added to plans</div>` : ''}
        </div>
        ${!isImported && !past ? `<button class="gcal-quick-add plan-edit" data-gcal-id="${ev.id}" data-gcal-summary="${ev.summary.replace(/"/g,'&quot;')}" data-gcal-time="${timeStr==='all day'?'':timeStr}" data-key="${key}" title="Add to plans" style="font-size:11px;color:rgba(160,200,255,0.7)">+</button>` : ''}
      </div>`;
    });
    html += `</div>`;
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

  panel.innerHTML = html;
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
      const p = allEvents[dayKey(Y,mo,d)] || [];
      total += p.length;
      if (p.some(x => x.friend && isConfirmed(x))) success++;
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

// ── Google Calendar ───────────────────────────────────────────
async function refreshGCalEvents(silent = true) {
  const btn = document.getElementById('gcal-btn');
  if (!silent && btn) { btn.textContent = '⟳ Syncing…'; btn.disabled = true; }
  try {
    const res = await fetch('/api/gcal/events');
    const data = await res.json();
    if (data.byDate) {
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
    btn.title = 'Click to refresh · Long-press to import';
    btn.onclick = async () => {
      await refreshGCalEvents(false);
    };
    btn.ondblclick = (e) => { e.preventDefault(); showGCalSync(); };
  } else {
    btn.textContent = '+ GCal';
    btn.title = 'Connect Google Calendar';
    btn.onclick = () => { window.location.href = '/auth/login'; };
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
    const res = await fetch('/api/gcal/events');
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (data.error) throw new Error(data.error);
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
        await api(`/api/events/${date}`, 'PUT', { plans: existing });
      }
    }
    renderAll();
    overlay.remove();
  });
}

// ── Friends Board ─────────────────────────────────────────────
function renderFriendsBoard() {
  const panel = document.getElementById('panel');
  const freq = friendFrequency();
  let html = `<div class="panel-head"><div class="panel-date">Friends</div><div class="panel-dow">Hangout frequency this fall</div></div>`;
  html += `<div class="plans-section">`;
  if (!freq.length) html += `<div style="font-size:10.5px;color:var(--ink-3);font-style:italic">No friend data yet.</div>`;
  else {
    const max = freq[0][1];
    freq.forEach(([name, count]) => {
      const f = friendsList.find(x => x.name === name);
      const pct = Math.round((count / max) * 100);
      html += `<div class="freq-row"><div class="freq-name">${name}</div><div class="freq-bar-wrap"><div class="freq-bar" style="width:${pct}%;background:${f?.color || '#78AADC'}"></div></div><div class="freq-count">${count}</div></div>`;
    });
  }
  html += `</div><div class="add-section"><div class="section-label">Manage Friends</div>`;
  friendsList.forEach((f, i) => {
    html += `<div class="friend-manage-row"><span class="friend-chip active" style="background:${f.color};color:#000;border-color:${f.color}">${f.name}</span><button class="plan-del" data-fi="${i}">×</button></div>`;
  });
  html += `<div class="plan-row2"><input class="add-input-sm" id="new-friend-name" placeholder="Friend's name"><button class="add-btn" id="add-friend-btn" style="flex-shrink:0">+ Add</button></div></div>`;
  panel.innerHTML = html;

  panel.querySelectorAll('.plan-del[data-fi]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fi = parseInt(btn.dataset.fi);
      const f = friendsList[fi];
      friendsList.splice(fi, 1);
      await fetch(`/api/friends/${f.id}`, { method: 'DELETE' });
      renderFriendsBoard();
    });
  });

  const addFriendBtn = panel.querySelector('#add-friend-btn');
  if (addFriendBtn) addFriendBtn.addEventListener('click', async () => {
    const inp = panel.querySelector('#new-friend-name');
    const name = inp?.value.trim(); if (!name) return;
    const id = `f${Date.now()}`, color = FRIEND_COLORS[friendsList.length % FRIEND_COLORS.length];
    friendsList.push({ id, name, color });
    await fetch('/api/friends', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name, color }) });
    renderFriendsBoard();
  });
}

// ── Breakdown ─────────────────────────────────────────────────
function renderBreakdown() {
  const panel = document.getElementById('panel');
  const counts = catBreakdown();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  let html = `<div class="panel-head"><div class="panel-date">Breakdown</div><div class="panel-dow">All plans by category</div></div><div class="plans-section">`;
  if (!total) html += `<div style="font-size:10.5px;color:var(--ink-3);font-style:italic">No plans yet.</div>`;
  else {
    CATS.forEach(cat => {
      const n = counts[cat.id] || 0; if (!n) return;
      const pct = Math.round((n / total) * 100);
      html += `<div class="freq-row"><div class="freq-name" style="font-size:12px">${cat.label}</div><div class="freq-bar-wrap"><div class="freq-bar" style="width:${pct}%;background:${cat.hex}"></div></div><div class="freq-count">${n}</div></div>`;
    });
    html += `<div style="font-size:10px;color:var(--ink-3);margin-top:8px">${total} plans total</div>`;
  }
  html += `</div>`;
  panel.innerHTML = html;
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
      const p = allEvents[dayKey(Y,mo,d)] || [];
      total += p.length;
      if (p.some(x => x.friend && isConfirmed(x))) success++;
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
        const data = await api('/api/ai/insights', 'POST', { plans: planSummary, friends, topCats });
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
        }
      } catch {}
      refreshBtn.textContent = '✦ Refresh'; refreshBtn.disabled = false;
    });
  }
}

// ── Nav ───────────────────────────────────────────────────────
document.getElementById('nav-prev').addEventListener('click', () => { if (viewStart > 0) { viewStart--; renderCalendar(); } });
document.getElementById('nav-next').addEventListener('click', () => { if (viewStart < 1) { viewStart++; renderCalendar(); } });
document.addEventListener('keydown', e => { if (e.shiftKey && e.altKey && e.key === 'T') runTests(); });

document.getElementById('tab-row').querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    const mw = document.getElementById('months-wrap');
    if (mw) mw.style.display = activeTab === 'calendar' ? '' : 'none';
    if (activeTab === 'friends') { renderFriendsBoard(); openPanel(); }
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
