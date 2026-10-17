/**
 * Crypto Matrix - 暗号マトリックス ＆ マイ・レシピ管理 (BIP39 24単語)
 */

const constMaxTileCount = 40;

const CENTER_CHARS = [
  '0', '1', '2', '3', '4', '5', '6', '7',
  '8', '9', 'a', 'b', 'c', 'd', 'e', 'f',
  'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n',
  'o', 'p', 'q', 'r', 's', 't', 'u', 'v',
  'w', 'x', 'y', 'z', '^', '%', '/', '-'
];

const ALL_ASCII_SYMBOLS = '!#$%&()*+-/:;=?@^_"`,.<>[\\]{|}~\'';

// 線形合同法＆浮動小数点除算による乱数生成器
class LinearCongruentialGenerator {
  constructor(seed) {
    this.seed = (Number(seed) >>> 0) || 0;
  }
  next() {
    this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
    return this.seed / 4294967296; // m = 2^32
  }
  intRange(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

class Random {
  constructor(seed) {
    this.generator = new LinearCongruentialGenerator(seed);
  }
  rand() {
    return this.generator.next();
  }
  intRange(min, max) {
    return this.generator.intRange(min, max);
  }
}

class Number1D {
  static shuffle(array, random) {
    const res = array.slice();
    for (let i = res.length - 1; i > 0; i--) {
      const j = Math.floor(random.rand() * (i + 1));
      const tmp = res[i];
      res[i] = res[j];
      res[j] = tmp;
    }
    return res;
  }
  static repeatArray(a, n) {
    const res = [];
    for (let i = 0; i < n; i++) {
      res.push(...a);
    }
    return res;
  }
  static filledOverMaxTile(a, max) {
    const len = a.length;
    const count = Math.ceil(max / len);
    return Number1D.repeatArray(a, count);
  }
}

let currentMatrixData = [];
let currentEvalSteps = [];
let traceTimer = null;
let currentMnemonicWords = [];
let bip39Wordlist = null;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function parseSeedValue(raw) {
  const s = String(raw || '0').trim();
  if (/^\d+$/.test(s)) return (parseInt(s, 10) >>> 0) || 0;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * マトリックス配列を生成
 */
function updateMainMatrix(seedValue) {
  const seedNum = parseSeedValue(seedValue);
  const random = new Random(seedNum);

  const alphabetLower = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const alphabetUpper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const numberCharacters = '0123456789'.split('');
  const symbolCharacters = ["-", "_", "!", "#", "$", "%", "&", "^", "(", ")", "+", "*", "/"];

  // コードの生成順序（記号から4種選抜 → rootCharacters構築 → 各配列生成＆シャッフル）
  const symbolCharacters4 = Number1D.shuffle(symbolCharacters, random).slice(0, 4);
  const rootCharacters = [].concat(numberCharacters, alphabetLower, symbolCharacters4);

  const numberCharactersFilled = Number1D.filledOverMaxTile(numberCharacters, constMaxTileCount);
  const numberCharactersShuffled = Number1D.shuffle(numberCharactersFilled, random);

  const alphabetNumberCharactersFilled = Number1D.filledOverMaxTile([].concat(numberCharacters, alphabetLower, alphabetUpper), constMaxTileCount);
  const alphabetNumberCharactersShuffled = Number1D.shuffle(alphabetNumberCharactersFilled, random);

  const alphabetNumberSymbolCharactersFilled = Number1D.filledOverMaxTile([].concat(numberCharacters, alphabetLower, alphabetUpper, symbolCharacters), constMaxTileCount);
  const alphabetNumberSymbolCharactersShuffled = Number1D.shuffle(alphabetNumberSymbolCharactersFilled, random);

  const correspondenceCharactersFilled = Number1D.filledOverMaxTile(rootCharacters, constMaxTileCount);
  const correspondenceCharactersShuffled = Number1D.shuffle(correspondenceCharactersFilled, random);

  currentMatrixData = [];
  const container = document.getElementById('div-encrypto-matrix-main');
  if (!container) return;
  container.innerHTML = '';

  for (let i = 0; i < constMaxTileCount; i++) {
    const item = {
      index: i,
      center: CENTER_CHARS[i],
      tl: numberCharactersShuffled[i],
      tr: alphabetNumberCharactersShuffled[i],
      bl: alphabetNumberSymbolCharactersShuffled[i],
      br: correspondenceCharactersShuffled[i]
    };
    currentMatrixData.push(item);

    const sq = document.createElement('div');
    sq.className = 'square';
    sq.dataset.index = i;
    sq.innerHTML = `
      <span class="center-text" data-spot="center">${escapeHtml(item.center)}</span>
      <span class="corner-text top-left" data-spot="tl">${escapeHtml(item.tl)}</span>
      <span class="corner-text top-right" data-spot="tr">${escapeHtml(item.tr)}</span>
      <span class="corner-text bottom-left" data-spot="bl">${escapeHtml(item.bl)}</span>
      <span class="corner-text bottom-right" data-spot="br">${escapeHtml(item.br)}</span>
    `;
    container.appendChild(sq);
  }

  updateVerbalGuide(getRecipeConfig());
}

function findTileIndex(ch) {
  if (!ch) return 0;
  const idx = CENTER_CHARS.indexOf(ch.toLowerCase());
  return idx !== -1 ? idx : (ch.charCodeAt(0) % constMaxTileCount);
}

function shiftTileIndex(baseIdx, dirMode, nVal, mVal, stepIdx) {
  let r = Math.floor(baseIdx / 8);
  let c = baseIdx % 8;
  const n = Math.max(0, Number(nVal) || 0);
  const m = Math.max(0, Number(mVal) || 0);

  const moveRC = (dr, dc) => {
    r = ((r + dr) % 5 + 5) % 5;
    c = ((c + dc) % 8 + 8) % 8;
  };

  switch (Number(dirMode)) {
    case 1: moveRC(0, n); break;
    case 2: moveRC(0, -n); break;
    case 3: moveRC(n, 0); break;
    case 4: moveRC(-n, 0); break;
    case 5: moveRC(n, n); break;
    case 6: moveRC(n, -n); break;
    case 7: moveRC(-n, n); break;
    case 8: moveRC(-n, -n); break;
    case 9: moveRC(m, n); break;
    case 10: (stepIdx % 2 === 0) ? moveRC(0, n) : moveRC(m, 0); break;
    case 11: (stepIdx % 2 === 0) ? moveRC(0, -n) : moveRC(-m, 0); break;
    case 12: {
      const dirs = [[-n, 0], [0, n], [n, 0], [0, -n]];
      const [dr, dc] = dirs[stepIdx % 4];
      moveRC(dr, dc);
      break;
    }
    case 13: {
      const dirs = [[-n, n], [n, n], [n, -n], [-n, -n]];
      const [dr, dc] = dirs[stepIdx % 4];
      moveRC(dr, dc);
      break;
    }
  }
  return r * 8 + c;
}

function getCornersSequence(baseCornerMode, pickPattern, stepIdx) {
  const cw = ['tl', 'tr', 'br', 'bl'];
  const ccw = ['tl', 'bl', 'br', 'tr'];
  const mapBase = ['bl', 'br', 'tr', 'tl'];

  let base = 'bl';
  switch (Number(baseCornerMode)) {
    case 0: case 1: case 2: case 3:
      base = mapBase[baseCornerMode]; break;
    case 4: base = cw[stepIdx % 4]; break;
    case 5: base = ccw[stepIdx % 4]; break;
    case 6: base = (stepIdx % 2 === 0) ? 'bl' : 'tr'; break;
    case 7: base = (stepIdx % 2 === 0) ? 'bl' : 'br'; break;
    case 8: base = (stepIdx % 2 === 0) ? 'tl' : 'bl'; break;
    case 9: base = (stepIdx % 2 === 0) ? 'tl' : 'tr'; break;
  }

  const cwIdx = cw.indexOf(base);
  const ccwIdx = ccw.indexOf(base);
  const rotCW = count => Array.from({ length: count }, (_, i) => cw[(cwIdx + i) % 4]);
  const rotCCW = count => Array.from({ length: count }, (_, i) => ccw[(ccwIdx + i) % 4]);

  switch (Number(pickPattern)) {
    case 0: return [base];
    case 1: return rotCW(2);
    case 2: return rotCCW(2);
    case 3: return [base, cw[(cwIdx + 2) % 4]];
    case 4: return (base === 'tr' || base === 'br') ? ['tr', 'br'] : ['tl', 'bl'];
    case 5: return (base === 'tr' || base === 'br') ? ['br', 'tr'] : ['bl', 'tl'];
    case 6: return (base === 'tl' || base === 'tr') ? ['tl', 'tr'] : ['bl', 'br'];
    case 7: return (base === 'tl' || base === 'tr') ? ['tr', 'tl'] : ['br', 'bl'];
    case 8: return [base, 'center'];
    case 9: return ['center', base];
    case 10: return rotCW(3);
    case 11: return rotCCW(3);
    case 12: return rotCW(4);
    case 13: return rotCCW(4);
    case 14: return ['tl', 'tr', 'bl', 'br'];
    case 15: return ['tr', 'tl', 'br', 'bl'];
    case 16: return ['bl', 'tl', 'br', 'tr'];
    case 17: return ['tl', 'br', 'tr', 'bl'];
    default: return [base];
  }
}

function getSaltCorners(patternId) {
  switch (Number(patternId)) {
    case 0: return ['tl', 'tr', 'br', 'bl'];
    case 1: return ['tl', 'bl', 'br', 'tr'];
    case 2: return ['bl', 'tl', 'tr', 'br'];
    case 3: return ['br', 'tr', 'tl', 'bl'];
    case 4: return ['tl', 'tr', 'bl', 'br'];
    case 5: return ['tl', 'br', 'tr', 'bl'];
    case 6: return ['tl', 'bl'];
    case 7: return ['tr', 'br'];
    case 8: return ['tl', 'tr'];
    case 9: return ['bl', 'br'];
    case 10: return ['tl', 'br'];
    case 11: return ['tr', 'bl'];
    case 12: return ['bl'];
    case 13: return ['tl'];
    default: return ['tl', 'tr', 'br', 'bl'];
  }
}

function isSymbolAllowed(ch, symMode, symListStr) {
  if (/^[0-9a-zA-Z]$/.test(ch)) return true;
  const mode = Number(symMode);
  if (mode === 0) return true;
  if (mode === 3) return false;
  const inList = symListStr.includes(ch);
  return mode === 1 ? !inList : inList;
}

function pickSingleCharWithFallback(tileIdx, corner, label, cfg) {
  const spotNames = { tl: '左上', tr: '右上', bl: '左下', br: '右下', center: '中央' };
  const baseTile = currentMatrixData[tileIdx] || currentMatrixData[0];
  const rawChar = baseTile[corner] !== undefined ? baseTile[corner] : baseTile.bl;

  if (isSymbolAllowed(rawChar, cfg.symMode, cfg.symList)) {
    return { ch: rawChar, tileIdx, corner, isFallback: false, log: `${label}: マス[${baseTile.center}]の${spotNames[corner]} ➔ '${rawChar}'` };
  }

  const cw = ['tl', 'tr', 'br', 'bl'];
  const ccw = ['tl', 'bl', 'br', 'tr'];
  const fbDir = Number(cfg.symFbDir);
  const fbDist = Math.max(1, Number(cfg.symFbDist) || 1);
  const fbCornerMode = Number(cfg.symFbCorner);

  if (fbDir === 0 || fbDir === 1) {
    const order = fbDir === 0 ? cw : ccw;
    const start = Math.max(0, order.indexOf(corner));
    for (let s = 1; s < 4; s++) {
      const nextC = order[(start + s) % 4];
      const cand = baseTile[nextC];
      if (isSymbolAllowed(cand, cfg.symMode, cfg.symList)) {
        return { ch: cand, tileIdx, corner: nextC, isFallback: true, log: `${label}: 禁止記号 ➔ 同マス${spotNames[nextC]}'${cand}'へ代替` };
      }
    }
  } else if (fbDir === 2) {
    const cand = baseTile.tr;
    return { ch: cand, tileIdx, corner: 'tr', isFallback: true, log: `${label}: 禁止記号 ➔ 同マス右上'${cand}'へ代替` };
  }

  const dirMap = { 0: 1, 1: 2, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8 };
  const shiftDirCode = dirMap[fbDir] || 1;

  let targetCorner = corner === 'center' ? 'bl' : corner;
  if (fbCornerMode === 1) targetCorner = cw[(cw.indexOf(targetCorner) + 1) % 4];
  else if (fbCornerMode === 2) targetCorner = 'bl';
  else if (fbCornerMode === 3) targetCorner = 'br';
  else if (fbCornerMode === 4) targetCorner = 'tr';

  for (let hop = 1; hop <= 40; hop++) {
    const dist = hop * fbDist;
    const nextIdx = shiftTileIndex(tileIdx, shiftDirCode, dist, dist, hop);
    const nextTile = currentMatrixData[nextIdx];
    const cand = nextTile[targetCorner];
    if (isSymbolAllowed(cand, cfg.symMode, cfg.symList)) {
      return { ch: cand, tileIdx: nextIdx, corner: targetCorner, isFallback: true, log: `${label}: 禁止記号 ➔ ${dist}マス移動しマス[${nextTile.center}]${spotNames[targetCorner]}'${cand}'へ代替` };
    }
  }

  return { ch: baseTile.tr, tileIdx, corner: 'tr', isFallback: true, log: `${label}: 禁止記号代替 ➔ マス[${baseTile.center}]右上'${baseTile.tr}'` };
}

function getRecipeConfig() {
  const val = id => Number(document.getElementById(id)?.value) || 0;
  return {
    kwOrder: val('rc-kw-order'),
    kwFilter: val('rc-kw-filter'),
    kwNum: Math.min(63, Math.max(1, val('rc-kw-num') || 4)),
    shiftDir: val('rc-shift-dir'),
    shiftN: Math.min(63, Math.max(0, val('rc-shift-n'))),
    shiftM: Math.min(63, Math.max(0, val('rc-shift-m'))),
    baseCorner: val('rc-base-corner'),
    pickPattern: val('rc-pick-pattern'),
    symMode: val('rc-sym-mode'),
    symList: document.getElementById('rc-sym-list')?.value || '',
    symFbDir: val('rc-sym-fb-dir'),
    symFbDist: Math.min(39, Math.max(1, val('rc-sym-fb-dist') || 1)),
    symFbCorner: val('rc-sym-fb-corner'),
    preTarget: val('rc-pre-target'),
    prePattern: val('rc-pre-pattern'),
    preOffset: Math.min(63, Math.max(0, val('rc-pre-offset'))),
    sufTarget: val('rc-suf-target'),
    sufPattern: val('rc-suf-pattern'),
    sufOffset: Math.min(63, Math.max(0, val('rc-suf-offset'))),
    ancTile: Math.min(39, Math.max(0, val('rc-anc-tile'))),
    ancMode: val('rc-anc-mode'),
    ancPos: Math.min(63, Math.max(0, val('rc-anc-pos'))),
    postMode: val('rc-post-mode'),
    lenMode: val('rc-len-mode'),
    lenVal: Math.min(128, Math.max(1, val('rc-len-val') || 16))
  };
}

function setRecipeConfig(cfg) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('rc-kw-order', cfg.kwOrder ?? 1);
  set('rc-kw-filter', cfg.kwFilter ?? 0);
  set('rc-kw-num', cfg.kwNum ?? 4);
  set('rc-shift-dir', cfg.shiftDir ?? 0);
  set('rc-shift-n', cfg.shiftN ?? 1);
  set('rc-shift-m', cfg.shiftM ?? 1);
  set('rc-base-corner', cfg.baseCorner ?? 0);
  set('rc-pick-pattern', cfg.pickPattern ?? 0);
  set('rc-sym-mode', cfg.symMode ?? 0);
  set('rc-sym-list', cfg.symList ?? '');
  set('rc-sym-fb-dir', cfg.symFbDir ?? 0);
  set('rc-sym-fb-dist', cfg.symFbDist ?? 1);
  set('rc-sym-fb-corner', cfg.symFbCorner ?? 0);
  set('rc-pre-target', cfg.preTarget ?? 0);
  set('rc-pre-pattern', cfg.prePattern ?? 0);
  set('rc-pre-offset', cfg.preOffset ?? 0);
  set('rc-suf-target', cfg.sufTarget ?? 1);
  set('rc-suf-pattern', cfg.sufPattern ?? 0);
  set('rc-suf-offset', cfg.sufOffset ?? 0);
  set('rc-anc-tile', cfg.ancTile ?? 0);
  set('rc-anc-mode', cfg.ancMode ?? 0);
  set('rc-anc-pos', cfg.ancPos ?? 4);
  set('rc-post-mode', cfg.postMode ?? 0);
  set('rc-len-mode', cfg.lenMode ?? 0);
  set('rc-len-val', cfg.lenVal ?? 16);
}

/**
 * 選択中のレシピ設定をマトリックス上部の説明欄に反映
 */
function updateVerbalGuide(cfg) {
  const listEl = document.getElementById('verbal-recipe-steps');
  if (!listEl) return;

  const orderTexts = [
    "サイト名のみを使用する", "サイト名 ＋ 合言葉 を連結する", "合言葉 ＋ サイト名 を連結する",
    "サイト名と合言葉を1文字ずつ交互に配置する", "合言葉とサイト名を1文字ずつ交互に配置する",
    "サイト名前半 ＋ 合言葉 ＋ サイト名後半を挟み込む", "合言葉前半 ＋ サイト名 ＋ 合言葉後半を挟み込む",
    "サイト名を逆順にしてから合言葉を連結する", "サイト名に合言葉を逆順で連結する", "全体（サイト名＋合言葉）を逆順にする"
  ];

  const shiftTexts = [
    "シフトなし（探したマスの文字をそのまま読む）", `右へ ${cfg.shiftN} マス移動したマスを読む`,
    `左へ ${cfg.shiftN} マス移動したマスを読む`, `下へ ${cfg.shiftN} マス移動したマスを読む`,
    `上へ ${cfg.shiftN} マス移動したマスを読む`, `右下斜めへ ${cfg.shiftN} マス移動したマスを読む`,
    `左下斜めへ ${cfg.shiftN} マス移動したマスを読む`, `右上斜めへ ${cfg.shiftN} マス移動したマスを読む`,
    `左上斜めへ ${cfg.shiftN} マス移動したマスを読む`, `カスタム座標（横${cfg.shiftN} 縦${cfg.shiftM}）移動したマスを読む`,
    `1文字ごとに「右${cfg.shiftN}」と「下${cfg.shiftM}」を交互に移動`, `1文字ごとに「左${cfg.shiftN}」と「上${cfg.shiftM}」を交互に移動`,
    `時計回り4方向へ ${cfg.shiftN} マス移動`, `斜め4方向へ ${cfg.shiftN} マス移動`
  ];

  const cornerTexts = [
    "左下（英大小・数字・記号）", "右下（英小・数字・記号）", "右上（英大小・数字）", "左上（数字のみ）",
    "時計回りで基準角を1文字ずつ移動", "反時計回りで基準角を1文字ずつ移動",
    "「左下」と「右上」を1文字ずつ交互に切り替え", "「左下」と「右下」を1文字ずつ交互に切り替え",
    "「左上」と「左下」を1文字ずつ交互に切り替え", "「左上」と「右上」を1文字ずつ交互に切り替え"
  ];

  const pickTexts = [
    "基準の角の1文字のみ", "基準角 → 時計回りに次の角（計2文字）", "基準角 → 反時計回りに次の角（計2文字）",
    "基準角 → 対角の角（計2文字）", "縦ペア（上 → 下、計2文字）", "縦ペア（下 → 上、計2文字）",
    "横ペア（左 → 右、計2文字）", "横ペア（右 → 左、計2文字）", "基準角 ＋ 中央の大文字（計2文字）",
    "中央の大文字 ＋ 基準角（計2文字）", "基準角から時計回りに3つの角", "基準角から反時計回りに3つの角",
    "基準角から時計回りに四隅を一周（4文字）", "基準角から反時計回りに四隅を一周（4文字）",
    "Z字順（左上→右上→左下→右下、4文字）", "逆Z字順（4文字）", "N字順（4文字）", "クロス対角順（4文字）"
  ];

  let html = `<li>1. キーワード構築： <span class="verbal-highlight">${orderTexts[cfg.kwOrder] || ''}</span>`;
  if (cfg.kwFilter > 0) {
    const fTexts = ["", `先頭から${cfg.kwNum}文字`, `末尾から${cfg.kwNum}文字`, `先頭${cfg.kwNum}＋末尾${cfg.kwNum}文字`, `${cfg.kwNum}文字おきに抽出`, "重複文字を除外", "母音を除外"];
    html += `（抽出: ${fTexts[cfg.kwFilter]}）`;
  }
  html += `</li>`;

  html += `<li>2. マス目移動： <span class="verbal-highlight">${shiftTexts[cfg.shiftDir] || ''}</span></li>`;
  html += `<li>3. 読み取り角 ＆ 取得数： 基準角は <span class="verbal-highlight">${cornerTexts[cfg.baseCorner]}</span>、1マスからは <span class="verbal-highlight">${pickTexts[cfg.pickPattern]}</span> を取得する</li>`;

  if (cfg.symMode > 0) {
    const sm = ["", "ブラックリスト", "ホワイトリスト", "全記号禁止"][cfg.symMode];
    html += `<li>4. 記号制限： <span class="verbal-highlight">${sm}</span>（代替方向設定済み・自動回避）</li>`;
  }

  if (cfg.preTarget > 0) html += `<li>5. 前ソルト（先頭追加）： 指定マスから四隅なぞりを先頭に付与</li>`;
  if (cfg.sufTarget > 0) html += `<li>6. 後ソルト（末尾追加）： 指定マスから四隅なぞりを末尾に付与</li>`;
  if (cfg.ancMode > 0) html += `<li>7. 起点マス（アンカー）： 指定マスをパスワード内の任意位置に挿入</li>`;

  if (cfg.lenMode > 0) {
    const lm = cfg.lenMode === 1 ? `先頭から ${cfg.lenVal}文字` : `末尾から ${cfg.lenVal}文字`;
    html += `<li>8. 文字数切り出し： 完成した文字列を <span class="verbal-highlight">${lm}</span> に揃える</li>`;
  }

  listEl.innerHTML = html;
}

function evaluateRecipeSteps(siteRaw, secretRaw, cfg) {
  const site = (siteRaw || 'amazon').trim() || 'a';
  const secret = (secretRaw || 'taro').trim() || 't';

  let combined = '';
  switch (cfg.kwOrder) {
    case 0: combined = site; break;
    case 1: combined = site + secret; break;
    case 2: combined = secret + site; break;
    case 3:
    case 4: {
      const a = cfg.kwOrder === 3 ? site : secret;
      const b = cfg.kwOrder === 3 ? secret : site;
      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i++) {
        if (i < a.length) combined += a[i];
        if (i < b.length) combined += b[i];
      }
      break;
    }
    case 5: {
      const h = Math.ceil(site.length / 2);
      combined = site.slice(0, h) + secret + site.slice(h);
      break;
    }
    case 6: {
      const h = Math.ceil(secret.length / 2);
      combined = secret.slice(0, h) + site + secret.slice(h);
      break;
    }
    case 7: combined = site.split('').reverse().join('') + secret; break;
    case 8: combined = site + secret.split('').reverse().join(''); break;
    case 9: combined = (site + secret).split('').reverse().join(''); break;
    default: combined = site + secret;
  }

  let kwChars = combined.split('');
  const n = Math.max(1, cfg.kwNum);
  switch (cfg.kwFilter) {
    case 1: kwChars = kwChars.slice(0, n); break;
    case 2: kwChars = kwChars.slice(-n); break;
    case 3: kwChars = [...kwChars.slice(0, n), ...kwChars.slice(-n)]; break;
    case 4: kwChars = kwChars.filter((_, i) => i % n === 0); break;
    case 5: kwChars = [...new Set(kwChars)]; break;
    case 6: {
      const noVowel = kwChars.filter(c => !/[aiueoAIUEO]/.test(c));
      if (noVowel.length > 0) kwChars = noVowel;
      break;
    }
  }

  let steps = [];
  const pushTileCorners = (tileIdx, corners, labelPrefix) => {
    corners.forEach((c, idx) => {
      const subLabel = corners.length > 1 ? `${labelPrefix}(${idx + 1}/${corners.length})` : labelPrefix;
      steps.push(pickSingleCharWithFallback(tileIdx, c, subLabel, cfg));
    });
  };

  const resolveSaltTiles = (targetMode, offsetVal) => {
    const off = Number(offsetVal) || 0;
    const wrap = idx => ((idx + off) % constMaxTileCount + constMaxTileCount) % constMaxTileCount;
    switch (Number(targetMode)) {
      case 1: return [wrap(findTileIndex(site[0]))];
      case 2: return [wrap(findTileIndex(site[site.length - 1]))];
      case 3: return [wrap(findTileIndex(secret[0]))];
      case 4: return [wrap(findTileIndex(secret[secret.length - 1]))];
      case 5: return [wrap((targetMode === 5 ? site.length : secret.length) % 10)];
      case 6: return [0, 7, 39, 32].map(wrap);
      case 7: return [off % constMaxTileCount];
      default: return [];
    }
  };

  if (cfg.preTarget > 0) {
    const tiles = resolveSaltTiles(cfg.preTarget, cfg.preOffset);
    const corners = getSaltCorners(cfg.prePattern);
    tiles.forEach(tIdx => pushTileCorners(tIdx, corners, '前ソルト'));
  }

  if (cfg.ancMode === 2) {
    pushTileCorners(cfg.ancTile, ['tl', 'bl', 'br', 'tr'], 'アンカー先頭');
  } else if (cfg.ancMode === 3) {
    pushTileCorners(cfg.ancTile, ['tl', 'tr'], 'アンカー先頭挟み');
  }

  kwChars.forEach((ch, idx) => {
    const baseIdx = findTileIndex(ch);
    const shiftedIdx = shiftTileIndex(baseIdx, cfg.shiftDir, cfg.shiftN, cfg.shiftM, idx);
    const corners = getCornersSequence(cfg.baseCorner, cfg.pickPattern, idx);
    const tag = shiftedIdx !== baseIdx ? `キーワード'${ch}'(移動先)` : `キーワード'${ch}'`;
    pushTileCorners(shiftedIdx, corners, tag);
  });

  if (cfg.sufTarget > 0) {
    const tiles = resolveSaltTiles(cfg.sufTarget, cfg.sufOffset);
    const corners = getSaltCorners(cfg.sufPattern);
    tiles.forEach(tIdx => pushTileCorners(tIdx, corners, '後ソルト'));
  }

  if (cfg.ancMode === 1) {
    pushTileCorners(cfg.ancTile, ['tl', 'tr', 'br', 'bl'], 'アンカー末尾');
  } else if (cfg.ancMode === 3) {
    pushTileCorners(cfg.ancTile, ['bl', 'br'], 'アンカー末尾挟み');
  } else if (cfg.ancMode === 4 || cfg.ancMode === 5 || cfg.ancMode === 6) {
    const ancCorners = cfg.ancMode === 6 ? ['tl', 'br'] : ['tl', 'tr', 'br', 'bl'];
    const ancSteps = ancCorners.map((c, i) =>
      pickSingleCharWithFallback(cfg.ancTile, c, `アンカー挿入(${i + 1}/${ancCorners.length})`, cfg)
    );
    const pos = cfg.ancMode === 4 ? Math.floor(steps.length / 2) : Math.min(steps.length, cfg.ancPos);
    steps.splice(pos, 0, ...ancSteps);
  }

  if (cfg.postMode === 1) {
    steps.reverse();
  } else if (cfg.postMode === 2 && steps.length >= 2) {
    const half = Math.floor(steps.length / 2);
    steps = [...steps.slice(half), ...steps.slice(0, half)];
  } else if (cfg.postMode === 3 && steps.length >= 2) {
    const first = steps[0];
    steps[0] = steps[steps.length - 1];
    steps[steps.length - 1] = first;
  } else if (cfg.postMode === 4 && steps.length >= 2) {
    for (let i = 0; i + 1 < steps.length; i += 2) {
      const tmp = steps[i];
      steps[i] = steps[i + 1];
      steps[i + 1] = tmp;
    }
  }

  if (cfg.lenMode === 1) {
    steps = steps.slice(0, cfg.lenVal);
  } else if (cfg.lenMode === 2) {
    steps = steps.slice(-cfg.lenVal);
  }

  return steps;
}

function updateSimulationUI() {
  stopMatrixTrace();
  const cfg = getRecipeConfig();
  const site = document.getElementById('sim-site')?.value || 'amazon';
  const secret = document.getElementById('sim-secret')?.value || 'taro';
  currentEvalSteps = evaluateRecipeSteps(site, secret, cfg);

  const pwBox = document.getElementById('sim-output-pw');
  if (pwBox) {
    pwBox.innerHTML = currentEvalSteps.map((st, i) =>
      `<span class="pw-char-span" data-step="${i}">${escapeHtml(st.ch)}</span>`
    ).join('');
  }

  const fallbackCount = currentEvalSteps.filter(s => s.isFallback).length;
  const metaEl = document.getElementById('sim-output-meta');
  if (metaEl) {
    metaEl.textContent = `総文字数: ${currentEvalSteps.length}文字 （記号代替発動: ${fallbackCount}箇所）`;
  }

  const logEl = document.getElementById('sim-trace-log');
  if (logEl) {
    logEl.innerHTML = currentEvalSteps.map((st, i) =>
      `<div class="trace-line" data-step="${i}">[${String(i + 1).padStart(2, '0')}] ${escapeHtml(st.log)}</div>`
    ).join('');
  }

  updateVerbalGuide(cfg);
}

function playMatrixTrace() {
  stopMatrixTrace();
  if (!currentEvalSteps || currentEvalSteps.length === 0) return;

  const speed = Number(document.getElementById('sim-speed')?.value) || 450;
  const squares = document.querySelectorAll('#div-encrypto-matrix-main .square');
  const pwSpans = document.querySelectorAll('#sim-output-pw .pw-char-span');
  const logLines = document.querySelectorAll('#sim-trace-log .trace-line');
  const banner = document.getElementById('sim-step-banner');

  document.getElementById('btn-play-trace').style.display = 'none';
  document.getElementById('btn-stop-trace').style.display = 'inline-block';

  let idx = 0;

  const showStep = (stepIndex) => {
    clearHighlightsOnly();
    if (stepIndex >= currentEvalSteps.length) {
      stopMatrixTrace();
      if (banner) banner.textContent = '✅ 全文字のルート再生が完了しました。';
      return;
    }

    const st = currentEvalSteps[stepIndex];
    const sq = squares[st.tileIdx];
    if (sq) {
      sq.classList.add(st.isFallback ? 'fallback-tile' : 'active-tile');
      const spotEl = sq.querySelector(`[data-spot="${st.corner}"]`);
      if (spotEl) spotEl.classList.add('active-char-spot');
    }

    if (pwSpans[stepIndex]) pwSpans[stepIndex].classList.add('playing-now');
    if (logLines[stepIndex]) {
      logLines[stepIndex].classList.add('active-trace-line');
      logLines[stepIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if (banner) {
      banner.textContent = `▶ [${stepIndex + 1}/${currentEvalSteps.length}文字目] ${st.log}`;
    }
  };

  showStep(0);
  idx = 1;
  traceTimer = setInterval(() => {
    if (idx >= currentEvalSteps.length) {
      stopMatrixTrace();
      if (banner) banner.textContent = '✅ 全文字のルート再生が完了しました。';
      return;
    }
    showStep(idx);
    idx++;
  }, speed);
}

function clearHighlightsOnly() {
  document.querySelectorAll('#div-encrypto-matrix-main .square').forEach(el => {
    el.classList.remove('active-tile', 'fallback-tile');
  });
  document.querySelectorAll('#div-encrypto-matrix-main .active-char-spot').forEach(el => {
    el.classList.remove('active-char-spot');
  });
  document.querySelectorAll('#sim-output-pw .pw-char-span.playing-now').forEach(el => {
    el.classList.remove('playing-now');
  });
  document.querySelectorAll('#sim-trace-log .trace-line.active-trace-line').forEach(el => {
    el.classList.remove('active-trace-line');
  });
}

function stopMatrixTrace() {
  if (traceTimer) {
    clearInterval(traceTimer);
    traceTimer = null;
  }
  clearHighlightsOnly();
  const playBtn = document.getElementById('btn-play-trace');
  const stopBtn = document.getElementById('btn-stop-trace');
  if (playBtn) playBtn.style.display = 'inline-block';
  if (stopBtn) stopBtn.style.display = 'none';
}

/* =====================================================================
 * BIP-0039 24単語シードフレーズ双方向変換
 * ===================================================================== */

async function loadBip39Wordlist() {
  if (bip39Wordlist && bip39Wordlist.length === 2048) return bip39Wordlist;
  const urls = [
    'https://cdn.jsdelivr.net/gh/bitcoin/bips@master/bip-0039/english.txt',
    'https://raw.githubusercontent.com/bitcoin/bips/master/bip-0039/english.txt'
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const words = (await r.text()).trim().split(/\r?\n/).map(w => w.trim()).filter(Boolean);
        if (words.length === 2048) {
          bip39Wordlist = words;
          return words;
        }
      }
    } catch (_) {}
  }
  throw new Error('BIP39英単語リスト(2048語)の取得に失敗しました。');
}

function encodeSymListTo32Bit(symStr) {
  let mask = 0;
  for (let i = 0; i < 32; i++) {
    if (symStr.includes(ALL_ASCII_SYMBOLS[i])) mask = (mask | (1 << i)) >>> 0;
  }
  return mask >>> 0;
}

function decode32BitToSymList(mask) {
  let s = '';
  for (let i = 0; i < 32; i++) {
    if ((mask >>> i) & 1) s += ALL_ASCII_SYMBOLS[i];
  }
  return s;
}

function packRecipeTo256Bit(cfg, includeCardSeed, seedNumber) {
  const plain = new Uint8Array(28);
  plain[0] = 0x43; // 'C'
  plain[1] = 0x4D; // 'M'
  plain[2] = (0x02 << 4) | (includeCardSeed ? 1 : 0);
  plain[3] = ((cfg.kwOrder & 0x0F) << 4) | (cfg.kwFilter & 0x0F);
  plain[4] = cfg.kwNum & 0xFF;
  plain[5] = ((cfg.shiftDir & 0x0F) << 4) | (cfg.baseCorner & 0x0F);
  plain[6] = cfg.shiftN & 0xFF;
  plain[7] = cfg.shiftM & 0xFF;
  plain[8] = cfg.pickPattern & 0xFF;
  plain[9] = ((cfg.symMode & 0x03) << 6) | ((cfg.symFbCorner & 0x07) << 3) | (cfg.postMode & 0x07);
  plain[10] = cfg.symFbDir & 0xFF;
  plain[11] = cfg.symFbDist & 0xFF;
  plain[12] = ((cfg.preTarget & 0x0F) << 4) | (cfg.prePattern & 0x0F);
  plain[13] = cfg.preOffset & 0xFF;
  plain[14] = ((cfg.sufTarget & 0x0F) << 4) | (cfg.sufPattern & 0x0F);
  plain[15] = cfg.sufOffset & 0xFF;
  plain[16] = cfg.ancTile & 0xFF;
  plain[17] = ((cfg.ancMode & 0x0F) << 4) | (cfg.lenMode & 0x0F);
  plain[18] = cfg.ancPos & 0xFF;
  plain[19] = cfg.lenVal & 0xFF;

  const symMask = encodeSymListTo32Bit(cfg.symList || '');
  plain[20] = (symMask >>> 24) & 0xFF;
  plain[21] = (symMask >>> 16) & 0xFF;
  plain[22] = (symMask >>> 8) & 0xFF;
  plain[23] = symMask & 0xFF;

  const numSeed = parseSeedValue(seedNumber);
  plain[24] = (numSeed >>> 24) & 0xFF;
  plain[25] = (numSeed >>> 16) & 0xFF;
  plain[26] = (numSeed >>> 8) & 0xFF;
  plain[27] = numSeed & 0xFF;

  const salt = new Uint8Array(4);
  window.crypto.getRandomValues(salt);

  const out = new Uint8Array(32);
  for (let i = 0; i < 28; i++) {
    out[i] = plain[i] ^ salt[i % 4] ^ ((i * 41 + 17) & 0xFF);
  }
  out.set(salt, 28);
  return out;
}

function unpack256BitToRecipe(bytes) {
  const salt = bytes.slice(28, 32);
  const plain = new Uint8Array(28);
  for (let i = 0; i < 28; i++) {
    plain[i] = bytes[i] ^ salt[i % 4] ^ ((i * 41 + 17) & 0xFF);
  }

  if (plain[0] !== 0x43 || plain[1] !== 0x4D || (plain[2] >>> 4) !== 0x02) {
    throw new Error('この24単語はCrypto Matrixのレシピデータではありません。');
  }

  const includeCardSeed = (plain[2] & 0x01) === 1;
  const symMask = ((plain[20] << 24) | (plain[21] << 16) | (plain[22] << 8) | plain[23]) >>> 0;
  const seedNumber = ((plain[24] << 24) | (plain[25] << 16) | (plain[26] << 8) | plain[27]) >>> 0;

  const cfg = {
    kwOrder: (plain[3] >>> 4) & 0x0F,
    kwFilter: plain[3] & 0x0F,
    kwNum: plain[4],
    shiftDir: (plain[5] >>> 4) & 0x0F,
    baseCorner: plain[5] & 0x0F,
    shiftN: plain[6],
    shiftM: plain[7],
    pickPattern: plain[8],
    symMode: (plain[9] >>> 6) & 0x03,
    symFbCorner: (plain[9] >>> 3) & 0x07,
    postMode: plain[9] & 0x07,
    symFbDir: plain[10],
    symFbDist: plain[11],
    preTarget: (plain[12] >>> 4) & 0x0F,
    prePattern: plain[12] & 0x0F,
    preOffset: plain[13],
    sufTarget: (plain[14] >>> 4) & 0x0F,
    sufPattern: plain[14] & 0x0F,
    sufOffset: plain[15],
    ancTile: plain[16] % constMaxTileCount,
    ancMode: (plain[17] >>> 4) & 0x0F,
    lenMode: plain[17] & 0x0F,
    ancPos: plain[18],
    lenVal: plain[19],
    symList: decode32BitToSymList(symMask)
  };

  return { cfg, includeCardSeed, seedNumber };
}

async function entropyToBip39Words(entropyBytes) {
  const wordlist = await loadBip39Wordlist();
  const hashBuf = await window.crypto.subtle.digest('SHA-256', entropyBytes);
  const checksumByte = new Uint8Array(hashBuf)[0];

  let bits = '';
  for (let i = 0; i < 32; i++) bits += entropyBytes[i].toString(2).padStart(8, '0');
  bits += checksumByte.toString(2).padStart(8, '0');

  const words = [];
  for (let i = 0; i < 24; i++) {
    const idx = parseInt(bits.slice(i * 11, (i + 1) * 11), 2);
    words.push(wordlist[idx]);
  }
  return words;
}

async function bip39WordsToEntropy(mnemonicStr) {
  const wordlist = await loadBip39Wordlist();
  const words = mnemonicStr.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length !== 24) throw new Error(`単語数が ${words.length} 語です。24単語すべてを入力してください。`);

  let bits = '';
  for (let i = 0; i < 24; i++) {
    const idx = wordlist.indexOf(words[i]);
    if (idx === -1) throw new Error(`${i + 1}語目の「${words[i]}」はBIP39リストに存在しません。`);
    bits += idx.toString(2).padStart(11, '0');
  }

  const entropyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    entropyBytes[i] = parseInt(bits.slice(i * 8, (i + 1) * 8), 2);
  }

  const hashBuf = await window.crypto.subtle.digest('SHA-256', entropyBytes);
  const expectedCS = new Uint8Array(hashBuf)[0].toString(2).padStart(8, '0');
  if (bits.slice(256, 264) !== expectedCS) {
    throw new Error('BIP39チェックサム不一致：単語の並び順またはスペルに誤りがあります。');
  }
  return entropyBytes;
}

async function generateAndRenderSeedPhrase() {
  const box = document.getElementById('seed-words-container');
  if (!box) return;
  try {
    const cfg = getRecipeConfig();
    const inc = document.getElementById('chk-include-card-seed')?.checked ?? true;
    const seedVal = document.getElementById('input-seed-number')?.value || '0';
    const entropy = packRecipeTo256Bit(cfg, inc, seedVal);
    const words = await entropyToBip39Words(entropy);
    currentMnemonicWords = words;

    box.innerHTML = words.map((w, i) => `
      <div class="seed-chip">
        <span class="seed-num">#${String(i + 1).padStart(2, '0')}</span>
        <span class="seed-txt">${escapeHtml(w)}</span>
      </div>
    `).join('');
  } catch (e) {
    box.innerHTML = `<div style="grid-column:1/-1;color:#dc2626;font-weight:700;">${escapeHtml(e.message)}</div>`;
  }
}

async function restoreRecipeFromSeedInput() {
  const raw = document.getElementById('input-restore-seed')?.value || '';
  const statusEl = document.getElementById('restore-status');
  statusEl.className = 'status-msg';
  try {
    const entropy = await bip39WordsToEntropy(raw);
    const { cfg, includeCardSeed, seedNumber } = unpack256BitToRecipe(entropy);
    setRecipeConfig(cfg);
    document.getElementById('chk-include-card-seed').checked = includeCardSeed;
    if (includeCardSeed) {
      document.getElementById('input-seed-number').value = String(seedNumber);
      updateMainMatrix(seedNumber);
    }
    updateSimulationUI();
    statusEl.className = 'status-msg ok';
    statusEl.textContent = '✅ BIP39検証成功！すべての設定を完全復元しました。';
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '❌ ' + e.message;
  }
}

/**
 * 初期化
 */
document.addEventListener('DOMContentLoaded', () => {
  const ancSel = document.getElementById('rc-anc-tile');
  if (ancSel) {
    ancSel.innerHTML = CENTER_CHARS.map((ch, i) =>
      `<option value="${i}">マス [${escapeHtml(ch)}] (${Math.floor(i / 8) + 1}行・${(i % 8) + 1}列)</option>`
    ).join('');
  }

  const params = new URLSearchParams(window.location.search);
  const kParam = params.get('k') || params.get('seed');
  const seedInput = document.getElementById('input-seed-number');
  if (kParam !== null && seedInput) seedInput.value = kParam;

  updateMainMatrix(seedInput ? seedInput.value : '0');
  updateSimulationUI();
  generateAndRenderSeedPhrase();

  document.getElementById('btn-update-matrix')?.addEventListener('click', () => {
    updateMainMatrix(seedInput.value);
    updateSimulationUI();
    generateAndRenderSeedPhrase();
  });

  document.getElementById('btn-random-matrix')?.addEventListener('click', () => {
    const rnd = Math.floor(Math.random() * 900000000) + 100000000;
    seedInput.value = String(rnd);
    updateMainMatrix(rnd);
    updateSimulationUI();
    generateAndRenderSeedPhrase();
  });

  document.querySelectorAll('.rc-input').forEach(el => {
    el.addEventListener('input', () => {
      updateSimulationUI();
      generateAndRenderSeedPhrase();
    });
    el.addEventListener('change', () => {
      updateSimulationUI();
      generateAndRenderSeedPhrase();
    });
  });

  document.getElementById('sim-site')?.addEventListener('input', updateSimulationUI);
  document.getElementById('sim-secret')?.addEventListener('input', updateSimulationUI);
  document.getElementById('chk-include-card-seed')?.addEventListener('change', generateAndRenderSeedPhrase);

  document.getElementById('btn-play-trace')?.addEventListener('click', playMatrixTrace);
  document.getElementById('btn-stop-trace')?.addEventListener('click', stopMatrixTrace);

  document.getElementById('btn-copy-pw')?.addEventListener('click', () => {
    const pw = currentEvalSteps.map(s => s.ch).join('');
    navigator.clipboard.writeText(pw);
  });

  document.getElementById('btn-reset-recipe')?.addEventListener('click', () => {
    setRecipeConfig({});
    updateSimulationUI();
    generateAndRenderSeedPhrase();
  });

  document.getElementById('btn-random-recipe')?.addEventListener('click', () => {
    const rInt = max => Math.floor(Math.random() * max);
    setRecipeConfig({
      kwOrder: 1 + rInt(8),
      kwFilter: 0,
      kwNum: 4,
      shiftDir: rInt(14),
      shiftN: 1 + rInt(4),
      shiftM: 1 + rInt(3),
      baseCorner: rInt(10),
      pickPattern: rInt(14),
      symMode: 0,
      symList: '',
      symFbDir: 0,
      symFbDist: 1,
      symFbCorner: 0,
      preTarget: rInt(7),
      prePattern: rInt(12),
      preOffset: rInt(8),
      sufTarget: 1 + rInt(6),
      sufPattern: rInt(12),
      sufOffset: rInt(8),
      ancTile: rInt(40),
      ancMode: rInt(6),
      ancPos: 2 + rInt(6),
      postMode: rInt(5),
      lenMode: 0,
      lenVal: 16
    });
    updateSimulationUI();
    generateAndRenderSeedPhrase();
  });

  document.getElementById('btn-generate-seed')?.addEventListener('click', generateAndRenderSeedPhrase);
  document.getElementById('btn-copy-seed')?.addEventListener('click', () => {
    if (currentMnemonicWords.length === 24) {
      navigator.clipboard.writeText(currentMnemonicWords.join(' '));
    }
  });
  document.getElementById('btn-restore-seed')?.addEventListener('click', restoreRecipeFromSeedInput);
});
