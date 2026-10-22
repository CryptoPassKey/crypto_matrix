const fs = require('fs');
const vm = require('vm');
const nodeCrypto = require('crypto');

const kdbxCode = fs.readFileSync('contents/kdbxweb.min.js', 'utf8');
const argon2Code = fs.readFileSync('contents/argon2.umd.min.js', 'utf8');

// Load real Argon2id implementation
const m = { exports: {} };
new Function('module', 'exports', argon2Code)(m, m.exports);
const realArgon2 = m.exports;

// Robust XML Node, Parser, and Serializer for pure Node.js DOM environment
class MiniNode {
  constructor(nodeName, ownerDoc = null) {
    this.nodeName = nodeName;
    this.tagName = nodeName;
    this.childNodes = [];
    this.attributes = [];
    this._textContent = '';
    this.ownerDocument = ownerDoc;
  }

  get textContent() {
    if (this.nodeName === '#text') return this._textContent;
    return this.childNodes.map(c => c.textContent).join('');
  }

  set textContent(val) {
    if (this.nodeName === '#text') {
      this._textContent = String(val || '');
    } else {
      this.childNodes = [];
      if (val !== undefined && val !== null && val !== '') {
        const textNode = new MiniNode('#text', this.ownerDocument);
        textNode._textContent = String(val);
        this.appendChild(textNode);
      }
    }
  }

  getAttribute(name) {
    const attr = this.attributes.find(a => a.name === name);
    return attr ? attr.value : null;
  }

  setAttribute(name, val) {
    let attr = this.attributes.find(a => a.name === name);
    if (!attr) {
      this.attributes.push({ name, value: String(val) });
    } else {
      attr.value = String(val);
    }
  }

  appendChild(child) {
    child.ownerDocument = this.ownerDocument || this;
    this.childNodes.push(child);
    return child;
  }

  getElementsByTagName(tagName) {
    let res = [];
    if (this.nodeName === tagName) res.push(this);
    for (const child of this.childNodes) {
      if (child.getElementsByTagName) {
        res = res.concat(child.getElementsByTagName(tagName));
      }
    }
    return res;
  }
}

class MiniDocument extends MiniNode {
  constructor() {
    super('#document', null);
    this.ownerDocument = this;
    this.documentElement = null;
  }

  createElement(name) {
    return new MiniNode(name, this);
  }

  createTextNode(text) {
    const node = new MiniNode('#text', this);
    node._textContent = String(text || '');
    return node;
  }
}

function parseXmlToMiniDoc(xmlStr) {
  const doc = new MiniDocument();
  const stack = [];
  let root = null;

  // XML tag & text parsing regex
  const tagRegex = /<(\/?)([A-Za-z0-9_:-]+)((?:\s+[A-Za-z0-9_:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let match;

  while ((match = tagRegex.exec(xmlStr)) !== null) {
    const isClose = match[1];
    const tagName = match[2];
    const attrStr = match[3];
    const isSelfClosing = match[4];
    const textContent = match[5];

    if (textContent) {
      if (stack.length > 0) {
        const decoded = textContent
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");
        const textNode = doc.createTextNode(decoded);
        stack[stack.length - 1].appendChild(textNode);
      }
    } else if (tagName) {
      if (tagName.startsWith('?') || tagName.startsWith('!')) continue;

      if (isClose) {
        if (stack.length > 0) stack.pop();
      } else {
        const node = doc.createElement(tagName);
        if (attrStr) {
          const attrRegex = /([A-Za-z0-9_:-]+)="([^"]*)"/g;
          let amatch;
          while ((amatch = attrRegex.exec(attrStr)) !== null) {
            node.setAttribute(amatch[1], amatch[2]);
          }
        }
        if (!root) {
          root = node;
          doc.documentElement = root;
          doc.appendChild(root);
        } else if (stack.length > 0) {
          stack[stack.length - 1].appendChild(node);
        }
        if (!isSelfClosing) {
          stack.push(node);
        }
      }
    }
  }

  return doc;
}

function serializeNode(node) {
  if (node.nodeName === '#text') {
    return node._textContent
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  if (node.nodeName === '#document') {
    return '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n' + (node.documentElement ? serializeNode(node.documentElement) : '');
  }
  let attrs = node.attributes.map(a => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join('');
  let children = node.childNodes.map(c => serializeNode(c)).join('');
  if (!children) {
    return `<${node.nodeName}${attrs} />`;
  }
  return `<${node.nodeName}${attrs}>${children}</${node.nodeName}>`;
}

class MiniDOMParser {
  parseFromString(xmlStr, mimeType) {

    return parseXmlToMiniDoc(xmlStr);
  }
}

class MiniXMLSerializer {
  serializeToString(doc) {
    return serializeNode(doc);
  }
}

const sandbox = {
  console: console,
  Uint8Array, Uint16Array, Uint32Array, Int32Array, BigInt, Math, Array, String, Number, Object, Error, TextEncoder, TextDecoder, Buffer, ArrayBuffer,
  crypto: nodeCrypto.webcrypto,
  DOMParser: MiniDOMParser,
  XMLSerializer: MiniXMLSerializer
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(kdbxCode, sandbox);

// Connect real Argon2id implementation to kdbxweb
sandbox.kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type, version) => {
  const hash = await realArgon2.argon2id({
    password: new Uint8Array(password),
    salt: new Uint8Array(salt),
    memorySize: memory,
    iterations: iterations,
    hashLength: length,
    parallelism: parallelism,
    outputType: 'binary'
  });
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
});

async function runKdbxTests() {
  console.log('====================================================');
  console.log('KeePass .kdbx Direct Export Verification Test Suite');
  console.log('====================================================');

  const kdbxweb = sandbox.kdbxweb;

  // Test 1: Password-only KDBX 4.0 Export & Complete Roundtrip Verification
  console.log('\n[Test 1] Password-only KDBX 4.0 Export & Reload Roundtrip');
  const masterPw = 'MyMasterPassword2026!';
  const creds1 = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(masterPw));

  const db1 = await kdbxweb.Kdbx.create(creds1, 'CryptoMatrix Export');
  const entry1 = db1.createEntry(db1.getDefaultGroup());
  entry1.fields.set('Title', 'Google Account');
  entry1.fields.set('UserName', 'myuser@gmail.com');
  entry1.fields.set('URL', 'https://google.com');
  entry1.fields.set('Password', kdbxweb.ProtectedValue.fromString('LZZLea+PZy'));

  const t0 = Date.now();
  const fileBytes1 = await db1.save();
  const elapsed1 = Date.now() - t0;
  console.log(`Saved KDBX 4.0 file size: ${fileBytes1.byteLength} bytes (took ${elapsed1}ms)`);

  // Reload saved database
  const loadedDb1 = await kdbxweb.Kdbx.load(fileBytes1, creds1);
  const loadedEntries1 = loadedDb1.getDefaultGroup().entries;
  if (loadedEntries1.length !== 1) {
    console.error(`FAIL: Expected 1 entry, found ${loadedEntries1.length}`);
    process.exit(1);
  }

  const loadedEntry1 = loadedEntries1[0];
  const title1 = loadedEntry1.fields.get('Title');
  const user1 = loadedEntry1.fields.get('UserName');
  const url1 = loadedEntry1.fields.get('URL');
  const pass1 = loadedEntry1.fields.get('Password').getText();

  console.log(`Reloaded Fields -> Title: '${title1}', User: '${user1}', URL: '${url1}', Pass: '${pass1}'`);
  if (title1 !== 'Google Account' || user1 !== 'myuser@gmail.com' || url1 !== 'https://google.com' || pass1 !== 'LZZLea+PZy') {
    console.error('FAIL: Reloaded fields mismatch');
    process.exit(1);
  }
  console.log('PASS: Password-only KDBX 4.0 export & full reload roundtrip verified!');

  // Test 2: Password + Keyfile Combination Export & Reload Verification
  console.log('\n[Test 2] Password + Keyfile Combination Export & Reload Verification');
  const keyfileBytes = sandbox.crypto.getRandomValues(new Uint8Array(32));
  const credsCombo = new kdbxweb.Credentials(
    kdbxweb.ProtectedValue.fromString(masterPw),
    keyfileBytes.buffer
  );

  const db2 = await kdbxweb.Kdbx.create(credsCombo, 'CryptoMatrix Keyfile Export');
  const entry2 = db2.createEntry(db2.getDefaultGroup());
  entry2.fields.set('Title', 'Secure Banking');
  entry2.fields.set('UserName', 'bank_user');
  entry2.fields.set('Password', kdbxweb.ProtectedValue.fromString('SuperBankPass2026!'));

  const fileBytes2 = await db2.save();
  console.log(`Saved KDBX with keyfile size: ${fileBytes2.byteLength} bytes`);

  const loadedDb2 = await kdbxweb.Kdbx.load(fileBytes2, credsCombo);
  const loadedEntry2 = loadedDb2.getDefaultGroup().entries[0];
  if (loadedEntry2.fields.get('Title') !== 'Secure Banking' || loadedEntry2.fields.get('Password').getText() !== 'SuperBankPass2026!') {
    console.error('FAIL: Keyfile protected DB reload mismatch');
    process.exit(1);
  }
  console.log('PASS: Password + Keyfile KDBX export & reload verified!');

  // Test 3: Japanese, Emoji & Special Characters Roundtrip
  console.log('\n[Test 3] Japanese, Emoji, and Symbols Entry Export & Reload Roundtrip');
  const unicodeTitle = 'メルカリ Flea Market 🍣';
  const unicodeUser = 'テストユーザー@example.com';
  const unicodePw = 'Mercari#2026Trade$';

  const entry3 = db1.createEntry(db1.getDefaultGroup());
  entry3.fields.set('Title', unicodeTitle);
  entry3.fields.set('UserName', unicodeUser);
  entry3.fields.set('Password', kdbxweb.ProtectedValue.fromString(unicodePw));

  const unicodeFileBytes = await db1.save();
  const loadedUnicodeDb = await kdbxweb.Kdbx.load(unicodeFileBytes, creds1);
  const loadedUnicodeEntries = loadedUnicodeDb.getDefaultGroup().entries;
  const targetUnicodeEntry = loadedUnicodeEntries.find(e => e.fields.get('Title') === unicodeTitle);

  if (!targetUnicodeEntry) {
    console.error('FAIL: Unicode entry not found after reloading');
    process.exit(1);
  }

  const resTitle = targetUnicodeEntry.fields.get('Title');
  const resUser = targetUnicodeEntry.fields.get('UserName');
  const resPw = targetUnicodeEntry.fields.get('Password').getText();

  console.log(`Reloaded Unicode -> Title: '${resTitle}', User: '${resUser}', Pass: '${resPw}'`);
  if (resTitle !== unicodeTitle || resUser !== unicodeUser || resPw !== unicodePw) {
    console.error('FAIL: Unicode field content mismatch');
    process.exit(1);
  }
  console.log('PASS: Multilingual, Emoji, and Symbol entry export & reload verified!');

  // Test 4: Rejection Assertion Tests (Wrong Password / Missing Keyfile / Wrong Keyfile)
  console.log('\n[Test 4] Rejection Assertions (Wrong Password / Keyfile Errors)');

  // 4a. Wrong Master Password
  let rejectedWrongPw = false;
  try {
    const badPwCreds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('WrongPassword123!'));
    await kdbxweb.Kdbx.load(fileBytes1, badPwCreds);
  } catch (err) {
    rejectedWrongPw = true;
  }
  if (!rejectedWrongPw) {
    console.error('FAIL: Wrong password was not rejected!');
    process.exit(1);
  }
  console.log('PASS: Wrong master password correctly rejected!');

  // 4b. Missing Keyfile (for DB created with keyfile)
  let rejectedMissingKeyfile = false;
  try {
    const pwOnlyCreds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(masterPw));
    await kdbxweb.Kdbx.load(fileBytes2, pwOnlyCreds);
  } catch (err) {
    rejectedMissingKeyfile = true;
  }
  if (!rejectedMissingKeyfile) {
    console.error('FAIL: Missing keyfile was not rejected!');
    process.exit(1);
  }
  console.log('PASS: Missing keyfile correctly rejected!');

  // 4c. Wrong Keyfile
  let rejectedWrongKeyfile = false;
  try {
    const wrongKeyfile = sandbox.crypto.getRandomValues(new Uint8Array(32));
    const badKeyfileCreds = new kdbxweb.Credentials(
      kdbxweb.ProtectedValue.fromString(masterPw),
      wrongKeyfile.buffer
    );
    await kdbxweb.Kdbx.load(fileBytes2, badKeyfileCreds);
  } catch (err) {
    rejectedWrongKeyfile = true;
  }
  if (!rejectedWrongKeyfile) {
    console.error('FAIL: Wrong keyfile was not rejected!');
    process.exit(1);
  }
  console.log('PASS: Wrong keyfile correctly rejected!');

  console.log('\n====================================================');
  console.log('All KDBX Real Argon2id Roundtrip & Rejection Tests Passed!');
  console.log('====================================================');
}

runKdbxTests().catch(err => {
  console.error('KDBX Test Suite Failed:', err);
  process.exit(1);
});
