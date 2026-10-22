const fs = require('fs');
const path = require('path');

const contentsDir = path.join(__dirname, 'contents');
const indexHtmlPath = path.join(contentsDir, 'index.html');
const singleHtmlPath = path.join(contentsDir, 'crypto-matrix-single.html');

let html = fs.readFileSync(indexHtmlPath, 'utf8');

// Replace script tags with inlined JS contents
// 1. qr-encoder.js
const qrJs = fs.readFileSync(path.join(contentsDir, 'qr-encoder.js'), 'utf8');
html = html.replace('<script src="qr-encoder.js"></script>', `<script>\n${qrJs}\n</script>`);

// 2. argon2.umd.min.js
const argon2Js = fs.readFileSync(path.join(contentsDir, 'argon2.umd.min.js'), 'utf8');
html = html.replace('<script src="argon2.umd.min.js"></script>', `<script>\n${argon2Js}\n</script>`);

// 3. kdbxweb.min.js
const kdbxJs = fs.readFileSync(path.join(contentsDir, 'kdbxweb.min.js'), 'utf8');
if (html.includes('<script src="kdbxweb.min.js"></script>')) {
  html = html.replace('<script src="kdbxweb.min.js"></script>', `<script>\n${kdbxJs}\n</script>`);
}

// 4. index.js
const indexJs = fs.readFileSync(path.join(contentsDir, 'index.js'), 'utf8');
html = html.replace('<script src="index.js"></script>', `<script>\n${indexJs}\n</script>`);

// 5. backup-qr.js
const backupJs = fs.readFileSync(path.join(contentsDir, 'backup-qr.js'), 'utf8');
html = html.replace('<script src="backup-qr.js"></script>', `<script>\n${backupJs}\n</script>`);

fs.writeFileSync(singleHtmlPath, html, 'utf8');
console.log('Successfully generated crypto-matrix-single.html!');
