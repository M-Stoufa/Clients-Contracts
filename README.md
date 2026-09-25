# Stoufa — Start a project

Single-page static site: clients fill in a work order, sign it, get a deposit confirmation. Hosted on GitHub Pages.

## Files
- `index.html` — order form (4 steps + ticket + FAQ + footer)
- `style.css` — all styling
- `script.js` — form logic, 15-min change window, PDF copy, Formspree send
- `privacy.html`, `404.html`, `robots.txt`, `.nojekyll`, `og.png`
- `jspdf.umd.min.js` — lazy-loaded only when client clicks “Download PDF”
- `arabic-shaping.js`, `arabic-font.js` — lazy-loaded only if the order contains Arabic

## Deploy (GitHub Pages)
1. Create a repo, upload **the extracted files** (not the zip, not `.vscode`) to the repo root.
2. Repo Settings → Pages → Deploy from branch → `main` / `/ (root)`.
3. Replace `YOURUSER/YOURREPO` in `index.html` (canonical, og:url, og:image, twitter:image) with your real Pages URL, or link previews break.
4. After every edit to `style.css`/`script.js`, bump `?v=N` in the `<link>`/`<script>` tags so visitors fetch fresh files instead of cached ones.

## Before each client / when terms change
Edit at the top of `script.js`:
- `DISCORD`, `EMAIL` — page links, PDF contact and fallback email sync from these.
- `TERMS_VERSION` — bump the date whenever you edit the terms text. It is sent with every order as the permanent record.
- `MIN_DEPOSIT_PCT`, `MIN_TOTAL` — validation + ticket labels update automatically. FAQ minimum in `index.html` must be updated by hand to match.
- `PRICES` — set a starting price (>0) to show “From X TND” on a service card. 0 hides it.
- `WORK` — add portfolio cards: `{ title, tag, text, img, link }`.
- `EXTRA_TERMS` — extra clauses after term 8. Numbering is automatic.

Formspree endpoint (`FS` in `script.js`) receives orders by email. Honeypot field, 3-second instant-submit time-trap and 15s timeout plus mailto fallback are built in. The public endpoint can still receive forged posts that skip page validation — always re-check totals, deposit and reply-to before confirming any deposit.

## Accounts: Google + email/password via Firebase (free, no backend)
Until you set this up, the account UI stays hidden and the page works as before.
1. Go to https://console.firebase.google.com → Add project → you can reuse your existing Google Cloud project.
2. Build → Authentication → Get started → Sign-in method → enable **Email/Password** and **Google** (one click each, no verification needed).
3. Authentication → Settings → Authorized domains → add `m-stoufa.github.io` (localhost is allowed by default).
4. Project Overview → Add app → Web (`</>`) → copy the `firebaseConfig` object.
5. Paste it as `FIREBASE_CONFIG` in `script.js`. Done — nav + order form get sign in/up, email verification, locked autofill, per-client order history.
Notes: passwords never touch this page (Firebase handles them). If Firebase's script is blocked (ad-blocker/offline), the form falls back to open submit with a note — orders still reach you.
