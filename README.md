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

Formspree endpoint (`FS` in `script.js`) receives orders by email. Honeypot field + 15s timeout + mailto fallback are built in.

## Google sign-in (required to submit, once configured)
Yes, it works on GitHub Pages — Google only needs a static HTTPS origin. Until you set it up, the page works exactly as before (no login box, no gate).
1. Go to [Google Cloud Console](https://console.cloud.google.com), create a project.
2. APIs & Services → OAuth consent screen → **External** → fill app name + support email.
3. Add scopes `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` (non-sensitive — no Google verification needed), then **Publish app** to Production (test mode would force you to pre-register every client).
4. Credentials → Create → OAuth client ID → **Web application** → Authorized JavaScript origins: add `https://YOURUSER.github.io` and `http://localhost:8000` (local testing) → copy the client ID.
5. Paste it into `GOOGLE_CLIENT_ID` in `script.js`. Done — clients now sign in with Google, name/email autofill and lock, signature must match the Google name, and each client gets a per-account order history.
Notes: `file://` preview won't work for login, use the localhost server. If Google's script is blocked (ad-blocker/offline), the form falls back to open submit with a note — orders still reach you.
