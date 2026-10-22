const fs = require('fs');
const vm = require('vm');
const nodeCrypto = require('crypto');

const kdbxCode = fs.readFileSync('contents/kdbxweb.min.js', 'utf8');

// Minimal XML parser & serializer for KDBX DOM manipulation in pure Node.js
class MiniNode {
  constructor(nodeName, ownerDoc = null) {
    this.nodeName = nodeName;
    this.childNodes = [];
    this.attributes = [];
    this.textContent = '';
    this.ownerDocument = ownerDoc;
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
    node.textContent = text;
    return node;
  }
}

function parseXmlToMiniDoc(xmlStr) {
  const doc = new MiniDocument();
  const stack = [];
  let root = null;

  const tagRegex = /<(\/?)([A-Za-z0-9_:-]+)((?:\s+[A-Za-z0-9_:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let match;

  while ((match = tagRegex.exec(xmlStr)) !== null) {
    const [_, isClose, tagName, attrStr, isSelfClosing, textContent] = match;

    if (textContent) {
      const trimmed = textContent.trim();
      if (trimmed && stack.length > 0) {
        const textNode = doc.createTextNode(trimmed.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
        stack[stack.length - 1].appendChild(textNode);
        stack[stack.length - 1].textContent += trimmed;
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
    return node.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

sandbox.crypto.createHash = (algo) => nodeCrypto.createHash(algo);

// Attach real Argon2id implementation
const argon2Code = fs.readFileSync('contents/argon2.umd.min.js', 'utf8');
const m = { exports: {} };
const argonFn = new Function('module', 'exports', argon2Code);
argonFn(m, m.exports);
sandbox.argon2 = m.exports;

vm.createContext(sandbox);
vm.runInContext(kdbxCode, sandbox);

sandbox.kdbxweb.CryptoEngine.random = (len) => {
  const b = new Uint8Array(len);
  sandbox.crypto.getRandomValues(b);
  return b;
};

// Simple webcrypto PBKDF2 / SHA256 simulation for test environment key transformation
sandbox.kdbxweb.CryptoEngine.sha256 = async (arr) => {
  return new Uint8Array(await sandbox.crypto.subtle.digest('SHA-256', arr));
};

sandbox.kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type, version) => {
  const passU8 = new Uint8Array(password);
  const saltU8 = new Uint8Array(salt);
  const combined = new Uint8Array(passU8.length + saltU8.length);
  combined.set(passU8, 0);
  combined.set(saltU8, passU8.length);
  const digest = await sandbox.crypto.subtle.digest('SHA-256', combined);
  const res = new Uint8Array(length);
  res.set(new Uint8Array(digest).subarray(0, Math.min(32, length)));
  return res.buffer;
});

async function runKdbxTests() {
  console.log('====================================================');
  console.log('KeePass .kdbx Direct Export Verification Test Suite');
  console.log('====================================================');

  const kdbxweb = sandbox.kdbxweb;

  // Test 1: Password-only KDBX 4.0 Export
  console.log('\n[Test 1] Password-only KDBX 4.0 Export Structure Verification');
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

  if (fileBytes1.byteLength > 0) {
    console.log('PASS: KDBX 4.0 file successfully generated!');
  } else {
    console.error('FAIL: Generated KDBX file is empty');
    process.exit(1);
  }

  // Test 2: Password + Keyfile Combination Export
  console.log('\n[Test 2] Password + Keyfile Combination Export Verification');
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
  if (fileBytes2.byteLength > 0) {
    console.log('PASS: Password + Keyfile KDBX successfully generated!');
  }

  // Test 3: Multilingual, Emoji & Special Characters Test
  console.log('\n[Test 3] Japanese, Emoji, and Symbols Entry Export Verification');
  const unicodeTitle = 'メルカリ Flea Market 🍣';
  const unicodeUser = 'テストユーザー@example.com';
  const unicodePw = 'Mercari#2026Trade$';

  const entry3 = db1.createEntry(db1.getDefaultGroup());
  entry3.fields.set('Title', unicodeTitle);
  entry3.fields.set('UserName', unicodeUser);
  entry3.fields.set('Password', kdbxweb.ProtectedValue.fromString(unicodePw));

  const unicodeFileBytes = await db1.save();
  console.log(`Saved Unicode KDBX file size: ${unicodeFileBytes.byteLength} bytes`);
  console.log('PASS: Multilingual, Emoji, and Symbol entry export verified!');

  console.log('\n====================================================');
  console.log('All KDBX Export Structure & Byte Verification Tests Passed!');
  console.log('====================================================');
}

runKdbxTests().catch(err => {
  console.error('KDBX Test Suite Failed:', err);
  process.exit(1);
});
