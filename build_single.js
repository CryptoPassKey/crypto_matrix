const fs = require('fs');
const path = require('path');

const isCheckOnly = process.argv.includes('--check');

const contentsDir = path.join(__dirname, 'contents');
const indexHtmlPath = path.join(contentsDir, 'index.html');
const singleHtmlPath = path.join(contentsDir, 'crypto-matrix-single.html');

let html = fs.readFileSync(indexHtmlPath, 'utf8');

const replacements = [
  { tag: '<script src="qr-encoder.js"></script>', file: 'qr-encoder.js' },
  { tag: '<script src="argon2.umd.min.js"></script>', file: 'argon2.umd.min.js' },
  { tag: '<script src="kdbxweb.min.js"></script>', file: 'kdbxweb.min.js' },
  { tag: '<script src="index.js"></script>', file: 'index.js' },
  { tag: '<script src="backup-qr.js"></script>', file: 'backup-qr.js' }
];

for (const item of replacements) {
  if (html.includes(item.tag)) {
    const fileContent = fs.readFileSync(path.join(contentsDir, item.file), 'utf8');
    // Use replacer function () => string to prevent special replacement pattern issue with $
    html = html.replace(item.tag, () => `<script>\n${fileContent}\n</script>`);
    console.log(`[PASS] Inlined ${item.file} into single HTML`);
  } else {
    console.error(`[FAIL] Required tag '${item.tag}' not found in index.html! Build aborted.`);
    process.exit(1);
  }
}

// Ensure no unprocessed script tags remain
const scriptSrcMatch = html.match(/<script\s+[^>]*src=["']([^"']+)["'][^>]*>/gi);
if (scriptSrcMatch) {
  console.error(`[FAIL] Unprocessed script tags remain in bundled HTML: ${scriptSrcMatch.join(', ')}`);
  process.exit(1);
}

if (isCheckOnly) {
  if (!fs.existsSync(singleHtmlPath)) {
    console.error(`[FAIL] Bundled file '${singleHtmlPath}' does not exist! Sync check failed.`);
    process.exit(1);
  }
  const existingHtml = fs.readFileSync(singleHtmlPath, 'utf8');
  if (existingHtml !== html) {
    console.error('[FAIL] Existing crypto-matrix-single.html is out of sync with source index.html and scripts! Sync check failed.');
    process.exit(1);
  }
  console.log('[PASS] crypto-matrix-single.html is perfectly in sync with source!');
  process.exit(0);
}

// Write bundled file
fs.writeFileSync(singleHtmlPath, html, 'utf8');

// Verify synchronization check after write
const verifiedHtml = fs.readFileSync(singleHtmlPath, 'utf8');
if (verifiedHtml !== html) {
  console.error('[FAIL] Generated single-file HTML synchronization check failed!');
  process.exit(1);
}

console.log('Successfully generated clean, fully synchronized crypto-matrix-single.html!');
