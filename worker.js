// Stoufa auth backend — Cloudflare Worker, zero dependencies.
// Env: DB (D1), MAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH,
//      SESSION_KEY, GIS_CLIENT_ID (the site's Google OAuth client, anti-replay)
// Paste into the Worker dashboard editor (Edit code) and Deploy. No build step.

const ALLOWED_ORIGINS = ['https://m-stoufa.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000'];
const CONTACT_EMAIL = 'boussenmostafa@gmail.com';
const OTP_TTL = 15 * 60 * 1000, OTP_RESEND_MS = 60 * 1000, OTP_MAX_TRY = 5;
const LOGIN_MAX_FAIL = 10, LOGIN_WINDOW_MS = 15 * 60 * 1000;
// Free-plan CPU is ~10ms/request and PBKDF2 is pure CPU: 40k iterations keeps
// hashing to a few ms native while staying a real work factor alongside per-user
// salts and login throttling. (100k+ risks blowing the CPU budget outright.)
const PBKDF2_ITERS = 40000;

// ---------- tiny helpers ----------
const te = new TextEncoder();
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = s => b64url(te.encode(s));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const rand6 = () => { const a = new Uint8Array(6); crypto.getRandomValues(a); return [...a].map(x => x % 10).join(''); };
const sha256hex = async s => hex(await crypto.subtle.digest('SHA-256', te.encode(s)));
const emailOk = e => typeof e === 'string' && /^\S+@\S+\.\S+$/.test(e.trim()) && e.trim().length <= 254;

function cors(req) {
  const o = req.headers.get('Origin') || '';
  const h = {};
  if (ALLOWED_ORIGINS.includes(o)) { h['Access-Control-Allow-Origin'] = o; h['Vary'] = 'Origin'; }
  h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  h['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
  h['Access-Control-Max-Age'] = '86400';
  return h;
}
const json = (req, data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors(req)) });

// ---------- sessions (stateless HMAC) ----------
async function hmacKey(env) {
  return crypto.subtle.importKey('raw', te.encode(env.SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signToken(env, uid, expMs) {
  const body = b64urlStr(JSON.stringify({ uid, exp: Date.now() + expMs }));
  const sig = hex(await crypto.subtle.sign('HMAC', await hmacKey(env), te.encode(body)));
  return body + '.' + sig;
}
async function checkToken(env, token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return 0;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), hexToBytes(sig), te.encode(body));
    if (!ok) return 0;
    const pad = s => s + '='.repeat((4 - (s.length % 4)) % 4); // atob needs padding; unpadded input fails ~1 in 4 tokens
    const p = JSON.parse(atob(pad(body.replace(/-/g, '+').replace(/_/g, '/'))));
    return (p.exp || 0) > Date.now() ? p.uid : 0;
  } catch (e) { return 0; }
}
function hexToBytes(h) {
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return b;
}
function bearer(req) {
  const h = req.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

// ---------- passwords ----------
async function hashPass(pw, saltHex) {
  const key = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERS }, key, 256);
  return { hash: hex(bits), salt: saltHex || hex(salt) };
}

// ---------- schema (once per isolate; DDL is idempotent anyway) ----------
let schemaDone = false;
async function schema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      pass_hash TEXT, salt TEXT, google_sub TEXT UNIQUE, verified INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS codes (
      email TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_sent INTEGER NOT NULL,
      PRIMARY KEY (email, purpose))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS throttle (
      email TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL)`),
  ]);
}

// ---------- gmail ----------
let cachedToken = null, cachedExp = 0;
async function gmailToken(env) {
  if (cachedToken && Date.now() < cachedExp - 60000) return cachedToken;
  const cid = String(env.GMAIL_CLIENT_ID || '').trim(), sec = String(env.GMAIL_CLIENT_SECRET || '').trim();
  const ref = String(env.GMAIL_REFRESH || '').trim(); // pasted tokens often smuggle whitespace
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cid, client_secret: sec,
      refresh_token: ref, grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!j.access_token) { try { console.error('mail-stage: token', j.error || 'no-token', (j.error_description || '').slice(0, 120)); } catch (e) {} throw new Error('gmail-token'); }
  cachedToken = j.access_token;
  cachedExp = Date.now() + (j.expires_in || 3600) * 1000;
  return cachedToken;
}
const b64mime = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rfc2047 = s => '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(s))).replace(/=+$/, '') + '?='; // raw UTF-8 in headers gets 400s
async function sendMail(env, to, subject, html, text) {
  const tok = await gmailToken(env);
  const boundary = 'stoufa-' + rand6() + Date.now().toString(36);
  const mime = [
    'From: "Stoufa" <' + env.MAIL_USER + '>',
    'To: <' + to + '>',
    'Reply-To: <' + CONTACT_EMAIL + '>',
    'Subject: ' + rfc2047(subject),
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '', '--' + boundary, 'Content-Type: text/plain; charset="UTF-8"', '',
    text, '', '--' + boundary, 'Content-Type: text/html; charset="UTF-8"', '',
    html, '', '--' + boundary + '--',
  ].join('\r\n');
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64mime(mime) }),
  });
  if (!r.ok) {
    let d = '';
    try { d = (await r.text()).slice(0, 200); } catch (e) {}
    try { console.error('mail-stage: send', r.status, d); } catch (e) {}
    throw new Error('gmail-send');
  }
}

// Constant-time string compare where available (login + OTP checks shouldn't leak prefix matches)
function safeEq(a, b) {
  try {
    const A = te.encode(a), B = te.encode(b);
    if (A.length !== B.length) return false;
    if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(A, B);
  } catch (e) { /* fall through to plain compare */ }
  return a === b;
}

// ---------- branded mail ----------
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function mailWrap(title, bodyHtml) {
  return '<div style="background:#0a0a0a;color:#f2f0ec;font-family:Arial,sans-serif;padding:32px 24px;">' +
    '<div style="max-width:480px;margin:0 auto;background:#141414;border:1px solid #2a2a2a;border-radius:20px;padding:32px 28px;">' +
    '<div style="font-size:20px;font-weight:bold;letter-spacing:2px;margin-bottom:6px;"><span style="display:inline-block;width:12px;height:12px;background:#e2241b;border-radius:4px;margin-right:8px;"></span>STOUFA</div>' +
    '<h2 style="margin:18px 0 12px;font-size:22px;">' + title + '</h2>' + bodyHtml +
    '<p style="color:#8f8f8f;font-size:13px;margin:24px 0 0;">— Stoufa (Mustapha Boussen)<br>' + CONTACT_EMAIL + '<br>https://m-stoufa.github.io/Clients-Contracts/</p>' +
    '</div></div>';
}
const otpMail = (name, code, why) => {
  const safe = escHtml(name) || 'there';
  return {
  subject: 'Stoufa — your verification code',
  html: mailWrap('Your verification code', '<p>Hello ' + safe + ',</p><p>' + why + '</p>' +
    '<p style="font-size:34px;font-weight:bold;letter-spacing:8px;color:#e2241b;">' + code + '</p>' +
    '<p style="color:#8f8f8f;font-size:13px;">Valid 15 minutes. Didn\u2019t ask for this? Just ignore it.</p>'),
  text: 'Hello ' + String(name || 'there') + ',\nYour Stoufa verification code: ' + code + '\nValid 15 minutes.',
  };
};

// ---------- handlers ----------
async function needBody(req) {
  try { return await req.json(); } catch (e) { return {}; }
}
async function issueCode(env, email, purpose, name, why) {
  email = email.trim().toLowerCase();
  const now = Date.now();
  const old = await env.DB.prepare('SELECT last_sent FROM codes WHERE email = ? AND purpose = ?').bind(email, purpose).first();
  if (old && now - old.last_sent < OTP_RESEND_MS) {
    const wait = Math.ceil((OTP_RESEND_MS - (now - old.last_sent)) / 1000);
    return { wait };
  }
  const code = rand6();
  await env.DB.prepare(`INSERT INTO codes (email, purpose, code_hash, expires_at, attempts, last_sent)
    VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT(email, purpose) DO UPDATE SET
    code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, last_sent = excluded.last_sent`)
    .bind(email, purpose, await sha256hex(code), now + OTP_TTL, now).run();
  const m = otpMail(name || 'there', code, why);
  await sendMail(env, email, m.subject, m.html, m.text);
  return { ok: true };
}
async function checkCode(env, email, purpose, code) {
  email = String(email || '').trim().toLowerCase();
  const row = await env.DB.prepare('SELECT code_hash, expires_at, attempts FROM codes WHERE email = ? AND purpose = ?').bind(email, purpose).first();
  if (!row) return 'wrong';
  if (Date.now() > row.expires_at) { await env.DB.prepare('DELETE FROM codes WHERE email = ? AND purpose = ?').bind(email, purpose).run(); return 'expired'; }
  if (row.attempts >= OTP_MAX_TRY) return 'locked';
  const good = safeEq(await sha256hex(String(code || '').trim()), row.code_hash);
  if (!good) {
    await env.DB.prepare('UPDATE codes SET attempts = attempts + 1 WHERE email = ? AND purpose = ?').bind(email, purpose).run();
    return 'wrong';
  }
  await env.DB.prepare('DELETE FROM codes WHERE email = ? AND purpose = ?').bind(email, purpose).run();
  return 'ok';
}
async function throttled(env, email) {
  email = email.trim().toLowerCase();
  const now = Date.now();
  const row = await env.DB.prepare('SELECT fails, window_start FROM throttle WHERE email = ?').bind(email).first();
  if (row && now - row.window_start < LOGIN_WINDOW_MS && row.fails >= LOGIN_MAX_FAIL) return true;
  return false;
}
async function noteFail(env, email) {
  email = email.trim().toLowerCase();
  const now = Date.now();
  const row = await env.DB.prepare('SELECT fails, window_start FROM throttle WHERE email = ?').bind(email).first();
  if (row && now - row.window_start < LOGIN_WINDOW_MS) {
    await env.DB.prepare('UPDATE throttle SET fails = fails + 1 WHERE email = ?').bind(email).run();
  } else {
    await env.DB.prepare('INSERT INTO throttle (email, fails, window_start) VALUES (?, 1, ?) ON CONFLICT(email) DO UPDATE SET fails = 1, window_start = excluded.window_start').bind(email, now).run();
  }
}
async function clearFails(env, email) {
  await env.DB.prepare('DELETE FROM throttle WHERE email = ?').bind(email.trim().toLowerCase()).run();
}
const pub = u => ({ id: u.id, name: u.name, email: u.email, verified: !!u.verified });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(req, { ok: true });
    if (req.method !== 'POST' && !(req.method === 'GET' && url.pathname === '/api/me')) return json(req, { error: 'method' }, 405);
    if (!env.DB || !env.SESSION_KEY || !env.MAIL_USER || !env.GMAIL_CLIENT_ID || !env.GIS_CLIENT_ID) {
      return json(req, { error: 'setup', message: 'Backend not configured yet.' }, 503);
    }
    try { if (!schemaDone) { await schema(env); schemaDone = true; } } catch (e) { return json(req, { error: 'db' }, 500); }
    const b = await needBody(req);

    // register
    if (url.pathname === '/api/register') {
      const name = String(b.name || '').trim().slice(0, 120);
      const email = String(b.email || '').trim().toLowerCase();
      const pw = String(b.password || '');
      if (!name) return json(req, { error: 'name' }, 400);
      if (!emailOk(email)) return json(req, { error: 'email' }, 400);
      if (pw.length < 6 || pw.length > 128) return json(req, { error: 'password' }, 400);
      const ex = await env.DB.prepare('SELECT id, verified FROM users WHERE email = ?').bind(email).first();
      if (ex && ex.verified) return json(req, { error: 'exists' }, 409);
      const { hash, salt } = await hashPass(pw);
      const now = Date.now();
      if (ex) {
        await env.DB.prepare('UPDATE users SET name = ?, pass_hash = ?, salt = ? WHERE email = ?').bind(name, hash, salt, email).run();
      } else {
        await env.DB.prepare('INSERT INTO users (name, email, pass_hash, salt, verified, created_at) VALUES (?, ?, ?, ?, 0, ?)').bind(name, email, hash, salt, now).run();
      }
      try {
        const r = await issueCode(env, email, 'verify', name.split(/\s+/)[0], 'Use this code to verify your email and activate your account:');
        if (r.wait) return json(req, { error: 'cooldown', retry_after: r.wait }, 429);
      } catch (e) { return json(req, { error: 'mail' }, 502); }
      return json(req, { ok: true, verify: true });
    }

    // verify code -> session
    if (url.pathname === '/api/verify') {
      const email = String(b.email || '').trim().toLowerCase();
      const remember = b.remember !== false;
      const st = await checkCode(env, email, 'verify', b.code);
      if (st !== 'ok') return json(req, { error: st }, 400);
      await env.DB.prepare('UPDATE users SET verified = 1 WHERE email = ?').bind(email).run();
      const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
      const token = await signToken(env, u.id, remember ? 30 * 864e5 : 12 * 36e5);
      return json(req, { ok: true, token, user: pub(u) });
    }

    // login
    if (url.pathname === '/api/login') {
      const email = String(b.email || '').trim().toLowerCase();
      const remember = b.remember !== false;
      if (!emailOk(email)) return json(req, { error: 'invalid' }, 401);
      if (await throttled(env, email)) return json(req, { error: 'locked' }, 429);
      const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
      const bad = async () => { await noteFail(env, email); return json(req, { error: 'invalid' }, 401); };
      if (!u || !u.pass_hash) return bad();
      const { hash } = await hashPass(String(b.password || ''), u.salt);
      if (!safeEq(hash, u.pass_hash)) return bad();
      await clearFails(env, email);
      if (!u.verified) return json(req, { error: 'unverified' }, 403);
      const token = await signToken(env, u.id, remember ? 30 * 864e5 : 12 * 36e5);
      return json(req, { ok: true, token, user: pub(u) });
    }

    // resend code (silent ok = no enumeration)
    if (url.pathname === '/api/resend') {
      const email = String(b.email || '').trim().toLowerCase();
      if (!emailOk(email)) return json(req, { ok: true });
      const u = await env.DB.prepare('SELECT name FROM users WHERE email = ?').bind(email).first();
      if (!u) return json(req, { ok: true });
      try {
        const r = await issueCode(env, email, 'verify', String(u.name).split(/\s+/)[0], 'Here is a fresh verification code:');
        if (r.wait) return json(req, { error: 'cooldown', retry_after: r.wait }, 429);
      } catch (e) { return json(req, { error: 'mail' }, 502); }
      return json(req, { ok: true });
    }

    // google (GIS access token -> tokeninfo; aud MUST be our own client or any
    // Google login from any other app could be replayed here)
    if (url.pathname === '/api/google') {
      const remember = b.remember !== false;
      let g = null;
      try {
        const r = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(String(b.accessToken || '')));
        g = await r.json();
      } catch (e) { g = null; }
      if (!g || !g.sub || !g.email || g.email_verified !== 'true' || !env.GIS_CLIENT_ID || g.aud !== env.GIS_CLIENT_ID) {
        return json(req, { error: 'google' }, 401);
      }
      const now = Date.now();
      let u = await env.DB.prepare('SELECT * FROM users WHERE google_sub = ? OR email = ?').bind(g.sub, String(g.email).toLowerCase()).first();
      if (u) {
        await env.DB.prepare('UPDATE users SET google_sub = ?, verified = 1, name = ? WHERE id = ?').bind(g.sub, String(g.name || u.name).slice(0, 120), u.id).run();
        u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first();
      } else {
        const ins = await env.DB.prepare('INSERT INTO users (name, email, google_sub, verified, created_at) VALUES (?, ?, ?, 1, ?)')
          .bind(String(g.name || '').slice(0, 120), String(g.email).toLowerCase(), g.sub, now).run();
        u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(ins.meta.last_row_id).first();
      }
      const token = await signToken(env, u.id, remember ? 30 * 864e5 : 12 * 36e5);
      return json(req, { ok: true, token, user: pub(u) });
    }

    // forgot -> reset OTP (silent ok). Google-only accounts may set a password
    // this way too: the inbox OTP proves ownership either way.
    if (url.pathname === '/api/forgot') {
      const email = String(b.email || '').trim().toLowerCase();
      if (!emailOk(email)) return json(req, { ok: true });
      const u = await env.DB.prepare('SELECT name FROM users WHERE email = ?').bind(email).first();
      if (!u) return json(req, { ok: true });
      try {
        const r = await issueCode(env, email, 'reset', String(u.name).split(/\s+/)[0], 'Use this code to reset your password:');
        if (r.wait) return json(req, { error: 'cooldown', retry_after: r.wait }, 429);
      } catch (e) { return json(req, { error: 'mail' }, 502); }
      return json(req, { ok: true });
    }

    // reset with code
    if (url.pathname === '/api/reset') {
      const email = String(b.email || '').trim().toLowerCase();
      const pw = String(b.newPassword || '');
      if (pw.length < 6 || pw.length > 128) return json(req, { error: 'password' }, 400);
      const st = await checkCode(env, email, 'reset', b.code);
      if (st !== 'ok') return json(req, { error: st }, 400);
      const { hash, salt } = await hashPass(pw);
      await env.DB.prepare('UPDATE users SET pass_hash = ?, salt = ?, verified = 1 WHERE email = ?').bind(hash, salt, email).run();
      await clearFails(env, email);
      return json(req, { ok: true });
    }

    // me
    if (url.pathname === '/api/me') {
      const uid = await checkToken(env, req.method === 'GET' ? url.searchParams.get('token') : bearer(req));
      if (!uid) return json(req, { error: 'auth' }, 401);
      const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first();
      if (!u) return json(req, { error: 'auth' }, 401);
      return json(req, { ok: true, user: pub(u) });
    }

    return json(req, { error: 'route' }, 404);
  },
};
