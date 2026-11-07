'use strict';
// CSP static check (Phase B): fail if inline code execution vectors or
// inline <style> elements reappear in first-party contents files.
//
// Detection families (3):
//   1. Inline event handler attributes — in HTML markup and in JS-built
//      markup strings. Case-insensitive. In HTML files, unquoted values
//      (onclick=go()) are also matched; in JS files a quote is required
//      after '=' so property assignments (el.onclick = fn) never match.
//   2. <script> without a real src attribute — in HTML (every tag is
//      checked; data-src does not count as src) and in JS-built markup.
//   3. Inline <style> elements — every occurrence, in HTML and in
//      JS-built markup strings.
//
// Scope: *.html / *.js directly under the target dir (vendor/ excluded:
// pinned third-party code, reviewed when the vendored copy changes).
// Known limits: HTML/JS comments containing these patterns will trip the
// check (keep such text out of comments), and event attributes built in
// JS by string concatenation right after '=' are not matched.
//
// Usage: node tests/security/csp-static-check.js [targetDir]
// Exit code 0 = clean, 1 = violations found.
const fs = require('fs');
const path = require('path');

const targetDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '..', 'contents');

function lineOf(text, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function allMatches(text, regex) {
  const out = [];
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m.index);
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}

const violations = [];
function scanFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(targetDir, file);
  const isHtml = file.endsWith('.html');
  const report = (idx, what) => violations.push(`${rel}:${lineOf(text, idx)}: ${what}`);

  // Family 1: inline event handler attributes
  const evPattern = isHtml
    ? /\son[a-z]+\s*=\s*(["']|[^\s>"']+)/gi
    : /\son[a-z]+\s*=\s*["']/gi;
  for (const idx of allMatches(text, evPattern)) {
    report(idx, 'inline event handler attribute');
  }

  // Family 2: <script> without src
  if (isHtml) {
    const tagRe = /<script\b[^>]*>/gi;
    let m;
    while ((m = tagRe.exec(text)) !== null) {
      if (!/\ssrc\s*=/.test(m[0])) report(m.index, '<script> without src');
    }
  } else {
    for (const idx of allMatches(text, /<script\b(?![^>]*\ssrc\s*=)/i)) {
      report(idx, '<script> without src built in JS');
    }
  }

  // Family 3: inline <style> elements (every occurrence, HTML and JS)
  for (const idx of allMatches(text, /<style[\s>]/i)) {
    report(idx, 'inline <style> element');
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
