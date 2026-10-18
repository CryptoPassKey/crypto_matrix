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
  document.body.classList.add('trace-playing');
  if (window.MatrixCardPreset && window.MatrixCardPreset.syncBlindInputs) window.MatrixCardPreset.syncBlindInputs();
  const stageEl = document.getElementById('matrix-stage-box') || document.getElementById('div-encrypto-matrix-main');
  if (stageEl) {
    const r = stageEl.getBoundingClientRect();
    if (r.top < -10 || r.top > 110) {
      window.scrollTo({ top: Math.max(0, window.scrollY + r.top - 8), behavior: 'smooth' });
    }
  }

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
      const logBox = document.getElementById('sim-trace-log');
      if (logBox) {
        const lineEl = logLines[stepIndex];
        logBox.scrollTop = Math.max(0, lineEl.offsetTop - logBox.offsetTop - (logBox.clientHeight / 2) + (lineEl.clientHeight / 2));
      }
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
  document.body.classList.remove('trace-playing');
  if (window.MatrixCardPreset && window.MatrixCardPreset.syncBlindInputs) window.MatrixCardPreset.syncBlindInputs();
  clearHighlightsOnly();
  const playBtn = document.getElementById('btn-play-trace');
  const stopBtn = document.getElementById('btn-stop-trace');
  if (playBtn) playBtn.style.display = 'inline-block';
  if (stopBtn) stopBtn.style.display = 'none';
}

/* =====================================================================
 * BIP-0039 24単語シードフレーズ双方向変換
 * ===================================================================== */

const INLINE_BIP39_STR = "abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual adapt add addict address adjust admit adult advance advice aerobic affair afford afraid again age agent agree ahead aim air airport aisle alarm album alcohol alert alien all alley allow almost alone alpha already also alter always amateur amazing among amount amused analyst anchor ancient anger angle angry animal ankle announce annual another answer antenna antique anxiety any apart apology appear apple approve april arch arctic area arena argue arm armed armor army around arrange arrest arrive arrow art artefact artist artwork ask aspect assault asset assist assume asthma athlete atom attack attend attitude attract auction audit august aunt author auto autumn average avocado avoid awake aware away awesome awful awkward axis baby bachelor bacon badge bag balance balcony ball bamboo banana banner bar barely bargain barrel base basic basket battle beach bean beauty because become beef before begin behave behind believe below belt bench benefit best betray better between beyond bicycle bid bike bind biology bird birth bitter black blade blame blanket blast bleak bless blind blood blossom blouse blue blur blush board boat body boil bomb bone bonus book boost border boring borrow boss bottom bounce box boy bracket brain brand brass brave bread breeze brick bridge brief bright bring brisk broccoli broken bronze broom brother brown brush bubble buddy budget buffalo build bulb bulk bullet bundle bunker burden burger burst bus business busy butter buyer buzz cabbage cabin cable cactus cage cake call calm camera camp can canal cancel candy cannon canoe canvas canyon capable capital captain car carbon card cargo carpet carry cart case cash casino castle casual cat catalog catch category cattle caught cause caution cave ceiling celery cement census century cereal certain chair chalk champion change chaos chapter charge chase chat cheap check cheese chef cherry chest chicken chief child chimney choice choose chronic chuckle chunk churn cigar cinnamon circle citizen city civil claim clap clarify claw clay clean clerk clever click client cliff climb clinic clip clock clog close cloth cloud clown club clump cluster clutch coach coast coconut code coffee coil coin collect color column combine come comfort comic common company concert conduct confirm congress connect consider control convince cook cool copper copy coral core corn correct cost cotton couch country couple course cousin cover coyote crack cradle craft cram crane crash crater crawl crazy cream credit creek crew cricket crime crisp critic crop cross crouch crowd crucial cruel cruise crumble crunch crush cry crystal cube culture cup cupboard curious current curtain curve cushion custom cute cycle dad damage damp dance danger daring dash daughter dawn day deal debate debris decade december decide decline decorate decrease deer defense define defy degree delay deliver demand demise denial dentist deny depart depend deposit depth deputy derive describe desert design desk despair destroy detail detect develop device devote diagram dial diamond diary dice diesel diet differ digital dignity dilemma dinner dinosaur direct dirt disagree discover disease dish dismiss disorder display distance divert divide divorce dizzy doctor document dog doll dolphin domain donate donkey donor door dose double dove draft dragon drama drastic draw dream dress drift drill drink drip drive drop drum dry duck dumb dune during dust dutch duty dwarf dynamic eager eagle early earn earth easily east easy echo ecology economy edge edit educate effort egg eight either elbow elder electric elegant element elephant elevator elite else embark embody embrace emerge emotion employ empower empty enable enact end endless endorse enemy energy enforce engage engine enhance enjoy enlist enough enrich enroll ensure enter entire entry envelope episode equal equip era erase erode erosion error erupt escape essay essence estate eternal ethics evidence evil evoke evolve exact example excess exchange excite exclude excuse execute exercise exhaust exhibit exile exist exit exotic expand expect expire explain expose express extend extra eye eyebrow fabric face faculty fade faint faith fall false fame family famous fan fancy fantasy farm fashion fat fatal father fatigue fault favorite feature february federal fee feed feel female fence festival fetch fever few fiber fiction field figure file film filter final find fine finger finish fire firm first fiscal fish fit fitness fix flag flame flash flat flavor flee flight flip float flock floor flower fluid flush fly foam focus fog foil fold follow food foot force forest forget fork fortune forum forward fossil foster found fox fragile frame frequent fresh friend fringe frog front frost frown frozen fruit fuel fun funny furnace fury future gadget gain galaxy gallery game gap garage garbage garden garlic garment gas gasp gate gather gauge gaze general genius genre gentle genuine gesture ghost giant gift giggle ginger giraffe girl give glad glance glare glass glide glimpse globe gloom glory glove glow glue goat goddess gold good goose gorilla gospel gossip govern gown grab grace grain grant grape grass gravity great green grid grief grit grocery group grow grunt guard guess guide guilt guitar gun gym habit hair half hammer hamster hand happy harbor hard harsh harvest hat have hawk hazard head health heart heavy hedgehog height hello helmet help hen hero hidden high hill hint hip hire history hobby hockey hold hole holiday hollow home honey hood hope horn horror horse hospital host hotel hour hover hub huge human humble humor hundred hungry hunt hurdle hurry hurt husband hybrid ice icon idea identify idle ignore ill illegal illness image imitate immense immune impact impose improve impulse inch include income increase index indicate indoor industry infant inflict inform inhale inherit initial inject injury inmate inner innocent input inquiry insane insect inside inspire install intact interest into invest invite involve iron island isolate issue item ivory jacket jaguar jar jazz jealous jeans jelly jewel job join joke journey joy judge juice jump jungle junior junk just kangaroo keen keep ketchup key kick kid kidney kind kingdom kiss kit kitchen kite kitten kiwi knee knife knock know lab label labor ladder lady lake lamp language laptop large later latin laugh laundry lava law lawn lawsuit layer lazy leader leaf learn leave lecture left leg legal legend leisure lemon lend length lens leopard lesson letter level liar liberty library license life lift light like limb limit link lion liquid list little live lizard load loan lobster local lock logic lonely long loop lottery loud lounge love loyal lucky luggage lumber lunar lunch luxury lyrics machine mad magic magnet maid mail main major make mammal man manage mandate mango mansion manual maple marble march margin marine market marriage mask mass master match material math matrix matter maximum maze meadow mean measure meat mechanic medal media melody melt member memory mention menu mercy merge merit merry mesh message metal method middle midnight milk million mimic mind minimum minor minute miracle mirror misery miss mistake mix mixed mixture mobile model modify mom moment monitor monkey monster month moon moral more morning mosquito mother motion motor mountain mouse move movie much muffin mule multiply muscle museum mushroom music must mutual myself mystery myth naive name napkin narrow nasty nation nature near neck need negative neglect neither nephew nerve nest net network neutral never news next nice night noble noise nominee noodle normal north nose notable note nothing notice novel now nuclear number nurse nut oak obey object oblige obscure observe obtain obvious occur ocean october odor off offer office often oil okay old olive olympic omit once one onion online only open opera opinion oppose option orange orbit orchard order ordinary organ orient original orphan ostrich other outdoor outer output outside oval oven over own owner oxygen oyster ozone pact paddle page pair palace palm panda panel panic panther paper parade parent park parrot party pass patch path patient patrol pattern pause pave payment peace peanut pear peasant pelican pen penalty pencil people pepper perfect permit person pet phone photo phrase physical piano picnic picture piece pig pigeon pill pilot pink pioneer pipe pistol pitch pizza place planet plastic plate play please pledge pluck plug plunge poem poet point polar pole police pond pony pool popular portion position possible post potato pottery poverty powder power practice praise predict prefer prepare present pretty prevent price pride primary print priority prison private prize problem process produce profit program project promote proof property prosper protect proud provide public pudding pull pulp pulse pumpkin punch pupil puppy purchase purity purpose purse push put puzzle pyramid quality quantum quarter question quick quit quiz quote rabbit raccoon race rack radar radio rail rain raise rally ramp ranch random range rapid rare rate rather raven raw razor ready real reason rebel rebuild recall receive recipe record recycle reduce reflect reform refuse region regret regular reject relax release relief rely remain remember remind remove render renew rent reopen repair repeat replace report require rescue resemble resist resource response result retire retreat return reunion reveal review reward rhythm rib ribbon rice rich ride ridge rifle right rigid ring riot ripple risk ritual rival river road roast robot robust rocket romance roof rookie room rose rotate rough round route royal rubber rude rug rule run runway rural sad saddle sadness safe sail salad salmon salon salt salute same sample sand satisfy satoshi sauce sausage save say scale scan scare scatter scene scheme school science scissors scorpion scout scrap screen script scrub sea search season seat second secret section security seed seek segment select sell seminar senior sense sentence series service session settle setup seven shadow shaft shallow share shed shell sheriff shield shift shine ship shiver shock shoe shoot shop short shoulder shove shrimp shrug shuffle shy sibling sick side siege sight sign silent silk silly silver similar simple since sing siren sister situate six size skate sketch ski skill skin skirt skull slab slam sleep slender slice slide slight slim slogan slot slow slush small smart smile smoke smooth snack snake snap sniff snow soap soccer social sock soda soft solar soldier solid solution solve someone song soon sorry sort soul sound soup source south space spare spatial spawn speak special speed spell spend sphere spice spider spike spin spirit split spoil sponsor spoon sport spot spray spread spring spy square squeeze squirrel stable stadium staff stage stairs stamp stand start state stay steak steel stem step stereo stick still sting stock stomach stone stool story stove strategy street strike strong struggle student stuff stumble style subject submit subway success such sudden suffer sugar suggest suit summer sun sunny sunset super supply supreme sure surface surge surprise surround survey suspect sustain swallow swamp swap swarm swear sweet swift swim swing switch sword symbol symptom syrup system table tackle tag tail talent talk tank tape target task taste tattoo taxi teach team tell ten tenant tennis tent term test text thank that theme then theory there they thing this thought three thrive throw thumb thunder ticket tide tiger tilt timber time tiny tip tired tissue title toast tobacco today toddler toe together toilet token tomato tomorrow tone tongue tonight tool tooth top topic topple torch tornado tortoise toss total tourist toward tower town toy track trade traffic tragic train transfer trap trash travel tray treat tree trend trial tribe trick trigger trim trip trophy trouble truck true truly trumpet trust truth try tube tuition tumble tuna tunnel turkey turn turtle twelve twenty twice twin twist two type typical ugly umbrella unable unaware uncle uncover under undo unfair unfold unhappy uniform unique unit universe unknown unlock until unusual unveil update upgrade uphold upon upper upset urban urge usage use used useful useless usual utility vacant vacuum vague valid valley valve van vanish vapor various vast vault vehicle velvet vendor venture venue verb verify version very vessel veteran viable vibrant vicious victory video view village vintage violin virtual virus visa visit visual vital vivid vocal voice void volcano volume vote voyage wage wagon wait walk wall walnut want warfare warm warrior wash wasp waste water wave way wealth weapon wear weasel weather web wedding weekend weird welcome west wet whale what wheat wheel when where whip whisper wide width wife wild will win window wine wing wink winner winter wire wisdom wise wish witness wolf woman wonder wood wool word work world worry worth wrap wreck wrestle wrist write wrong yard year yellow you young youth zebra zero zone zoo";
async function loadBip39Wordlist() {
  if (bip39Wordlist && bip39Wordlist.length === 2048) return bip39Wordlist;
  if (typeof INLINE_BIP39_STR === 'string' && INLINE_BIP39_STR.length > 1000) {
    const inlineWords = INLINE_BIP39_STR.split(' ');
    if (inlineWords.length === 2048) {
      bip39Wordlist = inlineWords;
      return bip39Wordlist;
    }
  }
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

/* CARD READING v2 + EXTENDED BIP39 BACKUP v2 + CME2 ENCRYPTION + SHAMIR SECRET SHARING (CMS3) + BLIND MODE
 * Original LCG/matrix and detailed evaluator above are preserved verbatim.
 * lenMode 3/4 preserve the prior physical-card v1 rules. lenMode 5 is symbol v2.
 * No hash/KDF/randomness is used to derive passwords; SHA-256 below verifies backups.
 * v2 original backup core -> v4 for lenMode 3/4; v5 for lenMode 5.
 * Newly generated backup salt is normalized to zero: same data => same words.
 * Full backup frame: 32 bytes, [C X B 2][index:u16BE][count:u16BE][tag:4][data:20].
 * Framed stream: [bodyLength:u32BE][body][SHA256(body)][zero padding to 20 bytes].
 * body: [C M X 2][core:32][siteLen:u16][secretLen:u16][symLen:u16]
 *       [exact UTF8 site][exact UTF8 secret][exact UTF8 symList][SHA256(output):32].
 * Encrypted body: [C M E 2][profileByte][salt:32][iv:12][optCredId][commitTag:16][AES-GCM ciphertext].
 * Shamir share body: [C M S 3][M:u8][N:u8][k:u8][0][setId:8][GF(2^8) shareData].
 */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const enc=new TextEncoder();
 const originalEvaluate=evaluateRecipeSteps, originalGuide=updateVerbalGuide;
 const originalSimulation=updateSimulationUI, originalMatrix=updateMainMatrix;
 const originalPack=packRecipeTo256Bit, originalUnpack=unpack256BitToRecipe;
 let appliedSeed=0, issue='', backupRequest=0, restoreRequest=0, restoring=false, blindMode=false;
 const cardMode=cfg=>[3,4,5].includes(cfg.lenMode);
 const canonical=s=>String(s??'').replace(/[A-Z]/g,c=>c.toLowerCase()).split('').filter(c=>CENTER_CHARS.includes(c)).join('');
 function setStatus(id,text,error=false){const el=$(id);if(el){el.textContent=text;el.dataset.error=String(error);}}
 function cryptoAPI(){if(!globalThis.crypto?.subtle)throw new Error('復元フレーズの検証にはWeb Crypto対応環境が必要です。HTTPSまたはlocalhostの対応ブラウザで開いてください。');return globalThis.crypto.subtle;}
 async function sha(a){return new Uint8Array(await cryptoAPI().digest('SHA-256',a));}
 async function sha512(a){return new Uint8Array(await cryptoAPI().digest('SHA-512',a));}
 function concat(...arr){const out=new Uint8Array(arr.reduce((n,a)=>n+a.length,0));let pos=0;for(const a of arr){out.set(a,pos);pos+=a.length;}return out;}
 function equal(a,b){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
 function filtered(site,secret){const s=canonical(site),k=canonical(secret);if(!s||!k)throw new Error('サイト名・合言葉それぞれにカード中央にある文字が必要です。空欄を既定の秘密へ置き換えません。');return{site:s,secret:k};}
 function next(i){return(i+1)%currentMatrixData.length;}
 function isSymbol(c){return !/^[A-Za-z0-9]$/.test(c);}
 function allowed(c,cfg){return isSymbolAllowed(c,cfg.symMode,cfg.symList);}
 function validateSymbols(cfg){
  if(![0,1,2].includes(cfg.symMode))throw new Error('記号ありでは「すべて許可」「ホワイトリスト」「ブラックリスト」のいずれかを選んでください。');
  if([...cfg.symList].some(c=>!ALL_ASCII_SYMBOLS.includes(c)))throw new Error('対象記号には半角記号だけを区切りなしで入力してください（空白・英数字・全角文字は不可）。');
  if(cfg.symMode===2&&!cfg.symList)throw new Error('ホワイトリストが空です。許可する記号を入力してください。');
  const usable=[...new Set(currentMatrixData.map(t=>t.bl).filter(c=>isSymbol(c)&&allowed(c,cfg)))];
  if(!usable.length)throw new Error('指定ルールで使える記号が、このカードの左下にありません。許可リスト・除外リストを確認してください。勝手に別の記号を使いません。');
  return usable;
 }
 function cardStep(i,corner,label,fallback=false){const t=currentMatrixData[i];return{ch:t[corner],tileIdx:i,corner,isFallback:fallback,log:`${label}: ${Math.floor(i/8)+1}行${i%8+1}列 マス[${t.center}]の${corner==='tl'?'左上':corner==='bl'?'左下':'右上'} → '${t[corner]}'`};}
 function search(start,corner,test,label,includeStart=false){let i=start;for(let hop=0;hop<currentMatrixData.length;hop++){if(!includeStart||hop>0)i=next(i);if(test(currentMatrixData[i][corner]))return cardStep(i,corner,`${label}（${includeStart?hop:hop+1}マス先）`,hop>0||!includeStart);}throw new Error(`${label}に使える文字が見つかりません。`);}
 function preset(mode,L){return{kwOrder:1,kwFilter:0,kwNum:4,shiftDir:0,shiftN:1,shiftM:1,baseCorner:mode==='pin'?3:0,pickPattern:0,symMode:mode==='pin'?3:Number($('cq-symbol-mode').value),symList:mode==='pin'?'':$('cq-symbol-list').value,symFbDir:3,symFbDist:1,symFbCorner:0,preTarget:0,prePattern:0,preOffset:0,sufTarget:0,sufPattern:0,sufOffset:0,ancTile:0,ancMode:0,ancPos:4,postMode:0,lenMode:mode==='pin'?3:5,lenVal:L};}
 updateMainMatrix=function(seed){originalMatrix(seed);appliedSeed=parseSeedValue(seed);};
 evaluateRecipeSteps=function(siteRaw,secretRaw,cfg){
  if(!cardMode(cfg))return originalEvaluate(siteRaw,secretRaw,cfg);
  issue='';
  try{
   if(!currentMatrixData.length)throw new Error('先にカードを表示してください。');
   const input=filtered(siteRaw,secretRaw),L=Number(cfg.lenVal);
   const tail=cfg.lenMode===5?4:cfg.lenMode===4?3:0;
   if(!Number.isInteger(L)||L<tail+1||L>128)throw new Error('指定した文字数では本文と末尾を作れません。');
   if(cfg.lenMode===5)validateSymbols(cfg);
   const raw=originalEvaluate(input.site,input.secret,{...cfg,lenMode:0,...(cfg.lenMode===5?{symMode:0}:{})});
   if(!raw.length)throw new Error('読み取り対象がありません。');
   const bodyLength=L-tail,steps=[];
   for(const source of raw.slice(0,bodyLength)){
    if(cfg.lenMode===5&&!allowed(source.ch,cfg))steps.push(search(source.tileIdx,'bl',c=>allowed(c,cfg),'禁止記号を飛ばして左下を読む'));
    else steps.push(source);
   }
   let cursor=steps[steps.length-1].tileIdx;
   const corner=cfg.lenMode===3?'tl':cfg.lenMode===4?'tr':'bl';
   while(steps.length<bodyLength){
    const s=cfg.lenMode===5?search(cursor,corner,c=>allowed(c,cfg),'文字数不足の追読'):cardStep(next(cursor),corner,'文字数不足の追読');
    steps.push(s);cursor=s.tileIdx;
   }
   if(tail){
    for(const [regex,label]of[[/[A-Z]/,'末尾の英大文字'],[/[a-z]/,'末尾の英小文字']]){const s=search(cursor,'tr',c=>regex.test(c),label);steps.push(s);cursor=s.tileIdx;}
    cursor=next(cursor);steps.push(cardStep(cursor,'tl','末尾の数字'));
    if(cfg.lenMode===5){const s=search(cursor,'bl',c=>isSymbol(c)&&allowed(c,cfg),'末尾の許可記号');steps.push(s);}
   }
   return steps;
  }catch(e){issue=e.message;return[];}
 };
 updateVerbalGuide=function(cfg){
  if(!cardMode(cfg))return originalGuide(cfg);
  originalGuide({...cfg,lenMode:0});
  const modeTitle=cfg.lenMode===3?'かんたん生成モード — 銀行などの暗証番号（数字のみ）':cfg.lenMode===5?'かんたん生成モード — パスワード（英大小・数字・記号）':'かんたん生成モード（旧互換） — パスワード（英大小・数字）';
  const notes=[`${modeTitle}：英字A〜Zは小文字として中央を探す。中央にない文字（ドット・空白など）は飛ばす。`,'順読みは左→右。行末は次の行の左端、右下の次は左上。',cfg.lenMode===3?`${cfg.lenVal}桁まで左上を読む。不足分は最後に読んだマスの次から左上を読み足す。`:cfg.lenMode===4?`本文は${cfg.lenVal-3}文字。右上を読み、不足時は順読み。その次から右上の大文字→さらに次から右上の小文字を探し、次のマスの左上数字を採用。`:`本文は${cfg.lenVal-4}文字。左下の禁止記号は次のマスへ飛ばす。不足分も左下を順読み。最後は次から右上の大文字→次から右上の小文字→次の左上数字→次から左下の許可記号を探して採用。`,'すべての出力文字は物理カードの実在する角から直接読み取る。パスワード生成にハッシュや追加乱数は使わない。'];
  for(const text of notes){const li=document.createElement('li');li.textContent=text;$('verbal-recipe-steps')?.appendChild(li);}
 };
 function qrSVG(text){
  if(!window.MatrixQRCode)return null;
  const matrix=MatrixQRCode.matrix(text),n=matrix.length+8,ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${n} ${n}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','復元用QR');svg.setAttribute('shape-rendering','crispEdges');
  const bg=document.createElementNS(ns,'rect');bg.setAttribute('width',String(n));bg.setAttribute('height',String(n));bg.setAttribute('fill','#fff');bg.setAttribute('class','qr-white');svg.appendChild(bg);
  let d='';for(let r=0;r<matrix.length;r++)for(let c=0;c<matrix.length;c++)if(matrix[r][c])d+=`M${c+4},${r+4}h1v1h-1z`;
  const path=document.createElementNS(ns,'path');path.setAttribute('d',d);path.setAttribute('fill','#000');path.setAttribute('class','qr-black');svg.appendChild(path);return svg;
 }
 function invalidateBackup(message='入力・設定が変わりました。復元フレーズとQRを更新しています…'){
  backupRequest++;currentMnemonicWords=[];if($('btn-copy-seed'))$('btn-copy-seed').disabled=true;
  if($('seed-words-container'))$('seed-words-container').textContent=message;
  if($('seed-qr-list'))$('seed-qr-list').replaceChildren();
 }
 let clipTimer=null;
 async function copyWithAutoClear(text,onCleared=null){
  await navigator.clipboard.writeText(text);
  if(clipTimer)clearTimeout(clipTimer);
  clipTimer=setTimeout(async()=>{
   clipTimer=null;
   try{await navigator.clipboard.writeText('');if(onCleared)onCleared();}catch(_){}
  },30000);
 }
 function estimatePasswordEntropy(pw){
  const chars=Array.from(String(pw??''));
  if(!chars.length)return{bits:0,pool:0,unique:0,length:0};
  let pool=0;
  if(chars.some(c=>/[0-9]/.test(c)))pool+=10;
  if(chars.some(c=>/[a-z]/.test(c)))pool+=26;
  if(chars.some(c=>/[A-Z]/.test(c)))pool+=26;
  if(chars.some(c=>/[^A-Za-z0-9\s]/.test(c)))pool+=32;
  if(chars.some(c=>/\s/.test(c)))pool+=1;
  if(!pool)pool=32;
  const unique=new Set(chars).size;
  const bits=Math.round(chars.length*Math.log2(pool)*10)/10;
  return{bits,pool,unique,length:chars.length};
 }
 function syncBlindInputs(){
  const playing=document.body.classList.contains('trace-playing');
  const shouldMask=blindMode&&!playing;
  const secEl=$('sim-secret'),seedEl=$('input-seed-number');
  if(secEl)secEl.type=shouldMask?'password':'text';
  if(seedEl)seedEl.type=shouldMask?'password':'text';
  const btn=$('btn-blind-mode');
  if(btn){
   btn.setAttribute('aria-pressed',String(blindMode));
   btn.classList.toggle('btn-blind-active',blindMode);
   btn.textContent=blindMode?(playing?'👁️ ブラインド表示: ON（ルート再生中は自動表示）':'🙈 ブラインド表示: ON（覗き見防止中）'):'🙈 ブラインド表示: OFF';
  }
 }
 function setBlindMode(active){
  blindMode=!!active;
  document.body.classList.toggle('blind-mode',blindMode);
  syncBlindInputs();
 }
 function getActiveModeLabel(cfg){
  if(cfg.lenMode===3)return`かんたん生成モード — 銀行などの暗証番号（数字のみ・${cfg.lenVal}桁）`;
  if(cfg.lenMode===5)return`かんたん生成モード — パスワード（英大小・数字・記号・${cfg.lenVal}文字）`;
  if(cfg.lenMode===4)return`かんたん生成モード — パスワード（英大小・数字・${cfg.lenVal}文字）`;
  return'1. マイ・レシピ全組み合わせ設定';
 }
 let lastActiveModeKind=null;
 function syncCollapseButtons(){
  const cqSec=$('card-quick'),cqBtn=$('btn-toggle-cq');
  if(cqSec&&cqBtn){
   const col=cqSec.classList.contains('is-collapsed');
   cqBtn.textContent=col?'▼ かんたん生成モードを開く':'▲ 折りたたむ';
  }
  const recSec=$('section-recipe-detail'),recBtn=$('btn-toggle-recipe');
  if(recSec&&recBtn){
   const col=recSec.classList.contains('is-collapsed');
   recBtn.textContent=col?'▼ マイ・レシピ設定を開く':'▲ 折りたたむ';
  }
 }
 function syncActiveModeUI(cfg){
  const isPin=cfg.lenMode===3,isAlnum=cfg.lenMode===4,isSymbol=cfg.lenMode===5;
  const isCard=isPin||isAlnum||isSymbol,isRecipe=!isCard;
  const modeLabel=getActiveModeLabel(cfg);
  const currentKind=isPin?'pin':isSymbol?'symbol':isAlnum?'alnum':'recipe';
  const cqSec=$('card-quick'),recSec=$('section-recipe-detail');
  if(lastActiveModeKind!==currentKind){
   lastActiveModeKind=currentKind;
   if(cqSec)cqSec.classList.toggle('is-collapsed',!isCard);
   if(recSec)recSec.classList.toggle('is-collapsed',!isRecipe);
  }
  syncCollapseButtons();
  for(const id of['verbal-mode-badge','live-mode-badge','sticky-mode-badge']){
   const b=$(id);if(b){b.textContent=`✅ 現在使用中：${modeLabel}`;b.classList.remove('inactive');}
  }
  const cqBadge=$('cq-section-badge');
  if(cqSec)cqSec.classList.toggle('active-mode-section',isCard);
  if(cqBadge){
   cqBadge.classList.toggle('inactive',!isCard);
   cqBadge.textContent=isCard
    ?`✅ 現在使用中：${isPin?'銀行などの暗証番号（数字のみ）':isSymbol?'パスワード（英大小・数字・記号）':'パスワード（英大小・数字）'}`
    :'未選択（下の「1. マイ・レシピ全組み合わせ設定」を使用中）';
  }
  const qPinBtn=$('btn-quick-switch-pin'),qSymBtn=$('btn-quick-switch-symbol');
  if(qPinBtn){qPinBtn.classList.toggle('btn-mode-active',isPin);qPinBtn.classList.toggle('btn-outline',!isPin);qPinBtn.textContent=isPin?'✅ 暗証番号（数字のみ）を使用中':'🔢 暗証番号（数字のみ）を使う';}
  if(qSymBtn){qSymBtn.classList.toggle('btn-mode-active',isSymbol);qSymBtn.classList.toggle('btn-outline',!isSymbol);qSymBtn.textContent=isSymbol?'✅ パスワード（記号あり）を使用中':'🔐 パスワード（英大小・数字・記号）を使う';}
  const pinPanel=$('cq-panel-pin'),pinBadge=$('cq-pin-badge'),pinBtn=$('cq-pin-apply');
  if(pinPanel)pinPanel.classList.toggle('active-mode-panel',isPin);
  if(pinBadge){pinBadge.classList.toggle('inactive',!isPin);pinBadge.textContent=isPin?'✅ 現在使用中':'未選択';}
  if(pinBtn){pinBtn.classList.toggle('btn-mode-active',isPin);pinBtn.classList.toggle('btn-outline',!isPin);pinBtn.textContent=isPin?'✅ 現在このモードを使用中':'このモードを使う';}
  const symPanel=$('cq-panel-symbol'),symBadge=$('cq-symbol-badge'),symBtn=$('cq-symbol-apply');
  if(symPanel)symPanel.classList.toggle('active-mode-panel',isSymbol);
  if(symBadge){symBadge.classList.toggle('inactive',!isSymbol);symBadge.textContent=isSymbol?'✅ 現在使用中':'未選択';}
  if(symBtn){symBtn.classList.toggle('btn-mode-active',isSymbol);symBtn.classList.toggle('btn-outline',!isSymbol);symBtn.textContent=isSymbol?'✅ 現在このモードを使用中':'このモードを使う';}
  const recBadge=$('recipe-section-badge'),recBtn=$('btn-use-recipe');
  if(recSec)recSec.classList.toggle('active-mode-section',isRecipe);
  if(recBadge){recBadge.classList.toggle('inactive',!isRecipe);recBadge.textContent=isRecipe?'✅ 現在使用中':'未選択（上の「かんたん生成モード」を使用中）';}
  if(recBtn){recBtn.classList.toggle('btn-mode-active',isRecipe);recBtn.classList.toggle('btn-outline',!isRecipe);recBtn.textContent=isRecipe?'✅ 現在このモードを使用中':'このモードを使う';}
  const cqSt=$('cq-status');
  if(cqSt)cqSt.dataset.mode=isCard?'card':'recipe';
 }

 updateSimulationUI=function(){
  issue='';originalSimulation();const cfg=getRecipeConfig();
  syncActiveModeUI(cfg);
  if(cardMode(cfg))try{filtered($('sim-site').value,$('sim-secret').value);}catch(e){issue=e.message;currentEvalSteps=[];$('sim-output-pw').textContent='';$('sim-trace-log').textContent='';}
  $('btn-copy-pw').disabled=!!issue;$('btn-play-trace').disabled=!!issue;
  if($('btn-sticky-play'))$('btn-sticky-play').disabled=!!issue;
  if($('btn-sticky-copy'))$('btn-sticky-copy').disabled=!!issue;
  if(cardMode(cfg)&&!issue){
   const input=filtered($('sim-site').value,$('sim-secret').value);
   const pw=currentEvalSteps.map(s=>s.ch).join('');
   const ent=estimatePasswordEntropy(pw);
   const subMode=cfg.lenMode===5?'パスワード（英大小・数字・記号）':cfg.lenMode===4?'パスワード（英大小・数字）':'銀行などの暗証番号（数字のみ）';
   $('sim-output-meta').textContent=`かんたん生成モード（${subMode}） ／ 出力: ${currentEvalSteps.length}${cfg.lenMode===3?'桁':'文字'} ／ 推定エントロピー: ${ent.bits} bits`;
   $('sim-step-banner').textContent='▶ 実際の出力文字があるマス・角が光ります。追読・代替・末尾の文字もカード上で確認できます。';
   const syms=cfg.lenMode===5?validateSymbols(cfg).join(''):'';
   setStatus('cq-status',`【現在使用中のモード】${getActiveModeLabel(cfg)}\n・適用済みカードシード：${appliedSeed} ／ カードで探す文字：${input.site} ＋ ${input.secret}\n・出力：${cfg.lenMode===5?'英大小・数字・記号':cfg.lenMode===4?'英大小・数字':'数字のみ'} ${cfg.lenVal}${cfg.lenMode===3?'桁':'文字'}（推定エントロピー ${ent.bits} bits）${cfg.lenMode===5?' ／ 使用可能な左下記号：'+syms:''}`);
   if(cfg.lenMode===3&&cfg.lenVal>=4&&cfg.lenVal<=12)$('cq-pin-length').value=String(cfg.lenVal);
   if(cfg.lenMode===5){if(cfg.lenVal>=16&&cfg.lenVal<=32)$('cq-symbol-length').value=String(cfg.lenVal);if([0,1,2].includes(cfg.symMode))$('cq-symbol-mode').value=String(cfg.symMode);$('cq-symbol-list').value=cfg.symList;}
  }else if(issue){$('sim-output-meta').textContent=issue;setStatus('cq-status',issue,true);}
  else{
   const pw=currentEvalSteps.map(s=>s.ch).join('');
   const ent=estimatePasswordEntropy(pw);
   if(pw&&$('sim-output-meta'))$('sim-output-meta').textContent=`1. マイ・レシピ全組み合わせ設定 ／ 総文字数: ${currentEvalSteps.length}文字 （記号代替発動: ${currentEvalSteps.filter(s=>s.isFallback).length}箇所） ／ 推定エントロピー: ${ent.bits} bits`;
   setStatus('cq-status','【現在使用中のモード】1. マイ・レシピ全組み合わせ設定（方向・自由数値・記号代替対応）\n上の「銀行などの暗証番号（数字のみ）」または「パスワード（英大小・数字・記号）」の「このモードを使う」を押すと、かんたん生成モードに切り替わります。');
  }
  const stickyPw=$('sticky-output-pw'),stickyMeta=$('sticky-output-meta');
  if(stickyPw&&$('sim-output-pw'))stickyPw.innerHTML=$('sim-output-pw').innerHTML;
  if(stickyMeta&&$('sim-output-meta'))stickyMeta.textContent=$('sim-output-meta').textContent;
  syncBlindInputs();
  if(!restoring&&$('backup-kind')){invalidateBackup();void generateAndRenderSeedPhrase();}
 };
 function versionOf(b){const salt=b.slice(28,32);if((b[0]^salt[0]^17)!==0x43||(b[1]^salt[1]^58)!==0x4d)return-1;return(b[2]^salt[2]^99)>>>4;}
 packRecipeTo256Bit=function(cfg,includeSeed,seed){
  const b=originalPack(cfg,includeSeed,includeSeed?seed:0),salt=b.slice(28,32);
  for(let i=0;i<28;i++)b[i]^=salt[i%4];b.fill(0,28);
  if([3,4].includes(cfg.lenMode))b[2]^=0x60;else if(cfg.lenMode===5)b[2]^=0x70;
  return b;
 };
 unpack256BitToRecipe=function(b){
  if(!(b instanceof Uint8Array)||b.length!==32)throw new Error('設定データ長が不正です。');
  const v=versionOf(b);let packet=b;
  if(v===4||v===5){packet=b.slice();packet[2]^=v===4?0x60:0x70;}
  if(v===3)throw new Error('以前のハッシュ補強版のデータです。生成した旧版で復元してください。');
  const d=originalUnpack(packet);
  if(v===4&&![3,4].includes(d.cfg.lenMode)||v===5&&d.cfg.lenMode!==5||v===2&&cardMode(d.cfg))throw new Error('バックアップのバージョンと読み取り方式が一致しません。');
  return d;
 };
 function snapshotBackup(forceFull=null,forceIncludeSeed=null){
  const cfg=getRecipeConfig();if(cardMode(cfg)&&issue)throw new Error('カード用の入力・記号設定を修正してからバックアップしてください。');
  const full=forceFull!==null?forceFull:$('backup-kind').value==='full';
  const includeSeed=forceIncludeSeed!==null?forceIncludeSeed:$('chk-include-card-seed').checked;
  const site=$('sim-site').value,secret=$('sim-secret').value;
  const value=evaluateRecipeSteps(site,secret,cfg).map(s=>s.ch).join('');
  if(!value||issue)throw new Error(issue||'先にサイト名・合言葉・読み方を設定して、生成結果を確認してください。');
  return{cfg,includeSeed,seed:appliedSeed,site,secret,full,value};
 }
 async function buildPlainBody(s,core){
  const sym=enc.encode(s.cfg.symList);
  if(sym.length>1024)throw new Error('記号リストは1024バイトまでです。');
  if(!s.full){
   const len=new Uint8Array(2);new DataView(len.buffer).setUint16(0,sym.length,false);
   return concat(new Uint8Array([0x43,0x4d,0x53,2]),core,len,sym);
  }
  const site=enc.encode(s.site),secret=enc.encode(s.secret);
  if(site.length>4096||secret.length>4096)throw new Error('拡張バックアップはサイト名・合言葉各4096バイト、記号リスト1024バイトまでです。');
  const lengths=new Uint8Array(6),view=new DataView(lengths.buffer);
  view.setUint16(0,site.length,false);view.setUint16(2,secret.length,false);view.setUint16(4,sym.length,false);
  return concat(new Uint8Array([0x43,0x4d,0x58,2]),core,lengths,site,secret,sym,await sha(enc.encode(s.value)));
 }
 async function frameBodyToBlocks(body){
  const hash=await sha(body),len=new Uint8Array(4);new DataView(len.buffer).setUint32(0,body.length,false);
  const stream=concat(len,body,hash),count=Math.ceil(stream.length/20),blocks=[];
  for(let i=0;i<count;i++){
   const b=new Uint8Array(32);b.set([0x43,0x58,0x42,2]);const h=new DataView(b.buffer);
   h.setUint16(4,i+1,false);h.setUint16(6,count,false);b.set(hash.slice(0,4),8);b.set(stream.slice(i*20,(i+1)*20),12);blocks.push(b);
  }
  return blocks;
 }
 async function fullBlocks(s,core){
  return frameBodyToBlocks(await buildPlainBody({...s,full:true},core));
 }

 /* ===================================================================
  * GF(2^8) Shamir's Secret Sharing (CMS3) — Irreducible poly 0x11B, gen 0x03
  * =================================================================== */
 const GF_EXP=new Uint8Array(512),GF_LOG=new Uint8Array(256);
 (()=>{
  let x=1;
  for(let i=0;i<255;i++){
   GF_EXP[i]=x;GF_EXP[i+255]=x;GF_LOG[x]=i;
   const x2=(x<<1)^((x&0x80)?0x11b:0);
   x=(x2^x)&0xff;
  }
 })();
 function gfMul(a,b){return(a===0||b===0)?0:GF_EXP[GF_LOG[a]+GF_LOG[b]];}
 function gfDiv(a,b){if(b===0)throw new Error('GF(2^8) zero division');return a===0?0:GF_EXP[GF_LOG[a]+255-GF_LOG[b]];}
 function shamirSplit(secretBytes,m,n){
  if(m<2||n<m||n>16)throw new Error('秘密分散の閾値・分割数の指定が不正です。');
  const len=secretBytes.length,shares=Array.from({length:n},()=>new Uint8Array(len));
  const rnd=new Uint8Array(len*(m-1));
  for(let off=0;off<rnd.length;off+=65536)crypto.getRandomValues(rnd.subarray(off,Math.min(rnd.length,off+65536)));
  const coeffs=new Uint8Array(m);
  let rPos=0;
  for(let i=0;i<len;i++){
   coeffs[0]=secretBytes[i];
   for(let d=1;d<m;d++)coeffs[d]=rnd[rPos++];
   for(let k=1;k<=n;k++){
    let y=0;
    for(let d=m-1;d>=0;d--)y=gfMul(y,k)^coeffs[d];
    shares[k-1][i]=y;
   }
  }
  return shares;
 }
 function shamirCombine(shareItems){
  const m=shareItems.length;
  if(m<2)throw new Error('秘密分散の復元に十分なシェアがありません。');
  const len=shareItems[0].data.length;
  const L=new Uint8Array(m);
  for(let j=0;j<m;j++){
   const xj=shareItems[j].index;
   let prod=1;
   for(let q=0;q<m;q++){
    if(q!==j){
     const xq=shareItems[q].index;
     if(xj===xq)throw new Error('同一番号の秘密分散シェアが重複しています。異なるシェアを入力してください。');
     prod=gfMul(prod,gfDiv(xq,xj^xq));
    }
   }
   L[j]=prod;
  }
  const out=new Uint8Array(len);
  for(let i=0;i<len;i++){
   let val=0;
   for(let j=0;j<m;j++)val^=gfMul(shareItems[j].data[i],L[j]);
   out[i]=val;
  }
  return out;
 }

 /* ===================================================================
  * CME2 Multi-Layered Encryption + Optional Serverless 2FA (Keyfile / WebAuthn Passkey PRF)
  * =================================================================== */
 const KDF_ITERATIONS={0:600000,1:2100000,2:5000000};
 const KDF_LABELS={
  0:'Level 1 Standard（PBKDF2-HMAC-SHA512 600,000回 ＋ HKDF-SHA512 ＋ AES-256-GCM ＋ Key-Committing HMAC）',
  1:'Level 2 Hardened（PBKDF2-HMAC-SHA512 2,100,000回 ＋ HKDF-SHA512 ＋ AES-256-GCM ＋ Key-Committing HMAC）',
  2:'Level 3 Maximum（PBKDF2-HMAC-SHA512 5,000,000回 ＋ HKDF-SHA512 ＋ AES-256-GCM ＋ Key-Committing HMAC）'
 };
 async function derivePasskeyPrf(salt32,credentialId=null){
  if(!window.PublicKeyCredential||!navigator.credentials){
   throw new Error('お使いのブラウザ環境ではパスキーが利用できません。対応ブラウザで開いてください。');
  }
  const rpId=location.hostname||'localhost';
  if(!credentialId){
   const userSecret=crypto.getRandomValues(new Uint8Array(32));
   const challenge=crypto.getRandomValues(new Uint8Array(32));
   const created=await navigator.credentials.create({
    publicKey:{
     challenge,
     rp:{name:'Crypto Matrix Backup',id:rpId},
     user:{id:userSecret,name:'cryptomatrix-backup-2fa',displayName:'Crypto Matrix 2FA Passkey'},
     pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257},{type:'public-key',alg:-8}],
     authenticatorSelection:{userVerification:'required',residentKey:'preferred'},
     timeout:60000
    }
   });
   if(!created)throw new Error('パスキーの作成がキャンセルされました。');
   const rawCredId=new Uint8Array(created.rawId);
   if(!rawCredId.length||rawCredId.length>470)throw new Error('パスキー識別子の長さが不正です。');
   const maskKey=(await sha512(concat(enc.encode('CM-PASSKEY-MASK-v2:'),salt32,rawCredId))).slice(0,32);
   const maskedSecret=new Uint8Array(32);
   for(let i=0;i<32;i++)maskedSecret[i]=userSecret[i]^maskKey[i];
   const packedCred=concat(new Uint8Array([0x50,0x4b,0x02]),maskedSecret,rawCredId);
   const extraFactor=await sha512(concat(enc.encode('CM-PASSKEY-FACTOR-v2:'),salt32,rawCredId,userSecret));
   return{extraFactor,credentialId:packedCred};
  }
  if(credentialId.length>35&&credentialId[0]===0x50&&credentialId[1]===0x4b&&credentialId[2]===0x02){
   const maskedSecret=credentialId.slice(3,35);
   const rawCredId=credentialId.slice(35);
   const assertion=await navigator.credentials.get({
    publicKey:{
     challenge:crypto.getRandomValues(new Uint8Array(32)),
     rpId,
     allowCredentials:[{type:'public-key',id:rawCredId}],
     userVerification:'required',
     timeout:60000
    }
   });
   if(!assertion)throw new Error('パスキーの認証がキャンセルされました。');
   const verifiedCredId=new Uint8Array(assertion.rawId);
   if(!equal(verifiedCredId,rawCredId))throw new Error('作成時に使用したパスキーと異なるパスキーが選択されました。作成時と同じパスキーで認証してください。');
   const authData=assertion.response?.authenticatorData?new Uint8Array(assertion.response.authenticatorData):new Uint8Array(0);
   const sig=assertion.response?.signature?new Uint8Array(assertion.response.signature):new Uint8Array(0);
   if(authData.length<37||(authData[32]&0x01)===0||sig.length===0){
    throw new Error('パスキーの認証結果を確認できませんでした。');
   }
   const maskKey=(await sha512(concat(enc.encode('CM-PASSKEY-MASK-v2:'),salt32,verifiedCredId))).slice(0,32);
   const userSecret=new Uint8Array(32);
   for(let i=0;i<32;i++)userSecret[i]=maskedSecret[i]^maskKey[i];
   if(assertion.response?.userHandle){
    const uh=new Uint8Array(assertion.response.userHandle);
    if(uh.length===32&&!equal(uh,userSecret))throw new Error('作成時に使用したパスキーと一致しません。');
   }
   const extraFactor=await sha512(concat(enc.encode('CM-PASSKEY-FACTOR-v2:'),salt32,verifiedCredId,userSecret));
   return{extraFactor,credentialId};
  }
  const prfInput=await sha(concat(enc.encode('CryptoMatrix-WebAuthn-PRF-v1:'),salt32));
  const assertion=await navigator.credentials.get({
   publicKey:{
    challenge:crypto.getRandomValues(new Uint8Array(32)),
    rpId,
    allowCredentials:[{type:'public-key',id:credentialId}],
    userVerification:'required',
    timeout:60000,
    extensions:{prf:{eval:{first:prfInput}}}
   }
  });
  if(!assertion)throw new Error('パスキーの認証がキャンセルされました。');
  const extRes=assertion.getClientExtensionResults?.()?.prf;
  if(!extRes?.results?.first){
   throw new Error('この旧形式パスキーバックアップの復号にはWebAuthn PRF拡張対応環境が必要です。');
  }
  const extraFactor=await sha512(new Uint8Array(extRes.results.first));
  return{extraFactor,credentialId};
 }
 async function deriveKeysCME2(password,salt,kdfProfile,extraFactor=null){
  const subt=cryptoAPI(),pwBytes=enc.encode(String(password??''));
  if(!pwBytes.length)throw new Error('このバックアップは暗号化されています。復元用パスワードを入力してください。');
  if(pwBytes.length>4096)throw new Error('復元用パスワードが長すぎます。');
  const iterations=KDF_ITERATIONS[kdfProfile];
  if(!iterations)throw new Error('未対応の暗号化プロファイルです。');
  const keyMaterial=extraFactor&&extraFactor.length
   ?concat(pwBytes,new Uint8Array([0x00,0xff,0x43,0x4d]),extraFactor)
   :pwBytes;
  const baseKey=await subt.importKey('raw',keyMaterial,'PBKDF2',false,['deriveBits']);
  const masterBits=await subt.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-512'},baseKey,512);
  const hkdfKey=await subt.importKey('raw',masterBits,'HKDF',false,['deriveKey']);
  const infoSuffix=extraFactor&&extraFactor.length?concat(enc.encode(':2FA:'),await sha(extraFactor)):new Uint8Array(0);
  const aesKey=await subt.deriveKey({name:'HKDF',hash:'SHA-512',salt,info:concat(enc.encode('CryptoMatrix-CME2-AES256GCM-Key'),infoSuffix)},hkdfKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const hmacKey=await subt.deriveKey({name:'HKDF',hash:'SHA-512',salt,info:concat(enc.encode('CryptoMatrix-CME2-KeyCommit-HMAC'),infoSuffix)},hkdfKey,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
  return{aesKey,hmacKey};
 }
 async function encryptBodyCME2(plainBody,password,kdfProfile=1,twoFaOpts=null){
  if(Array.from(String(password??'')).length<12)throw new Error('復元用パスワードは12文字以上で入力してください。');
  const profile=Number(kdfProfile);if(!(profile in KDF_ITERATIONS))throw new Error('暗号化プロファイルの指定が不正です。');
  const salt=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
  let twoFaMode=0,extraFactor=null,credHeader=new Uint8Array(0);
  if(twoFaOpts?.mode==='keyfile'){
   if(!twoFaOpts.keyfileBytes||!twoFaOpts.keyfileBytes.length)throw new Error('二段階ロック用のキーファイルを選択してください。');
   twoFaMode=1;
   extraFactor=await sha512(twoFaOpts.keyfileBytes);
  }else if(twoFaOpts?.mode==='passkey'){
   twoFaMode=2;
   const prf=await derivePasskeyPrf(salt,null);
   extraFactor=prf.extraFactor;
   if(prf.credentialId.length>512)throw new Error('パスキー識別子が長すぎます。');
   credHeader=new Uint8Array(2+prf.credentialId.length);
   new DataView(credHeader.buffer).setUint16(0,prf.credentialId.length,false);
   credHeader.set(prf.credentialId,2);
  }
  const profileByte=(profile&0x0f)|((twoFaMode&0x03)<<4);
  const header=concat(new Uint8Array([0x43,0x4d,0x45,2,profileByte]),salt,iv,credHeader);
  const {aesKey,hmacKey}=await deriveKeysCME2(password,salt,profile,extraFactor);
  const aad=concat(enc.encode('CME2:AEAD:v2:'),header);
  const ciphertext=new Uint8Array(await cryptoAPI().encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},aesKey,plainBody));
  const commitTag=new Uint8Array(await cryptoAPI().sign('HMAC',hmacKey,concat(header,ciphertext))).slice(0,16);
  return concat(header,commitTag,ciphertext);
 }
 async function decryptBodyCME2(cmeBody,password,twoFaOpts=null){
  if(cmeBody.length<49+16+38+16)throw new Error('暗号化バックアップのデータ長が不正です。');
  const profileByte=cmeBody[4],profile=profileByte&0x0f,twoFaMode=(profileByte>>>4)&0x03;
  const salt=cmeBody.slice(5,37),iv=cmeBody.slice(37,49);
  let headerLen=49,extraFactor=null;
  if(twoFaMode===1){
   if(!twoFaOpts?.keyfileBytes||!twoFaOpts.keyfileBytes.length){
    throw new Error('この暗号化バックアップには「キーファイル（2要素目）」が設定されています。復元欄のキーファイル選択で同じファイルを指定してください。');
   }
   extraFactor=await sha512(twoFaOpts.keyfileBytes);
  }else if(twoFaMode===2){
   if(cmeBody.length<51+16+38+16)throw new Error('パスキー2要素バックアップのヘッダ長が不正です。');
   const credLen=new DataView(cmeBody.buffer,cmeBody.byteOffset+49,2).getUint16(0,false);
   headerLen=51+credLen;
   if(credLen<1||credLen>512||cmeBody.length<headerLen+16+38+16)throw new Error('パスキー識別子の長さが不正です。');
   const credId=cmeBody.slice(51,headerLen);
   const prf=await derivePasskeyPrf(salt,credId);
   extraFactor=prf.extraFactor;
  }
  const header=cmeBody.slice(0,headerLen),commitTag=cmeBody.slice(headerLen,headerLen+16),ciphertext=cmeBody.slice(headerLen+16);
  const {aesKey,hmacKey}=await deriveKeysCME2(password,salt,profile,extraFactor);
  const expectedCommit=new Uint8Array(await cryptoAPI().sign('HMAC',hmacKey,concat(header,ciphertext))).slice(0,16);
  if(!equal(expectedCommit,commitTag)){
   throw new Error(twoFaMode===1?'復元用パスワードまたはキーファイルが違うか、暗号化データが破損しています。':'復元用パスワードが違うか、暗号化データが破損しています。');
  }
  try{
   const aad=concat(enc.encode('CME2:AEAD:v2:'),header);
   const innerBody=new Uint8Array(await cryptoAPI().decrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},aesKey,ciphertext));
   return{innerBody,kdfProfile:profile,twoFaMode};
  }catch(_){throw new Error('復元用パスワードが違うか、暗号化データが破損しています。');}
 }
 function hexTag(b){return[...b].map(v=>v.toString(16).padStart(2,'0')).join('');}
 function renderWords(groups){
  currentMnemonicWords=groups.flat();
  $('seed-words-container').innerHTML=groups.map((group,g)=>(groups.length>1?`<div class="backup-block-title">ブロック ${g+1} / ${groups.length}（この24単語も必須）</div>`:'')+group.map((w,i)=>`<div class="seed-chip"><span class="seed-num">#${String(g*24+i+1).padStart(2,'0')}</span><span class="seed-txt">${escapeHtml(w)}</span></div>`).join('')).join('');
  $('btn-copy-seed').disabled=false;
  const qrBox=$('seed-qr-list');
  if(qrBox&&window.MatrixQRCode){
   const allWordsText=groups.map(g=>g.join(' ')).join('\n');
   const fig=document.createElement('figure'),cap=document.createElement('figcaption'),svg=qrSVG(allWordsText);
   if(svg)fig.appendChild(svg);
   cap.textContent=groups.length===1
    ?'BIP39 24単語シードフレーズ（設定のみ・暗号化なし）\n24単語（QR 1枚）'
    :`BIP39 拡張バックアップ（暗号化なし）\n全${groups.length}ブロック・${groups.length*24}単語を1枚のQRに統合`;
   fig.appendChild(cap);
   qrBox.replaceChildren(fig);
  }
 }
 generateAndRenderSeedPhrase=async function(){
  const request=++backupRequest;currentMnemonicWords=[];$('btn-copy-seed').disabled=true;
  try{
   const s=snapshotBackup(),core=packRecipeTo256Bit(s.cfg,s.includeSeed,s.seed);
   const blocks=s.full?await fullBlocks(s,core):[core],groups=[];
   for(const b of blocks)groups.push(await entropyToBip39Words(b));
   if(request!==backupRequest)return;
   renderWords(groups);
   setStatus('backup-summary',s.full?`拡張バックアップ（暗号化なし）：全${groups.length}ブロック（${groups.length*24}単語）＋ 統合QR 1枚を自動作成しました。サイト名・合言葉・記号リスト・マイレシピ設定を保存。カードシード${s.includeSeed?'も保存':'は未保存（同じカードを別途用意）'}。`:`設定のみ（暗号化なし）：24単語 ＋ QR 1枚を自動作成しました。サイト名・合言葉は含みません。カードシード${s.includeSeed?'を保存':'は未保存'}。`);
  }catch(e){if(request!==backupRequest)return;currentMnemonicWords=[];$('seed-words-container').textContent='バックアップ未作成：'+e.message;if($('seed-qr-list'))$('seed-qr-list').replaceChildren();setStatus('backup-summary',e.message,true);}
 };
 function isFrame(b){return b[0]===0x43&&b[1]===0x58&&b[2]===0x42&&b[3]===2;}
 function parsePlainBody(innerBody,encrypted=false,kdfProfile=null,tagHex='',twoFaMode=0,shamir=null){
  if(innerBody[0]===0x43&&innerBody[1]===0x4d&&innerBody[2]===0x58&&innerBody[3]===2){
   if(innerBody.length<74)throw new Error('拡張データの長さが不正です。');
   const cfgData=unpack256BitToRecipe(innerBody.slice(4,36)),v=new DataView(innerBody.buffer,innerBody.byteOffset,innerBody.byteLength);
   const a=v.getUint16(36,false),b=v.getUint16(38,false),c=v.getUint16(40,false);
   if(a>4096||b>4096||c>1024||42+a+b+c+32!==innerBody.length)throw new Error('保存文字列の長さが不正です。');
   const decoder=new TextDecoder('utf-8',{fatal:true});let pos=42;
   const site=decoder.decode(innerBody.slice(pos,pos+=a)),secret=decoder.decode(innerBody.slice(pos,pos+=b)),symList=decoder.decode(innerBody.slice(pos,pos+=c));
   cfgData.cfg.symList=symList;
   return{...cfgData,site,secret,expected:innerBody.slice(pos,pos+32),full:true,encrypted,kdfProfile,tagHex,twoFaMode,shamir};
  }
  if(innerBody[0]===0x43&&innerBody[1]===0x4d&&innerBody[2]===0x53&&innerBody[3]===2){
   if(innerBody.length<38)throw new Error('設定データの長さが不正です。');
   const cfgData=unpack256BitToRecipe(innerBody.slice(4,36)),v=new DataView(innerBody.buffer,innerBody.byteOffset,innerBody.byteLength);
   const c=v.getUint16(36,false);
   if(c>1024||38+c!==innerBody.length)throw new Error('記号設定の長さが不正です。');
   const decoder=new TextDecoder('utf-8',{fatal:true});
   cfgData.cfg.symList=decoder.decode(innerBody.slice(38,38+c));
   return{...cfgData,full:false,encrypted,kdfProfile,tagHex,twoFaMode,shamir};
  }
  throw new Error('未対応の拡張バックアップ形式です。');
 }
 async function reassembleStreamGroup(groupBlocks,allowOutOfOrder=false){
  const count=groupBlocks.length;if(count<2||count>512)throw new Error('拡張バックアップのブロック数が不正です。');
  const tag=groupBlocks[0].slice(8,12),tagStr=hexTag(tag);
  const expectedCount=new DataView(groupBlocks[0].buffer,groupBlocks[0].byteOffset,groupBlocks[0].byteLength).getUint16(6,false);
  if(expectedCount<2||expectedCount>512)throw new Error('ブロック総数ヘッダが不正です。');
  let ordered=groupBlocks;
  if(allowOutOfOrder){
   const byIdx=new Map();
   for(const b of groupBlocks){
    const v=new DataView(b.buffer,b.byteOffset,b.byteLength),idx=v.getUint16(4,false),tot=v.getUint16(6,false);
    if(!isFrame(b)||tot!==expectedCount||idx<1||idx>expectedCount||!equal(b.slice(8,12),tag))throw new Error('ブロックの欠落・順序違い・別バックアップとの混在を検出しました。');
    if(byIdx.has(idx)&&!equal(byIdx.get(idx),b))throw new Error('同じブロック番号に異なるデータがあります。');
    byIdx.set(idx,b);
   }
   if(byIdx.size!==expectedCount)throw new Error(`全${expectedCount}ブロックのうち${byIdx.size}ブロックしかありません。全ブロックを入力してください。`);
   ordered=Array.from({length:expectedCount},(_,i)=>byIdx.get(i+1));
  }else{
   if(count!==expectedCount)throw new Error(`全${expectedCount}ブロックのうち${count}ブロックしかありません。全ブロックを順番に入力してください。`);
  }
  const parts=[];
  for(let i=0;i<expectedCount;i++){
   const b=ordered[i],v=new DataView(b.buffer,b.byteOffset,b.byteLength);
   if(!isFrame(b)||v.getUint16(4,false)!==i+1||v.getUint16(6,false)!==expectedCount||!equal(b.slice(8,12),tag))throw new Error('ブロックの欠落・順序違い・別バックアップとの混在を検出しました。全ブロックを順に入力してください。');
   parts.push(b.slice(12));
  }
  const stream=concat(...parts),size=new DataView(stream.buffer).getUint32(0,false);
  if(size<38||size>16000||Math.ceil((4+size+32)/20)!==expectedCount||4+size+32>stream.length||stream.slice(4+size+32).some(n=>n!==0))throw new Error('拡張データの長さ・末尾が不正です。');
  const body=stream.slice(4,4+size),hash=await sha(body);
  if(!equal(hash,stream.slice(4+size,4+size+32))||!equal(hash.slice(0,4),tag))throw new Error('バックアップ全体のチェックサムが一致しません。');
  return{body,tagHex:tagStr,blockCount:expectedCount};
 }
 function isShamirBody(body){return body.length>16&&body[0]===0x43&&body[1]===0x4d&&body[2]===0x53&&body[3]===3;}
 async function decodeFull(blocks,password='',allowOutOfOrder=false,twoFaOpts=null){
  if(blocks.length<2||blocks.length>512)throw new Error('拡張バックアップのブロック数が不正です。');
  const groupsByTag=new Map();
  for(const b of blocks){
   if(!isFrame(b))throw new Error('拡張バックアップのフレーム形式が不正です。');
   const tHex=hexTag(b.slice(8,12));
   if(!groupsByTag.has(tHex))groupsByTag.set(tHex,[]);
   groupsByTag.get(tHex).push(b);
  }
  if(groupsByTag.size===1){
   const {body,tagHex}=await reassembleStreamGroup(blocks,allowOutOfOrder);
   if(isShamirBody(body)){
    const m=body[4],n=body[5],k=body[6];
    throw new Error(`秘密分散バックアップ（${m}-of-${n} 分散）のシェア #${k} を確認しました。復元には任意の ${m} シェアが必要です（あと ${m-1} シェア分の24単語ブロックを改行して追加するか、QRを読み取ってください）。`);
   }
   if(body[0]===0x43&&body[1]===0x4d&&body[2]===0x45&&body[3]===2){
    const {innerBody,kdfProfile,twoFaMode}=await decryptBodyCME2(body,password,twoFaOpts);
    return parsePlainBody(innerBody,true,kdfProfile,tagHex,twoFaMode,null);
   }
   return parsePlainBody(body,false,null,tagHex,0,null);
  }
  // Multiple tag groups -> check for Shamir M-of-N shares
  const shareMap=new Map();
  let refM=0,refN=0,refSetId=null,refDataLen=0;
  for(const [,grpBlocks]of groupsByTag){
   const {body}=await reassembleStreamGroup(grpBlocks,true);
   if(!isShamirBody(body)){
    throw new Error('別のバックアップのブロックが混在しています。同じバックアップの全ブロックのみを入力してください。');
   }
   const m=body[4],n=body[5],k=body[6],setId=body.slice(8,16),shareData=body.slice(16);
   if(m<2||n<m||k<1||k>n)throw new Error('秘密分散シェアのヘッダ情報が不正です。');
   if(!refSetId){
    refM=m;refN=n;refSetId=setId;refDataLen=shareData.length;
   }else if(m!==refM||n!==refN||!equal(setId,refSetId)||shareData.length!==refDataLen){
    throw new Error('異なる秘密分散バックアップのシェアが混在しています。同じ作成時のシェア同士を入力してください。');
   }
   shareMap.set(k,{index:k,data:shareData});
  }
  const uniqueShares=[...shareMap.values()];
  if(uniqueShares.length<refM){
   throw new Error(`秘密分散バックアップ（${refM}-of-${refN} 分散）：現在 ${uniqueShares.length} シェア（シェア ${uniqueShares.map(s=>'#'+s.index).join('・')}）のみ入力されています。復元には任意の ${refM} シェアが必要です（あと ${refM-uniqueShares.length} シェア分を追加してください）。`);
  }
  const selected=uniqueShares.slice(0,refM);
  const cmeBody=shamirCombine(selected);
  const cmeHash=await sha(cmeBody);
  if(!equal(cmeHash.slice(0,8),refSetId))throw new Error('秘密分散シェアの合成検証（SHA-256）に失敗しました。');
  if(cmeBody[0]===0x43&&cmeBody[1]===0x4d&&cmeBody[2]===0x45&&cmeBody[3]===2){
   const {innerBody,kdfProfile,twoFaMode}=await decryptBodyCME2(cmeBody,password,twoFaOpts);
   return parsePlainBody(innerBody,true,kdfProfile,hexTag(refSetId.slice(0,4)),twoFaMode,{m:refM,n:refN,usedShares:selected.map(s=>s.index)});
  }
  return parsePlainBody(cmeBody,false,null,hexTag(refSetId.slice(0,4)),0,{m:refM,n:refN,usedShares:selected.map(s=>s.index)});
 }
 function saveUI(){return{cfg:getRecipeConfig(),site:$('sim-site').value,secret:$('sim-secret').value,seed:appliedSeed,seedInput:$('input-seed-number').value,inc:$('chk-include-card-seed').checked,kind:$('backup-kind').value,words:currentMnemonicWords.slice(),box:$('seed-words-container').innerHTML,summary:$('backup-summary').textContent,cqPinLen:$('cq-pin-length')?.value,cqSymLen:$('cq-symbol-length')?.value,cqSymMode:$('cq-symbol-mode')?.value,cqSymList:$('cq-symbol-list')?.value};}
 function restoreUI(s){setRecipeConfig(s.cfg);$('sim-site').value=s.site;$('sim-secret').value=s.secret;if(s.cqPinLen!==undefined&&$('cq-pin-length'))$('cq-pin-length').value=s.cqPinLen;if(s.cqSymLen!==undefined&&$('cq-symbol-length'))$('cq-symbol-length').value=s.cqSymLen;if(s.cqSymMode!==undefined&&$('cq-symbol-mode'))$('cq-symbol-mode').value=s.cqSymMode;if(s.cqSymList!==undefined&&$('cq-symbol-list'))$('cq-symbol-list').value=s.cqSymList;updateMainMatrix(s.seed);$('input-seed-number').value=s.seedInput;$('chk-include-card-seed').checked=s.inc;$('backup-kind').value=s.kind;updateSimulationUI();currentMnemonicWords=s.words;$('seed-words-container').innerHTML=s.box;$('btn-copy-seed').disabled=!s.words.length;setStatus('backup-summary',s.summary);}
 restoreRecipeFromSeedInput=async function(){
  const request=++restoreRequest,statusEl=$('restore-status');$('btn-restore-seed').disabled=true;statusEl.className='status-msg';statusEl.textContent='全ブロックを検証しています…';
  let previous=null;
  try{
   const rawTrimmed=$('input-restore-seed').value.trim();
   const password=$('input-restore-password')?$('input-restore-password').value:'';
   let keyfileBytes=null;
   const kfFile=$('input-restore-keyfile')?.files?.[0]||$('bq-restore-keyfile')?.files?.[0];
   if(kfFile)keyfileBytes=new Uint8Array(await kfFile.arrayBuffer());
   if(rawTrimmed.startsWith('MCBK1:')||rawTrimmed.startsWith('MCQR1:'))throw new Error('旧MCBK1/MCQR1形式のデータは、下の「3. 拡張バックアップ（暗号化）＆ 印刷QRからの復元」の復元欄に入力してください。');
   const words=rawTrimmed.toLowerCase().split(/\s+/).filter(Boolean);
   if(words.length<24||words.length%24!==0||words.length>512*24)throw new Error('24単語単位で全ブロックを順番に入力してください。');
   const blocks=[];for(let i=0;i<words.length;i+=24)blocks.push(await bip39WordsToEntropy(words.slice(i,i+24).join(' ')));
   let data;
   if(isFrame(blocks[0])){
    if(blocks.length===1)throw new Error('これは複数ブロックバックアップの一部です。他のブロックが欠落しています。');
    data=await decodeFull(blocks,password,false,keyfileBytes?{keyfileBytes}:null);
   }else{
    if(blocks.length!==1)throw new Error('この形式の拡張フレーズには対応していません。以前のハッシュ補強版は生成時の旧版で復元してください。');
    data={...unpack256BitToRecipe(blocks[0]),full:false,encrypted:false};
   }
   if(request!==restoreRequest)return;
   previous=saveUI();invalidateBackup();restoring=true;
   setRecipeConfig(data.cfg);
   $('chk-include-card-seed').checked=data.includeCardSeed;
   if(data.includeCardSeed){$('input-seed-number').value=String(data.seedNumber);updateMainMatrix(data.seedNumber);}
   if(data.full){$('sim-site').value=data.site;$('sim-secret').value=data.secret;}
   $('backup-kind').value=data.full?'full':'settings';
   const effective=getRecipeConfig();
   if(Object.keys(effective).some(k=>k!=='symList'&&effective[k]!==data.cfg[k]))throw new Error('この版で復元できない設定値が含まれています。');
   if(data.full){
    if(cardMode(effective))filtered(data.site,data.secret);
    issue='';
    const candidate=evaluateRecipeSteps(data.site||'amazon',data.secret||'taro',effective).map(s=>s.ch).join('');
    if(issue)throw new Error(issue);
    const actual=await sha(enc.encode(candidate));
    if(request!==restoreRequest)throw new Error('別の復元要求が開始されました。');
    if(!equal(actual,data.expected))throw new Error(data.includeCardSeed?'生成値の照合に失敗しました。対応バージョン・設定を確認してください。':'カードシードが未保存で、現在のカードでは生成値が一致しません。生成時と同じカードを適用して再度復元してください。');
   }
   updateSimulationUI();
   await generateAndRenderSeedPhrase();
   if($('input-restore-password'))$('input-restore-password').value='';
   const shamirMsg=data.shamir?`・秘密分散 ${data.shamir.m}-of-${data.shamir.n} 合成済み`:'';
   statusEl.className='status-msg ok';
   statusEl.textContent=data.full
    ?`✅ 全ブロック検証成功（${data.encrypted?'暗号化復号済み':'暗号化なし'}${shamirMsg}）。入力・設定を復元し、生成値も一致しました。`
    :`✅ 設定を復元しました（${data.encrypted?'暗号化復号済み':'24単語'}${shamirMsg}）。サイト名・合言葉は生成時と同じものを別途入力してください。`;
   document.dispatchEvent(new Event('matrix-card-settings-changed'));
  }catch(e){
   if(previous){restoring=true;restoreUI(previous);}
   if(request===restoreRequest){statusEl.className='status-msg err';statusEl.textContent='❌ '+e.message;}
  }finally{restoring=false;if(request===restoreRequest)$('btn-restore-seed').disabled=false;}
 };
 function apply(mode){
  let previous=null;
  try{
   const L=Number($(`cq-${mode}-length`).value);
   if(!Number.isInteger(L)||(mode==='pin'?L<4||L>12:L<16||L>32))throw new Error('対応する長さを選択してください。');
   filtered($('sim-site').value,$('sim-secret').value);
   const cfg=preset(mode,L);
   previous=saveUI();
   updateMainMatrix($('input-seed-number').value);
   if(mode==='symbol')validateSymbols(cfg);
   setRecipeConfig(cfg);updateSimulationUI();void generateAndRenderSeedPhrase();
   document.dispatchEvent(new Event('matrix-card-settings-changed'));
  }catch(e){if(previous){restoring=true;try{restoreUI(previous);}finally{restoring=false;}}setStatus('cq-status',e.message,true);}
 }
 document.addEventListener('DOMContentLoaded',()=>{
  $('btn-blind-mode')?.addEventListener('click',()=>setBlindMode(!blindMode));
  $('cq-pin-apply').addEventListener('click',()=>apply('pin'));
  $('cq-symbol-apply').addEventListener('click',()=>apply('symbol'));
  $('btn-quick-switch-pin')?.addEventListener('click',()=>apply('pin'));
  $('btn-quick-switch-symbol')?.addEventListener('click',()=>apply('symbol'));
  $('btn-toggle-cq')?.addEventListener('click',()=>{
   const cqSec=$('card-quick');
   if(cqSec){cqSec.classList.toggle('is-collapsed');syncCollapseButtons();}
  });
  $('btn-toggle-recipe')?.addEventListener('click',()=>{
   const recSec=$('section-recipe-detail');
   if(recSec){recSec.classList.toggle('is-collapsed');syncCollapseButtons();}
  });
  $('btn-use-recipe')?.addEventListener('click',()=>{
   const cfg=getRecipeConfig();
   if(cardMode(cfg)){
    if($('rc-len-mode'))$('rc-len-mode').value='0';
    if(cfg.lenMode===3&&$('rc-sym-mode'))$('rc-sym-mode').value='0';
   }
   if($('section-recipe-detail'))$('section-recipe-detail').classList.remove('is-collapsed');
   if($('card-quick'))$('card-quick').classList.add('is-collapsed');
   syncCollapseButtons();
   updateSimulationUI();
   void generateAndRenderSeedPhrase();
   document.dispatchEvent(new Event('matrix-card-settings-changed'));
  });
  for(const rid of['btn-reset-recipe','btn-random-recipe']){
   $(rid)?.addEventListener('click',()=>{
    if($('section-recipe-detail'))$('section-recipe-detail').classList.remove('is-collapsed');
    if($('card-quick'))$('card-quick').classList.add('is-collapsed');
    syncCollapseButtons();
   });
  }
  document.querySelectorAll('#section-recipe-detail .rc-input').forEach(el=>{
   const onManualRecipeEdit=()=>{
    const cfg=getRecipeConfig();
    if(el.id!=='rc-len-mode'&&el.id!=='rc-len-val'&&cardMode(cfg)){
     if($('rc-len-mode'))$('rc-len-mode').value='0';
     if(cfg.lenMode===3&&$('rc-sym-mode'))$('rc-sym-mode').value='0';
    }
   };
   el.addEventListener('input',onManualRecipeEdit,true);
   el.addEventListener('change',onManualRecipeEdit,true);
  });
  $('btn-sticky-play')?.addEventListener('click',()=>playMatrixTrace());
  $('btn-sticky-copy')?.addEventListener('click',()=>$('btn-copy-pw')?.click());
  $('btn-sticky-top')?.addEventListener('click',()=>{
   const stageEl=$('matrix-stage-box')||$('div-encrypto-matrix-main');
   if(stageEl)window.scrollTo({top:Math.max(0,window.scrollY+stageEl.getBoundingClientRect().top-8),behavior:'smooth'});
  });
  const liveRow=$('live-result-row'),stickyBar=$('sticky-pw-bar');
  if(liveRow&&stickyBar){
   const updateStickyVisibility=()=>{
    const r=liveRow.getBoundingClientRect();
    const outOfView=r.bottom<0||r.top>window.innerHeight;
    stickyBar.classList.toggle('visible',outOfView);
   };
   window.addEventListener('scroll',updateStickyVisibility,{passive:true});
   window.addEventListener('resize',updateStickyVisibility,{passive:true});
   updateStickyVisibility();
  }
  $('cq-pin-length').addEventListener('change',()=>{
   if(getRecipeConfig().lenMode===3)apply('pin');
   else setStatus('cq-status','「銀行などの暗証番号（数字のみ）」の桁数を変更しました。「このモードを使う」を押すと反映されます。');
  });
  $('cq-symbol-length').addEventListener('change',()=>{
   if(getRecipeConfig().lenMode===5)apply('symbol');
   else setStatus('cq-status','「パスワード（英大小・数字・記号）」の文字数を変更しました。「このモードを使う」を押すと反映されます。');
  });
  for(const id of['cq-symbol-mode','cq-symbol-list'])$(id).addEventListener(id==='cq-symbol-list'?'input':'change',()=>{
   if(getRecipeConfig().lenMode===5){$('rc-sym-mode').value=$('cq-symbol-mode').value;$('rc-sym-list').value=$('cq-symbol-list').value;updateSimulationUI();document.dispatchEvent(new Event('matrix-card-settings-changed'));}
   else setStatus('cq-status','記号ルールを変更しました。「パスワード（英大小・数字・記号）」の「このモードを使う」を押すと反映されます。');
  });
  $('backup-kind').addEventListener('change',()=>{invalidateBackup();void generateAndRenderSeedPhrase();});
  $('btn-copy-pw')?.addEventListener('click',async e=>{
   e.stopImmediatePropagation();
   const pw=currentEvalSteps.map(s=>s.ch).join('');
   if(!pw)return;
   try{
    await copyWithAutoClear(pw,()=>{if($('sim-step-banner'))$('sim-step-banner').textContent='🛡️ クリップボードのパスワードを自動消去しました。';});
    if($('sim-step-banner'))$('sim-step-banner').textContent='✅ パスワードをコピーしました（セキュリティ保護のため30秒後にクリップボードから自動消去されます）。';
    const btn=$('btn-copy-pw');
    if(btn){
     const origText=btn.dataset.origText||btn.textContent;
     btn.dataset.origText=origText;
     btn.textContent='✅ コピー済';
     setTimeout(()=>{btn.textContent=origText;},1800);
    }
    const sb=$('btn-sticky-copy');
    if(sb){const orig=sb.textContent;sb.textContent='✅ コピー済';setTimeout(()=>{sb.textContent=orig;},1800);}
   }catch(_){}
  },true);
  $('btn-copy-seed').addEventListener('click',async e=>{
   e.stopImmediatePropagation();
   if(!currentMnemonicWords.length)return;
   try{
    const words=currentMnemonicWords.slice();
    const text=Array.from({length:words.length/24},(_,i)=>words.slice(i*24,i*24+24).join(' ')).join('\n');
    await copyWithAutoClear(text,()=>setStatus('backup-summary','🛡️ クリップボードの復元フレーズを自動消去しました。'));
    setStatus('backup-summary',`${words.length/24}ブロック・${words.length}単語をコピーしました（30秒後にクリップボードから自動消去されます）。`);
   }catch(_){setStatus('backup-summary','コピーできませんでした。画面の全ブロックを順番どおり控えてください。',true);}
  },true);
  $('btn-zeroize')?.addEventListener('click',async()=>{
   stopMatrixTrace();
   if(clipTimer){clearTimeout(clipTimer);clipTimer=null;}
   try{await navigator.clipboard.writeText('');}catch(_){}
   if($('input-seed-number'))$('input-seed-number').value='0';
   updateMainMatrix(0);
   setRecipeConfig({});
   if($('cq-pin-length'))$('cq-pin-length').value='6';
   if($('cq-symbol-length'))$('cq-symbol-length').value='20';
   if($('cq-symbol-mode'))$('cq-symbol-mode').value='2';
   if($('cq-symbol-list'))$('cq-symbol-list').value='-_!#';
   if($('chk-include-card-seed'))$('chk-include-card-seed').checked=true;
   if($('backup-kind'))$('backup-kind').value='settings';
   for(const id of['sim-site','sim-secret','input-restore-seed','input-restore-password','input-restore-keyfile','bq-password','bq-password-confirm','bq-import','bq-restore-password','bq-keyfile','bq-restore-keyfile']){
    if($(id))$(id).value='';
   }
   if($('restore-status')){$('restore-status').className='status-msg';$('restore-status').textContent='';}
   $('bq-clear')?.click();
   $('bq-reset-parts')?.click();
   updateSimulationUI();
   if($('sim-step-banner'))$('sim-step-banner').textContent='🛡️ 緊急消去完了：カード配列シード番号・サイト名・合言葉・レシピ設定・暗号化表示・クリップボードをすべて初期化・消去しました。';
  });
 });
 window.MatrixCardPreset=Object.freeze({
  version:'card-reading-v2',
  getAppliedSeed:()=>appliedSeed,
  getIssue:()=>issue,
  isFrame:b=>isFrame(b),
  isShamirBody:b=>isShamirBody(b),
  reassembleStreamGroup:(blocks,allowOutOfOrder)=>reassembleStreamGroup(blocks,allowOutOfOrder),
  qrSVG:text=>qrSVG(text),
  kdfLabel:p=>KDF_LABELS[p]||KDF_LABELS[1],
  copyWithAutoClear:(text,onCleared)=>copyWithAutoClear(text,onCleared),
  estimatePasswordEntropy:pw=>estimatePasswordEntropy(pw),
  syncBlindInputs:()=>syncBlindInputs(),
  setBlindMode:active=>setBlindMode(active),
  isBlindMode:()=>blindMode,
  createEncryptedBip39Backup:async(extended,password,kdfProfile=1,options={})=>{
   if(parseSeedValue($('input-seed-number').value)!==appliedSeed){updateMainMatrix($('input-seed-number').value);updateSimulationUI();}
   const s=snapshotBackup(extended,true),core=packRecipeTo256Bit(s.cfg,true,s.seed);
   const plainBody=await buildPlainBody(s,core);
   const twoFaOpts=options?.twoFaMode&&options.twoFaMode!=='none'?{mode:options.twoFaMode,keyfileBytes:options.keyfileBytes}:null;
   const cmeBody=await encryptBodyCME2(plainBody,password,kdfProfile,twoFaOpts);
   const shamirM=Number(options?.shamirM||1),shamirN=Number(options?.shamirN||1);
   if(shamirN>1){
    const setId=(await sha(cmeBody)).slice(0,8);
    const rawShares=shamirSplit(cmeBody,shamirM,shamirN);
    const shares=[],allGroups=[];
    for(let k=1;k<=shamirN;k++){
     const shareBody=concat(new Uint8Array([0x43,0x4d,0x53,3,shamirM,shamirN,k,0]),setId,rawShares[k-1]);
     const sBlocks=await frameBodyToBlocks(shareBody),sGroups=[];
     for(const b of sBlocks)sGroups.push(await entropyToBip39Words(b));
     shares.push({index:k,m:shamirM,n:shamirN,groups:sGroups,blocks:sBlocks});
     allGroups.push(...sGroups);
    }
    return{groups:allGroups,shares,blocks:shares.flatMap(x=>x.blocks),tagHex:hexTag(setId.slice(0,4)),kdfProfile:Number(kdfProfile),extended:!!extended,shamirM,shamirN,twoFaMode:options?.twoFaMode||'none'};
   }
   const blocks=await frameBodyToBlocks(cmeBody),groups=[];
   for(const b of blocks)groups.push(await entropyToBip39Words(b));
   const tagHex=hexTag(blocks[0].slice(8,12));
   return{groups,shares:null,blocks,tagHex,kdfProfile:Number(kdfProfile),extended:!!extended,shamirM:1,shamirN:1,twoFaMode:options?.twoFaMode||'none'};
  },
  decodeBip39Blocks:async(words,password='',allowOutOfOrder=true,twoFaOpts=null)=>{
   const blocks=[];for(let i=0;i<words.length;i+=24)blocks.push(await bip39WordsToEntropy(words.slice(i,i+24).join(' ')));
   if(!isFrame(blocks[0])){
    if(blocks.length!==1)throw new Error('24単語単位のブロック形式が不正です。');
    return{...unpack256BitToRecipe(blocks[0]),full:false,encrypted:false,kdfProfile:null,tagHex:'',blockCount:1,twoFaMode:0,shamir:null};
   }
   if(blocks.length===1)throw new Error('これは複数ブロックバックアップ（24単語×必要ブロック数）の一部です。他のブロックが欠落しています。');
   const decoded=await decodeFull(blocks,password,allowOutOfOrder,twoFaOpts);
   return{...decoded,blockCount:blocks.length};
  },
  decodeExtendedBip39:async(words,password='',twoFaOpts=null)=>{
   const blocks=[];for(let i=0;i<words.length;i+=24)blocks.push(await bip39WordsToEntropy(words.slice(i,i+24).join(' ')));
   if(!isFrame(blocks[0]))return null;
   if(blocks.length===1)throw new Error('これは拡張バックアップの一部です。他のブロックが欠落しています。');
   return decodeFull(blocks,password,true,twoFaOpts);
  }
 });
})();
/* END CARD READING v2 + EXTENDED BIP39 BACKUP v2 */
