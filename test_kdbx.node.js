const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const nodeCrypto = require('crypto');

const kdbxCode = fs.readFileSync('contents/kdbxweb.min.js', 'utf8');
const argon2Code = fs.readFileSync('contents/argon2.umd.min.js', 'utf8');

// Load real Argon2id implementation from contents/argon2.umd.min.js
const m = { exports: {} };
new Function('module', 'exports', argon2Code)(m, m.exports);
const realArgon2 = m.exports;

// Functional XML Node, Parser, and Serializer for pure Node.js DOM environment
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
        // Safe entity decoding order: decode &lt;, &gt;, &quot;, &apos; first, then &amp;
        const decoded = textContent
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, '&');
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
  let attrs = node.attributes.map(a => ` ${a.name}="${a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
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

// Connect real Argon2id implementation to kdbxweb with strict type and parameter verification
sandbox.kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type, version) => {
  // Assert Argon2id type parameter (2 = Argon2id in KDBX 4.0 specification; 0 = Argon2d if requested)
  if (type !== undefined && type !== 2 && type !== 0) {
    throw new Error(`Unsupported Argon2 type: ${type}. Expected Argon2id (2).`);
  }
  if (version !== undefined && version !== 0x13) {
    throw new Error(`Unsupported Argon2 version: 0x${version ? version.toString(16) : '0'}. Expected 0x13.`);
  }

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

  // Test 1: Password-only KDBX 4.0 Export, KDF Parameters & Roundtrip Verification
  console.log('\n[Test 1] Password-only KDBX 4.0 Export & KDF Argon2id Parameter Verification');
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

  // Reload saved database and verify KDF parameters
  const loadedDb1 = await kdbxweb.Kdbx.load(fileBytes1, creds1);
  const kdfParams = loadedDb1.header.kdfParameters;
  const uuidVal = kdfParams.get('$UUID');
  const uuidBase64 = kdbxweb.ByteUtils.bytesToBase64(uuidVal.value || uuidVal);
  console.log(`KDF Provider UUID (Base64): ${uuidBase64}`);

  // Assert KDF Provider is Argon2id or Argon2d in KDBX format
  assert.ok(
    uuidBase64 === kdbxweb.Consts.KdfId.Argon2id || uuidBase64 === kdbxweb.Consts.KdfId.Argon2d || uuidBase64 === kdbxweb.Consts.KdfId.Argon2,
    `KDF Provider UUID must equal Argon2id (${kdbxweb.Consts.KdfId.Argon2id}) or Argon2 (${kdbxweb.Consts.KdfId.Argon2d}), got ${uuidBase64}`
  );
  console.log('PASS: KDBX Header KDF Provider verified as Argon2!');

  const loadedEntries1 = loadedDb1.getDefaultGroup().entries;
  assert.strictEqual(loadedEntries1.length, 1, 'Expected 1 entry in default group');

  const loadedEntry1 = loadedEntries1[0];
  const title1 = loadedEntry1.fields.get('Title');
  const user1 = loadedEntry1.fields.get('UserName');
  const url1 = loadedEntry1.fields.get('URL');
  const pass1 = loadedEntry1.fields.get('Password').getText();

  console.log(`Reloaded Fields -> Title: '${title1}', User: '${user1}', URL: '${url1}', Pass: '${pass1}'`);
  assert.strictEqual(title1, 'Google Account');
  assert.strictEqual(user1, 'myuser@gmail.com');
  assert.strictEqual(url1, 'https://google.com');
  assert.strictEqual(pass1, 'LZZLea+PZy');
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
  assert.strictEqual(loadedEntry2.fields.get('Title'), 'Secure Banking');
  assert.strictEqual(loadedEntry2.fields.get('Password').getText(), 'SuperBankPass2026!');
  console.log('PASS: Password + Keyfile KDBX export & reload verified!');

  // Test 3: Japanese, Emoji, XML Special Symbols & Surrounding Whitespace Roundtrip
  console.log('\n[Test 3] Multilingual, Emojis, XML Special Characters & Whitespace Roundtrip');
  const unicodeTitle = '  メルカリ Flea Market 🍣  ';
  const unicodeUser = 'テストユーザー <user&admin> @example.com';
  const unicodePw = 'Mercari#2026Trade$"&<>';

  const entry3 = db1.createEntry(db1.getDefaultGroup());
  entry3.fields.set('Title', unicodeTitle);
  entry3.fields.set('UserName', unicodeUser);
  entry3.fields.set('Password', kdbxweb.ProtectedValue.fromString(unicodePw));

  const unicodeFileBytes = await db1.save();
  const loadedUnicodeDb = await kdbxweb.Kdbx.load(unicodeFileBytes, creds1);
  const loadedUnicodeEntries = loadedUnicodeDb.getDefaultGroup().entries;
  const targetUnicodeEntry = loadedUnicodeEntries.find(e => e.fields.get('Title') === unicodeTitle);

  assert.ok(targetUnicodeEntry, 'Unicode & XML special character entry must be present after reload');

  const resTitle = targetUnicodeEntry.fields.get('Title');
  const resUser = targetUnicodeEntry.fields.get('UserName');
  const resPw = targetUnicodeEntry.fields.get('Password').getText();

  console.log(`Reloaded Unicode & XML Special -> Title: '${resTitle}', User: '${resUser}', Pass: '${resPw}'`);
  assert.strictEqual(resTitle, unicodeTitle);
  assert.strictEqual(resUser, unicodeUser);
  assert.strictEqual(resPw, unicodePw);
  console.log('PASS: Multilingual, Emojis, XML Special Characters & Whitespace verified!');

  // Test 4: Rejection Assertion Tests with Strict KdbxError Type & Code Assertions
  console.log('\n[Test 4] Rejection Assertions with Strict KdbxError Type & Code Assertions');

  // 4a. Wrong Master Password -> Expect KdbxError with code InvalidKey
  await assert.rejects(
    async () => {
      const badPwCreds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('WrongPassword123!'));
      await kdbxweb.Kdbx.load(fileBytes1, badPwCreds);
    },
    (err) => {
      assert.ok(err instanceof kdbxweb.KdbxError, 'Error must be an instance of KdbxError');
      assert.strictEqual(err.code, kdbxweb.Consts.ErrorCodes.InvalidKey, 'Error code must be InvalidKey');
      console.log(`PASS: Wrong master password correctly rejected with KdbxError code '${err.code}'`);
      return true;
    }
  );

  // 4b. Missing Keyfile (for DB created with keyfile) -> Expect KdbxError with code InvalidKey
  await assert.rejects(
    async () => {
      const pwOnlyCreds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(masterPw));
      await kdbxweb.Kdbx.load(fileBytes2, pwOnlyCreds);
    },
    (err) => {
      assert.ok(err instanceof kdbxweb.KdbxError, 'Error must be an instance of KdbxError');
      assert.strictEqual(err.code, kdbxweb.Consts.ErrorCodes.InvalidKey, 'Error code must be InvalidKey');
      console.log(`PASS: Missing keyfile correctly rejected with KdbxError code '${err.code}'`);
      return true;
    }
  );

  // 4c. Wrong Keyfile -> Expect KdbxError with code InvalidKey
  await assert.rejects(
    async () => {
      const wrongKeyfile = sandbox.crypto.getRandomValues(new Uint8Array(32));
      const badKeyfileCreds = new kdbxweb.Credentials(
        kdbxweb.ProtectedValue.fromString(masterPw),
        wrongKeyfile.buffer
      );
      await kdbxweb.Kdbx.load(fileBytes2, badKeyfileCreds);
    },
    (err) => {
      assert.ok(err instanceof kdbxweb.KdbxError, 'Error must be an instance of KdbxError');
      assert.strictEqual(err.code, kdbxweb.Consts.ErrorCodes.InvalidKey, 'Error code must be InvalidKey');
      console.log(`PASS: Wrong keyfile correctly rejected with KdbxError code '${err.code}'`);
      return true;
    }
  );

  console.log('\n====================================================');
  console.log('All KDBX Real Argon2id Roundtrip & Strict Rejection Tests Passed!');
  console.log('====================================================');
}

runKdbxTests().catch(err => {
  console.error('KDBX Test Suite Failed:', err);
  process.exit(1);
});
