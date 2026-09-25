// ---- Edit these three settings ----
const TERMS_VERSION = '2026-09-24'; // change this date whenever you edit the terms; it is sent with every order
const MIN_DEPOSIT_PCT = 20; // minimum deposit as a percent of the total
const MIN_TOTAL = { TND: 10, USD: 5, EUR: 5 }; // minimum order total, per currency
const DISCORD = 'https://discord.gg/PAwYBcmQAX';
const EMAIL = 'boussenmostafa@gmail.com'; // single source of truth: page links sync to this on load, PDF + fallback email use it too
const BUSINESS_ADDRESS = ''; // set a full street address here to show it in the footer (some consumer-protection rules expect one); leave empty to hide
const PRICES = { 'Website': 0, 'Discord bot': 0, 'Minecraft plugin or mod': 0, 'Something else': 0 }; // starting prices in TND. 0 hides the price.
const EXTRA_TERMS = [ // added after term 8, shown to the client and included in the PDF and the order email
  { title: 'Deposit and start', text: 'The deposit is at least 20% of the total price and is due before work starts. Work starts when Stoufa confirms in writing that the deposit has been received.' },
  { title: 'Cancellation after work starts', text: 'If the client cancels after the 15-minute change window and within 3 days of work starting, Stoufa keeps 10% of the total price from the deposit and refunds the rest of the deposit. If the client cancels later than that, the deposit is not refunded, and Stoufa may charge for the share of the work already completed beyond the deposit.' },
  { title: 'Inactivity', text: 'If the client does not reply to Stoufa for 14 days, Stoufa may close the order, and the cancellation term above applies.' },
  { title: 'Not included', text: 'Anything not described in this order is not included. This covers domains, hosting, paid third-party services or licenses, and new features. They are billed separately once agreed.' },
  { title: 'Rights to the work', text: 'The client gets the right to use the finished work once the final payment is received. Until then, all rights stay with Stoufa.' },
  { title: 'Currency and international clients', text: "The price is set in the currency chosen in this order (TND, USD, or EUR). Bank and conversion fees, and any exchange-rate difference between currencies, are the client's own cost, not Stoufa's." },
  { title: 'Custom work, starting now', text: "This is custom work built to this order, not a stock product. By paying the deposit, the client asks Stoufa to start right away and, to that extent, gives up any cooling-off or withdrawal period that might otherwise apply, beyond the 15-minute change window in term 8." },
  { title: 'Late payment', text: 'If the balance is not paid within 14 days of the first draft being ready, Stoufa may pause the project and add a late fee of 2% of the balance per further week until it is paid.' }
];
const QUESTIONS = { // 2 short optional questions per service, sent with the order
  'Website': ['Pages or sections you need', 'Do you already have a logo, colors and text?'],
  'Discord bot': ['Main commands or features', 'About how many members does your server have?'],
  'Minecraft plugin or mod': ['Server software and version (e.g. Paper 1.21)', 'Other plugins this must work with'],
  'Something else': []
};
const WORK = [];        // your projects: { title: 'HUBS', tag: 'Minecraft plugin', text: 'What it does.', img: 'images/hubs.png', link: 'https://...' }
const TESTIMONIALS = []; // client quotes: { quote: 'He delivered fast.', name: 'Client name', detail: 'Website, 2026' } — the section stays hidden until you add one
// -----------------------------------

const $ = id => document.getElementById(id);
// Fail-soft listener: a missing element (stale cached page, partial deploy) must
// never kill the whole script — that feature just stays dormant.
const on = (id, ev, fn) => { try { const el = $(id); if (el) el.addEventListener(ev, fn); } catch (e) {} };
const form = $('f'), err = $('err'), btn = $('btn'), prog = $('prog');
const next = $('next'), back = $('back');
const steps = [...document.querySelectorAll('.step')];
const marks = [...document.querySelectorAll('#stepper li')];
const KEY = 'stoufa-draft';
const TEXT_IDS = ['d', 'd2', 'rf', 'tp', 'dp', 'dl', 'cn', 'bn', 'ct', 'ct2', 'dc'];
const PH = {
  'Website': 'e.g. A 5-page site for my gym with a class schedule and contact form',
  'Discord bot': 'e.g. An economy bot with daily rewards, a shop, and moderation commands',
  'Minecraft plugin or mod': 'e.g. Teleport hubs with a GUI menu for my Paper server',
  'Something else': 'Tell me what you have in mind'
};
let cur = 0, snapshot = null;
const t0 = Date.now(); // page load: humans need minutes to fill an order, bots need milliseconds

const rnd = n => {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', a = new Uint8Array(n);
  (window.crypto && crypto.getRandomValues) ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256);
  return [...a].map(x => c[x % c.length]).join('');
};
const newNo = () => '#' + rnd(4) + '-' + rnd(4);
const today = () => new Date().toLocaleDateString('en-CA'); // local date as YYYY-MM-DD
const TZ = (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || '';
const localTime = ms => new Date(ms).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
let orderNo = newNo(), token = rnd(10); // token proves later updates or cancellations come from the same client
$('tid').textContent = orderNo;
$('dl').min = today();

const radio = n => (form.querySelector('input[name=' + n + ']:checked') || {}).value || '';
const svc = () => radio('svc'), pay = () => radio('pay'), curCode = () => radio('cur') || 'TND';
const svc2 = () => radio('svc2'), has2 = () => $('add2').checked; // second project (max 2 per order)
const svcLabel = () => !has2() || !svc2() ? (svc() || '') : (svc() === svc2() ? '2× ' + svc() : svc() + ' + ' + svc2());
const extras = () => [...form.querySelectorAll('input[name=extra]:checked')].map(x => x.value);
const money = (v, c) => (isNaN(parseFloat(v)) ? 0 : parseFloat(v)).toFixed(2) + ' ' + (c || curCode());
// Loyal clients: the direct phone contact unlocks after 3 successful orders
const COUNTKEY = 'stoufa-count';
const getCount = () => { try { return parseInt(localStorage.getItem(COUNTKEY) || '0', 10) || 0; } catch (e) { return 0; } };
function updatePhone() {
  const pill = $('phonepill');
  if (pill) pill.hidden = getCount() <= 2;
}
if (BUSINESS_ADDRESS) { const a = $('addr'); a.textContent = BUSINESS_ADDRESS; a.hidden = false; }

function setT(id, val) {
  const el = $(id);
  if (el.textContent === val) return;
  el.textContent = val;
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
function updateTicket() {
  const d = $('d').value.trim(), bn = $('bn').value.trim(), sg = $('sg').value.trim();
  const t = parseFloat($('tp').value) || 0, p = parseFloat($('dp').value) || 0, c = curCode();
  $('d').placeholder = PH[svc()] || 'Describe the features you need';
  $('d2').placeholder = PH[svc2()] || 'Describe the features you need';
  $('svc2wrap').hidden = !has2(); $('proj2wrap').hidden = !has2();
  setT('t-svc', svcLabel() || 'Not chosen');
  const proBase = bn || (d ? (d.length > 42 ? d.slice(0, 42) + '…' : d) : 'Not described');
  setT('t-pro', has2() ? proBase + ' (+1 more)' : proBase);
  setT('t-cli', $('cn').value.trim() || 'Not entered');
  setT('t-mail', $('ct').value.trim() || 'Not entered');
  const dlRaw = $('dl').value;
  let dlShown = 'Flexible';
  if (dlRaw) {
    const dt = new Date(dlRaw + 'T12:00:00');
    dlShown = isNaN(dt) ? dlRaw : dt.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
  setT('t-due', dlShown);
  setT('t-pay', pay() || 'Not chosen');
  setT('t-tot', money($('tp').value, c));
  setT('t-dep', money($('dp').value, c));
  setT('t-bal', Math.max(t - p, 0).toFixed(2) + ' ' + c);
  $('tpCur').textContent = c; $('dpCur').textContent = c;
  $('tpLbl').textContent = 'Total price (minimum ' + MIN_TOTAL[c] + ' ' + c + ')';
  $('tp').min = MIN_TOTAL[c];
  $('t-sig').textContent = sg || 'Unsigned';
  document.querySelector('.t-sig').classList.toggle('on', !!sg);
  if (svc() !== lastSvc) renderQs();
  if (svc2() !== lastSvc2) renderQs2();
  // class fallback for browsers without :has()
  form.querySelectorAll('.opt, .chip').forEach(l => { const i = l.querySelector('input'); if (i) l.classList.toggle('sel', i.checked); });
}

// Draft autosave, so a client who closes the tab doesn't lose their answers
let pendingQ = [], lastSvc = '', pendingQ2 = [], lastSvc2 = '';
const draftObj = () => { const o = { svc: svc(), svc2: svc2(), add2: has2(), pay: pay(), cur: curCode(), ex: extras() }; TEXT_IDS.forEach(i => o[i] = $(i).value); o.q = [...$('qs').querySelectorAll('input')].map(i => i.value); o.q2 = [...$('qs2').querySelectorAll('input')].map(i => i.value); return o; };
function save() { try { localStorage.setItem(KEY, JSON.stringify(draftObj())); } catch (e) {} }
function pick(n, v) {
  const r = [...form.querySelectorAll('input[name=' + n + ']')].find(x => x.value === v);
  if (r) r.checked = true;
}
function applyDraft(o) {
  pendingQ = o.q || []; pendingQ2 = o.q2 || [];
  TEXT_IDS.forEach(i => { if (o[i]) $(i).value = o[i]; });
  pick('svc', o.svc); pick('svc2', o.svc2); if (o.add2) $('add2').checked = true;
  pick('pay', o.pay); if (o.cur) pick('cur', o.cur);
  (o.ex || []).forEach(v => { const c = form.querySelector('input[name=extra][value="' + v + '"]'); if (c) c.checked = true; });
}
// Service-specific questions: rebuilt only when the chosen service changes
function renderQs() {
  const box = $('qs'), list = QUESTIONS[svc()] || [];
  const old = svc() === lastSvc ? [...box.querySelectorAll('input')].map(i => i.value) : [];
  lastSvc = svc();
  box.innerHTML = list.map((q, i) => '<div class="field"><label for="q' + i + '">' + esc(q) + ' (optional)</label><input type="text" id="q' + i + '" maxlength="200"></div>').join('');
  [...box.querySelectorAll('input')].forEach((el, i) => { el.value = old[i] || pendingQ[i] || ''; });
  pendingQ = [];
}
function renderQs2() {
  const box = $('qs2'), list = QUESTIONS[svc2()] || [];
  const old = svc2() === lastSvc2 ? [...box.querySelectorAll('input')].map(i => i.value) : [];
  lastSvc2 = svc2();
  box.innerHTML = list.map((q, i) => '<div class="field"><label for="r' + i + '">' + esc(q) + ' (optional)</label><input type="text" id="r' + i + '" maxlength="200"></div>').join('');
  [...box.querySelectorAll('input')].forEach((el, i) => { el.value = old[i] || pendingQ2[i] || ''; });
  pendingQ2 = [];
}
function restore() { try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (o) applyDraft(o); } catch (e) {} }

form.addEventListener('input', () => { updateTicket(); save(); });
form.addEventListener('change', () => { updateTicket(); save(); });

// Quick deposit: fills the deposit as a % of the total
document.querySelectorAll('.quick .chip').forEach(b => b.addEventListener('click', () => {
  const t = parseFloat($('tp').value);
  if (!t) { err.textContent = 'Enter the total price first.'; return; }
  err.textContent = '';
  $('dp').value = (t * b.dataset.p / 100).toFixed(2);
  updateTicket(); save();
}));

function go(n, first) {
  cur = n;
  steps.forEach((s, i) => s.classList.toggle('on', i === cur));
  marks.forEach((m, i) => m.classList.toggle('on', i <= cur));
  back.hidden = cur === 0;
  next.hidden = cur === steps.length - 1;
  btn.hidden = cur !== steps.length - 1;
  err.textContent = '';
  prog.style.width = (cur / steps.length * 100 + 6) + '%';
  if (first) return;
  const f = steps[cur].querySelector('input:not([type=radio]):not([type=checkbox]),textarea');
  if (f) setTimeout(() => f.focus({ preventScroll: true }), 60);
  $('order').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function check() {
  const v = id => $(id).value.trim();
  if (cur === 0 && !svc()) return 'Pick what you need to continue.';
  if (cur === 0 && has2() && !svc2()) return 'Pick the second project’s service, or untick the second project.';
  if (cur === 1) {
    if (!v('d')) return 'Describe what you want built.';
    if (has2() && !$('d2').value.trim()) return 'Describe the second project.';
    if ($('tp').value === '' || $('dp').value === '') return 'Enter the total price and the deposit.';
    const minTot = MIN_TOTAL[curCode()] || 10;
    if (parseFloat($('tp').value) < minTot) return 'The minimum order is ' + minTot + ' ' + curCode() + '.';
    const minDep = parseFloat($('tp').value) * MIN_DEPOSIT_PCT / 100;
    if (parseFloat($('dp').value) + 1e-9 < minDep) return 'The deposit must be at least ' + MIN_DEPOSIT_PCT + '% of the total (' + minDep.toFixed(2) + ' ' + curCode() + ').';
    if (parseFloat($('dp').value) > parseFloat($('tp').value)) return "The deposit can't be higher than the total price.";
    if (!pay()) return 'Choose how you want to pay (or “To be discussed”).';
  }
  if (cur === 2) {
    if (!v('cn')) return 'Enter your name.';
    if (!v('bn')) return 'Enter your business or project name.';
    if (!/^\S+@\S+\.\S+$/.test(v('ct'))) return 'Enter a valid email address so I can reply to you.';
    if (v('ct2').toLowerCase() !== v('ct').toLowerCase()) return 'Both email fields must match — retype it carefully.';
  }
  if (cur === 3) {
    if (FIREBASE_CONFIG && fbReady && !getUser()) return 'Sign in (top right, or below) to submit your order.';
    if (FIREBASE_CONFIG && getUser() && !getUser().verified) return 'Verify your email first — check your inbox, or resend it from your account.';
    if (!v('sg') || !$('ag').checked || !$('pc').checked) return 'Type your name as a signature and tick both boxes to continue.';
    const norm = s => s.trim().replace(/\s+/g, ' ').toLowerCase();
    if (norm(v('sg')) !== norm(v('cn'))) return 'Signature must match the full name you entered in “Who are you?”.';
  }
  return '';
}

next.addEventListener('click', () => {
  if (FIREBASE_CONFIG && fbReady && !getUser() && cur === 0) {
    err.textContent = 'Create an account or sign in to continue — it takes a minute.';
    openAuth();
    return;
  }
  const m = check();
  if (m) { err.textContent = m; return; }
  go(cur + 1);
});
back.addEventListener('click', () => go(cur - 1));
form.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && cur < steps.length - 1) { e.preventDefault(); next.click(); }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const gc = $('gc').value;
  const cn = $('cn').value.trim();
  if (gc) { // honeypot tripped: pretend success, send nothing, but keep a plausible local copy
    const fake = { 'Verification code': token, 'Signature': $('sg').value.trim(), 'Currency': curCode(), 'Signed on': today(), 'Client name': cn };
    finish(cn, Date.now() + WIN, fake); return;
  }

  const m = check();
  if (m) { err.textContent = m; return; }

  if (state && state.status !== 'pending') { renderDone(); return; }
  const editing = !!state;
  const endsAt = editing ? state.endsAt : Date.now() + WIN;
  if (!editing && Date.now() - t0 < 3000) { // time-trap: instant fills are bots — fake success, send nothing
    finish(cn, endsAt, { 'Verification code': token, 'Signature': $('sg').value.trim(), 'Currency': curCode(), 'Signed on': today(), 'Client name': cn });
    return;
  }

  btn.disabled = true;
  btn.classList.add('loading');
  btn.querySelector('.btxt').textContent = 'Submitting…';
  setTimeout(() => { if (btn.disabled) btn.querySelector('.btxt').textContent = 'Still sending…'; }, 5000);

  const ct = $('ct').value.trim();
  const payload = {
    "Order number": orderNo,
    "Signed on": today(),
    "Service": svcLabel() || svc(),
    "Second service": has2() ? svc2() : '',
    "Client name": cn,
    "Business or project name": $('bn').value.trim(),
    "Project description": $('d').value.trim() + (has2() ? '\n\nSecond project (' + svc2() + '): ' + $('d2').value.trim() : ''),
    "Extras": extras().join(', ') || 'None',
    "Reference links": $('rf').value.trim(),
    "Currency": curCode(),
    "Total price": $('tp').value,
    "Deposit": $('dp').value,
    "Needed by": $('dl').value || 'Flexible',
    "Payment method": pay() || 'Not chosen',
    "Email": ct,
    "Discord": $('dc').value.trim(),
    "Signature": $('sg').value.trim(),
    "_gotcha": gc,
    "_subject": "New project agreement " + orderNo + " signed by " + cn
  };
  if (/^\S+@\S+\.\S+$/.test(ct)) { payload._replyto = ct; payload.email = ct; } // 'email' is the field name Formspree treats as the sender's address // lets you reply straight to the client
  payload.Status = editing ? 'UPDATED (inside the 15-minute window)' : 'PENDING (final 15 minutes after signing unless cancelled)';
  const tk = editing ? state.token : token;
  payload['Verification code'] = tk;
  payload['Signed at (UTC)'] = editing ? (state.payload['Signed at (UTC)'] || new Date().toISOString()) : new Date().toISOString();
  if (editing) payload['Updated at (UTC)'] = new Date().toISOString();
  payload['Final at (UTC)'] = new Date(endsAt).toISOString();
  payload['Change window ends'] = localTime(endsAt);
  payload['Client timezone'] = TZ;
  payload['Wait until (Tunis time)'] = new Date(endsAt).toLocaleString('en-GB', { timeZone: 'Africa/Tunis', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  payload['Terms version'] = TERMS_VERSION;
  payload['Agreed terms'] = termsData().map(t => t[0] + '. ' + t[1] + ': ' + t[2]).join('\n'); // permanent record of exactly what the client agreed to
  payload['Consent to sign electronically'] = 'Yes';
  payload['Data consent'] = 'Yes';
  payload['Device'] = (navigator.userAgent || '').slice(0, 160);
  payload['Service details'] = [...$('qs').querySelectorAll('.field')].map(f => { const v = f.querySelector('input').value.trim(); return v ? f.querySelector('label').textContent.replace(' (optional)', '') + ': ' + v : ''; }).filter(Boolean).join('\n');
  if (has2()) {
    const d2 = [...$('qs2').querySelectorAll('.field')].map(f => { const v = f.querySelector('input').value.trim(); return v ? f.querySelector('label').textContent.replace(' (optional)', '') + ': ' + v : ''; }).filter(Boolean).join('\n');
    if (d2) payload['Service details'] += (payload['Service details'] ? '\n' : '') + 'Second project:\n' + d2;
    payload['Second service details'] = d2;
  }
  payload['Balance'] = Math.max((parseFloat(payload['Total price']) || 0) - (parseFloat(payload['Deposit']) || 0), 0).toFixed(2) + ' ' + payload['Currency'];
  payload._subject = (editing ? '[UPDATED] Order ' : '[PENDING 15 min] Order ') + orderNo + ' signed by ' + cn;
  snapshot = payload;

  try {
    const r = await postJSON(payload);
    if (r.ok) {
      if (!editing) { try { localStorage.setItem(COUNTKEY, String(getCount() + 1)); } catch (e) {} } // edits don't count, only new orders
      finish(cn, endsAt, payload);
      addOrder(); renderAccount();
      updatePhone(); // the 3rd successful order reveals the phone pill
    } else {
      let d = '';
      try { const j = await r.json(); d = (j.errors || []).map(e => e.message).filter(Boolean).join(' '); } catch (x) {} // Formspree's own error text
      fail(false, d);
    }
  } catch (e) {
    fail(e && e.name === 'AbortError');
  }
});

// ---- 15-minute window: change or cancel, then the order is final ----
const WIN = 15 * 60 * 1000, FS = 'https://formspree.io/f/xppwrbye', OKEY = 'stoufa-order', SEND_TIMEOUT = 15000;
// Every send gives up after 15 s so the button never stays stuck. A retry reuses the same order number, so a duplicate is easy to spot.
async function postJSON(body) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), SEND_TIMEOUT);
  try {
    return await fetch(FS, { method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: c.signal });
  } finally { clearTimeout(t); }
}
let state = null; // { no, endsAt, status: 'pending' | 'cancelled' | 'final', name, sig, draft, payload }
const persist = () => { try { state ? localStorage.setItem(OKEY, JSON.stringify(state)) : localStorage.removeItem(OKEY); } catch (e) {} };
const mmss = ms => { const t = Math.max(Math.ceil(ms / 1000), 0); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };

function finish(name, endsAt, payload) {
  try { localStorage.removeItem(KEY); } catch (e) {}
  state = { no: orderNo, token: payload['Verification code'] || token, endsAt, status: 'pending', name, sig: $('sg').value.trim(), draft: draftObj(), payload };
  snapshot = payload;
  persist();
  renderDone();
}
function renderDone() {
  const s = state, p = s.status === 'pending', c = s.status === 'cancelled';
  form.hidden = true; $('stepper').hidden = true; $('editnote').hidden = true; $('done').hidden = false;
  $('ticket').classList.add('signed'); $('ticket').classList.toggle('cancelled', c);
  document.querySelector('.t-stamp').textContent = c ? 'Cancelled' : 'Signed';
  $('dh').textContent = c ? 'Order cancelled.' : p ? 'Order signed.' : 'Order final.';
  $('dp2').textContent = c ? 'Order ' + s.no + ' is cancelled. Nothing more is needed from you.'
    : p ? 'Thanks, ' + (s.name.split(' ')[0] || '') + '. Order ' + s.no + ' is recorded. You have 15 minutes to change or cancel it here. After that it is final.'
    : 'Order ' + s.no + ' is final. To change or cancel it now, message Stoufa on Discord or email and mention ' + s.no + '. This is handled directly, outside this page.';
  $('timer').hidden = !p; $('acts').hidden = !p; $('again').hidden = p; $('copy').hidden = c;
  document.querySelector('.next').hidden = c;
  prog.style.width = '100%';
  tick();
}
function tick() {
  if (!state) return;
  const left = state.endsAt - Date.now();
  $('tm').textContent = mmss(left);
  $('tbar').style.width = Math.min(Math.max(left / WIN, 0), 1) * 100 + '%';
  $('timer').classList.toggle('low', left <= 60000 && left > 0); // urgency pulse under a minute
  $('editnote').textContent = 'Editing order ' + state.no + '. ' + mmss(left) + ' left to save your changes. Until you save, your original order stays as it was.';
  if (left <= 0 && state.status === 'pending') { state.status = 'final'; persist(); renderDone(); }
}
setInterval(tick, 1000);

on('chg', 'click', () => {
  if (!state || state.status !== 'pending') return;
  $('done').hidden = true; form.hidden = false; $('stepper').hidden = false; $('editnote').hidden = false;
  $('ticket').classList.remove('signed', 'cancelled');
  $('sg').value = ''; $('ag').checked = false; $('pc').checked = false; // sign + consent again after changing
  resetBtn();
  updateTicket(); go(0); tick();
});
let armed = false;
on('cxl', 'click', async () => {
  const b = $('cxl');
  if (!armed) { armed = true; b.textContent = 'Tap again to confirm'; setTimeout(() => { armed = false; b.textContent = 'Cancel order'; }, 4000); return; }
  armed = false;
  if (!state || state.status !== 'pending' || Date.now() > state.endsAt) { tick(); return; }
  b.disabled = true; $('derr').textContent = '';
  const msg = { "Order number": state.no, "Status": "CANCELLED by the client inside the 15-minute window", "Verification code": state.token, "Cancelled at (UTC)": new Date().toISOString(), "Client name": state.name,
    "Email": state.payload['Email'] || '', "_subject": "[CANCELLED] Order " + state.no + " by " + state.name };
  if (state.payload._replyto) { msg._replyto = state.payload._replyto; msg.email = state.payload._replyto; }
  try {
    const r = await postJSON(msg);
    if (!r.ok) throw 0;
    state.status = 'cancelled'; persist(); renderDone();
  } catch (e) {
    $('derr').textContent = "Couldn't cancel. Try again, or message Stoufa on Discord and mention " + state.no + '.';
  }
  b.disabled = false; b.textContent = 'Cancel order';
});
on('again', 'click', () => {
  state = null; persist(); snapshot = null;
  try { localStorage.removeItem(KEY); } catch (e) {}
  form.reset(); orderNo = newNo(); token = rnd(10); $('tid').textContent = orderNo;
  $('done').hidden = true; form.hidden = false; $('stepper').hidden = false;
  $('ticket').classList.remove('signed', 'cancelled'); document.querySelector('.t-stamp').textContent = 'Signed';
  resetBtn();
  updateTicket(); go(0); window.scrollTo({ top: 0, behavior: 'smooth' });
});

// The submit button locks while sending; these restore it for edits and next orders
function resetBtn() {
  btn.disabled = false;
  btn.classList.remove('loading');
  btn.querySelector('.btxt').textContent = 'Sign and submit';
}

function fail(timedOut, detail) {
  btn.disabled = false;
  btn.classList.remove('loading');
  btn.querySelector('.btxt').textContent = 'Sign and submit';
  err.textContent = (detail ? detail + ' ' : '') + (timedOut ? "Sending is taking too long. Check your connection, then try again, or " : "Couldn't send your order. Check your connection and try again, or ");
  const o = snapshot || {};
  const body = Object.keys(o).filter(k => k[0] !== '_' && k !== 'Agreed terms' && String(o[k] ?? '').trim() !== '').map(k => k + ': ' + o[k]).join('\n');
  const a = document.createElement('a');
  a.href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent('Order ' + orderNo) + '&body=' + encodeURIComponent(body);
  a.textContent = 'email the order to Stoufa instead';
  err.append(a, '.');
}

// Client copy: a designed PDF (falls back to plain text if the PDF library can't load)
const termsData = () => [...document.querySelectorAll('.term')].map(t =>
  [t.querySelector('span').textContent, t.querySelector('h3').lastChild.textContent, t.querySelector('p').textContent]);

function txtCopy(o) {
  const lines = ['WORK ORDER ' + orderNo, 'Stoufa (Mustapha Boussen)', ''];
  Object.keys(o).filter(k => k[0] !== '_' && k !== 'Order number' && k !== 'Agreed terms' && k !== 'Device' && String(o[k] ?? '').trim() !== '').forEach(k => lines.push(k + ': ' + o[k]));
  lines.push('', 'TERMS', ...termsData().map(t => t[0] + '. ' + t[1] + ': ' + t[2]), '', 'Signed by ' + (o.Signature || ''));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
  a.download = 'work-order-' + orderNo.slice(1) + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

function makePdf(o) {
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 16, CW = W - 2 * M;
  const RED = [226, 36, 27], INK = [22, 21, 20], MUT = [107, 104, 98], BG = [247, 246, 243], RULE = [226, 224, 217], WHITE = [255, 255, 255], LIGHT = [242, 240, 236];
  const L = s => String(s == null ? '' : s).replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF\u2019\u2018\u201C\u201D\u2013\u2014\u2026\u20AC]/g, '?');
  const T = (t, x, y, sz, st, col, opt) => { doc.setFont('helvetica', st || 'normal'); doc.setFontSize(sz); doc.setTextColor(...col); doc.text(t, x, y, opt); };
  const card = (x, y, w, h) => { doc.setFillColor(...WHITE); doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.roundedRect(x, y, w, h, 3, 3, 'FD'); };
  // Arabic support (lazy-loaded by needsArabic() below): registers the embedded
  // font if it's ready, and gives us isAr()/AS for shaping + right-to-left draw order.
  const AS = window.ArabicShape;
  const arabicOn = !!(AS && window.ArabicFontData);
  if (arabicOn) {
    doc.addFileToVFS('Amiri-Regular.ttf', window.ArabicFontData.regular); doc.addFont('Amiri-Regular.ttf', 'Amiri', 'normal');
    doc.addFileToVFS('Amiri-Bold.ttf', window.ArabicFontData.bold); doc.addFont('Amiri-Bold.ttf', 'Amiri', 'bold');
  }
  const isAr = s => arabicOn && AS.hasArabic(s);
  // Draws one short dynamic value (name, etc.) that might be Arabic; T() otherwise.
  const TV = (raw, x, y, sz, st, col) => {
    const s = raw == null ? '' : String(raw);
    if (isAr(s)) { doc.setFont('Amiri', st === 'bold' ? 'bold' : 'normal'); doc.setFontSize(sz); doc.setTextColor(...col); doc.text(AS.bidiLine(AS.reshape(s)), x, y); }
    else T(L(s), x, y, sz, st, col);
  };
  const bg = () => { doc.setFillColor(...BG); doc.rect(0, 0, W, H, 'F'); };
  const curr = o['Currency'] || 'TND';
  const fmt = n => n.toFixed(2) + ' ' + curr;
  let y = 0;
  const ensure = h => { if (y + h > H - 22) { doc.addPage(); bg(); y = 24; } };
  const h2 = t => { ensure(16); T(t, M, y, 13, 'bold', INK); doc.setFillColor(...RED); doc.rect(M, y + 2.6, 10, 1, 'F'); y += 11; };

  bg();
  // Header
  doc.setFillColor(10, 10, 10); doc.rect(0, 0, W, 64, 'F');
  doc.setFillColor(...RED); doc.rect(0, 64, W, 2, 'F'); doc.roundedRect(M, 16, 5, 5, 1, 1, 'F');
  T('STOUFA', M + 8, 20.2, 12, 'bold', LIGHT);
  T('WORK ORDER', W - M, 18, 8, 'bold', [143, 143, 143], { align: 'right' });
  T(orderNo, W - M, 28, 20, 'bold', RED, { align: 'right' });
  T('Project agreement', M, 45, 30, 'bold', LIGHT);
  T('Signed ' + L(o['Signed on']) + (o['Change window ends'] ? '   |   Changes allowed until ' + L(o['Change window ends']) : ''), M, 56, 9, 'normal', [143, 143, 143]);
  doc.setFillColor(...RED); doc.roundedRect(W - M - 28, 37, 28, 9, 4.5, 4.5, 'F'); T('SIGNED', W - M - 14, 42.9, 9, 'bold', WHITE, { align: 'center' });

  // Summary cards
  y = 76; const cw = (CW - 8) / 3;
  [['Service', [o['Service'], o['Second service']]], ['Client', [o['Client name'], o['Business or project name']]], ['Needed by', [o['Needed by']]]].forEach((c, i) => {
    const x = M + i * (cw + 4); card(x, y, cw, 24);
    T(c[0], x + 6, y + 8, 8, 'normal', MUT);
    const vals = c[1].filter(Boolean);
    if (vals.some(isAr)) { let ly = y + 15; vals.forEach(v => { TV(v, x + 6, ly, 10.5, 'bold', INK); ly += 5.6; }); }
    else {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
      const ls = vals.map(v => doc.splitTextToSize(L(v), cw - 12)[0]);
      T(ls.length ? ls : ['-'], x + 6, y + 15, 10.5, 'bold', INK);
    }
  });
  y += 32;

  // Payment
  const tp = parseFloat(o['Total price']) || 0, dp = parseFloat(o['Deposit']) || 0, bal = Math.max(tp - dp, 0), r = tp ? Math.min(dp / tp, 1) : 0;
  card(M, y, CW, 52);
  T('Payment', M + 8, y + 12, 13, 'bold', INK);
  const pm = o['Payment method'];
  T(pm && pm !== 'Not chosen' && pm !== 'To be discussed' ? 'Paid via ' + L(pm) : 'Payment method to be agreed', M + 8, y + 18, 8.5, 'normal', MUT);
  T(fmt(tp), W - M - 8, y + 14, 20, 'bold', INK, { align: 'right' }); T('Total', W - M - 8, y + 19.5, 8, 'normal', MUT, { align: 'right' });
  doc.setFillColor(...RULE); doc.roundedRect(M + 8, y + 26, CW - 16, 4, 2, 2, 'F');
  if (r > 0) { doc.setFillColor(...RED); doc.roundedRect(M + 8, y + 26, Math.max((CW - 16) * r, 4), 4, 2, 2, 'F'); }
  T('Deposit, due before work starts', M + 8, y + 38, 8, 'normal', MUT); T(fmt(dp), M + 8, y + 45, 12, 'bold', RED);
  T('Balance, due before handover', W - M - 8, y + 38, 8, 'normal', MUT, { align: 'right' }); T(fmt(bal), W - M - 8, y + 45, 12, 'bold', INK, { align: 'right' });
  y += 64;

  // Project
  h2('Project');
  const pd = o['Project description'] || '';
  if (isAr(pd)) {
    doc.setFont('Amiri', 'normal'); doc.setFontSize(10);
    const rtl = AS.isRTLDominant(pd);
    doc.splitTextToSize(AS.reshape(pd), CW - 8).forEach(l => {
      ensure(7);
      doc.setFillColor(...RED); doc.rect(rtl ? W - M - 1.4 : M, y - 3.8, 1.4, 5.6, 'F');
      doc.setTextColor(...INK);
      doc.text(AS.bidiLine(l), rtl ? W - M - 8 : M + 6, y, rtl ? { align: 'right' } : undefined);
      y += 5.6;
    });
  } else {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.splitTextToSize(L(pd), CW - 8).forEach(l => {
      ensure(7); doc.setFillColor(...RED); doc.rect(M, y - 3.8, 1.4, 5.6, 'F'); T(l, M + 6, y, 10, 'normal', INK); y += 5.6;
    });
  }
  y += 4;
  const sd = o['Service details'] || '';
  if (sd) {
    if (isAr(sd)) {
      doc.setFont('Amiri', 'normal'); doc.setFontSize(9);
      const rtl2 = AS.isRTLDominant(sd);
      doc.splitTextToSize(AS.reshape(sd), CW - 8).forEach(l => {
        ensure(6); doc.setTextColor(...MUT);
        doc.text(AS.bidiLine(l), rtl2 ? W - M - 8 : M + 6, y, rtl2 ? { align: 'right' } : undefined);
        y += 5;
      });
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.splitTextToSize(L(sd), CW - 8).forEach(l => { ensure(6); T(l, M + 6, y, 9, 'normal', MUT); y += 5; });
    }
    y += 3;
  }
  const ex = (o['Extras'] && o['Extras'] !== 'None') ? o['Extras'].split(', ') : []; let x = M;
  ex.forEach(e => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    const w = doc.getTextWidth(L(e)) + 10; if (x + w > W - M) { x = M; y += 9; }
    ensure(9); doc.setFillColor(252, 228, 226); doc.roundedRect(x, y, w, 7, 3.5, 3.5, 'F'); T(L(e), x + 5, y + 4.8, 8.5, 'bold', [160, 20, 14]); x += w + 3;
  });
  if (ex.length) y += 12;
  if (o['Reference links']) {
    ensure(8);
    const rl = o['Reference links'];
    T('Reference:', M, y, 9, 'normal', MUT);
    TV(rl, M + doc.getTextWidth('Reference: '), y, 9, 'normal', MUT);
    y += 8;
  }
  y += 6;

  // What happens next
  ensure(40); h2('What happens next');
  const st = [['Confirm deposit', 'After the 15-minute change window, Stoufa contacts you.'], ['Work starts', 'Once the deposit is paid.'],
    ['First draft', 'You review it. Two revisions are included.'], ['Final handover', 'Full source and access transfer after final payment.']];
  const sc = CW / 4;
  doc.setDrawColor(...RED); doc.setLineWidth(0.5); doc.line(M + 2.5, y, M + sc * 3 + 2.5, y);
  st.forEach((s, i) => {
    const x = M + i * sc;
    doc.setFillColor(...RED); doc.circle(x + 2.5, y, 2.5, 'F'); doc.setFillColor(...BG); doc.circle(x + 2.5, y, 1, 'F');
    T(s[0], x, y + 9, 9.5, 'bold', INK);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    T(doc.splitTextToSize(s[1], sc - 6), x, y + 14.5, 8.5, 'normal', MUT);
  });
  y += 30;

  // Terms in two columns
  h2('Terms');
  const tm = termsData(), tw = (CW - 5) / 2;
  for (let i = 0; i < tm.length; i += 2) {
    const pair = [tm[i], tm[i + 1]].filter(Boolean);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.8);
    const ls = pair.map(t => doc.splitTextToSize(t[2], tw - 12));
    const h = Math.max(...ls.map(l => l.length)) * 4.2 + 14; ensure(h + 4);
    pair.forEach((t, j) => {
      const cx = M + j * (tw + 5); card(cx, y, tw, h);
      doc.setFillColor(...RED); doc.circle(cx + 8, y + 8, 3, 'F'); T(t[0], cx + 8, y + 9.1, 7.5, 'bold', WHITE, { align: 'center' });
      T(t[1], cx + 14, y + 9, 10, 'bold', INK); T(ls[j], cx + 6, y + 15.5, 8.8, 'normal', MUT);
    });
    y += h + 4;
  }
  y += 6;

  // Signature and contact
  ensure(52); h2('Signature');
  const sw = CW * 0.58; card(M, y, sw, 36);
  T('Client signature', M + 7, y + 8, 8, 'normal', MUT);
  const sig = o['Signature'] || '';
  if (isAr(sig)) {
    const rtlSig = AS.isRTLDominant(sig);
    doc.setFont('Amiri', 'bold'); doc.setFontSize(22); doc.setTextColor(...INK);
    doc.text(AS.bidiLine(AS.reshape(sig)), rtlSig ? M + sw - 7 : M + 7, y + 22, rtlSig ? { align: 'right' } : undefined);
  } else {
    doc.setFont('times', 'italic'); doc.setFontSize(26); doc.setTextColor(...INK); doc.text(L(sig), M + 7, y + 22);
  }
  doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.line(M + 7, y + 25, M + sw - 7, y + 25);
  T('Signed on ' + L(o['Signed on']) + '. Terms agreed.', M + 7, y + 31, 8, 'normal', MUT);
  const cx2 = M + sw + 5, cw2 = CW - sw - 5; card(cx2, y, cw2, 36);
  T('Contractor', cx2 + 6, y + 8, 8, 'normal', MUT);   T('Stoufa (Mustapha Boussen)', cx2 + 6, y + 15, 9, 'bold', INK);
  T(EMAIL, cx2 + 6, y + 21, 8, 'normal', MUT); T(DISCORD.replace('https://', ''), cx2 + 6, y + 26, 8, 'normal', MUT);
  if (getCount() > 2) T('+216 27 637 784', cx2 + 6, y + 31, 8, 'normal', MUT); // phone only for 3+ order clients

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.line(M, H - 16, W - M, H - 16);
    T('Stoufa  |  Changes or cancellation after the change window are handled directly with Stoufa.', M, H - 10, 7.5, 'normal', MUT);
    T(orderNo + '  |  Page ' + i + ' of ' + n, W - M, H - 10, 7.5, 'normal', MUT, { align: 'right' });
  }
  doc.save('work-order-' + orderNo.slice(1) + '.pdf');
}

// The PDF library (410 KB) loads only when someone asks for the PDF, not on every visit
const loadPdfLib = () => window.jspdf ? Promise.resolve() : new Promise((res, rej) => {
  const t = document.createElement('script');
  t.src = 'jspdf.umd.min.js'; t.onload = res; t.onerror = rej; document.head.appendChild(t);
});

// Arabic shaping lib + embedded font (~340 KB combined) load only for an order
// that actually contains Arabic text — everyone else never pays for them.
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const needsArabic = o => ['Client name', 'Business or project name', 'Project description', 'Second service details', 'Service details', 'Reference links', 'Signature'].some(k => ARABIC_RE.test(o[k] || ''));
const loadScript = src => new Promise((res, rej) => { const t = document.createElement('script'); t.src = src; t.onload = res; t.onerror = rej; document.head.appendChild(t); });
const loadArabicAssets = () => (window.ArabicShape && window.ArabicFontData) ? Promise.resolve() : Promise.all([loadScript('arabic-shaping.js'), loadScript('arabic-font.js')]);

on('copy', 'click', () => {
  const o = snapshot || {};
  loadPdfLib()
    .then(() => needsArabic(o) ? loadArabicAssets().catch(() => null) : null)
    .then(() => makePdf(o))
    .catch(() => txtCopy(o));
});

// Price guide on the service cards
document.querySelectorAll('.opt').forEach(o => {
  const p = PRICES[o.querySelector('input').value];
  if (p > 0) o.insertAdjacentHTML('beforeend', '<small class="from">From ' + p + ' TND</small>');
});

// Work section: the live server card, anything in WORK, plus an honest CTA card (no fake portfolio)
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cards = [{ title: 'My Discord server', tag: 'Community', link: DISCORD, live: true,
  text: 'Ask questions, see examples of my work, get updates, and talk to me directly before you order.' }].concat(WORK).concat([
  { title: 'Your project here', tag: 'Next slot', link: '#order', label: 'Start your order',
    text: 'Tell me what to build in the work order below. Deposit first, then I start.' }]);
$('wgrid').innerHTML = cards.map(c =>
  '<article class="wcard">' +
  (c.img ? '<img class="wimg" loading="lazy" src="' + esc(c.img) + '" alt="' + esc(c.title) + '">' : '') +
  '<div class="wtag">' + esc(c.tag) + (c.live ? '<span class="live" id="live">Checking…</span>' : '') + '</div>' +
  '<h3>' + esc(c.title) + '</h3><p>' + esc(c.text) + '</p>' +
  (c.link ? (c.link[0] === '#'
    ? '<a class="ghost" href="' + esc(c.link) + '">' + esc(c.label || 'Start your order') + '</a>'
    : '<a class="ghost" href="' + esc(c.link) + '" target="_blank" rel="noopener">' + esc(c.live ? 'Join the server' : (c.label || 'View project')) + '</a>') : '') +
  '</article>').join('');

// Testimonials: hidden until TESTIMONIALS has entries
if (TESTIMONIALS.length && $('stories')) {
  $('stories').hidden = false;
  $('qgrid').innerHTML = TESTIMONIALS.map(q =>
    '<article class="wcard"><p class="quote">“' + esc(q.quote) + '”</p>' +
    '<div class="wtag">' + esc(q.name) + (q.detail ? ' · ' + esc(q.detail) : '') + '</div></article>').join('');
}

fetch('https://discord.com/api/v9/invites/' + DISCORD.split('/').pop() + '?with_counts=true')
  .then(r => r.json()).then(j => {
    const el = $('live'); if (!el) return;
    if (j.approximate_presence_count != null) el.textContent = j.approximate_presence_count + ' online'; else el.remove();
  }).catch(() => { const el = $('live'); if (el) el.remove(); });

// Your own extra clauses (see EXTRA_TERMS at the top)
const termBase = document.querySelectorAll('.terms .term').length;
EXTRA_TERMS.forEach((t, i) => document.querySelector('.terms').insertAdjacentHTML('beforeend',
  '<div class="term"><h3><span>' + (termBase + 1 + i) + '</span>' + esc(t.title) + '</h3><p>' + esc(t.text) + '</p></div>'));

// Single source of truth: hardcoded links in HTML are fallbacks for no-JS; JS syncs them to the constants above
document.querySelectorAll('a[href*="discord.gg"]').forEach(a => { try { a.href = DISCORD; } catch (e) {} });
document.querySelectorAll('a[href^="mailto:"]').forEach(a => { try { a.href = 'mailto:' + EMAIL; } catch (e) {} });

// FAQ accordion: opening one first smooth-closes the other, then opens (one slow ~2s handoff)
const RMOTION = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const closeDetails = o => { // fade content out while the grid collapses, then release
  o.classList.add('closing');
  o.open = false;
  setTimeout(() => o.classList.remove('closing'), 1200);
};
document.querySelectorAll('.faq').forEach(sec => {
  let busy = false;
  sec.addEventListener('click', e => {
    const sum = e.target && e.target.closest ? e.target.closest('summary') : null;
    if (!sum) return;
    const d = sum.closest('details');
    if (!d) return;
    d.classList.remove('closing'); // a fresh open never inherits a fade-out
    if (d.open) return; // closing one naturally needs no choreography
    if (busy) { e.preventDefault(); return; } // swallow rapid clicks mid-sequence
    const open = sec.querySelector('details[open]');
    if (!open || RMOTION) return; // nothing to close, or instant mode: native toggle
    e.preventDefault();
    busy = true;
    closeDetails(open);
    setTimeout(() => {
      d.classList.remove('closing');
      d.open = true; // then smooth open (~2s total with the close)
      try { d.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (x) {}
      busy = false;
    }, 700);
  });
  sec.addEventListener('toggle', e => {
    const t = e.target;
    if (!t || t.tagName !== 'DETAILS') return;
    if (t.open) {
      t.classList.remove('closing');
      sec.querySelectorAll('details[open]').forEach(o => { if (o !== t) closeDetails(o); });
    } else { // native close (own summary, or click-away below): fade it out too
      t.classList.add('closing');
      setTimeout(() => t.classList.remove('closing'), 1200);
    }
  }, true);
});

// Click-away: clicking outside an open question smoothly closes it
// (pure mouseout would shut answers while clients are still reading them)
document.addEventListener('click', e => {
  if (!e.target || !e.target.closest) return;
  document.querySelectorAll('.faq details[open]').forEach(o => {
    if (!o.contains(e.target)) closeDetails(o);
  });
});

// Motion: scroll reveals (progressive enhancement — content stays visible without JS)
// Staggered entrances for cards, FAQs and contact pills; plain fade for the rest
const io = ('IntersectionObserver' in window) ? new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: 0.1, rootMargin: '0px 0px -6% 0px' }) : null;
function reveal() {
  document.querySelectorAll('.rv:not(.in)').forEach(el => { io ? io.observe(el) : el.classList.add('in'); });
}
function stagger(sel, step) {
  document.querySelectorAll(sel).forEach((el, i) => { el.classList.add('rv'); el.style.setProperty('--d', (i * step) + 'ms'); });
}
document.querySelectorAll('.work, .faq, .footer, .left').forEach(el => el.classList.add('rv'));
stagger('#wgrid .wcard', 90);
stagger('#qgrid .wcard', 90);
stagger('.faq details', 60);
stagger('.contact-grid > :not(#phonepill)', 60);
document.querySelectorAll('.term').forEach(el => el.classList.add('rv'));
reveal();

// Hero pointer glow (fine pointers only; CSS holds a calm default until first move)
try {
  const hero = document.querySelector('.hero');
  if (hero && window.matchMedia && matchMedia('(pointer:fine)').matches) {
    hero.addEventListener('pointermove', e => {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      hero.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
  }
} catch (e) {}

// Accounts: Firebase Auth (Google + email/password) on the static site, no backend of mine.
// Until FIREBASE_CONFIG is set, the account UI stays hidden and the page works as before.
// Note: this proves identity to the page, not cryptographically to Stoufa — the
// order email + verification code stay the trust anchor for deposits.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAZNsL2OtmOtPkr2zkOSR6dV4fGRStTq4U",
  authDomain: "client-contract-9ed29.firebaseapp.com",
  projectId: "client-contract-9ed29",
  storageBucket: "client-contract-9ed29.firebasestorage.app",
  messagingSenderId: "388844178207",
  appId: "1:388844178207:web:10bb62dadce716ab197e2a",
  measurementId: "G-JVD4ST7Z0C"
}; // accounts on: nav + order form get sign in/up, submit gates on login
const OKEYS = 'stoufa-orders';
let fbUser = null, fbReady = false, fbFailed = false, authMode = 'in';
function getUser() {
  return fbUser ? { sub: fbUser.uid, name: fbUser.displayName || '', email: fbUser.email || '', verified: !!fbUser.emailVerified } : null;
}
function getOrders() { try { return JSON.parse(localStorage.getItem(OKEYS) || '{}'); } catch (e) { return {}; } }
function myOrders() { const u = getUser(); return u ? (getOrders()[u.sub] || []) : []; }
function addOrder() {
  const u = getUser();
  if (!u) return;
  const entry = { no: orderNo, svc: svcLabel() || svc(), total: $('tp').value || '0', cur: curCode(), pay: pay(), bn: $('bn').value.trim(), on: today() };
  const all = getOrders(), mine = all[u.sub] || [];
  const i = mine.findIndex(o => o.no === entry.no);
  if (i >= 0) mine[i] = Object.assign(mine[i], entry); else mine.unshift(entry); // edits update, new orders append
  all[u.sub] = mine;
  try { localStorage.setItem(OKEYS, JSON.stringify(all)); } catch (e) {}
}
function fillAccount() {
  const u = getUser();
  if (!u) return;
  $('cn').value = u.name || '';
  $('ct').value = u.email || ''; $('ct2').value = u.email || '';
  ['cn', 'ct', 'ct2'].forEach(id => { $(id).readOnly = true; }); // locked to the account identity
  const last = myOrders()[0]; // smart refill: business name, currency and pay from the last order, only where untouched
  if (last) {
    if (!$('bn').value && last.bn) $('bn').value = last.bn;
    if (curCode() === 'TND' && last.cur) pick('cur', last.cur);
    if (!pay() && last.pay) pick('pay', last.pay);
  }
}
function renderAccount() {
  const box = $('gbox');
  if (!box) return;
  if (!FIREBASE_CONFIG) { box.hidden = true; return; }
  box.hidden = false;
  const u = getUser();
  $('gopen').hidden = !!u;
  $('ginfo').hidden = !u;
  $('gout').hidden = !u;
  $('gnote').hidden = !!(u || !fbFailed);
  updateNavAcct();
  if (!u) { $('gorders').innerHTML = ''; return; }
  $('ginfo').textContent = u.name + ' · ' + u.email;
  const list = myOrders();
  $('gorders').innerHTML = list.length
    ? '<b>Your orders (' + list.length + ')</b>' + list.map(o =>
      '<div><span>' + esc(o.no) + '</span><span>' + esc(o.svc) + ' · ' + esc(o.total) + ' ' + esc(o.cur) + '</span></div>').join('')
    : '<span class="privacy">No orders yet — submitted orders will appear here.</span>';
}
function updateNavAcct() {
  const b = $('navacct');
  if (!b) return;
  if (!FIREBASE_CONFIG) { b.hidden = true; return; }
  b.hidden = false;
  const u = getUser();
  b.textContent = u ? u.email : 'Sign in';
  b.title = u ? u.email : '';
}
function fbMsg(e) {
  const c = (e && e.code) || '';
  if (c === 'auth/email-already-in-use') return 'That email already has an account — switch to Sign in.';
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found') return 'Wrong email or password.';
  if (c === 'auth/too-many-requests') return 'Too many tries — wait a bit, then try again.';
  if (c === 'auth/network-request-failed') return 'Network problem — check your connection and try again.';
  if (c === 'auth/popup-blocked') return 'Popup blocked — allow popups for this site and try again.';
  return (e && e.message) || 'Something went wrong. Try again.';
}
function openAuth(mode) {
  if (mode) setAuthMode(mode);
  renderAuth();
  $('authmodal').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    const f = $(getUser() ? 'amout' : 'ammail'); // focus the action that matters in each view
    if (f) f.focus({ preventScroll: true });
  }, 60);
}
function closeAuth() {
  $('authmodal').hidden = true;
  document.body.style.overflow = '';
  $('amerr').textContent = '';
}
function setAuthMode(m) {
  authMode = m;
  $('amtabin').classList.toggle('sel', m === 'in');
  $('amtabup').classList.toggle('sel', m === 'up');
  $('amnamewrap').hidden = m !== 'up';
  $('amforgot').hidden = m !== 'in';
  $('amforgot').textContent = 'Forgot password?';
  $('amgo').textContent = m === 'up' ? 'Create account' : 'Sign in';
  $('ampass').autocomplete = m === 'up' ? 'new-password' : 'current-password';
  $('amerr').textContent = '';
}
function renderAuth() {
  const u = getUser();
  $('amlogged').hidden = !u;
  $('amguest').hidden = !!u;
  if (u) {
    $('amwho').textContent = u.name + ' · ' + u.email;
    $('amverify').hidden = !!u.verified;
  }
}
async function amSubmit() {
  const go = $('amgo');
  $('amerr').textContent = '';
  if (!window.firebase) { $('amerr').textContent = "Sign-in service didn't load (ad-blocker or offline?). Try again with it off."; return; }
  const email = $('ammail').value.trim(), pass = $('ampass').value;
  if (!/^\S+@\S+\.\S+$/.test(email)) { $('amerr').textContent = 'Enter a valid email.'; return; }
  if (pass.length < 6) { $('amerr').textContent = 'Password needs at least 6 characters.'; return; }
  go.disabled = true;
  try {
    const auth = window.firebase.auth();
    if (authMode === 'up') {
      const name = $('amname').value.trim();
      if (!name) { $('amerr').textContent = 'Enter your full name.'; go.disabled = false; return; }
      const cred = await auth.createUserWithEmailAndPassword(email, pass);
      await cred.user.updateProfile({ displayName: name });
      try { await cred.user.sendEmailVerification(); } catch (e) {}
    } else {
      await auth.signInWithEmailAndPassword(email, pass);
    }
    closeAuth();
  } catch (e) { $('amerr').textContent = fbMsg(e); go.disabled = false; }
}
async function googleLogin() {
  if (!window.firebase) { $('amerr').textContent = "Sign-in service didn't load (ad-blocker or offline?). Try again with it off."; return; }
  try {
    await window.firebase.auth().signInWithPopup(new window.firebase.auth.GoogleAuthProvider());
    closeAuth();
  } catch (e) {
    if ((e && e.code) === 'auth/popup-closed-by-user') return;
    $('amerr').textContent = fbMsg(e);
  }
}
on('amforgot', 'click', async () => {
  const email = $('ammail').value.trim();
  if (!window.firebase) { $('amerr').textContent = "Sign-in service didn't load (ad-blocker or offline?). Try again with it off."; return; }
  if (!/^\S+@\S+\.\S+$/.test(email)) { $('amerr').textContent = 'Type your email above first.'; return; }
  try {
    await window.firebase.auth().sendPasswordResetEmail(email);
    $('amerr').textContent = '';
    $('amforgot').textContent = 'Reset link sent — check your inbox and spam.';
  } catch (e) { $('amerr').textContent = fbMsg(e); }
});
async function signOut() {
  try { await window.firebase.auth().signOut(); } catch (e) {}
  ['cn', 'ct', 'ct2'].forEach(id => { const el = $(id); el.value = ''; el.readOnly = false; });
  renderAccount(); updateTicket(); save();
}
function loadFb() {
  if (window.firebase) return Promise.resolve();
  return Promise.all([
    loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js'),
    loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js')
  ]);
}
function initAuth() {
  try {
    try { localStorage.removeItem('stoufa-user'); } catch (e) {} // retired Google-only session key
    window.firebase.initializeApp(FIREBASE_CONFIG);
    window.firebase.auth().onAuthStateChanged(u => {
      fbUser = u || null;
      if (u) fillAccount();
      renderAccount(); updateTicket(); save();
    });
    fbReady = true;
  } catch (e) { fbFailed = true; }
  renderAccount();
}
on('gopen', 'click', () => openAuth());
on('gout', 'click', signOut);
on('navacct', 'click', () => openAuth());
on('amx', 'click', closeAuth);
on('amback', 'click', closeAuth);
on('amtabin', 'click', () => setAuthMode('in'));
on('amtabup', 'click', () => setAuthMode('up'));
on('amgo', 'click', amSubmit);
on('amgoogle', 'click', googleLogin);
on('amout', 'click', signOut);
on('amresend', 'click', async () => {
  try { await fbUser.sendEmailVerification(); $('amerr').textContent = ''; $('amverify').querySelector('p').textContent = 'Sent — check your inbox and spam folder.'; }
  catch (e) { $('amerr').textContent = fbMsg(e); }
});
document.addEventListener('keydown', e => { const am = $('authmodal'); if (e.key === 'Escape' && am && !am.hidden) closeAuth(); });
if (FIREBASE_CONFIG) {
  renderAccount();
  loadFb().then(initAuth).catch(() => { fbFailed = true; renderAccount(); });
} else {
  const gb = $('gbox');
  if (gb) gb.hidden = true;
  updateNavAcct();
}

// Resume a saved order (window still open, final, or cancelled) or start fresh
updatePhone(); // phone pill stays hidden until the 3rd successful order
try { state = JSON.parse(localStorage.getItem(OKEY) || 'null'); } catch (e) { state = null; }
if (state && Date.now() > state.endsAt + 7 * 864e5) { state = null; persist(); } // saved orders are wiped from the browser after 7 days
if (state) {
  orderNo = state.no; $('tid').textContent = orderNo; snapshot = state.payload;
  applyDraft(state.draft); $('sg').value = state.sig || ''; $('ag').checked = true; $('pc').checked = true;
  if (state.status === 'pending' && Date.now() >= state.endsAt) { state.status = 'final'; persist(); }
  updateTicket(); go(0, true); renderDone();
} else { restore(); updateTicket(); go(0, true); }
