// Minimal Arabic text-shaping + display-reordering for jsPDF.
//
// jsPDF draws each character as its own glyph in logical string order with no
// text-shaping engine, so raw Arabic (which is stored one base letter per
// character) comes out as disconnected, wrong-direction letters. This file
// fixes both problems in two independent steps:
//   1. reshape()  — picks the correct positional glyph (isolated / initial /
//      medial / final) for each letter, per the standard Arabic cursive-join
//      rules, using the codepoints Unicode itself defines for each form.
//   2. bidiLine() — reorders each line into left-to-right *drawing* order so
//      that, once drawn, it *reads* right-to-left, handling embedded Latin
//      words/numbers correctly. Only a single embedding level is handled
//      (no nested brackets/overrides) — enough for real client-order text.
//
// Loaded lazily by script.js only when an order actually contains Arabic.
(function (global) {
  'use strict';

  // Each entry: base letter -> [isolated, initial, medial, final] codepoints,
  // 0 where that letter has no such form (right-joining letters have no
  // initial/medial form; a few letters never connect at all).
  var FORMS = {
    0x0621: [0xFE80, 0, 0, 0],
    0x0622: [0xFE81, 0, 0, 0xFE82], 0x0623: [0xFE83, 0, 0, 0xFE84],
    0x0624: [0xFE85, 0, 0, 0xFE86], 0x0625: [0xFE87, 0, 0, 0xFE88],
    0x0626: [0xFE89, 0xFE8B, 0xFE8C, 0xFE8A],
    0x0627: [0xFE8D, 0, 0, 0xFE8E],
    0x0628: [0xFE8F, 0xFE91, 0xFE92, 0xFE90],
    0x0629: [0xFE93, 0, 0, 0xFE94],
    0x062A: [0xFE95, 0xFE97, 0xFE98, 0xFE96],
    0x062B: [0xFE99, 0xFE9B, 0xFE9C, 0xFE9A],
    0x062C: [0xFE9D, 0xFE9F, 0xFEA0, 0xFE9E],
    0x062D: [0xFEA1, 0xFEA3, 0xFEA4, 0xFEA2],
    0x062E: [0xFEA5, 0xFEA7, 0xFEA8, 0xFEA6],
    0x062F: [0xFEA9, 0, 0, 0xFEAA], 0x0630: [0xFEAB, 0, 0, 0xFEAC],
    0x0631: [0xFEAD, 0, 0, 0xFEAE], 0x0632: [0xFEAF, 0, 0, 0xFEB0],
    0x0633: [0xFEB1, 0xFEB3, 0xFEB4, 0xFEB2],
    0x0634: [0xFEB5, 0xFEB7, 0xFEB8, 0xFEB6],
    0x0635: [0xFEB9, 0xFEBB, 0xFEBC, 0xFEBA],
    0x0636: [0xFEBD, 0xFEBF, 0xFEC0, 0xFEBE],
    0x0637: [0xFEC1, 0xFEC3, 0xFEC4, 0xFEC2],
    0x0638: [0xFEC5, 0xFEC7, 0xFEC8, 0xFEC6],
    0x0639: [0xFEC9, 0xFECB, 0xFECC, 0xFECA],
    0x063A: [0xFECD, 0xFECF, 0xFED0, 0xFECE],
    0x0640: [0x0640, 0x0640, 0x0640, 0x0640], // tatweel — joins either side, glyph is itself
    0x0641: [0xFED1, 0xFED3, 0xFED4, 0xFED2],
    0x0642: [0xFED5, 0xFED7, 0xFED8, 0xFED6],
    0x0643: [0xFED9, 0xFEDB, 0xFEDC, 0xFEDA],
    0x0644: [0xFEDD, 0xFEDF, 0xFEE0, 0xFEDE],
    0x0645: [0xFEE1, 0xFEE3, 0xFEE4, 0xFEE2],
    0x0646: [0xFEE5, 0xFEE7, 0xFEE8, 0xFEE6],
    0x0647: [0xFEE9, 0xFEEB, 0xFEEC, 0xFEEA],
    0x0648: [0xFEED, 0, 0, 0xFEEE], 0x0649: [0xFEEF, 0, 0, 0xFEF0],
    0x064A: [0xFEF1, 0xFEF3, 0xFEF4, 0xFEF2],
    // a few extra letters seen in Persian/Kurdish borrow-words / some Maghrebi typing
    0x067E: [0xFB56, 0xFB58, 0xFB59, 0xFB57], 0x0686: [0xFB7A, 0xFB7C, 0xFB7D, 0xFB7B],
    0x0698: [0xFB8A, 0, 0, 0xFB8B], 0x06A9: [0xFB8E, 0xFB90, 0xFB91, 0xFB8F],
    0x06AF: [0xFB92, 0xFB94, 0xFB95, 0xFB93], 0x06CC: [0xFBFC, 0xFBFE, 0xFBFF, 0xFBFD]
  };

  // LAM directly followed by one of these ALEF variants renders as one glyph.
  var LAM = 0x0644;
  var LAM_ALEF = {
    0x0622: [0xFEF5, 0xFEF6], 0x0623: [0xFEF7, 0xFEF8],
    0x0625: [0xFEF9, 0xFEFA], 0x0627: [0xFEFB, 0xFEFC]
  };

  // Diacritics (tashkeel) sit on top of a letter and don't break the cursive
  // chain — the letters on either side of one still connect through it.
  var MARKS = {};
  [0x0610, 0x0611, 0x0612, 0x0613, 0x0614, 0x0615, 0x0616, 0x0617, 0x0618, 0x0619, 0x061A,
   0x064B, 0x064C, 0x064D, 0x064E, 0x064F, 0x0650, 0x0651, 0x0652, 0x0653, 0x0654, 0x0655,
   0x0656, 0x0657, 0x0658, 0x0670, 0x06D6, 0x06D7, 0x06D8, 0x06D9, 0x06DA, 0x06DB, 0x06DC,
   0x06DF, 0x06E0, 0x06E1, 0x06E2, 0x06E3, 0x06E4, 0x06E7, 0x06E8, 0x06EA, 0x06EB, 0x06EC, 0x06ED
  ].forEach(function (c) { MARKS[c] = true; });

  function isArabicCode(c) {
    return (c >= 0x0600 && c <= 0x06FF) || (c >= 0x0750 && c <= 0x077F) ||
           (c >= 0x08A0 && c <= 0x08FF) || (c >= 0xFB50 && c <= 0xFDFF) ||
           (c >= 0xFE70 && c <= 0xFEFF);
  }
  function joinsForward(code) { var f = FORMS[code]; return !!(f && (f[1] || f[2])); }  // can lead into the next letter
  function joinsBackward(code) { var f = FORMS[code]; return !!(f && (f[2] || f[3])); } // can follow the previous letter

  // Keep only what the embedded font actually has glyphs for; everything
  // else becomes '?' rather than a missing-glyph box.
  function sanitize(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 0x09 || c === 0x0A || c === 0x0D) out += s.charAt(i);
      else if (c >= 0x20 && c <= 0x7E) out += s.charAt(i);
      else if (c >= 0xA0 && c <= 0xFF) out += s.charAt(i);
      else if (c >= 0x100 && c <= 0x17F) out += s.charAt(i);
      else if (isArabicCode(c)) out += s.charAt(i);
      else if (c >= 0x200C && c <= 0x200F) out += s.charAt(i); // ZWNJ/ZWJ/LRM/RLM — zero-width, harmless
      else if (c === 0x2010 || c === 0x2011 || c === 0x2018 || c === 0x2019 ||
               c === 0x201C || c === 0x201D || c === 0x2026) out += s.charAt(i);
      else out += '?';
    }
    return out;
  }

  function reshape(raw) {
    var text = sanitize(String(raw == null ? '' : raw));
    var codes = [];
    for (var k = 0; k < text.length; k++) codes.push(text.charCodeAt(k));
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var code = codes[i];
      var form = FORMS[code];
      if (!form) { out.push(text.charAt(i)); continue; }

      var p = i - 1; while (p >= 0 && MARKS[codes[p]]) p--;
      var prevCode = p >= 0 ? codes[p] : -1;
      var nx = i + 1; while (nx < text.length && MARKS[codes[nx]]) nx++;
      var nextCode = nx < text.length ? codes[nx] : -1;

      var fromPrev = prevCode >= 0 && joinsForward(prevCode);
      var toNext = nextCode >= 0 && joinsForward(code) && joinsBackward(nextCode);

      if (code === LAM && nextCode >= 0 && LAM_ALEF[nextCode]) {
        var lig = LAM_ALEF[nextCode];
        out.push(String.fromCharCode(fromPrev ? lig[1] : lig[0]));
        i = nx; // the ALEF is consumed into the ligature
        continue;
      }

      var takesFinal = fromPrev && form[3];
      var takesInitial = toNext && form[1];
      if (takesInitial && takesFinal) out.push(String.fromCharCode(form[2] || form[0]));
      else if (takesFinal) out.push(String.fromCharCode(form[3]));
      else if (takesInitial) out.push(String.fromCharCode(form[1]));
      else out.push(String.fromCharCode(form[0]));
    }
    return out.join('');
  }

  function hasArabic(s) {
    if (!s) return false;
    s = String(s);
    for (var i = 0; i < s.length; i++) if (isArabicCode(s.charCodeAt(i))) return true;
    return false;
  }

  // First strong (letter) character decides the line/field's base direction.
  function isRTLDominant(s) {
    s = String(s == null ? '' : s);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (isArabicCode(c)) return true;
      if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) return false;
    }
    return false;
  }

  // Reorders one already-shaped line into left-to-right drawing order so it
  // reads correctly. Splits into same-direction runs, reverses each Arabic
  // run's characters (shapes were already fixed by reshape(), this only
  // changes drawing order), then — only for an Arabic-dominant line — flips
  // the run order too, so embedded Latin words/numbers land in the right spot.
  function bidiLine(line) {
    if (!line) return line;
    var runs = [], cur = null;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      var cls = isArabicCode(line.charCodeAt(i)) ? 'ar' : 'ot';
      if (cur && cur.cls === cls) cur.text += ch;
      else { cur = { cls: cls, text: ch }; runs.push(cur); }
    }
    runs.forEach(function (r) { if (r.cls === 'ar') r.text = r.text.split('').reverse().join(''); });
    if (isRTLDominant(line)) runs.reverse();
    return runs.map(function (r) { return r.text; }).join('');
  }

  global.ArabicShape = { hasArabic: hasArabic, isRTLDominant: isRTLDominant, reshape: reshape, bidiLine: bidiLine };
}(window));
