'use strict';
// CSP static check (Phase B): fail if inline code execution vectors or
// inline <style> elements reappear in first-party contents files.
// Scope: *.html / *.js directly under the target dir (vendor/ excluded:
// pinned third-party code, reviewed when the vendored copy changes).
// Usage: node tests/security/csp-static-check.js [targetDir]
// Exit code 0 = clean, 1 = violations found.
const fs = require('fs');
const path = require('path');

const targetDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '..', 'contents');

const EVENT_ATTR = /\son[a-zA-Z]+\s*=\s*["']/;
const SCRIPT_TAG = /<script\b[^>]*>/gi;
const STYLE_TAG = /<style[\s>]/i;
const SCRIPT_IN_JS = /<script(?![^>]*\bsrc=)/i;

function lineOf(text, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

const violations = [];
function scanFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(targetDir, file);
  const isHtml = file.endsWith('.html');

  // 1. inline event handler attributes (HTML markup and JS-built markup)
  let m;
  const ev = new RegExp(EVENT_ATTR.source, 'g');
  while ((m = ev.exec(text)) !== null) {
    violations.push(`${rel}:${lineOf(text, m.index)}: inline event handler attribute`);
  }

  if (isHtml) {
    // 2. <script> without src in HTML
    const st = new RegExp(SCRIPT_TAG.source, 'gi');
    while ((m = st.exec(text)) !== null) {
      if (!/\bsrc\s*=/.test(m[0])) {
        violations.push(`${rel}:${lineOf(text, m.index)}: <script> without src`);
      }
    }
    // 3. inline <style> elements (externalized in Phase A-3; keep them out)
    const sy = text.search(STYLE_TAG);
    if (sy >= 0) {
      violations.push(`${rel}:${lineOf(text, sy)}: inline <style> element`);
    }
  } else {
    // 4. script tag built in JS without src
    const sj = text.search(SCRIPT_IN_JS);
    if (sj >= 0) {
      violations.push(`${rel}:${lineOf(text, sj)}: <script> without src built in JS`);
    }
  }
}

const entries = fs.readdirSync(targetDir, { withFileTypes: true })
  .filter((e) => e.isFile() && (e.name.endsWith('.html') || e.name.endsWith('.js')))
  .map((e) => path.join(targetDir, e.name))
  .sort();

for (const f of entries) scanFile(f);

if (violations.length) {
  console.error(`CSP static check: ${violations.length} violation(s)`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(`CSP static check: PASS (${entries.length} files scanned)`);
