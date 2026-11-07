'use strict';
// CSP policy regression check for Phase C-1 + D.
// This validates the policies actually shipped in the HTML documents.
// Browser-level behavior is covered separately by the manual Chrome/Safari flow.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..', 'contents');

function readPolicy(file) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const tag = html.match(/<meta\\b[^>]*http-equiv\\s*=\\s*["']Content-Security-Policy["'][^>]*>/i);
  if (!tag) throw new Error(`${file}: CSP meta element not found`);
  const content = tag[0].match(/\\bcontent\\s*=\\s*(["'])(.*?)\\1/i);
  if (!content) throw new Error(`${file}: CSP content attribute not found`);

  const directives = new Map();
  for (const raw of content[2].split(';')) {
    const parts = raw.trim().split(/\\s+/).filter(Boolean);
    if (!parts.length) continue;
    const name = parts.shift().toLowerCase();
    if (directives.has(name)) throw new Error(`${file}: duplicate CSP directive: ${name}`);
    directives.set(name, parts);
  }
  return directives;
}

function requireDirective(directives, file, name, expected) {
  const actual = directives.get(name);
  if (!actual) throw new Error(`${file}: missing ${name} directive`);
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${file}: expected ${name} ${expected.join(' ')}, got ${actual.join(' ')}`);
  }
}

function requireContains(directives, file, name, token) {
  const actual = directives.get(name) || [];
  if (!actual.includes(token)) throw new Error(`${file}: ${name} must include ${token}`);
}

function requireAbsent(directives, file, name, token) {
  const actual = directives.get(name) || [];
  if (actual.includes(token)) throw new Error(`${file}: ${name} must not include ${token}`);
}

const main = readPolicy('index.html');
requireContains(main, 'index.html', 'script-src', "'self'");
requireContains(main, 'index.html', 'script-src', "'wasm-unsafe-eval'");
requireAbsent(main, 'index.html', 'script-src', "'unsafe-inline'");
requireAbsent(main, 'index.html', 'script-src', "'unsafe-eval'");
requireDirective(main, 'index.html', 'worker-src', ["'self'"]);
requireDirective(main, 'index.html', 'frame-src', ["'none'"]);

const recovery = readPolicy('timelock-recover.html');
requireContains(recovery, 'timelock-recover.html', 'script-src', "'self'");
requireContains(recovery, 'timelock-recover.html', 'script-src', "'wasm-unsafe-eval'");
requireAbsent(recovery, 'timelock-recover.html', 'script-src', "'unsafe-inline'");
requireContains(recovery, 'timelock-recover.html', 'style-src', "'self'");

console.log('CSP policy check: PASS (index C-1 + D; recovery external CSS allowed)');
