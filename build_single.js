const fs = require('fs');
const path = require('path');

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

// Ensure no local or external script tags remain in bundled HTML
const scriptSrcMatch = html.match(/<script\s+[^>]*src=["']([^"']+)["'][^>]*>/gi);
if (scriptSrcMatch) {
  console.error(`[FAIL] Unprocessed script tags remain in bundled HTML: ${scriptSrcMatch.join(', ')}`);
  process.exit(1);
}

// Write bundled file
fs.writeFileSync(singleHtmlPath, html, 'utf8');

// Verify synchronization check
const verifiedHtml = fs.readFileSync(singleHtmlPath, 'utf8');
if (verifiedHtml !== html) {
  console.error('[FAIL] Generated single-file HTML synchronization check failed!');
  process.exit(1);
}

console.log('Successfully generated clean, fully synchronized crypto-matrix-single.html!');
