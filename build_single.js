const fs = require('fs');
const path = require('path');

const contentsDir = path.join(__dirname, 'contents');
const indexHtmlPath = path.join(contentsDir, 'index.html');
const singleHtmlPath = path.join(contentsDir, 'crypto-matrix-single.html');

let html = fs.readFileSync(indexHtmlPath, 'utf8');

const replacements = [
  { tag: '<script src="qr-encoder.js"></script>', file: 'qr-encoder.js' },
  { tag: '<script src="argon2.umd.min.js"></script>', file: 'argon2.umd.min.js' },
  { tag: '<script src="kdbxweb.min.js"></script>', file: 'kdbxweb.min.js', optional: true },
  { tag: '<script src="index.js"></script>', file: 'index.js' },
  { tag: '<script src="backup-qr.js"></script>', file: 'backup-qr.js' }
];

for (const item of replacements) {
  if (html.includes(item.tag)) {
    const fileContent = fs.readFileSync(path.join(contentsDir, item.file), 'utf8');
    // Use replacer function () => string to prevent special replacement pattern issue with $
    html = html.replace(item.tag, () => `<script>\n${fileContent}\n</script>`);
    console.log(`[PASS] Inlined ${item.file} into single HTML`);
  } else if (!item.optional) {
    console.error(`[FAIL] Tag '${item.tag}' not found in index.html! Build aborted.`);
    process.exit(1);
  }
}

// Verify no external script tags remain (except external fonts/remote CDNs if any)
if (html.includes('<script src=')) {
  console.warn('[WARN] External script tags remain in bundled HTML');
}

fs.writeFileSync(singleHtmlPath, html, 'utf8');
console.log('Successfully generated clean crypto-matrix-single.html!');
