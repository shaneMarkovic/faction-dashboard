// ==UserScript==
// @name         Torn War Enforcer
// @namespace    http://tampermonkey.net/
// @version      1.16
// @description  Blocks attacks when faction war caps are reached; hover to see why; admins edit rules in-game.
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      mmoaqgkhfxmbgvirsgxw.supabase.co
// ==/UserScript==
 
(function () {
  'use strict';
 
  if (window.top !== window.self) return;   // run only in the top frame (Torn embeds iframes → was rendering twice)
 
  // Page-level singleton: if another instance already started in this document
  // (PDA can inject the script more than once), this one bails completely —
  // before registering any listeners or tooltips. Fixes duplicate/overlapping popups.
  if (document.getElementById('tw-singleton')) return;
  { const m = document.createElement('meta'); m.id = 'tw-singleton'; (document.head || document.documentElement).appendChild(m); }
 
  // ──────────────── CONFIG ────────────────
  const SUPABASE_URL = 'https://mmoaqgkhfxmbgvirsgxw.supabase.co';
  const ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tb2FxZ2toZnhtYmd2aXJzZ3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NTkzODQsImV4cCI6MjA5NjQzNTM4NH0.axLRQuuDx3uHHR6kK4hZugPPllBz2gawxINOA7yPPJM';
  const POLL_MS = 10000;   // DB read cadence (down from 30s); Realtime pushes on top of this
  const ENFORCE_ACTIVITY_RULE = true;   // rule #4: block online enemies; block idle enemies until idle ≥ target minutes
  // ─────────────────────────────────────────
 
  const REASON_TEXT = {
    faction_target: 'Faction target score reached',
    member_score:   'Your personal score target reached',
    attack_limit:   'Your attack limit reached',
  };
 
  const ATTACK_SELECTOR = 'a[href*="sid=attack"]';
  let BLOCK = false, REASONS = [], MYID = '';
  let MYSCORE = null, MYATK = null;
  let ENEMY_TS_BY_UID = {}, ENEMY_IDS = null, IDLE_TARGET_MIN = 10;   // ENEMY_IDS: opponent roster (null = unknown)
  let LAST_STATE = null;
  let WAR_ACTIVE = false;   // true only while a war is live → enables blocking + activity rule
  let ADMINTOK = '', adminOpen = false;
 
  // ---- persistence ----
  function pstore(k, v) { try { GM_setValue(k, v); } catch (_) { try { localStorage.setItem(k, v); } catch (e) {} } }
  function pload(k) { try { const v = GM_getValue(k, null); if (v != null) return v; } catch (_) {} try { return localStorage.getItem(k); } catch (e) { return null; } }
 
  // ---- backend ----
  function gmReq(method, path, extraHeaders, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url: SUPABASE_URL + path,
        headers: Object.assign({ apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY, Accept: 'application/json' }, extraHeaders || {}),
        data: body, timeout: 10000,
        onload: (r) => resolve({ status: r.status, text: r.responseText }),
        onerror: reject, ontimeout: reject,
      });
    });
  }
  async function gmGet(path) { const r = await gmReq('GET', path); return JSON.parse(r.text); }
 
  function killEvent(e) { e.preventDefault(); e.stopImmediatePropagation(); return false; }
 
  // ---- tooltip ----
  let tip;
  function ensureTip() {
    if (tip) return tip;
    const style = document.createElement('style');
    style.textContent =
      '#tw-tip{position:fixed;z-index:2147483647;display:none;pointer-events:none;background:#1b1b1b;' +
      'border:1px solid #3a3a3a;border-left:3px solid #ff5c5c;border-radius:6px;padding:7px 10px;max-width:min(260px,82vw);' +
      "font:12px/1.45 -apple-system,'Segoe UI',sans-serif;color:#f0f0f0;box-shadow:0 4px 14px rgba(0,0,0,.5)}" +
      '#tw-tip .h{font-weight:700;color:#ff5c5c;margin-bottom:3px}#tw-tip .r{color:#ddd}';
    document.head.appendChild(style);
    tip = document.createElement('div'); tip.id = 'tw-tip'; document.body.appendChild(tip);
    return tip;
  }
  function showTip(reasons, e) {
    if (!reasons.length) return;
    const t = ensureTip();
    t.innerHTML = '<div class="h">Attack disabled</div>' + reasons.map((r) => '<div class="r">⛔ ' + r + '</div>').join('');
    t.style.display = 'block'; moveTip(e);
  }
  function moveTip(e) {
    if (!tip || tip.style.display === 'none') return;
    const pad = 14, r = tip.getBoundingClientRect();
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + r.width > innerWidth) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight) y = e.clientY - r.height - pad;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }
 
  // One delegated handler on the document — keeps working even when Torn
  // swaps out the <a> node (per-element listeners would be lost on re-render).
  document.addEventListener('mousemove', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[data-tw-blocked="1"]');
    if (!a) { hideTip(); return; }
    const reasons = (a.getAttribute('data-tw-reasons') || '').split('\n').filter(Boolean);
    if (!reasons.length) { hideTip(); return; }
    showTip(reasons, e);
  }, true);
 
  // Mobile / touch: no hover, so tapping a blocked attack shows the reason briefly.
  // Runs in capture phase, before the per-link click killer, so it still fires.
  let tipTimer;
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[data-tw-blocked="1"]');
    if (a) {
      const reasons = (a.getAttribute('data-tw-reasons') || '').split('\n').filter(Boolean);
      if (reasons.length) {
        showTip(reasons, e);
        clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 3500);
      }
    } else {
      hideTip();
    }
  }, true);
 
  // ---- enforcement ----
  function setBlocked(el, on, reasons) {
    if (on) {
      const list = reasons || [];
      el.setAttribute('data-tw-reasons', list.join('\n'));   // read by our styled tooltip
      // suppress the game's native tooltip (it's built from title AND aria-label) so ONLY our box shows
      if (el.getAttribute('title')) {
        if (!el.hasAttribute('data-tw-title')) el.setAttribute('data-tw-title', el.getAttribute('title'));
        el.removeAttribute('title');
      }
      if (el.getAttribute('aria-label')) {
        if (!el.hasAttribute('data-tw-aria')) el.setAttribute('data-tw-aria', el.getAttribute('aria-label'));
        el.removeAttribute('aria-label');
      }
      if (el.dataset.twBlocked) return;
      el.dataset.twBlocked = '1';
      // text links: red + strike-through (no border). icon buttons: red outline.
      const isIcon = !(el.textContent && el.textContent.trim());
      el.style.setProperty('color', '#ff5252', 'important');
      el.style.textDecoration = 'line-through';
      el.style.opacity = '0.55';
      el.style.cursor = 'not-allowed';
      el.style.filter = '';
      if (isIcon) {
        el.style.outline = '1px solid #ff5252';
        el.style.outlineOffset = '1px';
        el.style.borderRadius = '3px';
      } else {
        el.style.outline = ''; el.style.outlineOffset = ''; el.style.borderRadius = '';
      }
      el.addEventListener('click', killEvent, true);
      el.addEventListener('mousedown', killEvent, true);
      el.addEventListener('auxclick', killEvent, true);
    } else {
      if (!el.dataset.twBlocked) return;
      delete el.dataset.twBlocked;
      el.removeAttribute('data-tw-reasons');
      if (el.hasAttribute('data-tw-title')) { el.setAttribute('title', el.getAttribute('data-tw-title')); el.removeAttribute('data-tw-title'); }
      if (el.hasAttribute('data-tw-aria')) { el.setAttribute('aria-label', el.getAttribute('data-tw-aria')); el.removeAttribute('data-tw-aria'); }
      el.style.removeProperty('color');
      el.style.textDecoration = ''; el.style.opacity = ''; el.style.outline = '';
      el.style.outlineOffset = ''; el.style.borderRadius = ''; el.style.filter = ''; el.style.cursor = '';
      el.removeEventListener('click', killEvent, true);
      el.removeEventListener('mousedown', killEvent, true);
      el.removeEventListener('auxclick', killEvent, true);
    }
  }
 
  // Status detection keyed by user ID — no DOM-container guessing.
  // Each status div: <div aria-label="Lukas11084 is online" class="userStatusWrap___xxxx">
  // Its row also has a profile link: /profiles.php?XID=22839
  // Each attack link: /page.php?sid=attack&user2ID=22839  -> same ID, so we match by ID.
  let STATUS_BY_UID = {};
 
  function buildStatusMap() {
    STATUS_BY_UID = {};
    document.querySelectorAll('[class*="userStatusWrap" i]').forEach((w) => {
      const al = (w.getAttribute('aria-label') || '').toLowerCase();
      let st = null;
      if (al.indexOf(' is online') !== -1) st = 'online';
      else if (al.indexOf(' is idle') !== -1) st = 'idle';
      else if (al.indexOf(' is offline') !== -1) st = 'offline';
      if (!st) return;
      const box = w.closest('[class*="userInfoBox" i]') || w.parentElement;
      if (!box) return;
      const prof = box.querySelector('a[href*="XID="]');
      const m = prof && (prof.getAttribute('href') || '').match(/XID=(\d+)/i);
      if (m) STATUS_BY_UID[m[1]] = st;
    });
  }
 
  function linkUid(el) {
    const m = (el.getAttribute('href') || '').match(/user2ID=(\d+)/i);
    return m ? m[1] : null;
  }
 
  // Rule #4 — hybrid:
  //   online (live DOM dot) -> always blocked (instant re-lock on return)
  //   idle  -> blocked until idle ≥ IDLE_TARGET_MIN (exact N-min gate)
  //   offline -> attackable
  // On the faction page every attack link is an enemy. ANYWHERE ELSE (profile,
  // attack page, attack log) we only touch links whose target is in the enemy
  // roster, so normal attacks on non-enemies are never blocked.
  function reasonsFor(el) {
    const onFaction = routeActive();
    const id = linkUid(el);
    if (!onFaction) {
      if (!ENEMY_IDS || !id || !ENEMY_IDS.has(id)) return [];   // not a war enemy → leave it alone
    }
    const r = BLOCK ? REASONS.slice() : [];          // global cap reasons (apply to all enemy links)
    if (WAR_ACTIVE && ENFORCE_ACTIVITY_RULE && IDLE_TARGET_MIN > 0) {
      const dot = id ? STATUS_BY_UID[id] : null;     // live status from the page (faction list only)
      const ts  = id ? ENEMY_TS_BY_UID[id] : null;   // backend last-action time
      if (dot === 'online') {
        r.push('Target is online — do not attack');
      } else if (dot === 'idle') {
        if (!ts) r.push('Target is idle — do not attack');
        else { const mins = (Date.now() / 1000 - ts) / 60; if (mins < IDLE_TARGET_MIN) r.push('Target idle ' + Math.floor(mins) + '/' + IDLE_TARGET_MIN + ' min — wait'); }
      } else if (!dot && ts) {
        // no live dot (off the faction page) → judge by last-action timestamp
        const mins = (Date.now() / 1000 - ts) / 60;
        if (mins < IDLE_TARGET_MIN) r.push('Target active ' + Math.floor(mins) + '/' + IDLE_TARGET_MIN + ' min ago — wait');
      }
      // offline / long-idle → attackable
    }
    return r;
  }
  function applyAll(root) {
    if (disabled) return;                 // panel-owner check only; enforce on every page
    buildStatusMap();                     // no-op off the faction list (no status dots there)
    (root && root.querySelectorAll ? root.querySelectorAll(ATTACK_SELECTOR) : []).forEach((el) => {
      const r = reasonsFor(el);
      setBlocked(el, r.length > 0, r);
    });
  }
 
  // ---- panel ----
  let panel, statusEl, idEl, adminEl, headerEl, headTitleEl, bodyEl, minBtn, refreshBtn;
  let minimized = false;
  let disabled = false;   // set if another instance already mounted the panel in this page
  const INP = 'background:#0f0f0f;color:#f0f0f0;border:1px solid #3a3a3a;border-radius:5px;padding:3px 6px';
  const BTN = 'background:#22c48a;color:#0f0f0f;border:0;border-radius:5px;padding:3px 9px;cursor:pointer;font-weight:600';
  // Where the panel parks when minimized (adjust to taste). Expanding restores the last dragged spot.
  const MIN_DOCK = { right: '10px', bottom: '64px' };
  const VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) ? GM_info.script.version : '';
 
  // Title: "War Enforcer" (bold, colored) + small muted version tag.
  function setHeadTitle(icon, color) {
    if (!headTitleEl) return;
    headTitleEl.innerHTML =
      '<span style="font-weight:700;color:' + color + '">' + (icon || '') + 'War Enforcer</span>' +
      (VERSION ? ' <span style="font-size:9px;font-weight:400;color:#777">v' + VERSION + '</span>' : '');
  }
 
  function mkCtrlBtn(txt, title) {
    const b = document.createElement('button');
    b.textContent = txt; b.title = title; b.type = 'button';
    b.style.cssText = 'background:#222;color:#ddd;border:1px solid #3a3a3a;border-radius:6px;' +
      'width:28px;height:28px;line-height:1;text-align:center;cursor:pointer;font-size:16px;' +
      'padding:0;margin-left:5px;user-select:none;touch-action:manipulation';
    return b;
  }
  function spin(btn) {
    btn.style.transition = 'transform .5s'; btn.style.transform = 'rotate(360deg)';
    setTimeout(() => { btn.style.transition = ''; btn.style.transform = ''; }, 520);
  }
  // Minimized → always dock to MIN_DOCK. Expanded → last dragged spot (tw_pos) or default corner.
  function applyPanelPosition() {
    if (!panel) return;
    if (minimized) {
      panel.style.left = 'auto'; panel.style.top = 'auto';
      panel.style.right = MIN_DOCK.right; panel.style.bottom = MIN_DOCK.bottom;
      return;
    }
    let p = null;
    try { p = JSON.parse(pload('tw_pos') || 'null'); } catch (_) {}
    if (p && p.left && p.top) {
      panel.style.left = p.left; panel.style.top = p.top; panel.style.right = 'auto'; panel.style.bottom = 'auto';
    } else {
      panel.style.left = 'auto'; panel.style.top = 'auto'; panel.style.right = '12px'; panel.style.bottom = '12px';
    }
  }
  function setMinimized(on) {
    minimized = on;
    if (bodyEl) bodyEl.style.display = on ? 'none' : 'block';
    if (minBtn) { minBtn.textContent = on ? '+' : '–'; minBtn.title = on ? 'Expand' : 'Minimize'; }
    pstore('tw_min', on ? '1' : '0');
    applyPanelPosition();
  }
 
  function ensurePanel() {
    if (panel) return panel;
    if (disabled) return null;
    // Singleton across instances: if any instance already put the panel in the
    // page, this one stands down (PDA can inject the script more than once).
    if (document.getElementById('tw-enforcer')) { disabled = true; return null; }
    panel = document.createElement('div');
    panel.id = 'tw-enforcer';
    panel.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:12px', 'z-index:99999', 'cursor:move',
      "font:12px/1.45 -apple-system,'Segoe UI',sans-serif",
      'background:#181818', 'color:#f0f0f0', 'border:1px solid #2a2a2a',
      'border-radius:10px', 'padding:9px 12px', 'min-width:200px',
      'box-shadow:0 4px 16px rgba(0,0,0,.45)', 'user-select:none',
    ].join(';');
    // header: drag handle (title) on the left, control buttons on the right
    headerEl = document.createElement('div');
    headerEl.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:move';
    headTitleEl = document.createElement('div');
    headTitleEl.style.cssText = 'white-space:nowrap;font-size:13px';
    setHeadTitle('', '#22c48a');
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;flex:0 0 auto';
    refreshBtn = mkCtrlBtn('⟳', 'Refresh');
    minBtn = mkCtrlBtn('–', 'Minimize');
    controls.appendChild(refreshBtn); controls.appendChild(minBtn);
    // buttons must not start a panel drag, and must respond to touch
    controls.addEventListener('mousedown', (e) => e.stopPropagation());
    controls.addEventListener('pointerdown', (e) => e.stopPropagation());
    controls.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    headerEl.appendChild(headTitleEl); headerEl.appendChild(controls);
 
    // body: everything that collapses when minimized
    statusEl = document.createElement('div');
    statusEl.style.cssText = 'margin-top:7px';
    idEl = document.createElement('div');
    idEl.style.cssText = 'margin-top:7px;padding-top:7px;border-top:1px solid #2a2a2a';
    adminEl = document.createElement('div');
    adminEl.style.cssText = 'margin-top:7px;padding-top:7px;border-top:1px solid #2a2a2a';
    idEl.addEventListener('mousedown', (e) => e.stopPropagation());
    adminEl.addEventListener('mousedown', (e) => e.stopPropagation());
    bodyEl = document.createElement('div');
    bodyEl.appendChild(statusEl); bodyEl.appendChild(idEl); bodyEl.appendChild(adminEl);
 
    panel.appendChild(headerEl); panel.appendChild(bodyEl);
    document.body.appendChild(panel);
 
    refreshBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); spin(refreshBtn); poll(); };
    minBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); setMinimized(!minimized); };
 
    // ---- positioning ----
    applyPanelPosition();
 
    // Drag via Pointer Events (mouse + touch). The WHOLE panel is the handle,
    // except interactive controls (inputs/buttons/links) so they still work.
    let drag = null;
    const DRAG_IGNORE = 'input,textarea,select,button,a,label';
    panel.style.touchAction = 'none';      // own the gesture so the page doesn't scroll mid-drag
    panel.addEventListener('pointerdown', (e) => {
      if (minimized) return;               // docked when minimized — not draggable
      if (e.target.closest && e.target.closest(DRAG_IGNORE)) return;  // let controls work
      drag = { id: e.pointerId, dx: e.clientX - panel.offsetLeft, dy: e.clientY - panel.offsetTop };
      try { panel.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    panel.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const x = Math.max(0, Math.min(e.clientX - drag.dx, innerWidth - panel.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - drag.dy, innerHeight - panel.offsetHeight));
      panel.style.left = x + 'px'; panel.style.top = y + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
    });
    const endDrag = () => {
      if (!drag) return;
      try { panel.releasePointerCapture(drag.id); } catch (_) {}
      drag = null;
      pstore('tw_pos', JSON.stringify({ left: panel.style.left, top: panel.style.top }));
    };
    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);
 
    minimized = pload('tw_min') === '1';
    setMinimized(minimized);
    renderId(); renderAdmin();
    return panel;
  }
 
  function renderId() {
    ensurePanel();
    if (disabled) return;
    if (MYID) {
      idEl.innerHTML = '<span style="color:#777">Your ID: ' + MYID + (ADMINTOK ? ' · <span style="color:#5ba4f5">(admin)</span>' : '') + '</span> ' +
        '<a href="#" id="tw-id-edit" style="color:#5ba4f5;text-decoration:none">change</a>';
      idEl.querySelector('#tw-id-edit').onclick = (e) => { e.preventDefault(); MYID = ''; pstore('tw_myid', ''); renderId(); poll(); };
    } else {
      idEl.innerHTML =
        '<div style="color:#f0a832;margin-bottom:4px">⚠ Set your Torn ID for personal limits</div>' +
        '<input id="tw-id-in" placeholder="Your Torn ID" inputmode="numeric" style="width:96px;' + INP + '"> ' +
        '<button id="tw-id-save" style="' + BTN + '">Save</button>';
      const inp = idEl.querySelector('#tw-id-in');
      const save = () => { const v = (inp.value || '').replace(/\D/g, ''); if (v) { MYID = v; pstore('tw_myid', v); renderId(); poll(); } };
      idEl.querySelector('#tw-id-save').onclick = save;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    }
  }
 
  function ruleRow(label, id, val) {
    return '<label style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
      '<span style="color:#999">' + label + '</span>' +
      '<input id="' + id + '" type="number" min="0" value="' + (val == null ? '' : val) + '" title="0 = no limit" style="width:84px;' + INP + '"></label>';
  }
 
  function renderAdmin() {
    ensurePanel();
    if (disabled) return;
    let html = '<a href="#" id="tw-admin-toggle" style="color:#5ba4f5;text-decoration:none">⚙ admin' + (adminOpen ? ' ▾' : ' ▸') + '</a>';
    if (adminOpen) {
      if (!ADMINTOK) {
        html += '<div style="margin-top:6px">' +
          '<input id="tw-admin-tok" type="password" placeholder="admin token" style="width:120px;' + INP + '"> ' +
          '<button id="tw-admin-unlock" style="' + BTN + '">Unlock</button>' +
          '<div id="tw-admin-msg" style="color:#777;margin-top:4px"></div></div>';
      } else {
        const s = LAST_STATE || {};
        html += '<div style="margin-top:6px;display:grid;gap:5px">' +
          ruleRow('Total score', 'tw-r-total', s.total_score_target) +
          ruleRow('Personal score', 'tw-r-perm', s.per_member_score_target) +
          ruleRow('Max hits', 'tw-r-hits', s.max_attacks_per_member) +
          ruleRow('Idle ≥ (min)', 'tw-r-idle', s.idle_minutes_target) +
          '<div style="margin-top:2px"><button id="tw-admin-save" style="' + BTN + '">Save rules</button> ' +
          '<a href="#" id="tw-admin-lock" style="color:#777;text-decoration:none;margin-left:6px">lock</a></div>' +
          '<div id="tw-admin-msg" style="color:#777"></div></div>';
      }
    }
    adminEl.innerHTML = html;
 
    adminEl.querySelector('#tw-admin-toggle').onclick = (e) => { e.preventDefault(); adminOpen = !adminOpen; renderAdmin(); };
    if (adminOpen && !ADMINTOK) {
      adminEl.querySelector('#tw-admin-unlock').onclick = () => {
        const v = (adminEl.querySelector('#tw-admin-tok').value || '').trim();
        if (v) { ADMINTOK = v; pstore('tw_admin_token', v); renderAdmin(); renderId(); }
      };
    }
    if (adminOpen && ADMINTOK) {
      adminEl.querySelector('#tw-admin-lock').onclick = (e) => { e.preventDefault(); ADMINTOK = ''; pstore('tw_admin_token', ''); renderAdmin(); renderId(); };
      adminEl.querySelector('#tw-admin-save').onclick = saveRules;
    }
  }
 
  function saveRules() {
    const msg = adminEl.querySelector('#tw-admin-msg');
    const total = parseInt(adminEl.querySelector('#tw-r-total').value, 10);
    const perm  = parseInt(adminEl.querySelector('#tw-r-perm').value, 10);
    const hits  = parseInt(adminEl.querySelector('#tw-r-hits').value, 10);
    const idle  = parseInt(adminEl.querySelector('#tw-r-idle').value, 10);
    if (![total, perm, hits, idle].every((n) => Number.isInteger(n) && n >= 0)) { msg.textContent = 'enter 0 or a positive number'; msg.style.color = '#ff5c5c'; return; }
    msg.textContent = 'saving…'; msg.style.color = '#777';
    gmReq('POST', '/functions/v1/set-rules', { 'Content-Type': 'application/json', 'x-admin-token': ADMINTOK },
      JSON.stringify({ total_score_target: total, per_member_score_target: perm, max_attacks_per_member: hits, idle_minutes_target: idle }))
      .then((r) => {
        let j = {}; try { j = JSON.parse(r.text); } catch (e) {}
        if (r.status === 200 && j.ok) { msg.textContent = 'saved ✓ (applies within ~1 min)'; msg.style.color = '#22c48a'; setTimeout(poll, 1500); }
        else if (r.status === 401) { msg.textContent = 'wrong admin token'; msg.style.color = '#ff5c5c'; }
        else { msg.textContent = j.error || ('failed (' + r.status + ')'); msg.style.color = '#ff5c5c'; }
      })
      .catch(() => { msg.textContent = 'network error'; msg.style.color = '#ff5c5c'; });
  }
 
  const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  function countdown(startTs) {
    const s = Math.max(0, Number(startTs || 0) - Math.floor(Date.now() / 1000));
    if (s <= 0) return 'now';
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
    if (h > 0) return h + 'h ' + m + 'm ' + sec + 's';
    if (m > 0) return m + 'm ' + sec + 's';
    return sec + 's';
  }
 
  function renderStatus(state, err) {
    if (!routeActive()) return;   // panel lives on the faction tab only
    ensurePanel();
    if (disabled) return;
    if (err) {
      setHeadTitle('⚠ ', '#f0a832');
      statusEl.innerHTML = 'backend unreachable<br><span style="color:#777">ATTACKS ALLOWED</span>'; return;
    }
    if (!state || (!state.active && !state.enlisted)) {
      setHeadTitle('✅ ', '#22c48a');
      statusEl.innerHTML = 'no active war<br><span style="color:#777">ATTACKS ALLOWED</span>'; return;
    }
    if (!state.active && state.enlisted) {
      setHeadTitle('⏳ ', '#f0a832');
      const opp = state.opponent_name ? '<br><span style="color:#bbb">vs ' + esc(state.opponent_name) + '</span>' : '';
      statusEl.innerHTML =
        '<span style="color:#f0a832">⏳ WAR ENLISTED</span>' + opp +
        '<br><span style="color:#bbb">Starts in ' + countdown(state.start_ts) + '</span>' +
        '<br><span style="color:#777">ATTACKS ALLOWED — war not started</span>';
      return;
    }
    const okC = '#22c48a', hitC = '#ff5c5c';
    const color = BLOCK ? hitC : okC;
    const head = BLOCK ? '⛔ ATTACKS BLOCKED' : '✅ ATTACKS ALLOWED';
    setHeadTitle(BLOCK ? '⛔ ' : '✅ ', color);
 
    // a rule row is green while under its limit, red once the limit is hit.
    // a target of 0 means "no limit" → always green, shown as ∞.
    const row = (label, val, target) => {
      const t = Number(target) || 0;
      const cap = t > 0 ? t : '∞';
      const hit = t > 0 && val != null && Number(val) >= t;
      const v = (val == null) ? '–' : val;
      return '<br><span style="color:' + (hit ? hitC : okC) + '">' + label + ': ' + v + ' / ' + cap + '</span>';
    };
 
    let body = row('Agreed score', state.our_score ?? 0, state.total_score_target);
    if (MYID) {
      body += row('My score', MYSCORE, state.per_member_score_target);
      body += row('My hits', MYATK, state.max_attacks_per_member);
    }
    const idleN = Number(state.idle_minutes_target ?? IDLE_TARGET_MIN ?? 0);
    if (ENFORCE_ACTIVITY_RULE) {
      body += idleN > 0
        ? '<br><span style="color:#777">Allowed idle attack ≥ ' + idleN + ' min</span>'
        : '<br><span style="color:#777">No activity restriction</span>';
    }
    statusEl.innerHTML = '<span style="color:' + color + '">' + head + '</span>' + body;
  }
 
  // ---- realtime (best-effort) ----
  // Pushes a poll() the instant war-poll writes the DB. Torn's CSP may block the
  // WebSocket (GM_xmlhttpRequest can't proxy ws) — if so this silently fails and
  // the POLL_MS interval still carries updates. Never throws into the page.
  function startRealtime() {
    const WSS = SUPABASE_URL.replace(/^https/, 'wss') + '/realtime/v1/websocket?apikey=' + ANON_KEY + '&vsn=1.0.0';
    let hb = null, backoff = 2000, rtTimer = null;
    const ping = () => { if (rtTimer) return; rtTimer = setTimeout(() => { rtTimer = null; if (routeActive()) poll(); }, 300); };
    function connect() {
      let sock;
      try { sock = new WebSocket(WSS); } catch (_) { return; }   // CSP can throw synchronously
      sock.onopen = () => {
        backoff = 2000;
        try {
          sock.send(JSON.stringify({
            topic: 'realtime:tw', event: 'phx_join', ref: '1', join_ref: '1',
            payload: { config: { postgres_changes: [
              { event: '*', schema: 'public', table: 'war_state' },
              { event: '*', schema: 'public', table: 'member_progress' }
            ] } }
          }));
          sock.send(JSON.stringify({ topic: 'realtime:tw', event: 'access_token', ref: '2', payload: { access_token: ANON_KEY } }));
        } catch (_) {}
        clearInterval(hb);
        hb = setInterval(() => { try { if (sock.readyState === 1) sock.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', ref: String(Date.now()), payload: {} })); } catch (_) {} }, 25000);
      };
      sock.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (_) { return; } if (m && m.event === 'postgres_changes') ping(); };
      sock.onerror = () => { try { sock.close(); } catch (_) {} };
      sock.onclose = () => { clearInterval(hb); setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 60000); };
    }
    connect();
  }
 
  // ---- poll ----
  async function poll() {
    if (disabled) return;
    try {
      const rows = await gmGet('/rest/v1/war_state?id=eq.1&select=active,enlisted,start_ts,opponent_name,faction_blocked,our_score,total_score_target,per_member_score_target,max_attacks_per_member,idle_minutes_target,war_id');
      const st = Array.isArray(rows) ? rows[0] : null;
      LAST_STATE = st;
      WAR_ACTIVE = !!(st && st.active);
 
      MYSCORE = null; MYATK = null;
      ENEMY_TS_BY_UID = {};
      ENEMY_IDS = null;
      IDLE_TARGET_MIN = Number(st && st.idle_minutes_target) || 10;
      const codes = new Set();
      if (st && st.active) {
        if (st.faction_blocked) codes.add('faction_target');
        if (MYID) {
          try {
            const mp = await gmGet('/rest/v1/member_progress?select=blocked,reasons,score,attacks&war_id=eq.' + st.war_id + '&member_id=eq.' + MYID);
            const me = Array.isArray(mp) ? mp[0] : null;
            if (me) { MYSCORE = Number(me.score || 0); MYATK = Number(me.attacks || 0); if (me.blocked && Array.isArray(me.reasons)) me.reasons.forEach((c) => codes.add(c)); }
          } catch (_) {}
        }
        // enemy roster — drives both the enemy-ID gate (every page) and the idle rule
        try {
          const es = await gmGet('/rest/v1/enemy_status?select=member_id,last_action_ts&war_id=eq.' + st.war_id);
          if (Array.isArray(es)) {
            ENEMY_IDS = new Set();
            es.forEach((row) => {
              ENEMY_IDS.add(String(row.member_id));
              if (row.last_action_ts) ENEMY_TS_BY_UID[String(row.member_id)] = Number(row.last_action_ts);
            });
          }
        } catch (_) {}
      }
      const order = ['faction_target', 'member_score', 'attack_limit'];
      REASONS = order.filter((c) => codes.has(c)).map((c) => REASON_TEXT[c]);
      BLOCK = REASONS.length > 0;
      if (!BLOCK) hideTip();
      applyAll(document);
      if (routeActive()) renderStatus(st, null);   // panel only on the faction tab
    } catch (e) {
      WAR_ACTIVE = false; BLOCK = false; REASONS = []; ENEMY_IDS = null; hideTip(); applyAll(document);
      if (routeActive()) renderStatus(null, e);
    }
  }
 
  // ---- observe AJAX content ----
  let applyTimer = null;
  const obs = new MutationObserver(() => {
    if (applyTimer) return;
    applyTimer = setTimeout(() => { applyTimer = null; applyAll(document); }, 200);
  });
  obs.observe(document.body, { childList: true, subtree: true });
 
  // ---- go ----
  MYID = (pload('tw_myid') || '').replace(/\D/g, '');
  ADMINTOK = pload('tw_admin_token') || '';
 
  function routeActive() { return /\/factions\.php/.test(location.pathname); }
 
  let lastHref = location.href;
  function route() {
    if (routeActive()) {
      ensurePanel();
      if (disabled || !panel) return;
      panel.style.display = '';
      poll();
    } else if (panel) {
      panel.style.display = 'none';
      hideTip();
    }
  }
  route();
  poll();                                  // enforce on first load of ANY page (profile, attack, log…)
  try { startRealtime(); } catch (_) {}   // best-effort instant updates; poll is the fallback
 
  // In-app / SPA navigation changes the URL without a reload — watch for it.
  setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; route(); poll(); } }, 1000);
  // Tick the enlisted countdown every second (cheap re-render of the status line).
  setInterval(() => {
    if (!disabled && panel && routeActive() && LAST_STATE && !LAST_STATE.active && LAST_STATE.enlisted) renderStatus(LAST_STATE, null);
  }, 1000);
  // Periodic refresh — everywhere, so blocking stays fresh off the faction tab too.
  setInterval(poll, POLL_MS);
  window.addEventListener('focus', poll);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();