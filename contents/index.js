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
try {
  Object.defineProperty(window, 'currentEvalSteps', {
    get: () => currentEvalSteps,
    set: (v) => { currentEvalSteps = v; },
    configurable: true
  });
} catch (_) {}
let currentDisplayMode = 'recipe';
  if (document.getElementById('gesture-design-bar')) document.getElementById('gesture-design-bar').style.display = 'none'; // 'recipe' | 'stroke'
let traceTimer = null;
let traceIsPaused = false;
let traceCurrentIndex = 0;
let traceStepRunner = null;
let traceLastBannerText = '';
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

function estimatePasswordEntropy(pw) {
  const chars = Array.from(String(pw ?? ''));
  if (!chars.length) return { bits: 0, pool: 0, unique: 0, length: 0 };
  let pool = 0;
  if (chars.some(c => /[0-9]/.test(c))) pool += 10;
  if (chars.some(c => /[a-z]/.test(c))) pool += 26;
  if (chars.some(c => /[A-Z]/.test(c))) pool += 26;
  if (chars.some(c => /[^A-Za-z0-9\s]/.test(c))) pool += 32;
  if (chars.some(c => /\s/.test(c))) pool += 1;
  if (!pool) pool = 32;
  const unique = new Set(chars).size;
  const bits = Math.round(chars.length * Math.log2(pool) * 10) / 10;
  return { bits, pool, unique, length: chars.length };
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
  const site = (siteRaw || '1Password').trim() || '1';
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

let transferFeedbackTimer = null;

function updateTransferButtonsUI() {
  if (transferFeedbackTimer) {
    clearTimeout(transferFeedbackTimer);
    transferFeedbackTimer = null;
  }
  const siteInput = document.getElementById('sim-site');
  const siteVal = (siteInput?.value || '').trim();
  const isMaster = siteVal.toLowerCase().includes('master');

  const mainBtn = document.getElementById('btn-transfer-to-keeweb');
  if (mainBtn) {
    if (isMaster) {
      mainBtn.innerHTML = '🔑 KeeWebマスターパスワードに転送';
      mainBtn.title = '算出したパスワードをKeeWebのマスターパスワード入力欄に転送して自動設定します';
    } else {
      mainBtn.innerHTML = siteVal ? `📥 KeePassエントリーに追加 「${escapeHtml(siteVal)}」` : '📥 KeePassエントリーに追加';
      mainBtn.title = siteVal ? `「${siteVal}」のパスワードとしてKeeWebのエントリーに転送・追加します` : '算出したパスワードをKeeWebのエントリーに転送・追加します';
    }
    mainBtn.style.background = '';
    mainBtn.style.borderColor = '';
    mainBtn.style.color = '';
  }

  const stickyBtn = document.getElementById('btn-sticky-transfer');
  if (stickyBtn) {
    if (isMaster) {
      stickyBtn.innerHTML = '🔑 マスターPW転送';
      stickyBtn.title = 'KeeWebマスターパスワードに転送';
    } else {
      stickyBtn.innerHTML = '📥 KeePass追加';
      stickyBtn.title = siteVal ? `「${siteVal}」をKeePassエントリーに追加` : 'KeePassエントリーに追加';
    }
  }
}

function updateSimulationUI() {
  stopMatrixTrace();
  updateTransferButtonsUI();
  if (currentDisplayMode === 'stroke') {
    updateStrokeGestureUI();
    return;
  }
  const designBar = document.getElementById('gesture-design-bar');
  if (designBar) designBar.style.display = 'none';
  const cfg = getRecipeConfig();
  const site = document.getElementById('sim-site')?.value || '1Password';
  const secret = document.getElementById('sim-secret')?.value || 'KeePass';
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

let lastPlayTrigger = 'recipe'; // 'recipe' | 'stroke'

function updateTraceButtonsUI(state) {
  // state: 'idle' | 'playing' | 'paused'
  const isPlaying = state === 'playing';
  const isPaused = state === 'paused';
  const isActive = isPlaying || isPaused;

  const playBtn = document.getElementById('btn-play-trace');
  const strokeBtn = document.getElementById('btn-play-stroke');
  const pauseBtn = document.getElementById('btn-pause-trace');
  const stopBtn = document.getElementById('btn-stop-trace');

  const stickyPlay = document.getElementById('btn-sticky-play');
  const stickyStroke = document.getElementById('btn-sticky-stroke');
  const stickyPause = document.getElementById('btn-sticky-pause');
  const stickyStop = document.getElementById('btn-sticky-stop');

  if (isActive) {
    // ユーザーが再生を押したまさにその場所（同一座標・同一スロット）に一時停止ボタンを表示！
    const targetPlayBtn = (lastPlayTrigger === 'stroke') ? strokeBtn : playBtn;
    if (pauseBtn && targetPlayBtn && targetPlayBtn.parentNode) {
      targetPlayBtn.parentNode.insertBefore(pauseBtn, targetPlayBtn);
      if (stopBtn) {
        pauseBtn.parentNode.insertBefore(stopBtn, pauseBtn.nextSibling);
      }
    }
    const targetStickyBtn = (lastPlayTrigger === 'stroke') ? stickyStroke : stickyPlay;
    if (stickyPause && targetStickyBtn && targetStickyBtn.parentNode) {
      targetStickyBtn.parentNode.insertBefore(stickyPause, targetStickyBtn);
      if (stickyStop) {
        stickyPause.parentNode.insertBefore(stickyStop, stickyPause.nextSibling);
      }
    }

    if (playBtn) playBtn.style.display = 'none';
    if (strokeBtn) strokeBtn.style.display = 'none';
    if (stickyPlay) stickyPlay.style.display = 'none';
    if (stickyStroke) stickyStroke.style.display = 'none';

    if (pauseBtn) {
      pauseBtn.style.display = 'inline-block';
      pauseBtn.textContent = isPaused ? '▶ 再開' : '⏸ 一時停止';
      pauseBtn.title = isPaused ? 'クリックして続きから再生を再開します' : 'クリックして再生を一時停止します（自分のペースで1文字ずつ確認できます）';
    }
    if (stopBtn) {
      stopBtn.style.display = 'inline-block';
    }

    if (stickyPause) {
      stickyPause.style.display = 'inline-block';
      stickyPause.textContent = isPaused ? '▶ 再開' : '⏸ 一時停止';
    }
    if (stickyStop) {
      stickyStop.style.display = 'inline-block';
    }

    document.body.classList.add('trace-playing');
  } else {
    // 停止時は元の配置順に綺麗に戻す
    const mainBar = document.getElementById('trace-controls-bar');
    if (mainBar && strokeBtn && pauseBtn && stopBtn) {
      mainBar.insertBefore(pauseBtn, strokeBtn.nextSibling);
      mainBar.insertBefore(stopBtn, pauseBtn.nextSibling);
    }
    const stickyBar = document.getElementById('sticky-controls-bar');
    if (stickyBar && stickyStroke && stickyPause && stickyStop) {
      stickyBar.insertBefore(stickyPause, stickyStroke.nextSibling);
      stickyBar.insertBefore(stickyStop, stickyPause.nextSibling);
    }

    if (playBtn) playBtn.style.display = 'inline-block';
    if (strokeBtn) strokeBtn.style.display = 'inline-block';
    if (stickyPlay) stickyPlay.style.display = 'inline-block';
    if (stickyStroke) stickyStroke.style.display = 'inline-block';

    if (pauseBtn) {
      pauseBtn.style.display = 'none';
      pauseBtn.textContent = '⏸ 一時停止';
    }
    if (stopBtn) stopBtn.style.display = 'none';

    if (stickyPause) {
      stickyPause.style.display = 'none';
      stickyPause.textContent = '⏸ 一時停止';
    }
    if (stickyStop) stickyStop.style.display = 'none';

    document.body.classList.remove('trace-playing');
  }
}

let strokePreviewTimer = null;
let strokePreviewState = null;
let strokeResumePreviewRunner = null;

function hideStrokeHUD() {
  const hud = document.getElementById('stroke-char-hud');
  if (hud) {
    hud.classList.remove('is-visible');
    hud.style.display = 'none';
  }
}

function togglePauseMatrixTrace() {
  if (!traceTimer && !strokePreviewTimer && !traceIsPaused) return;

  const banner = document.getElementById('sim-step-banner');

  if (!traceIsPaused) {
    if (traceTimer) {
      clearInterval(traceTimer);
      traceTimer = null;
    }
    if (strokePreviewTimer) {
      clearTimeout(strokePreviewTimer);
      strokePreviewTimer = null;
      if (strokePreviewState) {
        const elapsed = Date.now() - (strokePreviewState.startedAt || Date.now());
        strokePreviewState.remainingMs = Math.max(250, (strokePreviewState.duration || 1000) - elapsed);
      }
    }
    traceIsPaused = true;
    updateTraceButtonsUI('paused');
    if (banner) {
      traceLastBannerText = banner.textContent;
      banner.textContent = '⏸ 一時停止中（「▶ 再開」を押すと続きから再生します）';
    }
  } else {
    traceIsPaused = false;
    updateTraceButtonsUI('playing');
    if (banner && traceLastBannerText) {
      banner.textContent = traceLastBannerText;
    }
    const speed = Number(document.getElementById('sim-speed')?.value) || 500;
    if (strokePreviewState && typeof strokeResumePreviewRunner === 'function') {
      strokeResumePreviewRunner();
    } else if (traceStepRunner) {
      traceTimer = setInterval(() => {
        const nextIdx = traceCurrentIndex + 1;
        traceStepRunner(nextIdx);
      }, speed);
    }
  }
}

function stopMatrixTrace() {
  if (strokePreviewTimer) {
    clearTimeout(strokePreviewTimer);
    strokePreviewTimer = null;
  }
  strokePreviewState = null;
  strokeResumePreviewRunner = null;
  hideStrokeHUD();
  if (traceTimer) {
    clearInterval(traceTimer);
    traceTimer = null;
  }
  traceIsPaused = false;
  traceStepRunner = null;
  traceCurrentIndex = 0;
  clearHighlightsOnly();
  updateTraceButtonsUI('idle');
  if (window.MatrixCardPreset && window.MatrixCardPreset.syncBlindInputs) window.MatrixCardPreset.syncBlindInputs();
}

function playMatrixTrace() {
  lastPlayTrigger = 'recipe';
  const modeChanged = currentDisplayMode !== 'recipe';
  currentDisplayMode = 'recipe';
  const designBar = document.getElementById('gesture-design-bar');
  if (designBar) designBar.style.display = 'none';
  stopMatrixTrace();
  if (modeChanged || !currentEvalSteps || currentEvalSteps.length === 0) {
    updateSimulationUI();
  }
  if (!currentEvalSteps || currentEvalSteps.length === 0) return;
  updateTraceButtonsUI('playing');
  if (window.MatrixCardPreset && window.MatrixCardPreset.syncBlindInputs) window.MatrixCardPreset.syncBlindInputs();
  const stageEl = document.getElementById('matrix-stage-box') || document.getElementById('div-encrypto-matrix-main');
  if (stageEl) {
    const r = stageEl.getBoundingClientRect();
    if (r.top < -10 || r.top > 110) {
      window.scrollTo({ top: Math.max(0, window.scrollY + r.top - 8), behavior: 'smooth' });
    }
  }

  const speed = Number(document.getElementById('sim-speed')?.value) || 500;
  const squares = document.querySelectorAll('#div-encrypto-matrix-main .square');
  const pwSpans = document.querySelectorAll('#sim-output-pw .pw-char-span');
  const logLines = document.querySelectorAll('#sim-trace-log .trace-line');
  const banner = document.getElementById('sim-step-banner');

  const showStep = (stepIndex) => {
    clearHighlightsOnly();
    if (stepIndex >= currentEvalSteps.length) {
      stopMatrixTrace();
      if (banner) banner.textContent = '✅ 全文字のルート再生が完了しました。';
      return;
    }

    traceCurrentIndex = stepIndex;
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

  traceStepRunner = (idx) => showStep(idx);
  showStep(0);
  traceCurrentIndex = 0;
  traceTimer = setInterval(() => {
    const nextIdx = traceCurrentIndex + 1;
    traceStepRunner(nextIdx);
  }, speed);
}

function clearHighlightsOnly() {
  document.querySelectorAll('#div-encrypto-matrix-main .square').forEach(el => {
    el.classList.remove('active-tile', 'fallback-tile', 'stroke-active-tile', 'stroke-preview-tile', 'stroke-start-tile');
  });
  document.querySelectorAll('#div-encrypto-matrix-main .corner-text').forEach(el => {
    el.classList.remove('active-char-spot', 'preview-char-spot', 'start-char-spot');
  });
  document.querySelectorAll('#sim-output-pw .pw-char-span.playing-now').forEach(el => {
    el.classList.remove('playing-now');
  });
  document.querySelectorAll('#sim-trace-log .trace-line.active-trace-line').forEach(el => {
    el.classList.remove('active-trace-line');
  });
}

/* =====================================================================
 * パターンルート（5×8盤面・公式ルート描画）方式
 * 物理カード上で「0, 1, 2, 5, 7」や「C, L, U, S, O」など直感的な形を
 * Androidのパターンのように指でなぞるだけで、誰でも迷わずパスワードを復元できる公式パターン機能
 * ===================================================================== */
const GESTURE_DESIGNS = {
  // === 数字のデザイン ===
  '0': {
    symbol: '0',
    name: '外周一周',
    desc: '左上から外周を時計回りに一周する完全上下・左右対称ルート',
    category: '数字のデザイン',
    getStrokes: () => {
      const pts = [];
      for (let c = 0; c < 8; c++) pts.push([0, c]);
      for (let r = 1; r < 5; r++) pts.push([r, 7]);
      for (let c = 6; c >= 0; c--) pts.push([4, c]);
      for (let r = 3; r >= 1; r--) pts.push([r, 0]);
      return [pts];
    },
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  '1': {
    symbol: '1',
    name: '上から下へ直進',
    desc: '中央列（第4列）を上から下へ垂直直進するルート',
    category: '数字のデザイン',
    getStrokes: (col = 3) => {
      const c = Math.max(0, Math.min(7, col));
      return [[[0, c], [1, c], [2, c], [3, c], [4, c]]];
    },
    getPts: function(col = 3) { return [].concat(...this.getStrokes(col)); }
  },
  '2': {
    symbol: '2',
    name: 'Z型スラッシュ',
    desc: '上辺を右へ、中央を斜め左下に駆け下り、下辺を右へ抜ける完全点対称ルート',
    category: '数字のデザイン',
    aliasOf: 'Z',
    getStrokes: () => GESTURE_DESIGNS['Z'].getStrokes(),
    getPts: () => GESTURE_DESIGNS['Z'].getPts()
  },
  '5': {
    symbol: '5',
    name: 'ジグザグ',
    desc: '右上から、左→下→右→下→左へ進みます',
    category: '数字のデザイン',
    getStrokes: () => {
      const pts = [];
      for (let c = 7; c >= 0; c--) pts.push([0, c]);
      pts.push([1, 0]);
      for (let c = 0; c < 8; c++) pts.push([2, c]);
      pts.push([3, 7]);
      for (let c = 7; c >= 0; c--) pts.push([4, c]);
      return [pts];
    },
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  '7': {
    symbol: '7',
    name: 'コーナー',
    desc: '左上から右端まで進み、そのまま下へ進みます',
    category: '数字のデザイン',
    getStrokes: () => {
      const pts = [];
      for (let c = 0; c < 8; c++) pts.push([0, c]);
      for (let r = 1; r < 5; r++) pts.push([r, 7]);
      return [pts];
    },
    getPts: function() { return [].concat(...this.getStrokes()); }
  },

  // === 英字のデザイン ===
  'C': {
    symbol: 'C',
    name: 'コの字（左壁）',
    desc: '最上段を左へ進み、左端を下って最下段を右へ進む完全上下対称ルート',
    category: '英字のデザイン',
    getStrokes: () => {
      const pts = [];
      for (let c = 7; c >= 0; c--) pts.push([0, c]);
      for (let r = 1; r < 5; r++) pts.push([r, 0]);
      for (let c = 1; c < 8; c++) pts.push([4, c]);
      return [pts];
    },
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'L': {
    symbol: 'L',
    name: '下へ進み最下段を右へ',
    desc: '左上から下へ進み、最下段を右へ進みます',
    category: '英字のデザイン',
    getStrokes: () => {
      const pts = [];
      for (let r = 0; r < 5; r++) pts.push([r, 0]);
      for (let c = 1; c < 8; c++) pts.push([4, c]);
      return [pts];
    },
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'U': {
    symbol: 'U',
    name: '下→右→上',
    desc: '左上から下→右→上へ進む左右対称ルート（推奨16文字）',
    category: '英字のデザイン',
    getStrokes: () => {
      const pts = [];
      for (let r = 0; r < 5; r++) pts.push([r, 0]);
      for (let c = 1; c < 7; c++) pts.push([4, c]);
      for (let r = 4; r >= 0; r--) pts.push([r, 7]);
      return [pts];
    },
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'S': {
    symbol: 'S',
    name: '5と共通',
    desc: '右上から、左→下→右→下→左へ進みます（5と共通の形）',
    category: '英字のデザイン',
    aliasOf: '5',
    getStrokes: () => GESTURE_DESIGNS['5'].getStrokes(),
    getPts: () => GESTURE_DESIGNS['5'].getPts()
  },
  'O': {
    symbol: 'O',
    name: '0と共通',
    desc: '左上から外周を一周します（0と共通の形）',
    category: '英字のデザイン',
    aliasOf: '0',
    getStrokes: () => GESTURE_DESIGNS['0'].getStrokes(),
    getPts: () => GESTURE_DESIGNS['0'].getPts()
  },
  'X': {
    symbol: 'X',
    name: '2画クロス',
    desc: '書き順通り左上から右下、右上から左下へ2画で交差する完全対称クロス（推奨ジャスト16文字）',
    category: '英字のデザイン',
    getStrokes: () => [
      // 1画目: 左上から右下へ
      [[0, 0], [1, 1], [1, 2], [2, 3], [2, 4], [3, 5], [3, 6], [4, 7]],
      // 2画目: 右上から左下へ
      [[0, 7], [1, 6], [1, 5], [2, 4], [2, 3], [3, 2], [3, 1], [4, 0]]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'Z': {
    symbol: 'Z',
    name: 'Zスラッシュ',
    desc: '上辺を右へ、中央を斜め左下に駆け下り、下辺を右へ抜ける完全点対称ルート（180度回転対称）',
    category: '英字のデザイン',
    getStrokes: () => [
      [
        [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7],
        [1, 6], [1, 5],
        [2, 4], [2, 3],
        [3, 2], [3, 1],
        [4, 0], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [4, 7]
      ]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'N': {
    symbol: 'N',
    name: 'Nスラッシュ',
    desc: '左端を駆け上がり、中央を斜めに下り、右端を天へ駆け上がる完全点対称ルート（推奨16文字）',
    category: '英字のデザイン',
    getStrokes: () => [
      [
        [4, 0], [3, 0], [2, 0], [1, 0], [0, 0],
        [1, 1], [1, 2],
        [2, 3], [2, 4],
        [3, 5], [3, 6],
        [4, 7], [3, 7], [2, 7], [1, 7], [0, 7]
      ]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },

  // === 漢字・カナのデザイン ===
  'ko': {
    symbol: 'コ',
    name: 'カタカナ「コ」',
    desc: '最上段を右へ進み、右端を下って最下段を左へ戻る完全上下対称ルート',
    category: 'カナのデザイン',
    getStrokes: () => {
      const pts = [];
      for (let c = 0; c < 8; c++) pts.push([0, c]);
      for (let r = 1; r < 5; r++) pts.push([r, 7]);
      for (let c = 6; c >= 0; c--) pts.push([4, c]);
      return [pts];
    },
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'ichi': {
    symbol: '一',
    name: '漢字の「一」',
    desc: '盤面中央（3行目）を水平に真一文字で横断する完全対称ルート',
    category: '漢字のデザイン',
    getStrokes: () => {
      const pts = [];
      for (let c = 0; c < 8; c++) pts.push([2, c]);
      return [pts];
    },
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'ni': {
    symbol: '二',
    name: '漢字の「二」',
    desc: '書き順通り第2行・第4行を2画で引く、端正な二（推奨ジャスト16文字）',
    category: '漢字のデザイン',
    getStrokes: () => [
      // 1画目: 上の横線 (全幅8マス)
      [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7]],
      // 2画目: 下の横線 (全幅8マス)
      [[3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7]]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'san': {
    symbol: '三',
    name: '漢字の「三」',
    desc: '書き順通り1行目・3行目・5行目を3画でまっすぐ引く、端正な三（全24文字）',
    category: '漢字のデザイン',
    getStrokes: () => [
      // 1画目: 1行目
      [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7]],
      // 2画目: 3行目
      [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6], [2, 7]],
      // 3画目: 5行目
      [[4, 0], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [4, 7]]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'ju': {
    symbol: '十',
    name: '漢字の「十」',
    desc: '書き順通り横棒を引いてから中央の縦柱を貫く、完全上下対称十字（全13文字）',
    category: '漢字のデザイン',
    getStrokes: () => [
      // 1画目: 横棒 (全幅8マス)
      [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6], [2, 7]],
      // 2画目: 縦棒 (全高5マス)
      [[0, 3], [1, 3], [2, 3], [3, 3], [4, 3]]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'kawa': {
    symbol: '川',
    name: '漢字の「川」',
    desc: '書き順通り左・中・右の3本の川を縦に3画で引く、純粋な川の字（全15文字）',
    category: '漢字のデザイン',
    getStrokes: () => [
      // 1画目: 左川
      [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
      // 2画目: 中川
      [[0, 3], [1, 3], [2, 3], [3, 3], [4, 3]],
      // 3画目: 右川
      [[0, 7], [1, 7], [2, 7], [3, 7], [4, 7]]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'yama': {
    symbol: '山',
    name: '漢字の「山」',
    desc: '正しい書き順で中央主峰を立て、左から底辺を回って右峰を結ぶ純粋な山（全17文字）',
    category: '漢字のデザイン',
    getStrokes: () => [
      // 1画目: 中央の主峰
      [[0, 3], [1, 3], [2, 3], [3, 3], [4, 3]],
      // 2画目: 左の峰から底辺を通り右峰へ
      [[2, 0], [3, 0], [4, 0], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [4, 7], [3, 7], [2, 7]]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'hi': {
    symbol: '日',
    name: '漢字の「日」',
    desc: '正しい書き順で左縦→上横右縦→中横→底横と描く、端正な日（全28文字）',
    category: '漢字のデザイン',
    getStrokes: () => [
      // 1画目: 左縦
      [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
      // 2画目: 上横〜右縦
      [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [1, 7], [2, 7], [3, 7], [4, 7]],
      // 3画目: 中横
      [[2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6]],
      // 4画目: 底横
      [[4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6]]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'ta': {
    symbol: '田',
    name: '漢字の「田」',
    desc: '正しい書き順で外枠→中縦→中横→底横を描く、均整の取れた純粋な田（全31文字）',
    category: '漢字のデザイン',
    getStrokes: () => [
      // 1画目: 左縦
      [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
      // 2画目: 上横〜右縦
      [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [1, 7], [2, 7], [3, 7], [4, 7]],
      // 3画目: 中縦
      [[1, 3], [2, 3], [3, 3]],
      // 4画目: 中横
      [[2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6]],
      // 5画目: 底横
      [[4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6]]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'e': {
    symbol: 'エ',
    name: 'カタカナ「エ」',
    desc: '正しい書き順（上横→中柱→下横）で引く、端正なエ（全19文字）',
    category: 'カナのデザイン',
    getStrokes: () => [
      // 1画目: 上横 (全幅8マス)
      [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7]],
      // 2画目: 中柱
      [[1, 3], [2, 3], [3, 3]],
      // 3画目: 下横 (全幅8マス)
      [[4, 0], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [4, 7]]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'to': {
    symbol: 'ト',
    name: 'カタカナ「ト」',
    desc: '正しい書き順（縦棒→斜め枝）で素直に描く、美しいト（全11文字）',
    category: 'カナのデザイン',
    getStrokes: () => [
      // 1画目: 縦棒
      [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]],
      // 2画目: 斜め枝
      [[2, 2], [2, 3], [3, 4], [3, 5], [4, 6], [4, 7]]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },

  // === 記号・シンボル ===
  'heart': {
    symbol: '♡',
    name: 'ハート型',
    desc: '左右完全対称で愛らしいハートの輪郭を指でなぞるルート（推奨15文字）',
    category: '記号のデザイン',
    getStrokes: () => [
      [
        [4, 3], [3, 2], [2, 1], [1, 0],
        [0, 1], [0, 2],
        [1, 3], [1, 4],
        [0, 5], [0, 6],
        [1, 7], [2, 6], [3, 5],
        [4, 4], [4, 3]
      ]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'star': {
    symbol: '☆',
    name: '星型（5芒星）',
    desc: '左右完全対称で全幅8マスに腕を広げた星の輪郭をなぞるルート（推奨16文字★）',
    category: '記号のデザイン',
    getStrokes: () => [
      [
        [0, 3], [1, 2], [1, 1], [1, 0],
        [2, 2], [3, 2], [4, 1],
        [3, 3], [3, 4],
        [4, 6], [3, 5], [2, 5],
        [1, 7], [1, 6], [1, 5],
        [0, 4]
      ]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'penta': {
    symbol: '★',
    name: '五芒星（パターン交差）',
    desc: '左下から頂点、右下、左腕、右腕、左下と交差して描く伝統的な五芒星パターン（全23文字）',
    category: '記号のデザイン',
    getStrokes: () => [
      [
        [4, 1], [3, 2], [2, 2], [1, 3], [0, 3],
        [0, 4], [1, 4], [2, 5], [3, 5], [4, 6],
        [3, 4], [2, 2], [1, 0],
        [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7],
        [2, 5], [3, 3], [4, 1]
      ]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'dia': {
    symbol: '◇',
    name: 'ダイヤ型',
    desc: '盤面4隅に向かって大きくひし形を描く完全上下・左右対称ジュエルルート',
    category: '記号のデザイン',
    getStrokes: () => [
      [
        [0, 3], [0, 4], [1, 5], [1, 6], [2, 7],
        [3, 6], [3, 5], [4, 4], [4, 3],
        [3, 2], [3, 1], [2, 0],
        [1, 1], [1, 2], [0, 3]
      ]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'inf': {
    symbol: '∞',
    name: 'インフィニティ',
    desc: '2つのループが交差する完全上下・左右対称エイトライン',
    category: '記号のデザイン',
    getStrokes: () => [
      [
        [2, 3], [1, 2], [0, 2], [0, 1], [1, 0], [2, 0], [3, 0], [4, 1], [4, 2], [3, 2], [2, 3],
        [2, 4], [1, 5], [0, 5], [0, 6], [1, 7], [2, 7], [3, 7], [4, 6], [4, 5], [3, 5], [2, 4]
      ]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'eq': {
    symbol: '＝',
    name: 'イコール',
    desc: '書き順通り2本の平行ラインを引く、完全上下対称ルート（推奨ジャスト16文字）',
    category: '記号のデザイン',
    aliasOf: 'ni',
    getStrokes: () => GESTURE_DESIGNS['ni'].getStrokes(),
    getPts: () => GESTURE_DESIGNS['ni'].getPts()
  },

  // === 矢印のデザイン ===
  'arrow_r': {
    symbol: '→',
    name: '右矢印',
    desc: '中央軸を引いてから矢じりを描く、完全上下対称アロー（全13文字）',
    category: '矢印のデザイン',
    getStrokes: () => [
      // 1画目: シャフト (全幅8マス)
      [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6], [2, 7]],
      // 2画目: 矢じり
      [[0, 5], [1, 6], [2, 7], [3, 6], [4, 5]]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'arrow_l': {
    symbol: '←',
    name: '左矢印',
    desc: '中央軸を引いてから矢じりを描く、完全上下対称アロー（全13文字）',
    category: '矢印のデザイン',
    getStrokes: () => [
      // 1画目: シャフト (全幅8マス)
      [[2, 7], [2, 6], [2, 5], [2, 4], [2, 3], [2, 2], [2, 1], [2, 0]],
      // 2画目: 矢じり
      [[0, 2], [1, 1], [2, 0], [3, 1], [4, 2]]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'arrow_u': {
    symbol: '↑',
    name: '上矢印',
    desc: '下から天へ垂直軸を突き上げ、両翼の矢じりを描く完全左右対称アロー（全13文字）',
    category: '矢印のデザイン',
    getStrokes: () => [
      // 1画目: 垂直軸
      [[4, 3], [3, 3], [2, 3], [1, 3], [0, 3]],
      // 2画目: 矢じり
      [[3, 0], [2, 1], [1, 2], [0, 3], [0, 4], [1, 5], [2, 6], [3, 7]]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  },
  'arrow_d': {
    symbol: '↓',
    name: '下矢印',
    desc: '天から地へ垂直軸を突き下ろし、両翼の矢じりを描く完全左右対称アロー（全13文字）',
    category: '矢印のデザイン',
    getStrokes: () => [
      // 1画目: 垂直軸
      [[0, 3], [1, 3], [2, 3], [3, 3], [4, 3]],
      // 2画目: 矢じり
      [[1, 0], [2, 1], [3, 2], [4, 3], [4, 4], [3, 5], [2, 6], [1, 7]]
    ],
    getPts: function() { return [].concat(...this.getStrokes()); }
  }
};
let currentSelectedGestureDesign = null; // null: サイト頭文字から自動検出、指定時は固定

// Stroke Mode is a visual recipe suggestion. It can be opened from a URL, but
// it never replaces the normal recipe value saved in backups.
function setStrokePattern(designKey) {
  const key = String(designKey || '').trim();
  if (!GESTURE_DESIGNS[key]) return false;
  currentSelectedGestureDesign = key;
  currentDisplayMode = 'stroke';
  const designBar = document.getElementById('gesture-design-bar');
  if (designBar) designBar.style.display = '';
  return true;
}

function getGestureDesignKey(site) {
  if (currentSelectedGestureDesign && GESTURE_DESIGNS[currentSelectedGestureDesign]) {
    return currentSelectedGestureDesign;
  }
  const clean = String(site || '').trim();
  const c = clean ? clean[0].toUpperCase() : 'U';
  if (GESTURE_DESIGNS[c]) return c;
  // 漢字・記号・カナ直接マッチ
  if (c === 'コ' || c === 'こ') return 'ko';
  if (c === '一') return 'ichi';
  if (c === '二') return 'ni';
  if (c === '三') return 'san';
  if (c === '十') return 'ju';
  if (c === '川') return 'kawa';
  if (c === '山') return 'yama';
  if (c === '日') return 'hi';
  if (c === '田') return 'ta';
  if (c === 'エ' || c === 'え') return 'e';
  if (c === 'ト' || c === 'と') return 'to';
  if (c === '=' || c === '＝') return 'eq';
  if (c === '♡' || c === '♥') return 'heart';
  if (c === '★' || c === '五') return 'penta';
  if (c === '☆' || c === '*' || c === '星') return 'star';
  if (c === '◇' || c === '◆') return 'dia';
  if (c === '∞') return 'inf';
  if (c === '→') return 'arrow_r';
  if (c === '←') return 'arrow_l';
  if (c === '↑') return 'arrow_u';
  if (c === '↓') return 'arrow_d';
  // アルファベットからの連想マッピング
  if (c === 'K') return 'ko';
  if (c === 'H') return 'heart';
  if (c === 'R') return 'arrow_r';
  if (c === 'Y') return 'yama';
  if (c === 'E') return 'e';
  if (c === 'T') return 'to';
  if (['B', 'D', 'P', 'Q'].includes(c)) return 'O';
  if (['I', 'J'].includes(c)) return '1';
  if (c === 'Z' || c === 'ｚ') return 'Z';
  if (c === 'N' || c === 'ｎ') return 'N';
  if (['G'].includes(c)) return 'C';
  if (['M'].includes(c)) return 'L';
  if (['A', 'V', 'W'].includes(c)) return 'U';
  if (['F'].includes(c)) return '7';
  if (['3', '8', '9'].includes(c)) return '0';
  if (['4', '6'].includes(c)) return '5';
  return 'U';
}
function getStrokeStepDirAndCorner(prevPt, currPt, isFirst = false, startCol = 0) {
  if (isFirst) {
    if (currPt.r === 0) return { dirTxt: '始点', corner: currPt.c >= 4 ? 'tr' : 'tl' };
    if (currPt.r === 4) return { dirTxt: '始点', corner: currPt.c >= 4 ? 'br' : 'bl' };
    return { dirTxt: '始点', corner: currPt.c >= 4 ? 'tr' : 'tl' };
  }
  const dr = currPt.r - prevPt.r;
  const dc = currPt.c - prevPt.c;
  if (dr === 0 && dc > 0) {
    return { dirTxt: '→ 右へ', corner: currPt.r >= 3 ? 'br' : 'tr' };
  }
  if (dr === 0 && dc < 0) {
    return { dirTxt: '← 左へ', corner: currPt.r >= 3 ? 'bl' : 'tl' };
  }
  if (dr > 0 && dc === 0) {
    return { dirTxt: '↓ 下へ', corner: currPt.c >= 4 ? 'br' : 'bl' };
  }
  if (dr < 0 && dc === 0) {
    return { dirTxt: '↑ 上へ', corner: currPt.c >= 4 ? 'tr' : 'tl' };
  }
  if (dr > 0 && dc > 0) return { dirTxt: '↘ 右下へ', corner: 'br' };
  if (dr > 0 && dc < 0) return { dirTxt: '↙ 左下へ', corner: 'bl' };
  if (dr < 0 && dc > 0) return { dirTxt: '↗ 右上へ', corner: 'tr' };
  if (dr < 0 && dc < 0) return { dirTxt: '↖ 左上へ', corner: 'tl' };
  return { dirTxt: '➔ なぞる', corner: currPt.r >= 3 ? 'br' : 'tr' };
}
function evaluateStrokeGestureSteps(site, secret, explicitDesignKey) {
  const spotNames = { tl: '左上', tr: '右上', bl: '左下', br: '右下', center: '中央' };
  const cleanSite = String(site || '').trim();
  const cleanSecret = String(secret || '').trim();
  const designKey = explicitDesignKey || getGestureDesignKey(cleanSite);
  const design = GESTURE_DESIGNS[designKey] || GESTURE_DESIGNS['U'];

  let colFor1 = 3;
  if (designKey === '1' && cleanSite) {
    const tileIdx = findTileIndex(cleanSite[0]);
    if (tileIdx >= 0) colFor1 = tileIdx % 8;
  }

  const rawStrokes = design.getStrokes
    ? (designKey === '1' ? design.getStrokes(colFor1) : design.getStrokes())
    : [design.getPts ? (designKey === '1' ? design.getPts(colFor1) : design.getPts()) : []];

  const steps = [];
  rawStrokes.forEach((stroke, sIdx) => {
    const tiles = stroke.map(p => ({ r: p[0], c: p[1], tileIdx: p[0] * 8 + p[1] }));
    tiles.forEach((t, pIdx) => {
      const tile = currentMatrixData[t.tileIdx] || currentMatrixData[0];
      const isFirst = (pIdx === 0);
      const { dirTxt, corner } = getStrokeStepDirAndCorner(
        !isFirst ? tiles[pIdx - 1] : null,
        t,
        isFirst,
        t.c
      );
      const ch = tile[corner] || tile.center;
      const isPenUp = (sIdx > 0 && isFirst);
      steps.push({
        ch,
        tileIdx: t.tileIdx,
        corner,
        isFallback: false,
        isStroke: true,
        strokeIndex: sIdx,
        isStrokeStart: isFirst,
        isPenUp,
        designKey,
        designSymbol: design.symbol,
        designName: design.name,
        log: isFirst
          ? (sIdx === 0
              ? `✍️ 【${design.category}「${design.symbol}」第1画の始点】マス [${tile.center}] (${t.r + 1}行・${t.c + 1}列) ➔ '${ch}' (${spotNames[corner]})`
              : `✍️ ━━【第${sIdx + 1}画へジャンプして始点】マス [${tile.center}] (${t.r + 1}行・${t.c + 1}列) ➔ '${ch}' (${spotNames[corner]})`)
          : `   ${dirTxt}なぞる ➔ マス [${tile.center}] (${t.r + 1}行・${t.c + 1}列) ➔ '${ch}' (${spotNames[corner]})`
      });
    });
  });

  return steps;
}
function updateStrokeGestureUI() {
  const site = document.getElementById('sim-site')?.value || '1Password';
  const secret = document.getElementById('sim-secret')?.value || 'KeePass';
  const designKey = getGestureDesignKey(site);
  const design = GESTURE_DESIGNS[designKey] || GESTURE_DESIGNS['U'];

  const strokeSteps = evaluateStrokeGestureSteps(site, secret, designKey);
  if (!strokeSteps || strokeSteps.length === 0) return;

  currentEvalSteps = strokeSteps;
  if (window.MatrixCardPreset && window.MatrixCardPreset.syncBlindInputs) window.MatrixCardPreset.syncBlindInputs();

  // デザイン一覧バーを表示し、該当デザインボタンをアクティブ化
  const designBar = document.getElementById('gesture-design-bar');
  if (designBar) designBar.style.display = 'block';

  document.querySelectorAll('#gesture-design-bar .gesture-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.design === designKey);
  });

  const pwBox = document.getElementById('sim-output-pw');
  if (pwBox) {
    pwBox.innerHTML = strokeSteps.map((st, i) =>
      `<span class="pw-char-span" data-step="${i}">${escapeHtml(st.ch)}</span>`
    ).join('');
  }

  const pwVal = strokeSteps.map(s => s.ch).join('');
  const ent = estimatePasswordEntropy(pwVal);
  const cleanSite = (site || '1Password').trim();

  const metaBox = document.getElementById('sim-output-meta');
  if (metaBox) {
    metaBox.innerHTML = `✍️ <strong>パターンルート</strong>（${design.category}「${escapeHtml(design.symbol)}: ${escapeHtml(design.name)}」）／ 総文字数: ${strokeSteps.length}文字 ／ 推定エントロピー: ${ent.bits} bits`;
  }

  const badge = document.getElementById('live-mode-badge');
  if (badge) {
    badge.textContent = `✍️ パターン「${design.symbol}」(${strokeSteps.length}字)`;
    badge.classList.remove('inactive');
  }

  const verbalBadge = document.getElementById('verbal-mode-badge');
  if (verbalBadge) {
    verbalBadge.textContent = `✍️ パターン「${design.symbol}」(${strokeSteps.length}字)`;
    verbalBadge.classList.remove('inactive');
  }

  const stickyPw = document.getElementById('sticky-output-pw');
  if (stickyPw) stickyPw.textContent = pwVal;
  const stickyMeta = document.getElementById('sticky-output-meta');
  if (stickyMeta) stickyMeta.textContent = `✍️ パターン「${design.symbol}」／ ${strokeSteps.length}文字`;
  const stickyBadge = document.getElementById('sticky-mode-badge');
  if (stickyBadge) {
    stickyBadge.textContent = `✍️ パターン「${design.symbol}」`;
    stickyBadge.classList.remove('inactive');
  }

  const logBox = document.getElementById('sim-trace-log');
  if (logBox) {
    logBox.innerHTML = strokeSteps.map((st, i) =>
      `<div class="trace-line" data-step="${i}">${escapeHtml(st.log)}</div>`
    ).join('');
  }

  const banner = document.getElementById('sim-step-banner');
  if (banner && (!traceTimer && !traceIsPaused)) {
    banner.textContent = `✍️ パターンモード（${design.category}「${design.symbol}」）：カード上で${design.desc}（全${strokeSteps.length}文字）です。「✍️ パターンルート再生」を押すと動きを確認できます。`;
  }

  const cqSt = document.getElementById('cq-status');
  if (cqSt) {
    cqSt.textContent = `【現在使用中のモード】✍️ パターンルート方式\n・選択デザイン：${design.category}「${design.symbol}」(${design.name})\n・出力：英大小・数字・記号 ${strokeSteps.length}文字（推定エントロピー ${ent.bits} bits）\n・特徴：Androidのパターンロックのようにカード上で指を滑らせるだけで、誰でも直感的にパスワードを復元できます。`;
  }

  for (const id of ['btn-copy-pw', 'btn-play-trace', 'btn-play-stroke', 'btn-sticky-play', 'btn-sticky-stroke', 'btn-sticky-copy']) {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  }
}

function showStrokePreview(designKey, strokeSteps, previewDurationMs) {
  clearHighlightsOnly();
  const squares = document.querySelectorAll('#div-encrypto-matrix-main .square');
  if (!squares || squares.length === 0) return;

  const steps = strokeSteps || currentEvalSteps;
  if (!steps || steps.length === 0) return;

  const key = designKey || steps[0]?.designKey || 'U';
  const design = GESTURE_DESIGNS[key] || GESTURE_DESIGNS['U'];

  // 1. 各タイルの文字ルートプレビューハイライト
  steps.forEach((st, i) => {
    const sq = squares[st.tileIdx];
    if (sq) {
      if (i === 0) {
        sq.classList.add('stroke-start-tile');
      } else {
        sq.classList.add('stroke-preview-tile');
      }
      const spotEl = sq.querySelector(`[data-spot="${st.corner}"]`);
      if (spotEl) {
        if (i === 0) {
          spotEl.classList.add('start-char-spot');
        } else {
          spotEl.classList.add('preview-char-spot');
        }
      }
    }
  });

  // 2. スタイリッシュなネオンHUDバッジのオーバーレイ表示
  const hud = document.getElementById('stroke-char-hud');
  const hudBadge = document.getElementById('stroke-hud-badge');
  const hudTitle = document.getElementById('stroke-hud-title');
  const hudSub = document.getElementById('stroke-hud-sub');
  if (hud && hudBadge && hudTitle && hudSub) {
    hudBadge.textContent = design.symbol;
    hudTitle.textContent = `✍️ ${design.category}「${design.symbol}」${design.name}（${steps.length}文字）`;
    hudSub.textContent = `${design.desc}。カード上で指を滑らせるだけで再現できます`;
    hud.style.display = 'flex';
    hud.classList.remove('is-visible');
    void hud.offsetWidth; // リフローをトリガーしてポップアニメーションを実行
    hud.classList.add('is-visible');
  }

  // 3. バナーメッセージの更新
  const banner = document.getElementById('sim-step-banner');
  if (banner) {
    const waitSec = Math.round((previewDurationMs || 3800) / 1000);
    banner.textContent = `💡【パターン軌跡予告】${design.category}「${design.symbol}」${design.name}（全${steps.length}マス）。指でなぞるルートをご確認ください（約${waitSec}秒後に再生開始）`;
  }
}

function playStrokeGestureTrace() {
  lastPlayTrigger = 'stroke';
  currentDisplayMode = 'stroke';
  stopMatrixTrace();
  updateStrokeGestureUI();

  const strokeSteps = currentEvalSteps;
  if (!strokeSteps || strokeSteps.length === 0) return;

  updateTraceButtonsUI('playing');
  if (window.MatrixCardPreset && window.MatrixCardPreset.syncBlindInputs) window.MatrixCardPreset.syncBlindInputs();

  const stageEl = document.getElementById('matrix-stage-box') || document.getElementById('div-encrypto-matrix-main');
  if (stageEl) {
    const r = stageEl.getBoundingClientRect();
    if (r.top < -10 || r.top > 110) {
      window.scrollTo({ top: Math.max(0, window.scrollY + r.top - 8), behavior: 'smooth' });
    }
  }

  const site = document.getElementById('sim-site')?.value || '1Password';
  const designKey = getGestureDesignKey(site);
  const design = GESTURE_DESIGNS[designKey] || GESTURE_DESIGNS['U'];

  const speed = Number(document.getElementById('sim-speed')?.value) || 500;
  const previewDuration = Math.max(3800, Math.min(5500, Math.round(speed * 7.5)));
  const squares = document.querySelectorAll('#div-encrypto-matrix-main .square');
  const pwSpans = document.querySelectorAll('#sim-output-pw .pw-char-span');
  const logLines = document.querySelectorAll('#sim-trace-log .trace-line');
  const banner = document.getElementById('sim-step-banner');
  const logBox = document.getElementById('sim-trace-log');

  const showStep = (idx) => {
    clearHighlightsOnly();
    if (idx >= strokeSteps.length) {
      stopMatrixTrace();
      if (banner) {
        banner.textContent = `✅ ${design.category}「${design.symbol}」パスワード完成！カード上のルートを指でなぞるだけでいつでも再現できます。`;
      }
      return;
    }

    traceCurrentIndex = idx;
    const st = strokeSteps[idx];
    const sq = squares[st.tileIdx];
    if (sq) {
      sq.classList.add('stroke-active-tile');
      const spotEl = sq.querySelector(`[data-spot="${st.corner}"]`);
      if (spotEl) spotEl.classList.add('active-char-spot');
    }

    if (pwSpans[idx]) pwSpans[idx].classList.add('playing-now');
    if (logLines[idx]) {
      logLines[idx].classList.add('active-trace-line');
      if (logBox) {
        const lineEl = logLines[idx];
        logBox.scrollTop = Math.max(0, lineEl.offsetTop - logBox.offsetTop - (logBox.clientHeight / 2) + (lineEl.clientHeight / 2));
      }
    }
    if (banner) {
      banner.textContent = `✍️ [${idx + 1}/${strokeSteps.length}文字目] ${st.log}`;
    }
  };

  const startTracing = () => {
    strokePreviewTimer = null;
    strokePreviewState = null;
    strokeResumePreviewRunner = null;
    hideStrokeHUD();
    clearHighlightsOnly();
    traceCurrentIndex = 0;
    showStep(0);
    traceTimer = setInterval(() => {
      const nextIdx = traceCurrentIndex + 1;
      traceStepRunner(nextIdx);
    }, speed);
  };

  traceStepRunner = (idx) => {
    showStep(idx);
  };

  // 軌跡プレビューを表示してからなぞり開始
  showStrokePreview(designKey, strokeSteps, previewDuration);
  strokePreviewState = {
    duration: previewDuration,
    startedAt: Date.now(),
    remainingMs: previewDuration
  };
  strokeResumePreviewRunner = () => {
    showStrokePreview(designKey, strokeSteps, strokePreviewState.remainingMs);
    strokePreviewState.startedAt = Date.now();
    const waitMs = strokePreviewState.remainingMs || previewDuration;
    strokePreviewTimer = setTimeout(startTracing, waitMs);
  };
  strokePreviewTimer = setTimeout(startTracing, previewDuration);
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
    /* external fetch disabled: inline wordlist is used (offline-only) */
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

  const seedInput = document.getElementById('input-seed-number');

  function saveStateToStorage() {
    try {
      const seed = document.getElementById('input-seed-number')?.value;
      if (seed !== undefined && seed !== null && seed !== '') {
        localStorage.setItem('cm_active_seed', seed);
      }
      const site = document.getElementById('sim-site')?.value;
      if (site !== undefined && site !== null) {
        localStorage.setItem('cm_active_site', site);
      }
      // Security Hardening (A04): Do not persist plain-text secrets or generated passwords to localStorage by default
      if (typeof window !== 'undefined' && window.__ALLOW_SECRET_STORAGE__ === true) {
        const secret = document.getElementById('sim-secret')?.value;
        if (secret !== undefined && secret !== null) {
          localStorage.setItem('cm_active_secret', secret);
        }
        const pw = (document.getElementById('sim-output-pw')?.textContent || '').trim();
        if (pw) {
          localStorage.setItem('cm_last_generated_pw', pw);
        }
      } else {
        localStorage.removeItem('cm_active_secret');
        localStorage.removeItem('cm_last_generated_pw');
      }
      const cfg = getRecipeConfig();
      const extra = {
        cfg,
        cqPinLen: document.getElementById('cq-pin-length')?.value,
        cqSymLen: document.getElementById('cq-symbol-length')?.value,
        cqSymMode: document.getElementById('cq-symbol-mode')?.value,
        cqSymList: document.getElementById('cq-symbol-list')?.value
      };
      localStorage.setItem('cm_active_recipe', JSON.stringify(extra));
    } catch (_) {}
  }

  // Security Hardening (A04): Unified KeeWeb Transfer Storage with auto-expiry TTL (default 60s) & transfer ID tracking
  const _transferTimers = {};
  let _activeKeeWebWindow = null;
  const ALLOWED_TRANSFER_KEYS = new Set([
    'cm_pending_master_pass',
    'cm_pending_keyfile',
    'cm_pending_entry',
    'cm_pending_generated_password'
  ]);

  function trackKeeWebWindow(win) {
    if (!win || (typeof win !== 'object' && typeof win !== 'function')) return null;
    try { if (win.window !== win || win.closed) return null; } catch (_) { return null; }
    _activeKeeWebWindow = win;
    return win;
  }
  function openKeeWeb(transferId = '') {
    // A changing query string also refreshes an already-open KeeWeb tab, so it
    // rechecks the newly-created short-lived transfer without user intervention.
    const suffix = transferId ? `?cmTransfer=${encodeURIComponent(transferId)}` : '';
    const win = trackKeeWebWindow(window.open(`keeweb/index.html${suffix}`, 'keeweb_app'));
    try { win?.focus(); } catch (_) {}
    return win;
  }
  window.trackKeeWebWindow = trackKeeWebWindow;
  window.openKeeWeb = openKeeWeb;
  window.MatrixCardPreset = window.MatrixCardPreset || {};
  if (!Object.isFrozen(window.MatrixCardPreset)) {
    window.MatrixCardPreset.trackKeeWebWindow = trackKeeWebWindow;
    window.MatrixCardPreset.openKeeWeb = openKeeWeb;
  }
  const _transferIds = Object.create(null);
  function setPendingKeeWebTransfer(key, data, ttlMs = 60000) {
    if (!ALLOWED_TRANSFER_KEYS.has(key)) throw new Error('許可されていない転送キーです。');
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 60000) throw new Error('転送有効期間は0秒超・60秒以内で指定してください。');
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const transferId = 'xfer_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    const metadata = { _transferId: transferId, _expiresAt: Date.now() + ttlMs };
    const payload = data && typeof data === 'object' && !Array.isArray(data)
      ? Object.assign({}, data, metadata) : Object.assign({data}, metadata);
    localStorage.setItem(key, JSON.stringify(payload));
    if (_transferTimers[key]) clearTimeout(_transferTimers[key]);
    _transferIds[key] = transferId;
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(key);
        const cur = raw ? JSON.parse(raw) : null;
        if (cur && cur._transferId === transferId) localStorage.removeItem(key);
      } catch (_) {
        // Never delete a record whose owner cannot be verified.
      } finally {
        if (_transferTimers[key] === timer) delete _transferTimers[key];
        if (_transferIds[key] === transferId) delete _transferIds[key];
      }
    }, ttlMs);
    _transferTimers[key] = timer;
    return transferId;
  }
  window.setPendingKeeWebTransfer = setPendingKeeWebTransfer;
  if (!Object.isFrozen(window.MatrixCardPreset)) window.MatrixCardPreset.setPendingKeeWebTransfer = setPendingKeeWebTransfer;
  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.type !== 'KEEWEB_IMPORT_COMPLETE') return;
    const {key, transferId} = data;
    if (typeof key !== 'string' || !ALLOWED_TRANSFER_KEYS.has(key)) return;
    if (typeof transferId !== 'string' || !transferId || _transferIds[key] !== transferId) return;
    if (e.origin !== window.location.origin) return;
    if (!e.source || (e.source !== _activeKeeWebWindow && e.source !== window)) return;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const cur = JSON.parse(raw);
        if (!cur || cur._transferId !== transferId) return;
        localStorage.removeItem(key);
      }
      // The receiver may already have removed this transfer before its ACK arrives.
      if (_transferTimers[key]) clearTimeout(_transferTimers[key]);
      delete _transferTimers[key];
      delete _transferIds[key];
    } catch (_) {}
  });

  function restoreStateFromStorage(hasUrlSeed, hasUrlSite, hasUrlSecret) {
    try {
      if (!hasUrlSeed && seedInput) {
        const savedSeed = localStorage.getItem('cm_active_seed');
        if (savedSeed !== null && savedSeed !== '') {
          seedInput.value = savedSeed;
        }
      }
      const siteInput = document.getElementById('sim-site');
      if (!hasUrlSite && siteInput) {
        const savedSite = localStorage.getItem('cm_active_site');
        if (savedSite !== null && savedSite !== '') {
          siteInput.value = savedSite;
        }
      }
      const secretInput = document.getElementById('sim-secret');
      if (!hasUrlSecret && secretInput) {
        const savedSecret = localStorage.getItem('cm_active_secret');
        if (savedSecret !== null && savedSecret !== '') {
          secretInput.value = savedSecret;
        }
      }
      const savedRecipe = localStorage.getItem('cm_active_recipe');
      if (savedRecipe) {
        try {
          const parsed = JSON.parse(savedRecipe);
          if (parsed.cfg) {
            setRecipeConfig(parsed.cfg);
            if (parsed.cqPinLen && document.getElementById('cq-pin-length')) document.getElementById('cq-pin-length').value = parsed.cqPinLen;
            if (parsed.cqSymLen && document.getElementById('cq-symbol-length')) document.getElementById('cq-symbol-length').value = parsed.cqSymLen;
            if (parsed.cqSymMode && document.getElementById('cq-symbol-mode')) document.getElementById('cq-symbol-mode').value = parsed.cqSymMode;
            if (parsed.cqSymList && document.getElementById('cq-symbol-list')) document.getElementById('cq-symbol-list').value = parsed.cqSymList;
          } else {
            setRecipeConfig(parsed);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  function parseAndApplyUrlParams() {
    const params = new URLSearchParams(window.location.search);
    let kParam = params.get('k') || params.get('seed') || params.get('s');
    let siteParam = params.get('site') || params.get('title') || params.get('name');
    let secretParam = params.get('secret');
    let designParam = params.get('pattern') || params.get('design');

    let actionParam = params.get('action');

    if (window.location.hash) {
      const rawHash = window.location.hash.replace(/^#/, '');
      const hp = new URLSearchParams(rawHash);
      if (!kParam) kParam = hp.get('k') || hp.get('seed') || hp.get('s') || (/^\d+$/.test(rawHash) ? rawHash : null);
      if (!siteParam) siteParam = hp.get('site') || hp.get('title') || hp.get('name');
      if (!secretParam) secretParam = hp.get('secret');
      if (!designParam) designParam = hp.get('pattern') || hp.get('design');
      if (!actionParam) actionParam = hp.get('action');
      if (rawHash === 'keyfile' || rawHash === 'keyfile-modal') actionParam = 'keyfile';
    }

    restoreStateFromStorage(kParam !== null, siteParam !== null, secretParam !== null);

    let changed = false;
    if (kParam !== null && seedInput && seedInput.value !== kParam) {
      seedInput.value = kParam;
      changed = true;
    }
    const siteInput = document.getElementById('sim-site');
    if (siteParam !== null && siteInput && siteInput.value !== siteParam) {
      siteInput.value = siteParam;
      changed = true;
    }
    const secretInput = document.getElementById('sim-secret');
    if (secretParam !== null && secretInput && secretInput.value !== secretParam) {
      secretInput.value = secretParam;
      changed = true;
    }
    if (designParam !== null && typeof setStrokePattern === 'function') {
      setStrokePattern(designParam);
      changed = true;
    }

    if (changed || kParam !== null || siteParam !== null) {
      updateMainMatrix(seedInput ? seedInput.value : '0');
      updateSimulationUI();
      generateAndRenderSeedPhrase();
      saveStateToStorage();
      if (siteParam) {
        setTimeout(() => {
          const simTarget = document.getElementById('sim-site') || document.getElementById('sim-output-pw');
          if (simTarget) {
            simTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
            simTarget.classList.add('seed-prompt-highlight');
            setTimeout(() => simTarget.classList.remove('seed-prompt-highlight'), 1800);
          }
        }, 300);
      }
    }

    if (actionParam === 'keyfile' || actionParam === 'keyfile-modal') {
      setTimeout(() => {
        const rawSeed = (seedInput && seedInput.value) ? seedInput.value : (kParam || localStorage.getItem('cm_active_seed') || '0');
        const seedNum = (typeof parseSeedValue === 'function') ? parseSeedValue(rawSeed) : (parseInt(rawSeed, 10) || 0);

        const currentPw = document.getElementById('sim-output-pw')?.textContent || '';
        const isValidSimPw = currentPw && !currentPw.includes('未入力') && !currentPw.includes('...') && currentPw.length >= 8;
        const secretVal = document.getElementById('sim-secret')?.value || '';
        const defaultPassword = isValidSimPw ? currentPw : (secretVal || (typeof window !== 'undefined' && window.__ALLOW_SECRET_STORAGE__ ? localStorage.getItem('cm_active_secret') : '') || '');

        const hasPasskey = !!localStorage.getItem('cm_passkey_cred_' + seedNum);
        const showModal = (typeof showKeyfileModal === 'function') ? showKeyfileModal : window.MatrixCardPreset?.showKeyfileModal;
        const exportKeyfile = (typeof exportKeePassXmlKeyfile === 'function') ? exportKeePassXmlKeyfile : window.MatrixCardPreset?.exportKeePassXmlKeyfile;

        if (showModal) {
          showModal({
            seedNum,
            defaultPassword,
            defaultPasskey: hasPasskey,
            context: 'keeweb'
          }, async (opts) => {
            try {
              const filename = `matrix-card-${opts.seedNum}.key`;
              if (exportKeyfile) {
                const res = await exportKeyfile({
                  seedNum: opts.seedNum,
                  password: opts.password,
                  passkeyFactor: opts.passkeyFactor,
                  passkeyCred: opts.passkeyCred,
                  filename
                });
                try {
                  setPendingKeeWebTransfer('cm_pending_keyfile', {
                    seedNum: opts.seedNum,
                    filename: filename,
                    xml: res.keyData.xml,
                    factorSummary: opts.factorSummary,
                    timestamp: Date.now()
                  });
                } catch (_) {}
                try {
                  if (window.opener && !window.opener.closed) {
                    const targetOrigin = (window.location.origin && window.location.origin !== 'null') ? window.location.origin : window.location.href;
                    window.opener.postMessage({
                      type: 'cm_keyfile_created',
                      seedNum: opts.seedNum,
                      filename: filename,
                      xml: res.keyData.xml
                    }, targetOrigin);
                  }
                } catch (_) {}
              }
            } catch (err) {
              alert('キーファイルの作成に失敗しました: ' + err.message);
            }
          });
        }
      }, 350);
    }
  }

  parseAndApplyUrlParams();

  window.addEventListener('hashchange', () => {
    parseAndApplyUrlParams();
  });

  function applyGeneratedPasswordFromKeeWeb() {
    const key = 'cm_pending_generated_password';
    let raw = '';
    try {
      raw = localStorage.getItem(key) || '';
      const data = JSON.parse(raw);
      const validTargets = new Set(['bq', 'bv', 'km', 'tl']);
      if (!data || typeof data !== 'object' || Array.isArray(data) ||
          !validTargets.has(data.target) || typeof data.password !== 'string' || !data.password ||
          !Number.isFinite(data._expiresAt) || data._expiresAt <= Date.now() ||
          typeof data._transferId !== 'string' || !data._transferId) {
        if (raw && localStorage.getItem(key) === raw) localStorage.removeItem(key);
        return false;
      }
      const inputIds = data.target === 'bq'
        ? ['bq-password', 'bq-password-confirm']
        : data.target === 'bv'
          ? ['bv-password', 'bv-password-confirm']
          : data.target === 'tl'
            ? ['tl-password', 'tl-password-confirm']
            : ['km-password'];
      const inputs = inputIds.map(id => document.getElementById(id)).filter(Boolean);
      if (!inputs.length) return false;
      inputs.forEach(input => {
        input.value = data.password;
        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.dispatchEvent(new Event('change', {bubbles:true}));
      });
      if (raw && localStorage.getItem(key) === raw) localStorage.removeItem(key);
      const labels = {bq:'バックアップ用の復元パスワード', bv:'保管庫用の復元パスワード', km:'キーファイル用の復元パスワード', tl:'タイムロック用の復元パスワード'};
      const statusId = data.target === 'bq' ? 'bq-status' : data.target === 'bv' ? 'bv-encrypt-status' : data.target === 'tl' ? 'tl-encrypt-status' : 'km-generated-password-status';
      const status = document.getElementById(statusId);
      if (status) {
        if (statusId === 'km-generated-password-status') status.style.display = 'block';
        status.textContent = '✅ KeeWebで生成したパスワードを' + labels[data.target] + 'に反映しました。';
      }
      return true;
    } catch (_) {
      try { if (raw && localStorage.getItem(key) === raw) localStorage.removeItem(key); } catch (__) {}
      return false;
    }
  }

  window.addEventListener('storage', (e) => {
    if (e.key === 'cm_active_secret' && e.newValue) {
      const secretInput = document.getElementById('sim-secret');
      if (secretInput && secretInput.value !== e.newValue) {
        secretInput.value = e.newValue;
        updateSimulationUI();
      }
    }
    if (e.key === 'cm_pending_generated_password' && e.newValue) applyGeneratedPasswordFromKeeWeb();
  });

  window.addEventListener('focus', () => {
    applyGeneratedPasswordFromKeeWeb();
    const savedSecret = localStorage.getItem('cm_active_secret');
    const secretInput = document.getElementById('sim-secret');
    if (savedSecret && secretInput && secretInput.value !== savedSecret) {
      secretInput.value = savedSecret;
      updateSimulationUI();
    }
  });

  // A single drop target for restore files. The format is inspected locally and
  // then handed to the appropriate Section 3 or Section 4 reader.
  let dropDepth = 0;
  function ensureDropHint() {
    let hint = document.getElementById('cm-global-drop-hint');
    if (hint) return hint;
    hint = document.createElement('div');
    hint.id = 'cm-global-drop-hint';
    hint.setAttribute('aria-live', 'polite');
    hint.style.cssText = 'display:none;position:fixed;inset:18px;z-index:100000;border:3px dashed #0284c7;border-radius:14px;background:rgba(240,249,255,.94);color:#075985;align-items:center;justify-content:center;text-align:center;font-size:1.1rem;font-weight:800;pointer-events:none;';
    hint.textContent = '📥 復元ファイルをドロップ — バックアップ／保管庫／タイムロックを自動判別します';
    document.body.appendChild(hint);
    return hint;
  }
  function showDropHint(show) { ensureDropHint().style.display = show ? 'flex' : 'none'; }
  async function routeDroppedFiles(fileList) {
    const backupFiles = [], vaultFiles = [], timelockFiles = [];
    for (const file of Array.from(fileList || [])) {
      const lower = (file.name || '').toLowerCase();
      if (lower.endsWith('.cmtl')) { timelockFiles.push(file); continue; }
      if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(lower)) { backupFiles.push(file); continue; }
      let target = /\.(txt|asc)$/i.test(lower) ? 'backup' : 'vault';
      try {
        const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
        const text = new TextDecoder().decode(head);
        if (/CRYPTOMATRIX\s+TIMELOCK\b/i.test(text)) target = 'timelock';
        else if (/CRYPTOMATRIX\s+VAULT\b/i.test(text)) target = 'vault';
        else if (/CRYPTOMATRIX\s+BACKUP\b/i.test(text)) target = 'backup';
        else if (head.length >= 4) {
          const magic4 = String.fromCharCode(head[0], head[1], head[2], head[3]);
          const magic3 = magic4.slice(0, 3);
          if (magic4 === 'CMTL' || magic4 === 'CMTS') target = 'timelock';
          else if (magic3 === 'CXB' || magic3 === 'CMS') target = 'backup';
          else if (magic3 === 'CME' || magic3 === 'CMV') target = 'vault';
        }
      } catch (_) {}
      if (target === 'timelock') timelockFiles.push(file);
      else if (target === 'backup') backupFiles.push(file);
      else vaultFiles.push(file);
    }
    if (timelockFiles.length) document.dispatchEvent(new CustomEvent('cm-route-timelock-files', {detail:{files:timelockFiles}}));
    if (backupFiles.length) document.dispatchEvent(new CustomEvent('cm-route-backup-files', {detail:{files:backupFiles}}));
    if (vaultFiles.length) document.dispatchEvent(new CustomEvent('cm-route-vault-files', {detail:{files:vaultFiles}}));
  }
  document.addEventListener('dragenter', event => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    dropDepth++;
    showDropHint(true);
  });
  document.addEventListener('dragover', event => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', event => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    dropDepth = Math.max(0, dropDepth - 1);
    if (!dropDepth) showDropHint(false);
  });
  document.addEventListener('drop', event => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    dropDepth = 0;
    showDropHint(false);
    void routeDroppedFiles(event.dataTransfer.files);
  });

  updateMainMatrix(seedInput ? seedInput.value : '0');
  updateSimulationUI();
  generateAndRenderSeedPhrase();
  saveStateToStorage();

  seedInput?.addEventListener('input', () => {
    saveStateToStorage();
  });
  seedInput?.addEventListener('change', () => {
    saveStateToStorage();
  });

  document.getElementById('btn-update-matrix')?.addEventListener('click', () => {
    updateMainMatrix(seedInput.value);
    updateSimulationUI();
    generateAndRenderSeedPhrase();
    saveStateToStorage();
  });

  document.getElementById('btn-random-matrix')?.addEventListener('click', () => {
    const rnd = Math.floor(Math.random() * 900000000) + 100000000;
    seedInput.value = String(rnd);
    updateMainMatrix(rnd);
    updateSimulationUI();
    generateAndRenderSeedPhrase();
    saveStateToStorage();
  });

  document.querySelectorAll('.rc-input').forEach(el => {
    el.addEventListener('input', () => {
      updateSimulationUI();
      generateAndRenderSeedPhrase();
      saveStateToStorage();
    });
    el.addEventListener('change', () => {
      updateSimulationUI();
      generateAndRenderSeedPhrase();
      saveStateToStorage();
    });
  });

  document.querySelectorAll('.cq-input').forEach(el => {
    el.addEventListener('input', () => {
      updateSimulationUI();
      saveStateToStorage();
    });
    el.addEventListener('change', () => {
      updateSimulationUI();
      saveStateToStorage();
    });
  });

  document.getElementById('sim-site')?.addEventListener('input', () => {
    updateSimulationUI();
    saveStateToStorage();
  });
  document.getElementById('sim-secret')?.addEventListener('input', () => {
    updateSimulationUI();
    saveStateToStorage();
  });
  document.getElementById('chk-include-card-seed')?.addEventListener('change', () => {
    generateAndRenderSeedPhrase();
    saveStateToStorage();
  });

  function transferGeneratedPasswordToKeeWeb(sourceButton) {
    saveStateToStorage();
    const pw = (document.getElementById('sim-output-pw')?.textContent || '').trim();
    if (!pw) {
      alert('転送するパスワードがありません。先にカードまたは合言葉を入力してください。');
      return;
    }
    const siteVal = (document.getElementById('sim-site')?.value || '').trim();
    const isMaster = siteVal.toLowerCase().includes('master');
    const seed = document.getElementById('input-seed-number')?.value || '0';
    localStorage.setItem('cm_active_seed', seed);
    // Security Hardening (A04): Never persist cm_last_generated_pw in plaintext in transfer path

    if (isMaster) {
      setPendingKeeWebTransfer('cm_pending_master_pass', pw);
    } else {
      const baseAppUrl = window.location.href.split(/[?#]/)[0];
      const curSeed = $('input-seed-number')?.value || '0';
      setPendingKeeWebTransfer('cm_pending_entry', {
        site: siteVal || '新規エントリー',
        password: pw,
        passphrase: (document.getElementById('sim-secret')?.value || '').trim(),
        url: `${baseAppUrl}#seed=${curSeed}${siteVal ? '&site=' + encodeURIComponent(siteVal) : ''}`,
        timestamp: Date.now()
      });
    }

    const buttons = [
      document.getElementById('btn-transfer-to-keeweb'),
      document.getElementById('btn-sticky-transfer')
    ].filter(Boolean);
    if (buttons.length) {
      if (transferFeedbackTimer) clearTimeout(transferFeedbackTimer);
      buttons.forEach((btn) => {
        btn.innerHTML = isMaster ? '✅ マスターPWをKeeWebへ転送' : `✅ 「${escapeHtml(siteVal || 'エントリー')}」をKeeWebへ転送`;
        btn.style.background = '#dcfce7';
        btn.style.borderColor = '#86efac';
        btn.style.color = '#15803d';
      });
      transferFeedbackTimer = setTimeout(() => {
        transferFeedbackTimer = null;
        updateTransferButtonsUI();
      }, 2500);
    }
    if (!openKeeWeb()) alert('KeeWebを開けませんでした。ポップアップの許可を確認してください。');
  }

  document.getElementById('btn-transfer-to-keeweb')?.addEventListener('click', (event) => {
    transferGeneratedPasswordToKeeWeb(event.currentTarget);
  });

  document.getElementById('btn-sticky-transfer')?.addEventListener('click', (event) => {
    // Call directly from this trusted click. Re-dispatching a synthetic click can
    // make browsers block the KeeWeb window as a popup.
    transferGeneratedPasswordToKeeWeb(event.currentTarget);
  });

  document.getElementById('btn-play-trace')?.addEventListener('click', () => {
    if (document.getElementById('gesture-design-bar')) document.getElementById('gesture-design-bar').style.display = 'none';
    playMatrixTrace();
  });
  document.getElementById('btn-play-stroke')?.addEventListener('click', playStrokeGestureTrace);
  document.getElementById('btn-pause-trace')?.addEventListener('click', togglePauseMatrixTrace);
  document.getElementById('btn-stop-trace')?.addEventListener('click', () => {
    stopMatrixTrace();
    const banner = document.getElementById('sim-step-banner');
    if (banner) banner.textContent = '⏹ 再生を停止しました。';
  });

  document.getElementById('btn-close-gesture-bar')?.addEventListener('click', () => {
    const designBar = document.getElementById('gesture-design-bar');
    if (designBar) designBar.style.display = 'none';
  });

  // パターン公式デザイン一覧ピルのクリックイベント
  document.querySelectorAll('#gesture-design-bar .gesture-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const wasPlaying = !!(traceTimer || strokePreviewTimer || traceIsPaused);
      stopMatrixTrace();
      currentSelectedGestureDesign = btn.dataset.design;
      currentDisplayMode = 'stroke';
      lastPlayTrigger = 'stroke';
      updateStrokeGestureUI();
      if (wasPlaying) {
        playStrokeGestureTrace();
      } else {
        showStrokePreview(currentSelectedGestureDesign);
      }
    });
  });

  document.getElementById('btn-copy-pw')?.addEventListener('click', () => {
    const pw = currentEvalSteps.map(s => s.ch).join('');
    navigator.clipboard.writeText(pw);
  });

  document.getElementById('btn-reset-recipe')?.addEventListener('click', () => {
    currentDisplayMode = 'recipe';
    const designBar = document.getElementById('gesture-design-bar');
    if (designBar) designBar.style.display = 'none';
    setRecipeConfig({});
    updateSimulationUI();
    generateAndRenderSeedPhrase();
  });

  document.getElementById('btn-random-recipe')?.addEventListener('click', () => {
    currentDisplayMode = 'recipe';
    const designBar = document.getElementById('gesture-design-bar');
    if (designBar) designBar.style.display = 'none';
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
 function preset(mode,L){return{kwOrder:3,kwFilter:0,kwNum:4,shiftDir:0,shiftN:1,shiftM:1,baseCorner:mode==='pin'?3:0,pickPattern:0,symMode:mode==='pin'?3:Number($('cq-symbol-mode').value),symList:mode==='pin'?'':$('cq-symbol-list').value,symFbDir:3,symFbDist:1,symFbCorner:0,preTarget:0,prePattern:0,preOffset:0,sufTarget:0,sufPattern:0,sufOffset:0,ancTile:0,ancMode:0,ancPos:4,postMode:0,lenMode:mode==='pin'?3:5,lenVal:L};}
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
   const effCfg={...cfg,lenMode:0,...(cfg.lenMode===5?{symMode:0}:{})};
   const raw=originalEvaluate(input.site,input.secret,effCfg);
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
  const orderTexts = [
   "サイト名のみを使用する", "サイト名 ＋ 合言葉 を連結する", "合言葉 ＋ サイト名 を連結する",
   "サイト名と合言葉を1文字ずつ交互に配置する", "合言葉とサイト名を1文字ずつ交互に配置する",
   "サイト名前半 ＋ 合言葉 ＋ サイト名後半を挟み込む", "合言葉前半 ＋ サイト名 ＋ 合言葉後半を挟み込む",
   "サイト名を逆順にしてから合言葉を連結する", "サイト名に合言葉を逆順で連結する", "全体（サイト名＋合言葉）を逆順にする"
  ];
  let orderNote = '';
  if (cfg.kwOrder === 1) {
   orderNote = '結合方式：連結（サイト名＋合言葉を順番に並べて読み取ります）。';
  } else if (cfg.kwOrder === 3) {
   orderNote = '結合方式：交互配置（サイト名と合言葉を1文字ずつ交互に並べて安全性を高めます）。';
  } else {
   const name = orderTexts[cfg.kwOrder] || `結合方式 #${cfg.kwOrder}`;
   orderNote = `結合方式：${name}。`;
  }
  const modeTitle=cfg.lenMode===3?'かんたん生成モード — 銀行などの暗証番号（数字のみ）':cfg.lenMode===5?'かんたん生成モード — パスワード（英大小・数字・記号）':'かんたん生成モード（旧互換） — パスワード（英大小・数字）';
  const notes=[orderNote,`${modeTitle}：英字A〜Zは小文字として中央を探す。中央にない文字（ドット・空白など）は飛ばす。`,'順読みは左→右。行末は次の行の左端、右下の次は左上。',cfg.lenMode===3?`${cfg.lenVal}桁まで左上を読む。不足分は最後に読んだマスの次から左上を読み足す。`:cfg.lenMode===4?`本文は${cfg.lenVal-3}文字。右上を読み、不足時は順読み。その次から右上の大文字→さらに次から右上の小文字を探し、次のマスの左上数字を採用。`:`本文は${cfg.lenVal-4}文字。左下の禁止記号は次のマスへ飛ばす。不足分も左下を順読み。最後は次から右上の大文字→次から右上の小文字→次の左上数字→次から左下の許可記号を探して採用。`,'すべての出力文字は物理カードの実在する角から直接読み取る。パスワード生成にハッシュや追加乱数は使わない。'];
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
  if($('btn-save-seed-txt'))$('btn-save-seed-txt').disabled=true;
  if($('btn-save-seed-qr'))$('btn-save-seed-qr').disabled=true;
  if($('btn-sec2-transfer-keeweb'))$('btn-sec2-transfer-keeweb').disabled=true;
  if($('btn-sec2-transfer-timelock'))$('btn-sec2-transfer-timelock').disabled=true;
  if($('seed-words-container'))$('seed-words-container').textContent=message;
  if($('seed-qr-list'))$('seed-qr-list').replaceChildren();
 }
 function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
 }
 function saveSvgAsPng(svgEl,filename){
  if(!svgEl)return;
  const clone=svgEl.cloneNode(true);
  const xml=new XMLSerializer().serializeToString(clone);
  const svgBlob=new Blob([xml],{type:'image/svg+xml;charset=utf-8'});
  const url=URL.createObjectURL(svgBlob);
  const img=new Image();
  img.onload=()=>{
   const canvas=document.createElement('canvas');
   const size=640;
   canvas.width=size;canvas.height=size;
   const ctx=canvas.getContext('2d');
   ctx.fillStyle='#ffffff';
   ctx.fillRect(0,0,size,size);
   const pad=24;
   ctx.drawImage(img,pad,pad,size-pad*2,size-pad*2);
   URL.revokeObjectURL(url);
   canvas.toBlob(blob=>{
    if(blob)downloadBlob(blob,filename);
   },'image/png');
  };
  img.src=url;
 }
 function svgToPngBase64(svgEl,size=640){
  return new Promise(resolve=>{
   if(!svgEl)return resolve('');
   const clone=svgEl.cloneNode(true);
   if(!clone.getAttribute('xmlns'))clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
   if(!clone.getAttribute('width'))clone.setAttribute('width',String(size));
   if(!clone.getAttribute('height'))clone.setAttribute('height',String(size));
   const xml=new XMLSerializer().serializeToString(clone);
   const svgBlob=new Blob([xml],{type:'image/svg+xml;charset=utf-8'});
   const url=URL.createObjectURL(svgBlob);
   const img=new Image();
   img.onload=()=>{
    try{
     const canvas=document.createElement('canvas');
     canvas.width=size;canvas.height=size;
     const ctx=canvas.getContext('2d');
     ctx.fillStyle='#ffffff';
     ctx.fillRect(0,0,size,size);
     const pad=24;
     ctx.drawImage(img,pad,pad,size-pad*2,size-pad*2);
     URL.revokeObjectURL(url);
     const dataUrl=canvas.toDataURL('image/png');
     resolve(dataUrl.split(',')[1]||'');
    }catch(_){URL.revokeObjectURL(url);resolve('');}
   };
   img.onerror=()=>{URL.revokeObjectURL(url);resolve('');};
   img.src=url;
  });
 }
 function stringToBase64(str){
  const bytes=new TextEncoder().encode(String(str??''));
  let bin='';const chunk=8192;
  for(let i=0;i<bytes.length;i+=chunk)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));
  return btoa(bin);
 }
 function generateUuidBase64(){
  const b=crypto.getRandomValues(new Uint8Array(16));
  let bin='';for(let i=0;i<16;i++)bin+=String.fromCharCode(b[i]);
  return btoa(bin);
 }
 function escapeXml(str){
  return String(str??'').replace(/[<>&'"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
 }
 async function exportKeePassXmlWithAttachments({title,username,password,notes,qrSvg,backupText,seedNum=null}){
  const qrBase64=await svgToPngBase64(qrSvg,640);
  const textBase64=stringToBase64(backupText||'');
  const entryUuid=generateUuidBase64();
  const groupUuid=generateUuidBase64();
  const sNum = seedNum || (document.getElementById('input-seed-number')?.value || '');
  const entryUrl = `../index.html#site=${encodeURIComponent(title)}${sNum && sNum !== '0' ? `&seed=${sNum}` : ''}`;
  const xml=`<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<KeePassFile>
	<Meta>
		<Generator>Crypto Matrix</Generator>
		<DatabaseName>Crypto Matrix Export</DatabaseName>
		<MemoryProtection>
			<ProtectPassword>True</ProtectPassword>
		</MemoryProtection>
		<Binaries>
			<Binary ID="0" Compressed="False">${qrBase64}</Binary>
			<Binary ID="1" Compressed="False">${textBase64}</Binary>
		</Binaries>
	</Meta>
	<Root>
		<Group>
			<UUID>${groupUuid}</UUID>
			<Name>Crypto Matrix</Name>
			<Entry>
				<UUID>${entryUuid}</UUID>
				<String>
					<Key>Title</Key>
					<Value>${escapeXml(title)}</Value>
				</String>
				<String>
					<Key>UserName</Key>
					<Value>${escapeXml(username)}</Value>
				</String>
				<String>
					<Key>Password</Key>
					<Value ProtectInMemory="True">${escapeXml(password)}</Value>
				</String>
				<String>
					<Key>URL</Key>
					<Value>${escapeXml(entryUrl)}</Value>
				</String>
				<String>
					<Key>Notes</Key>
					<Value>${escapeXml(notes)}</Value>
				</String>
				<Binary>
					<Key>matrix-qr.png</Key>
					<Value Ref="0" />
				</Binary>
				<Binary>
					<Key>matrix-backup.txt</Key>
					<Value Ref="1" />
				</Binary>
			</Entry>
		</Group>
	</Root>
</KeePassFile>`;
  const blob=new Blob([xml],{type:'application/xml;charset=utf-8'});
  const cleanName=title.replace(/[^a-zA-Z0-9_\-\u3000-\u30fe\u4e00-\u9fa5]/g,'_');
  const filename=`${cleanName||'cryptomatrix'}-keepass.xml`;
  downloadBlob(blob,filename);
  return filename;
 }

 function getValidSeedOrPrompt(statusElId=null){
  const seedInput=$('input-seed-number');
  const raw=seedInput?seedInput.value.trim():'';
  if(!raw){
   const msg='⚠️ カードの配列シード番号が未入力です。画面上部の「カード配列シード番号 (seed)」を入力してください。';
   if(statusElId&&$(statusElId)){
    if(typeof message==='function')message(statusElId,msg,true);
    else if(typeof setStatus==='function')setStatus(statusElId,msg,true);
    else $(statusElId).textContent=msg;
   }
   if($('sim-step-banner'))$('sim-step-banner').textContent=msg;
   if(seedInput){
    seedInput.scrollIntoView({behavior:'smooth',block:'center'});
    seedInput.classList.remove('seed-prompt-highlight');
    void seedInput.offsetWidth;
    seedInput.classList.add('seed-prompt-highlight');
    seedInput.focus();
    setTimeout(()=>seedInput.classList.remove('seed-prompt-highlight'),4000);
   }
   return null;
  }
  const num=parseSeedValue(raw);
  if(num===0){
   const skipZeroConfirm=(window.__SKIP_SEED_ZERO_CONFIRM__===true)||(localStorage.getItem('cm_allow_seed_zero')==='true');
   if(!skipZeroConfirm){
    const ok=confirm('カード配列シード番号が初期値の「0」のままです。このままカード番号0で作成しますか？\n（お手持ちのカードに別の番号がある場合は「キャンセル」を押して番号を入力してください）');
    if(!ok){
     const msg='⚠️ カードのシード番号を入力してください。';
     if(statusElId&&$(statusElId)){
      if(typeof message==='function')message(statusElId,msg,true);
      else if(typeof setStatus==='function')setStatus(statusElId,msg,true);
      else $(statusElId).textContent=msg;
     }
     if(seedInput){
      seedInput.scrollIntoView({behavior:'smooth',block:'center'});
      seedInput.focus();
     }
     return null;
    }
   }
   return 0;
  }
  return num;
 }

 async function generateKeePassXmlKeyfile({seedNum,password='',passkeyFactor=null,passkeyCred=null}){
  const enc=new TextEncoder();
  const ikm=enc.encode(`CRYPTOMATRIX-CARD-SEED-V3:${seedNum}`);
  let mixed=ikm;
  if(password&&password.trim().length>0){
   const passBytes=enc.encode(password);
   const salt=new Uint8Array(await crypto.subtle.digest('SHA-256',ikm));
   const passKey=await crypto.subtle.importKey(
    'raw',passBytes,{name:'PBKDF2'},false,['deriveBits']
   );
   const derived=new Uint8Array(await crypto.subtle.deriveBits(
    {name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},
    passKey,256
   ));
   const nextMixed=new Uint8Array(mixed.length+32);
   nextMixed.set(mixed,0);
   nextMixed.set(derived,mixed.length);
   mixed=nextMixed;
  }
  if(passkeyFactor&&passkeyFactor.length>0){
   const pfHash=new Uint8Array(await crypto.subtle.digest('SHA-256',passkeyFactor));
   const nextMixed=new Uint8Array(mixed.length+32);
   nextMixed.set(mixed,0);
   nextMixed.set(pfHash,mixed.length);
   mixed=nextMixed;
  }
  const combinedKey=new Uint8Array(await crypto.subtle.digest('SHA-256',mixed));
  const hexFull=Array.from(combinedKey).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
  const hashBytes=new Uint8Array(await crypto.subtle.digest('SHA-256',combinedKey));
  const hashHex=Array.from(hashBytes.slice(0,4)).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
  const line1=[hexFull.slice(0,8),hexFull.slice(8,16),hexFull.slice(16,24),hexFull.slice(24,32)].join(' ');
  const line2=[hexFull.slice(32,40),hexFull.slice(40,48),hexFull.slice(48,56),hexFull.slice(56,64)].join(' ');

  let credComment='';
  if(passkeyCred&&passkeyCred.length>0){
   const credB64=btoa(String.fromCharCode(...passkeyCred));
   credComment=`\n    <!-- CryptoMatrix Passkey Credential: ${credB64} -->`;
  }

  const xml=
`<?xml version="1.0" encoding="utf-8"?>
<KeyFile>
    <Meta>
        <Version>2.0</Version>
        <!-- CryptoMatrix KDF: PBKDF2-SHA256 / 600000 iterations / Card Seed V3 -->${credComment}
    </Meta>
    <Key>
        <Data Hash="${hashHex}">
            ${line1}
            ${line2}
        </Data>
    </Key>
</KeyFile>\n`;
  return{xml,rawBytes:combinedKey,hashHex,hexFull};
 }

 async function exportKeePassXmlKeyfile({seedNum,password='',passkeyFactor=null,passkeyCred=null,filename=null}){
  const keyData=await generateKeePassXmlKeyfile({seedNum,password,passkeyFactor,passkeyCred});
  const finalName=filename||`matrix-card-${seedNum}.key`;
  const blob=new Blob([keyData.xml],{type:'text/xml;charset=utf-8'});
  downloadBlob(blob,finalName);
  return{filename:finalName,keyData};
 }
 let activeKeyfileContext = null;
 let activeKeyfileCallback = null;

 function updateKeyfileModalUI() {
  const radioSeed = document.getElementById('km-factor-seed');
  const radioDual = document.getElementById('km-factor-dual');
  const radioPasskey = document.getElementById('km-factor-passkey');
  const radioMulti = document.getElementById('km-factor-multi');

  const lblSeed = document.getElementById('lbl-km-factor-seed');
  const lblDual = document.getElementById('lbl-km-factor-dual');
  const lblPasskey = document.getElementById('lbl-km-factor-passkey');
  const lblMulti = document.getElementById('lbl-km-factor-multi');

  const passWrap = document.getElementById('km-pass-wrap');
  const passkeyWrap = document.getElementById('km-passkey-wrap');

  const isSeed = !!radioSeed?.checked;
  const isDual = !!radioDual?.checked;
  const isPasskey = !!radioPasskey?.checked;
  const isMulti = !!radioMulti?.checked;

  if (lblSeed) {
   lblSeed.style.border = isSeed ? '1.5px solid #0284c7' : '1px solid #cbd5e1';
   lblSeed.style.background = isSeed ? '#f0f9ff' : '#f8fafc';
  }
  if (lblDual) {
   lblDual.style.border = isDual ? '1.5px solid #0284c7' : '1px solid #cbd5e1';
   lblDual.style.background = isDual ? '#f0f9ff' : '#f8fafc';
  }
  if (lblPasskey) {
   lblPasskey.style.border = isPasskey ? '1.5px solid #0f766e' : '1px solid #cbd5e1';
   lblPasskey.style.background = isPasskey ? '#f0fdfa' : '#f8fafc';
  }
  if (lblMulti) {
   lblMulti.style.border = isMulti ? '1.5px solid #7c3aed' : '1px solid #cbd5e1';
   lblMulti.style.background = isMulti ? '#f5f3ff' : '#f8fafc';
  }

  if (passWrap) passWrap.style.display = (isDual || isMulti) ? 'block' : 'none';
  if (passkeyWrap) passkeyWrap.style.display = (isPasskey || isMulti) ? 'block' : 'none';
 }

 function showKeyfileModal({ seedNum, defaultPassword = '', defaultPasskey = false, context = 'sec2' }, onConfirm) {
  activeKeyfileContext = context;
  activeKeyfileCallback = onConfirm;
  const modal = document.getElementById('keyfile-modal');
  if (!modal) {
   if (onConfirm) onConfirm({ seedNum, password: defaultPassword, passkeyFactor: null, passkeyCred: null, factorSummary: '', context });
   return;
  }

  const seedInput = document.getElementById('keyfile-modal-seed');
  if (seedInput) seedInput.value = (seedNum !== undefined && seedNum !== null) ? seedNum : '';

  const passInput = document.getElementById('km-password');
  if (passInput) passInput.value = defaultPassword || '';

  const errEl = document.getElementById('keyfile-modal-error');
  if (errEl) errEl.style.display = 'none';

  const radioSeed = document.getElementById('km-factor-seed');
  const radioDual = document.getElementById('km-factor-dual');
  const radioPasskey = document.getElementById('km-factor-passkey');
  const radioMulti = document.getElementById('km-factor-multi');

  const hasPw = defaultPassword && defaultPassword.length >= 12;
  const hasPk = !!defaultPasskey;

  if (hasPw && hasPk) {
   if (radioMulti) radioMulti.checked = true;
  } else if (hasPk) {
   if (radioPasskey) radioPasskey.checked = true;
  } else if (hasPw) {
   if (radioDual) radioDual.checked = true;
  } else {
   if (radioSeed) radioSeed.checked = true;
  }

  const existingNotice = document.getElementById('km-passkey-existing-notice');
  if (existingNotice) {
   const credB64 = localStorage.getItem('cm_passkey_cred_' + seedNum);
   existingNotice.style.display = credB64 ? 'block' : 'none';
  }

  updateKeyfileModalUI();
  modal.hidden = false;
 }

 function closeKeyfileModal() {
  const modal = document.getElementById('keyfile-modal');
  if (modal) modal.hidden = true;
  activeKeyfileCallback = null;
  activeKeyfileContext = null;
 }

 function initKeyfileModalEvents() {
  document.getElementById('btn-keyfile-modal-close')?.addEventListener('click', closeKeyfileModal);
  document.getElementById('btn-km-cancel')?.addEventListener('click', closeKeyfileModal);

  for (const id of ['km-factor-seed', 'km-factor-dual', 'km-factor-passkey', 'km-factor-multi']) {
   document.getElementById(id)?.addEventListener('change', updateKeyfileModalUI);
  }

  document.getElementById('btn-km-confirm')?.addEventListener('click', async () => {
   const errEl = document.getElementById('keyfile-modal-error');
   const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };

   const rawSeed = document.getElementById('keyfile-modal-seed')?.value.trim();
   if (!rawSeed) {
    return showErr('⚠️ カードのシード番号を入力してください。');
   }
   const seedNum = parseSeedValue(rawSeed);
   if (seedNum === 0) {
    const skipZeroConfirm = (window.__SKIP_SEED_ZERO_CONFIRM__ === true) || (localStorage.getItem('cm_allow_seed_zero') === 'true');
    if (!skipZeroConfirm) {
     const ok = confirm('カード配列シード番号が初期値の「0」のままです。このままシード番号0でキーファイルを作成しますか？');
     if (!ok) return;
    }
   }

   const isSeed = document.getElementById('km-factor-seed')?.checked;
   const isDual = document.getElementById('km-factor-dual')?.checked;
   const isPasskey = document.getElementById('km-factor-passkey')?.checked;
   const isMulti = document.getElementById('km-factor-multi')?.checked;

   const passVal = document.getElementById('km-password')?.value || '';
   const needsPw = isDual || isMulti;
   const needsPk = isPasskey || isMulti;

   if (needsPw && (!passVal || passVal.trim().length === 0)) {
    return showErr('復元用パスワードを入力するか、他の生成方式を選択してください。');
   }

   let passkeyFactor = null;
   let passkeyCred = null;
   let factorSummary = '';

   if (needsPk) {
    const btn = document.getElementById('btn-km-confirm');
    const origText = btn ? btn.textContent : '';
    try {
     if (btn) { btn.disabled = true; btn.textContent = '👤 パスキー認証中...'; }
     const enc = new TextEncoder();
     const ikm = enc.encode(`CRYPTOMATRIX-CARD-SEED-V2:${seedNum}`);
     const salt32 = new Uint8Array(await crypto.subtle.digest('SHA-256', ikm));

     const storedCredB64 = localStorage.getItem('cm_passkey_cred_' + seedNum);
     let credToUse = null;
     if (storedCredB64) {
      try {
       credToUse = Uint8Array.from(atob(storedCredB64), c => c.charCodeAt(0));
      } catch (_) { credToUse = null; }
     }

     let prfRes;
     try {
      prfRes = await derivePasskeyPrf(salt32, credToUse);
     } catch (firstErr) {
      if (credToUse) {
       prfRes = await derivePasskeyPrf(salt32, null);
      } else {
       throw firstErr;
      }
     }

     passkeyFactor = prfRes.extraFactor;
     passkeyCred = prfRes.credentialId;
     if (passkeyCred && passkeyCred.length > 0) {
      const b64 = btoa(String.fromCharCode(...passkeyCred));
      localStorage.setItem('cm_passkey_cred_' + seedNum, b64);
     }
    } catch (pkErr) {
     if (btn) { btn.disabled = false; btn.textContent = origText; }
     return showErr('パスキー認証に失敗またはキャンセルされました: ' + pkErr.message);
    } finally {
     if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
   }

   if (isMulti) factorSummary = '（シード ＋ パスワード ＋ パスキー）';
   else if (isPasskey) factorSummary = '（シード ＋ パスキー）';
   else if (isDual) factorSummary = '（シード ＋ パスワード）';
   else factorSummary = '（シード単体）';

   const cb = activeKeyfileCallback;
   const ctx = activeKeyfileContext;
   closeKeyfileModal();

   if (cb) {
    cb({
     seedNum,
     password: needsPw ? passVal : '',
     passkeyFactor,
     passkeyCred,
     factorSummary,
     context: ctx
    });
   }
  });
 }

 window.MatrixCardPreset=window.MatrixCardPreset||{};
 window.MatrixCardPreset.downloadBlob=downloadBlob;
 window.MatrixCardPreset.saveSvgAsPng=saveSvgAsPng;
 window.MatrixCardPreset.svgToPngBase64=svgToPngBase64;
 window.MatrixCardPreset.exportKeePassXmlWithAttachments=exportKeePassXmlWithAttachments;
 window.MatrixCardPreset.showKeyfileModal=showKeyfileModal;
 window.MatrixCardPreset.closeKeyfileModal=closeKeyfileModal;
 window.MatrixCardPreset.generateKeePassXmlKeyfile=generateKeePassXmlKeyfile;
 window.MatrixCardPreset.exportKeePassXmlKeyfile=exportKeePassXmlKeyfile;

 window.promptLegacyPK2Consent = function() {
  if (typeof window !== 'undefined' && window.__PROMPT_PK2_RESPONSE__ !== undefined) {
   return Promise.resolve(!!window.__PROMPT_PK2_RESPONSE__);
  }
  return new Promise((resolve) => {
   const modal = document.getElementById('legacy-pk2-modal');
   const btnAccept = document.getElementById('btn-legacy-pk2-accept');
   const btnCancel = document.getElementById('btn-legacy-pk2-cancel');
   const btnClose = document.getElementById('btn-legacy-pk2-close');
   if (!modal || !btnAccept) {
    resolve(false);
    return;
   }
   modal.hidden = false;
   function cleanup(res) {
    modal.hidden = true;
    btnAccept.onclick = null;
    if (btnCancel) btnCancel.onclick = null;
    if (btnClose) btnClose.onclick = null;
    if (res) {
     window.__ALLOW_LEGACY_PK2__ = true;
    }
    resolve(res);
   }
   btnAccept.onclick = () => cleanup(true);
   if (btnCancel) btnCancel.onclick = () => cleanup(false);
   if (btnClose) btnClose.onclick = () => cleanup(false);
  });
 };
 window.MatrixCardPreset.promptLegacyPK2Consent = window.promptLegacyPK2Consent;
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
   btn.innerHTML=blindMode?(playing?'<svg class="cm-btn-ico" viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>ブラインド表示: ON（ルート再生中は自動表示）':'<svg class="cm-btn-ico" viewBox="0 0 24 24"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>ブラインド表示: ON（覗き見防止中）'):'<svg class="cm-btn-ico" viewBox="0 0 24 24"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>ブラインド表示: OFF';
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
  issue='';
  updateTransferButtonsUI();
  if(currentDisplayMode==='stroke'){
   stopMatrixTrace();
   updateStrokeGestureUI();
   return;
  }
  const designBar = document.getElementById('gesture-design-bar');
  if (designBar) designBar.style.display = 'none';
  originalSimulation();const cfg=getRecipeConfig();
  syncActiveModeUI(cfg);
  if(cardMode(cfg))try{filtered($('sim-site').value,$('sim-secret').value);}catch(e){issue=e.message;currentEvalSteps=[];$('sim-output-pw').textContent='';$('sim-trace-log').textContent='';}
  $('btn-copy-pw').disabled=!!issue;$('btn-play-trace').disabled=!!issue;
  if($('btn-play-stroke'))$('btn-play-stroke').disabled=false;
  if($('btn-pause-trace'))$('btn-pause-trace').disabled=false;
  if($('btn-stop-trace'))$('btn-stop-trace').disabled=false;
  if($('btn-sticky-play'))$('btn-sticky-play').disabled=!!issue;
  if($('btn-sticky-stroke'))$('btn-sticky-stroke').disabled=false;
  if($('btn-sticky-pause'))$('btn-sticky-pause').disabled=false;
  if($('btn-sticky-stop'))$('btn-sticky-stop').disabled=false;
  if($('btn-sticky-copy'))$('btn-sticky-copy').disabled=!!issue;
  if(cardMode(cfg)&&!issue){
   const input=filtered($('sim-site').value,$('sim-secret').value);
   const pw=currentEvalSteps.map(s=>s.ch).join('');
   const ent=estimatePasswordEntropy(pw);
   const subMode=cfg.lenMode===5?'パスワード（英大小・数字・記号）':cfg.lenMode===4?'パスワード（英大小・数字）':'銀行などの暗証番号（数字のみ）';
   $('sim-output-meta').textContent=`かんたん生成モード（${subMode}） ／ 出力: ${currentEvalSteps.length}${cfg.lenMode===3?'桁':'文字'} ／ 推定エントロピー: ${ent.bits} bits（※文字種・長さに基づく参考値。決定論的カード生成ではカードシード空間が上限）`;
   $('sim-step-banner').textContent='▶ 実際の出力文字があるマス・角が光ります。追読・代替・末尾の文字もカード上で確認できます。';
   const syms=cfg.lenMode===5?validateSymbols(cfg).join(''):'';
   setStatus('cq-status',`【現在使用中のモード】${getActiveModeLabel(cfg)}\n・適用済みシードフレーズ：${appliedSeed} ／ カードで探す文字：${input.site} ＋ ${input.secret}（交互配置）\n・出力：${cfg.lenMode===5?'英大小・数字・記号':cfg.lenMode===4?'英大小・数字':'数字のみ'} ${cfg.lenVal}${cfg.lenMode===3?'桁':'文字'}（文字種・長さ参考エントロピー ${ent.bits} bits）${cfg.lenMode===5?' ／ 使用可能な左下記号：'+syms:''}`);
   if(cfg.lenMode===3&&cfg.lenVal>=4&&cfg.lenVal<=12)$('cq-pin-length').value=String(cfg.lenVal);
   if(cfg.lenMode===5){if(cfg.lenVal>=16&&cfg.lenVal<=32)$('cq-symbol-length').value=String(cfg.lenVal);if([0,1,2].includes(cfg.symMode))$('cq-symbol-mode').value=String(cfg.symMode);$('cq-symbol-list').value=cfg.symList;}
  }else if(issue){$('sim-output-meta').textContent=issue;setStatus('cq-status',issue,true);}
  else{
   const pw=currentEvalSteps.map(s=>s.ch).join('');
   const ent=estimatePasswordEntropy(pw);
   if(pw&&$('sim-output-meta'))$('sim-output-meta').textContent=`1. マイ・レシピ全組み合わせ設定 ／ 総文字数: ${currentEvalSteps.length}文字 （記号代替発動: ${currentEvalSteps.filter(s=>s.isFallback).length}箇所） ／ 推定エントロピー: ${ent.bits} bits（※文字種・長さに基づく参考値。決定論的カード生成ではカードシード空間が上限）`;
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
  if(count>512){
   throw new Error(`データサイズが大きすぎるためBIP39単語形式（上限512ブロック＝約10KB）に変換できません（現在 ${count} ブロック）。「暗号化ファイル(.cmenc)保存」または「PGPアーマード保存」をご利用ください。`);
  }
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
  zeroize(rnd);
  zeroize(coeffs);
  return shares;
 }
 function shamirCombine(shareItems){
  if(!Array.isArray(shareItems)||shareItems.length<2){
   throw new Error('秘密分散の復元に十分なシェアがありません。');
  }
  const m=shareItems.length;
  const first=shareItems[0];
  if(!first?.data||!(first.data instanceof Uint8Array)||first.data.length===0){
   throw new Error('シェアデータが空または不正です。');
  }
  if(first.m!==undefined&&(first.m<2||m<first.m)){
   throw new Error(`復元には最低 ${first.m} 個のシェアが必要です（現在 ${m} 個）。`);
  }
  const len=first.data.length;
  const L=new Uint8Array(m);
  for(let j=0;j<m;j++){
   const item=shareItems[j];
   const xj=item?.index;
   if(!Number.isInteger(xj)||xj<1||xj>255){
    throw new Error(`シェア番号が不正です（index=${xj}）。1〜255の範囲である必要があります。`);
   }
   if(first.n!==undefined&&xj>first.n){
    throw new Error(`シェア番号（#${xj}）が分割数（${first.n}）を超えています。`);
   }
   if(!item.data||!(item.data instanceof Uint8Array)||item.data.length!==len){
    throw new Error('シェア間でデータ長が一致しません。異なるバックアップデータが混在しています。');
   }
   if((first.m!==undefined&&item.m!==undefined&&item.m!==first.m)||(first.n!==undefined&&item.n!==undefined&&item.n!==first.n)){
    throw new Error('異なる秘密分散設定（M-of-N）のシェアが混在しています。');
   }
   if(first.setId!==undefined&&item.setId!==undefined){
    const sameSet=(first.setId instanceof Uint8Array&&item.setId instanceof Uint8Array)?equal(first.setId,item.setId):(item.setId===first.setId);
    if(!sameSet)throw new Error('異なるセットIDのシェアが混在しています。');
   }
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

 function zeroize(buf){
  if(!buf)return;
  if(buf instanceof Uint8Array||buf instanceof Uint32Array||buf instanceof Int32Array||ArrayBuffer.isView(buf)){
   buf.fill(0);
  }else if(buf instanceof ArrayBuffer){
   new Uint8Array(buf).fill(0);
  }
 }
 const ChaCha20Poly1305=(()=>{
  function chacha20Block(key,counter,nonce){
   const state=new Uint32Array(16);
   state[0]=0x61707865;state[1]=0x3320646e;state[2]=0x79622d32;state[3]=0x6b206574;
   const keyView=new DataView(key.buffer,key.byteOffset,32);
   for(let i=0;i<8;i++)state[4+i]=keyView.getUint32(i*4,true);
   state[12]=counter;
   const nonceView=new DataView(nonce.buffer,nonce.byteOffset,12);
   for(let i=0;i<3;i++)state[13+i]=nonceView.getUint32(i*4,true);
   const x=new Uint32Array(state);
   function qr(a,b,c,d){
    x[a]=(x[a]+x[b])|0;x[d]^=x[a];x[d]=(x[d]<<16)|(x[d]>>>16);
    x[c]=(x[c]+x[d])|0;x[b]^=x[c];x[b]=(x[b]<<12)|(x[b]>>>20);
    x[a]=(x[a]+x[b])|0;x[d]^=x[a];x[d]=(x[d]<<8)|(x[d]>>>24);
    x[c]=(x[c]+x[d])|0;x[b]^=x[c];x[b]=(x[b]<<7)|(x[b]>>>25);
   }
   for(let i=0;i<10;i++){
    qr(0,4,8,12);qr(1,5,9,13);qr(2,6,10,14);qr(3,7,11,15);
    qr(0,5,10,15);qr(1,6,11,12);qr(2,7,8,13);qr(3,4,9,14);
   }
   const out=new Uint8Array(64);
   const outView=new DataView(out.buffer);
   for(let i=0;i<16;i++){
    outView.setUint32(i*4,(x[i]+state[i])|0,true);
   }
   zeroize(state);
   zeroize(x);
   return out;
  }
  function chacha20Xor(key,counter,nonce,data){
   const out=new Uint8Array(data.length);
   const blockCount=Math.ceil(data.length/64);
   for(let b=0;b<blockCount;b++){
    const keyStream=chacha20Block(key,counter+b,nonce);
    const start=b*64,end=Math.min(data.length,start+64);
    for(let i=start;i<end;i++)out[i]=data[i]^keyStream[i-start];
    zeroize(keyStream);
   }
   return out;
  }
  function poly1305(key32,msg){
   const P=(1n<<130n)-5n;
   const rBytes=key32.slice(0,16);
   rBytes[3]&=15;rBytes[7]&=15;rBytes[11]&=15;rBytes[15]&=15;
   rBytes[4]&=252;rBytes[8]&=252;rBytes[12]&=252;
   function bytesToBigIntLE(b){
    let val=0n;
    for(let i=b.length-1;i>=0;i--)val=(val<<8n)|BigInt(b[i]);
    return val;
   }
   const r=bytesToBigIntLE(rBytes);
   const s=bytesToBigIntLE(key32.slice(16,32));
   let acc=0n;
   for(let offset=0;offset<msg.length;offset+=16){
    const chunk=msg.subarray(offset,Math.min(msg.length,offset+16));
    const chunkWithOne=new Uint8Array(chunk.length+1);
    chunkWithOne.set(chunk);
    chunkWithOne[chunk.length]=0x01;
    const n=bytesToBigIntLE(chunkWithOne);
    acc=((acc+n)*r)%P;
   }
   acc=(acc+s)%(1n<<128n);
   const tag=new Uint8Array(16);
   for(let i=0;i<16;i++)tag[i]=Number((acc>>BigInt(i*8))&0xffn);
   zeroize(rBytes);
   return tag;
  }
  function pad16(bytes){
   const rem=bytes.length%16;
   if(rem===0)return bytes;
   const out=new Uint8Array(bytes.length+(16-rem));
   out.set(bytes);
   return out;
  }
  function numTo64LE(num){
   const buf=new Uint8Array(8);
   const view=new DataView(buf.buffer);
   view.setUint32(0,num&0xffffffff,true);
   view.setUint32(4,Math.floor(num/0x100000000),true);
   return buf;
  }
  return{
   encrypt(key,nonce,plaintext,aad=new Uint8Array(0)){
    const block0=chacha20Block(key,0,nonce);
    const otk=block0.slice(0,32);
    zeroize(block0);
    const ciphertext=chacha20Xor(key,1,nonce,plaintext);
    const macData=concat(pad16(aad),pad16(ciphertext),numTo64LE(aad.length),numTo64LE(ciphertext.length));
    const tag=poly1305(otk,macData);
    zeroize(otk);
    return{ciphertext,tag};
   },
   decrypt(key,nonce,ciphertext,tag,aad=new Uint8Array(0)){
    const block0=chacha20Block(key,0,nonce);
    const otk=block0.slice(0,32);
    zeroize(block0);
    const macData=concat(pad16(aad),pad16(ciphertext),numTo64LE(aad.length),numTo64LE(ciphertext.length));
    const computedTag=poly1305(otk,macData);
    zeroize(otk);
    let diff=0;
    for(let i=0;i<16;i++)diff|=(tag[i]^computedTag[i]);
    if(diff!==0)throw new Error('ChaCha20-Poly1305 MAC tag mismatch');
    return chacha20Xor(key,1,nonce,ciphertext);
   }
  };
 })();

 /* ===================================================================
  * CME3 Dual-Cascade Encryption (AES-256-GCM + ChaCha20-Poly1305)
  * + CME2 Legacy Backward Compatibility + Serverless 2FA
  * =================================================================== */
 const KDF_ITERATIONS={0:600000,1:2100000,2:5000000,3:'argon2id',4:'argon2id',5:'argon2id'};
 const ARGON2_PROFILES={
  3:{memorySize:65536,iterations:3,parallelism:1,label:'64MB / 3反復（PC・スマホ両用推奨）',isMobileSafe:true},
  4:{memorySize:131072,iterations:3,parallelism:1,label:'128MB / 3反復（PC推奨・高強度 / ⚠️スマホ高負荷）',isMobileSafe:false},
  5:{memorySize:262144,iterations:4,parallelism:1,label:'256MB / 4反復（PC限定・超高強度 / ⚠️スマホ復元困難）',isMobileSafe:false}
 };
 const KDF_LABELS={
  0:'Level 1 PBKDF2（600,000回 ＋ HKDF-SHA512 ＋ 二重カスケード AES-256-GCM / ChaCha20-Poly1305 ＋ Key-Committing HMAC）',
  1:'Level 2 PBKDF2（2,100,000回 ＋ HKDF-SHA512 ＋ 二重カスケード AES-256-GCM / ChaCha20-Poly1305 ＋ Key-Committing HMAC）',
  2:'Level 3 PBKDF2（5,000,000回 ＋ HKDF-SHA512 ＋ 二重カスケード AES-256-GCM / ChaCha20-Poly1305 ＋ Key-Committing HMAC）',
  3:'Level 4 Argon2id 64MB / 3回（RFC 9106標準 / PC・スマホ両用 ＋ 二重カスケード ＋ Key-Committing HMAC）',
  4:'Level 5 Argon2id 128MB / 3回（高強度・PC推奨 ⚠️スマホ高負荷 ＋ 二重カスケード ＋ Key-Committing HMAC）',
  5:'Level 6 Argon2id 256MB / 4回（最高強度・PC限定 ⚠️スマホ復元困難 ＋ 二重カスケード ＋ Key-Committing HMAC）'
 };

 function getSavedPasskeyCredential() {
  try {
   const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('cm_registered_passkey_v1') : null;
   if (!raw) return null;
   const parsed = JSON.parse(raw);
   const rpId = (typeof location !== 'undefined' && location.hostname) ? location.hostname : 'localhost';
   if (parsed && parsed.id && (!parsed.rpId || parsed.rpId === rpId)) {
    const bin = atob(parsed.id);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return { credentialId: arr, metadata: parsed };
   }
  } catch (_) {}
  return null;
 }

 function savePasskeyCredential(rawCredId, meta = {}) {
  try {
   if (!rawCredId || !rawCredId.length || typeof localStorage === 'undefined') return;
   const b64 = btoa(String.fromCharCode(...rawCredId));
   const rpId = (typeof location !== 'undefined' && location.hostname) ? location.hostname : 'localhost';
   const obj = {
    id: b64,
    rpId,
    createdAt: meta.createdAt || Date.now(),
    label: meta.label || 'CryptoMatrix パスキー'
   };
   localStorage.setItem('cm_registered_passkey_v1', JSON.stringify(obj));
   if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('cm-passkey-changed', { detail: obj }));
   }
  } catch (_) {}
 }

 function clearSavedPasskeyCredential() {
  try {
   if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('cm_registered_passkey_v1');
   }
   if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('cm-passkey-changed', { detail: null }));
   }
  } catch (_) {}
 }

 async function derivePasskeyPrf(salt32,credentialId=null,opts={}){
  if(!window.PublicKeyCredential||!navigator.credentials){
   throw new Error('お使いのブラウザ環境ではパスキーが利用できません。対応ブラウザで開いてください。');
  }
  const rpId=location.hostname||'localhost';
  const prfInput=await sha(concat(enc.encode('CryptoMatrix-WebAuthn-PRF-v1:'),salt32));

  if(!credentialId && !opts.forceNew){
   const saved = getSavedPasskeyCredential();
   if(saved && saved.credentialId && saved.credentialId.length){
    try {
     return await derivePasskeyPrf(salt32, saved.credentialId, opts);
    } catch(err) {
     if(err.name === 'AbortError' || (err.name === 'NotAllowedError' && (err.message?.includes('cancel') || err.message?.includes('キャンセル')))){
      throw err;
     }
     console.warn('Saved passkey authentication failed, creating new:', err);
    }
   }
  }

  if(!credentialId){
   const userSecret=crypto.getRandomValues(new Uint8Array(32));
   const challenge=crypto.getRandomValues(new Uint8Array(32));
   let created;
   try {
    created=await navigator.credentials.create({
     publicKey:{
      challenge,
      rp:{name:'Crypto Matrix Backup',id:rpId},
      user:{id:userSecret,name:'cryptomatrix-backup-2fa',displayName:'Crypto Matrix 2FA Passkey'},
      pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257},{type:'public-key',alg:-8}],
      authenticatorSelection:{userVerification:'required',residentKey:'preferred'},
      timeout:60000,
      extensions:{prf:{eval:{first:prfInput}}}
     }
    });
   } catch(err) {
    throw err;
   }
   if(!created)throw new Error('パスキーの作成がキャンセルされました。');
   const rawCredId=new Uint8Array(created.rawId);
   if(!rawCredId.length||rawCredId.length>512)throw new Error('パスキー識別子の長さが不正です。');
   
   // 1. 作成時にすでにPRF結果がある場合（真のPRF対応）
   const extRes=created.getClientExtensionResults?.()?.prf;
   if(extRes?.results?.first){
    savePasskeyCredential(rawCredId);
    return{extraFactor:await sha512(new Uint8Array(extRes.results.first)),credentialId:rawCredId};
   }

   // 2. 作成時にPRF結果がなければ get() で試行
   let getPrf=null;
   try {
    const assertion=await navigator.credentials.get({
     publicKey:{
      challenge:crypto.getRandomValues(new Uint8Array(32)),
      rpId,
      allowCredentials:[{type:'public-key',id:rawCredId}],
      userVerification:'preferred',
      timeout:60000,
      extensions:{prf:{eval:{first:prfInput}}}
     }
    });
    getPrf=assertion?.getClientExtensionResults?.()?.prf;
   } catch(_) {}

   if(getPrf?.results?.first){
    savePasskeyCredential(rawCredId);
    return{extraFactor:await sha512(new Uint8Array(getPrf.results.first)),credentialId:rawCredId};
   }



   throw new Error('お使いの認証器・ブラウザはWebAuthn PRF（暗号鍵導出拡張）に対応していません。パスキー保護にはPRF対応環境、または「キーファイル／パスワード」保護をご利用ください。');
  }

  if(credentialId.length>35&&credentialId[0]===0x50&&credentialId[1]===0x4b&&credentialId[2]===0x02){
   let allowMigrate = (typeof window !== 'undefined' && (window.__ALLOW_LEGACY_PK2__ === true || window.__ALLOW_LEGACY_MIGRATION__ === true));
   if(!allowMigrate && window.__ALLOW_LEGACY_PK2__ !== false && typeof window !== 'undefined' && typeof window.promptLegacyPK2Consent === 'function'){
    allowMigrate = await window.promptLegacyPK2Consent();
   }
   if(!allowMigrate){
    throw new Error('旧PKv2形式のパスキー保護データはセキュリティ上の理由（PRF非対応フォールバック廃止）により救出が許可されていません。救出・移行を許可して再試行してください。');
   }
   const maskedSecret=credentialId.slice(3,35);
   const rawCredId=credentialId.slice(35);
   const maskKey=(await sha512(concat(enc.encode('CM-PASSKEY-MASK-v2:'),salt32,rawCredId))).slice(0,32);
   const userSecret=new Uint8Array(32);
   for(let i=0;i<32;i++)userSecret[i]=maskedSecret[i]^maskKey[i];
   const extraFactor=await sha512(concat(enc.encode('CM-PASSKEY-FACTOR-v2:'),salt32,rawCredId,userSecret));
   return{extraFactor,credentialId:rawCredId,isLegacyPK2Migrated:true};
  }

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
   throw new Error('このパスキーバックアップの復号にはWebAuthn PRF拡張対応環境が必要です。');
  }
  const extraFactor=await sha512(new Uint8Array(extRes.results.first));
  return{extraFactor,credentialId};
 }
 async function deriveKeysCME2(password,salt,kdfProfile,extraFactor=null,hasPassword=true){
  const subt=cryptoAPI();
  const iterations=KDF_ITERATIONS[kdfProfile];
  if(!iterations)throw new Error('未対応の暗号化プロファイルです。');
  let keyMaterial,pwBytes=null;
  try{
   if(hasPassword){
    pwBytes=enc.encode(String(password??''));
    if(!pwBytes.length)throw new Error('このバックアップには「復元用パスワード」が設定されています。パスワードを入力してください。');
    if(pwBytes.length>4096)throw new Error('復元用パスワードが長すぎます。');
    keyMaterial=extraFactor&&extraFactor.length
     ?concat(pwBytes,new Uint8Array([0x00,0xff,0x43,0x4d]),extraFactor)
     :pwBytes.slice();
   }else{
    if(!extraFactor||!extraFactor.length)throw new Error('保護キー（キーファイルまたはパスキー）の導出に失敗しました。');
    keyMaterial=concat(enc.encode('CM-NOPASS:'),extraFactor);
   }
   let masterBits;
   if(kdfProfile===3||kdfProfile===4||kdfProfile===5){
    if(typeof hashwasm==='undefined'||!hashwasm.argon2id){
     throw new Error('Argon2id（WebAssembly）が読み込まれていないか利用できない環境です。');
    }
    const argonCfg=ARGON2_PROFILES[kdfProfile]||{memorySize:65536,iterations:3,parallelism:1};
    const argonSalt=concat(salt,enc.encode(':ARGON2ID:'));
    try{
     masterBits=await hashwasm.argon2id({
      password:keyMaterial,
      salt:argonSalt.subarray(0,32),
      parallelism:argonCfg.parallelism||1,
      iterations:argonCfg.iterations,
      memorySize:argonCfg.memorySize,
      hashLength:64,
      outputType:'binary'
     });
    }catch(err){
     if(argonCfg.memorySize>65536){
      throw new Error(`Argon2id（メモリ ${argonCfg.memorySize/1024}MB）の計算に失敗しました。端末のメモリ不足の可能性があります（スマホでは復元が困難な高強度設定です）: ${err?.message||err}`);
     }
     throw err;
    }
    zeroize(keyMaterial);if(pwBytes)zeroize(pwBytes);
   }else{
    const baseKey=await subt.importKey('raw',keyMaterial,'PBKDF2',false,['deriveBits']);
    zeroize(keyMaterial);if(pwBytes)zeroize(pwBytes);
    masterBits=await subt.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-512'},baseKey,512);
   }
   const hkdfKey=await subt.importKey('raw',masterBits,'HKDF',false,['deriveKey']);
   zeroize(masterBits);
   const infoSuffix=extraFactor&&extraFactor.length?concat(enc.encode(':2FA:'),await sha(extraFactor)):new Uint8Array(0);
   const aesKey=await subt.deriveKey({name:'HKDF',hash:'SHA-512',salt,info:concat(enc.encode('CryptoMatrix-CME2-AES256GCM-Key'),infoSuffix)},hkdfKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
   const hmacKey=await subt.deriveKey({name:'HKDF',hash:'SHA-512',salt,info:concat(enc.encode('CryptoMatrix-CME2-KeyCommit-HMAC'),infoSuffix)},hkdfKey,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
   return{aesKey,hmacKey};
  }finally{
   if(pwBytes)zeroize(pwBytes);if(keyMaterial)zeroize(keyMaterial);
  }
 }
 async function deriveKeysCME3(password,salt,kdfProfile,extraFactor=null,hasPassword=true){
  const subt=cryptoAPI();
  const iterations=KDF_ITERATIONS[kdfProfile];
  if(iterations===undefined)throw new Error('未対応の暗号化プロファイルです。');
  let keyMaterial,pwBytes=null;
  try{
   if(hasPassword){
    pwBytes=enc.encode(String(password??''));
    if(!pwBytes.length)throw new Error('このバックアップには「復元用パスワード」が設定されています。パスワードを入力してください。');
    if(pwBytes.length>4096)throw new Error('復元用パスワードが長すぎます。');
    keyMaterial=extraFactor&&extraFactor.length
     ?concat(pwBytes,new Uint8Array([0x00,0xff,0x43,0x4d]),extraFactor)
     :pwBytes.slice();
   }else{
    if(!extraFactor||!extraFactor.length)throw new Error('保護キー（キーファイルまたはパスキー）の導出に失敗しました。');
    keyMaterial=concat(enc.encode('CM-NOPASS:'),extraFactor);
   }
   let masterBits;
   if(kdfProfile===3||kdfProfile===4||kdfProfile===5){
    if(typeof hashwasm==='undefined'||!hashwasm.argon2id){
     throw new Error('Argon2id（WebAssembly）が読み込まれていないか利用できない環境です。');
    }
    const argonCfg=ARGON2_PROFILES[kdfProfile]||{memorySize:65536,iterations:3,parallelism:1};
    const argonSalt=concat(salt,enc.encode(':ARGON2ID:'));
    try{
     masterBits=await hashwasm.argon2id({
      password:keyMaterial,
      salt:argonSalt.subarray(0,32),
      parallelism:argonCfg.parallelism||1,
      iterations:argonCfg.iterations,
      memorySize:argonCfg.memorySize,
      hashLength:64,
      outputType:'binary'
     });
    }catch(err){
     if(argonCfg.memorySize>65536){
      throw new Error(`Argon2id（メモリ ${argonCfg.memorySize/1024}MB）の計算に失敗しました。端末のメモリ不足の可能性があります（スマホでは復元が困難な高強度設定です。PCブラウザでの復元をお試しください）: ${err?.message||err}`);
     }
     throw err;
    }
    zeroize(keyMaterial);if(pwBytes)zeroize(pwBytes);
   }else{
    const baseKey=await subt.importKey('raw',keyMaterial,'PBKDF2',false,['deriveBits']);
    zeroize(keyMaterial);if(pwBytes)zeroize(pwBytes);
    masterBits=await subt.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-512'},baseKey,512);
   }
   const hkdfKey=await subt.importKey('raw',masterBits,'HKDF',false,['deriveKey','deriveBits']);
   zeroize(masterBits);
   const infoSuffix=extraFactor&&extraFactor.length?concat(enc.encode(':2FA:'),await sha(extraFactor)):new Uint8Array(0);
   const aesKey=await subt.deriveKey({name:'HKDF',hash:'SHA-512',salt,info:concat(enc.encode('CryptoMatrix-CME3-AES256GCM-Key'),infoSuffix)},hkdfKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
   const chachaBits=await subt.deriveBits({name:'HKDF',hash:'SHA-512',salt,info:concat(enc.encode('CryptoMatrix-CME3-ChaCha20Poly1305-Key'),infoSuffix)},hkdfKey,256);
   const chachaKey=new Uint8Array(chachaBits);
   const hmacKey=await subt.deriveKey({name:'HKDF',hash:'SHA-512',salt,info:concat(enc.encode('CryptoMatrix-CME3-KeyCommit-HMAC'),infoSuffix)},hkdfKey,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
   return{aesKey,chachaKey,hmacKey};
  }finally{
   if(pwBytes)zeroize(pwBytes);if(keyMaterial)zeroize(keyMaterial);
  }
 }
 async function encryptBodyCME3(plainBody,password,kdfProfile=1,factors={}){
  const profile=Number(kdfProfile);
  if(!(profile in KDF_ITERATIONS))throw new Error('暗号化プロファイルの指定が不正です。');
  const usePass=factors?.usePassword!==undefined?!!factors.usePassword:true;
  const useKeyfile=!!factors?.useKeyfile;
  const usePasskey=!!factors?.usePasskey;
  if(!usePass&&!useKeyfile&&!usePasskey){
   throw new Error('保護・暗号化の方法（パスワード、キーファイル、パスキー）を少なくとも1つ選択してください。');
  }
  if(usePass){
   if(Array.from(String(password??'')).length<12)throw new Error('復元用パスワードは12文字以上で入力してください。');
  }
  let combo=0;
  if(usePass&&!useKeyfile&&!usePasskey)combo=0;
  else if(usePass&&useKeyfile&&!usePasskey)combo=1;
  else if(usePass&&!useKeyfile&&usePasskey)combo=2;
  else if(usePass&&useKeyfile&&usePasskey)combo=3;
  else if(!usePass&&useKeyfile&&!usePasskey)combo=4;
  else if(!usePass&&!useKeyfile&&usePasskey)combo=5;
  else if(!usePass&&useKeyfile&&usePasskey)combo=6;

  const salt=crypto.getRandomValues(new Uint8Array(32));
  const aesIv=crypto.getRandomValues(new Uint8Array(12));
  const chachaNonce=crypto.getRandomValues(new Uint8Array(12));
  let extraFactor=null,credHeader=new Uint8Array(0),passkeySalt=salt,formatVersion=3;

  if(useKeyfile){
   if(!factors.keyfileBytes||!factors.keyfileBytes.length)throw new Error('キーファイルを選択するか、「専用キーファイル(.key)を新規作成・保存」を押してください。');
  }
  let prf=null;
  if(usePasskey){
   if(factors.passkeyContext){
    prf=factors.passkeyContext;
    passkeySalt=prf.salt;
    formatVersion=4;
   }else prf=await derivePasskeyPrf(salt,null);
   if(factors)factors.createdPrf=prf;
   if(prf.credentialId.length>512)throw new Error('パスキー識別子が長すぎます。');
   credHeader=new Uint8Array(2+prf.credentialId.length);
   new DataView(credHeader.buffer).setUint16(0,prf.credentialId.length,false);
   credHeader.set(prf.credentialId,2);
  }

  if(useKeyfile&&usePasskey){
   extraFactor=await sha512(concat(enc.encode('CM-KEYFILE-PASSKEY:'),await sha512(factors.keyfileBytes),prf.extraFactor));
  }else if(useKeyfile){
   extraFactor=await sha512(factors.keyfileBytes);
  }else if(usePasskey){
   extraFactor=prf.extraFactor;
  }

  const profileByte=(profile&0x0f)|((combo&0x0f)<<4);
  const header=concat(new Uint8Array([0x43,0x4d,0x45,formatVersion,profileByte]),salt,aesIv,chachaNonce,formatVersion===4?passkeySalt:new Uint8Array(0),credHeader);
  const {aesKey,chachaKey,hmacKey}=await deriveKeysCME3(usePass?password:'',salt,profile,extraFactor,usePass);

  let innerPayload=null;
  try{
   // Inner Layer: ChaCha20-Poly1305
   const aadChacha=concat(enc.encode('CME3:CHACHA:v3:'),chachaNonce);
   const chachaRes=ChaCha20Poly1305.encrypt(chachaKey,chachaNonce,plainBody,aadChacha);
   innerPayload=concat(chachaRes.ciphertext,chachaRes.tag);

   // Outer Layer: AES-256-GCM
   const aadAes=concat(enc.encode('CME3:AEAD:v3:'),header);
   const outerCiphertext=new Uint8Array(await cryptoAPI().encrypt({name:'AES-GCM',iv:aesIv,additionalData:aadAes,tagLength:128},aesKey,innerPayload));

   // Key-Commitment: HMAC-SHA256
   const commitTag=new Uint8Array(await cryptoAPI().sign('HMAC',hmacKey,concat(header,outerCiphertext))).slice(0,16);
   return concat(header,commitTag,outerCiphertext);
  }finally{
   zeroize(chachaKey);
   if(innerPayload)zeroize(innerPayload);
  }
 }
 const encryptBodyCME2=(plainBody,password,kdfProfile=1,factors={})=>encryptBodyCME3(plainBody,password,kdfProfile,factors);

 async function encryptDuressDualCME(realBody,realPassword,decoyBody,decoyPassword,kdfProfile=1,factors={}){
  let dualFactors=factors,sharedContext=null;
  if(factors.usePasskey){
   const sharedSalt=crypto.getRandomValues(new Uint8Array(32));
   sharedContext=await derivePasskeyPrf(sharedSalt,null);
   sharedContext.salt=sharedSalt;
   dualFactors={...factors,passkeyContext:sharedContext};
  }
  try{
   const cmeDecoy=await encryptBodyCME3(decoyBody,decoyPassword,kdfProfile,dualFactors);
   if(cmeDecoy.length>65535){
    throw new Error('おとりデータのサイズが大きすぎます（上限約64KB）。おとりテキストを短くしてください。');
   }
   const cmeReal=await encryptBodyCME3(realBody,realPassword,kdfProfile,dualFactors);
   const lenDecoy=new Uint8Array(2);
   new DataView(lenDecoy.buffer).setUint16(0,cmeDecoy.length,false);
   const profile=Number(kdfProfile);
   const containerHeader=new Uint8Array([0x43,0x4d,0x45,3,(profile&0x0f)|0x80]);
   return concat(containerHeader,lenDecoy,cmeDecoy,cmeReal);
  }finally{
   if(sharedContext?.extraFactor)zeroize(sharedContext.extraFactor);
   if(sharedContext?.salt)zeroize(sharedContext.salt);
  }
 }

 async function decryptBodyCME(cmeBody,password,twoFaOpts=null){
  if(cmeBody.length<4)throw new Error('暗号化データの長さが不正です。');
  if(cmeBody[0]!==0x43||cmeBody[1]!==0x4d||cmeBody[2]!==0x45){
   throw new Error('未対応の暗号化フォーマットです。');
  }

  // Dual-Payload Duress Container (bit 7 of byte 4)
  if(cmeBody.length>7&&(cmeBody[4]&0x80)!==0){
   const lenSlot1=new DataView(cmeBody.buffer,cmeBody.byteOffset+5,2).getUint16(0,false);
   if(lenSlot1<1||7+lenSlot1>=cmeBody.length){
    throw new Error('デュアルスロット暗号化コンテナのヘッダ長が不正です。');
   }
   const slot1=cmeBody.subarray(7,7+lenSlot1);
   const slot2=cmeBody.subarray(7+lenSlot1);
   // Always evaluate both slots. This makes the password path take the same
   // KDF work for the real and duress records. CME4 shares one cached WebAuthn
   // PRF result, so new dual backups ask for biometric authentication once.
   const sharedOpts=Object.assign({},twoFaOpts||{}, {__cmPasskeyCache:new Map()});
   let realResult,decoyResult,realError,decoyError;
   try{realResult=await decryptBodyCME(slot2,password,sharedOpts);}catch(e){realError=e;}
   try{decoyResult=await decryptBodyCME(slot1,password,sharedOpts);}catch(e){decoyError=e;}
   for(const prf of sharedOpts.__cmPasskeyCache.values())if(prf?.extraFactor)zeroize(prf.extraFactor);
   if(realResult)return{...realResult,isDuress:false};
   if(decoyResult)return{...decoyResult,isDuress:true};
   throw new Error('復元用パスワードが違うか、保護キー（キーファイル／パスキー）が一致しません。');
  }

  const version=cmeBody[3];
  if(version===2){
   return decryptBodyCME2(cmeBody,password,twoFaOpts);
  }
  if(version!==3&&version!==4){
   throw new Error(`未対応の暗号化バージョン（CME v${version}）です。`);
  }

  // CME3 Dual-Cascade Decryption
  if(cmeBody.length<61+16+16+16)throw new Error('暗号化データの長さが不正です。');
  const profileByte=cmeBody[4],profile=profileByte&0x0f,combo=(profileByte>>>4)&0x0f;
  const needPass=(combo===0||combo===1||combo===2||combo===3);
  const needKeyfile=(combo===1||combo===3||combo===4||combo===6);
  const needPasskey=(combo===2||combo===3||combo===5||combo===6);

  const salt=cmeBody.slice(5,37);
  const aesIv=cmeBody.slice(37,49);
  const chachaNonce=cmeBody.slice(49,61);

  if(needPass){
   if(!password||!String(password).length){
    throw new Error('このバックアップには「復元用パスワード」が設定されています。パスワードを入力してください。');
   }
  }
  if(needKeyfile){
   if(!twoFaOpts?.keyfileBytes||!twoFaOpts.keyfileBytes.length){
    throw new Error('このバックアップには「キーファイル」が設定されています。復元欄のキーファイル選択で同じファイルを指定してください。');
   }
  }

  let headerLen=61,passkeyFactor=null,isLegacyPK2Migrated=false;
  if(needPasskey){
   const prfOffset=version===4?93:61;
   if(cmeBody.length<prfOffset+2+16+16+16)throw new Error('パスキー保護バックアップのヘッダ長が不正です。');
   const credLen=new DataView(cmeBody.buffer,cmeBody.byteOffset+prfOffset,2).getUint16(0,false);
   headerLen=prfOffset+2+credLen;
   if(credLen<1||credLen>512||cmeBody.length<headerLen+16+16+16)throw new Error('パスキー識別子の長さが不正です。');
   const credId=cmeBody.slice(prfOffset+2,headerLen);
   const prfSalt=version===4?cmeBody.slice(61,93):salt;
   const cacheKey=Array.from(prfSalt).join(',')+'|'+Array.from(credId).join(',');
   let prf=twoFaOpts?.__cmPasskeyCache?.get(cacheKey);
   if(!prf){
    prf=await derivePasskeyPrf(prfSalt,credId);
    twoFaOpts?.__cmPasskeyCache?.set(cacheKey,prf);
   }
   passkeyFactor=prf.extraFactor;
   if(prf.isLegacyPK2Migrated)isLegacyPK2Migrated=true;
  }

  let extraFactor=null;
  if(needKeyfile&&needPasskey){
   extraFactor=await sha512(concat(enc.encode('CM-KEYFILE-PASSKEY:'),await sha512(twoFaOpts.keyfileBytes),passkeyFactor));
  }else if(needKeyfile){
   extraFactor=await sha512(twoFaOpts.keyfileBytes);
  }else if(needPasskey){
   extraFactor=passkeyFactor;
  }

  const header=cmeBody.slice(0,headerLen);
  const commitTag=cmeBody.slice(headerLen,headerLen+16);
  const outerCiphertext=cmeBody.slice(headerLen+16);

  const {aesKey,chachaKey,hmacKey}=await deriveKeysCME3(needPass?password:'',salt,profile,extraFactor,needPass);
  try{
   const expectedCommit=new Uint8Array(await cryptoAPI().sign('HMAC',hmacKey,concat(header,outerCiphertext))).slice(0,16);
   if(!equal(expectedCommit,commitTag)){
    const failMsg=needPass&&(needKeyfile||needPasskey)
     ?'復元用パスワードまたは保護キー（キーファイル／パスキー）が違うか、暗号化データが破損しています。'
     :needPass
     ?'復元用パスワードが違うか、暗号化データが破損しています。'
     :'指定された保護キー（キーファイルまたはパスキー）が違うか、暗号化データが破損しています。';
    throw new Error(failMsg);
   }

   let innerPayload;
   try{
    const aadAes=concat(enc.encode('CME3:AEAD:v3:'),header);
    innerPayload=new Uint8Array(await cryptoAPI().decrypt({name:'AES-GCM',iv:aesIv,additionalData:aadAes,tagLength:128},aesKey,outerCiphertext));
   }catch(_){
    throw new Error('復号に失敗しました。パスワードまたは保護キー（キーファイル／パスキー）を確認してください。');
   }

   if(innerPayload.length<16){
    zeroize(innerPayload);
    throw new Error('カスケード暗号の内層データ長が不正です。');
   }
   const chachaCiphertext=innerPayload.subarray(0,innerPayload.length-16);
   const chachaTag=innerPayload.subarray(innerPayload.length-16);
   const aadChacha=concat(enc.encode('CME3:CHACHA:v3:'),chachaNonce);

   let innerBody;
   try{
    innerBody=ChaCha20Poly1305.decrypt(chachaKey,chachaNonce,chachaCiphertext,chachaTag,aadChacha);
   }catch(e){
    throw new Error('内層ChaCha20-Poly1305復号に失敗しました。認証タグ不一致または改ざんを検出しました。');
   }finally{
    zeroize(innerPayload);
   }

   return{innerBody,kdfProfile:profile,combo,needPass,needKeyfile,needPasskey,version:3,isLegacyPK2Migrated};
  }finally{
   zeroize(chachaKey);
  }
 }
 async function decryptBodyCME2(cmeBody,password,twoFaOpts=null){
  if(!cmeBody||cmeBody.length<4)throw new Error('暗号化データの長さが不正です。');
  if(cmeBody[0]!==0x43||cmeBody[1]!==0x4d||cmeBody[2]!==0x45){
   throw new Error('未対応の暗号化フォーマットです。');
  }
  if((cmeBody.length>7&&(cmeBody[4]&0x80)!==0)||cmeBody[3]!==2){
   return decryptBodyCME(cmeBody,password,twoFaOpts);
  }
  if(cmeBody.length<63)throw new Error('CME v2暗号化データの長さが不正です。');
  const profileByte=cmeBody[4],kdfProfile=profileByte&0x0f,combo=(profileByte>>>4)&0x07;
  const needPass=(combo===0||combo===1||combo===2||combo===3);
  const needKeyfile=(combo===1||combo===3||combo===4||combo===6);
  const needPasskey=(combo===2||combo===3||combo===5||combo===6);
  if(needPass&&(!password||!String(password).length)){
   throw new Error('このバックアップには「復元用パスワード」が設定されています。パスワードを入力してください。');
  }
  if(needKeyfile&&(!twoFaOpts?.keyfileBytes||!twoFaOpts.keyfileBytes.length)){
   throw new Error('このバックアップには「キーファイル」が設定されています。復元欄のキーファイル選択で同じファイルを指定してください。');
  }
  const salt=cmeBody.slice(5,37);
  const iv=cmeBody.slice(37,49);
  let headerLen=49,passkeyFactor=null,isLegacyPK2Migrated=false;
  if(needPasskey){
   if(cmeBody.length<51+16+16)throw new Error('CME v2パスキー保護バックアップのヘッダ長が不正です。');
   const credLen=new DataView(cmeBody.buffer,cmeBody.byteOffset+49,2).getUint16(0,false);
   headerLen=51+credLen;
   if(credLen<1||credLen>512||cmeBody.length<headerLen+16+16)throw new Error('パスキー識別子の長さが不正です。');
   const credId=cmeBody.slice(51,headerLen);
   const prf=await derivePasskeyPrf(salt,credId);
   passkeyFactor=prf.extraFactor;
   if(prf.isLegacyPK2Migrated)isLegacyPK2Migrated=true;
  }
  let extraFactor=null;
  if(needKeyfile&&needPasskey){
   extraFactor=await sha512(concat(enc.encode('CM-KEYFILE-PASSKEY:'),await sha512(twoFaOpts.keyfileBytes),passkeyFactor));
  }else if(needKeyfile){
   extraFactor=await sha512(twoFaOpts.keyfileBytes);
  }else if(needPasskey){
   extraFactor=passkeyFactor;
  }
  const {aesKey,hmacKey}=await deriveKeysCME2(needPass?password:'',salt,kdfProfile,extraFactor,needPass);
  const subt=cryptoAPI();
  const header=cmeBody.slice(0,headerLen);
  const commitTag16=cmeBody.slice(headerLen,headerLen+16);
  const ciphertext16=cmeBody.slice(headerLen+16);
  const expectedCommit16=new Uint8Array(await subt.sign('HMAC',hmacKey,concat(header,ciphertext16))).slice(0,16);
  if(equal(expectedCommit16,commitTag16)){
   let innerPlain;
   try{
    const aad=concat(enc.encode('CME2:AEAD:v2:'),header);
    innerPlain=await subt.decrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},aesKey,ciphertext16);
   }catch(_){
    innerPlain=await subt.decrypt({name:'AES-GCM',iv,additionalData:header,tagLength:128},aesKey,ciphertext16);
   }
   return{innerBody:new Uint8Array(innerPlain),kdfProfile,combo,needPass,needKeyfile,needPasskey,version:2,isLegacyPK2Migrated};
  }
  const storedTag14=cmeBody.slice(49,63);
  const ciphertext14=cmeBody.slice(63);
  const expectedCommit14=new Uint8Array(await subt.sign('HMAC',hmacKey,concat(salt,iv,ciphertext14))).slice(0,14);
  if(equal(expectedCommit14,storedTag14)){
   const innerPlain=await subt.decrypt({name:'AES-GCM',iv,additionalData:cmeBody.slice(0,63),tagLength:128},aesKey,ciphertext14);
   return{innerBody:new Uint8Array(innerPlain),kdfProfile,combo,needPass,needKeyfile,needPasskey,version:2,isLegacyPK2Migrated};
  }
  throw new Error('復元用パスワードが違うか、保護キーが一致しません。');
 }
 function hexTag(b){return[...b].map(v=>v.toString(16).padStart(2,'0')).join('');}
 let activeSec2Format='armored';
 let sec2ArmoredText='';

 function armorBlocks(blocks,tag='BACKUP'){
  const bytes=concat(...blocks);
  let s='';const chunk=8192;
  for(let i=0;i<bytes.length;i+=chunk)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));
  const b64=btoa(s);
  const wrapped=b64.match(/.{1,64}/g)?.join('\n')||b64;
  return `-----BEGIN CRYPTOMATRIX ${tag}-----\n${wrapped}\n-----END CRYPTOMATRIX ${tag}-----`;
 }

 function dearmorBlocks(str){
  const regex=/-----BEGIN CRYPTOMATRIX[^-]*-----([\s\S]*?)-----END CRYPTOMATRIX[^-]*-----/g;
  let match;const blocks=[];
  while((match=regex.exec(str))!==null){
   const b64Str=match[1].replace(/[\r\n\s]/g,'');
   if(b64Str){
    try{
     const bin=atob(b64Str);
     const bytes=new Uint8Array(bin.length);
     for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
     for(let i=0;i<bytes.length;i+=32){
      if(i+32<=bytes.length)blocks.push(bytes.slice(i,i+32));
     }
    }catch(_){}
   }
  }
  return blocks;
 }
 function renderWords(groups,blocks=null){
  currentMnemonicWords=groups.flat();
  const box=$('seed-words-container'),qrBox=$('seed-qr-list');
  if(!box)return;

  if(groups.length===1){
   activeSec2Format='words';
   sec2ArmoredText='';
   box.innerHTML=`<div class="seed-words-grid">${groups[0].map((w,i)=>`<div class="seed-chip"><span class="seed-num">#${String(i+1).padStart(2,'0')}</span><span class="seed-txt">${escapeHtml(w)}</span></div>`).join('')}</div>`;
   $('btn-copy-seed').disabled=false;
   if($('btn-save-seed-txt'))$('btn-save-seed-txt').disabled=false;
   if($('btn-save-seed-qr'))$('btn-save-seed-qr').disabled=false;
   if($('btn-sec2-transfer-keeweb'))$('btn-sec2-transfer-keeweb').disabled=false;
   if($('btn-sec2-transfer-timelock'))$('btn-sec2-transfer-timelock').disabled=false;
   if(qrBox&&window.MatrixQRCode){
    const wordsText=groups[0].join(' ');
    const fig=document.createElement('figure'),cap=document.createElement('figcaption'),svg=qrSVG(wordsText);
    if(svg)fig.appendChild(svg);
    cap.textContent='BIP39 24単語シードフレーズ（設定のみ・暗号化なし）\n24単語（QR 1枚）';
    fig.appendChild(cap);
    qrBox.replaceChildren(fig);
   }
   return;
  }

  activeSec2Format='armored';
  sec2ArmoredText=blocks?armorBlocks(blocks,'BACKUP'):'';
  const allWordsText=groups.map(g=>g.join(' ')).join('\n');

  const chipsHtml=groups.map((group,g)=>
   `<div class="backup-block-title" style="width:100%; margin-top:8px;">ブロック ${g+1} / ${groups.length}（24単語）</div>`+
   `<div class="seed-words-grid" style="margin:6px 0 12px 0;">`+
   group.map((w,i)=>`<div class="seed-chip"><span class="seed-num">#${String(g*24+i+1).padStart(2,'0')}</span><span class="seed-txt">${escapeHtml(w)}</span></div>`).join('')+
   `</div>`
  ).join('');

  box.innerHTML=`
   <div class="bv-no-print" style="width:100%; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px; background:#f1f5f9; padding:8px 12px; border-radius:6px; border:1px solid #cbd5e1;">
     <div style="font-size:0.82rem; font-weight:700; color:#334155;">
       📜 出力形式（現在: <span id="seed-active-format-label">PGPアーマード形式</span>）
     </div>
     <button type="button" class="btn btn-outline" id="btn-toggle-seed-format" style="font-size:0.78rem; padding:4px 10px;">
       🔄 表示切替：BIP39 24単語ブロック形式 ⇄ PGPアーマード形式
     </button>
   </div>
   <div id="seed-armored-wrap" style="width:100%;">
     <textarea id="seed-armored-text" class="seed-textarea" readonly style="min-height:140px; font-family:monospace; font-size:0.8rem; width:100%;"></textarea>
   </div>
   <div id="seed-words-chips-wrap" hidden style="width:100%;">
     ${chipsHtml}
   </div>
  `;

  if($('seed-armored-text'))$('seed-armored-text').value=sec2ArmoredText;
  $('btn-copy-seed').disabled=false;
  if($('btn-save-seed-txt'))$('btn-save-seed-txt').disabled=false;
  if($('btn-save-seed-qr'))$('btn-save-seed-qr').disabled=false;
  if($('btn-sec2-transfer-keeweb'))$('btn-sec2-transfer-keeweb').disabled=false;
  if($('btn-sec2-transfer-timelock'))$('btn-sec2-transfer-timelock').disabled=false;

  function updateSec2QR(format){
   if(!qrBox||!window.MatrixQRCode)return;
   const qrText=(format==='armored'?sec2ArmoredText:allWordsText);
   const fig=document.createElement('figure'),cap=document.createElement('figcaption');
   try{
    if(qrText.length>2200)throw new Error('capacity');
    const svg=qrSVG(qrText);
    if(svg)fig.appendChild(svg);
   }catch(_){
    const notice=document.createElement('div');
    notice.className='bv-no-print';
    notice.style.cssText='font-size:0.78rem;color:#92400e;background:#fffbeb;border:1px solid #fef3c7;border-radius:6px;padding:8px;margin-bottom:6px;';
    notice.textContent='⚠️ データ量がQRコードの上限を超えたため、統合QRは表示しません。PGPアーマード形式またはファイル保存をご利用ください。';
    fig.appendChild(notice);
   }
   cap.textContent=(format==='armored'
    ?`PGPアーマード 拡張バックアップ（暗号化なし）\n全${groups.length}ブロック統合QR（1枚）`
    :`BIP39 拡張バックアップ（暗号化なし）\n全${groups.length}ブロック・${groups.length*24}単語を1枚のQRに統合`);
   fig.appendChild(cap);
   qrBox.replaceChildren(fig);
  }

  updateSec2QR('armored');

  $('btn-toggle-seed-format')?.addEventListener('click',()=>{
   activeSec2Format=(activeSec2Format==='armored'?'words':'armored');
   if($('seed-armored-wrap'))$('seed-armored-wrap').hidden=(activeSec2Format!=='armored');
   if($('seed-words-chips-wrap'))$('seed-words-chips-wrap').hidden=(activeSec2Format!=='words');
   if($('seed-active-format-label'))$('seed-active-format-label').textContent=(activeSec2Format==='armored'?'PGPアーマード形式':'BIP39 24単語ブロック形式');
   updateSec2QR(activeSec2Format);
  });
 }
 generateAndRenderSeedPhrase=async function(){
  const request=++backupRequest;currentMnemonicWords=[];$('btn-copy-seed').disabled=true;
  try{
   const s=snapshotBackup(),core=packRecipeTo256Bit(s.cfg,s.includeSeed,s.seed);
   const blocks=s.full?await fullBlocks(s,core):[core],groups=[];
   for(const b of blocks)groups.push(await entropyToBip39Words(b));
   if(request!==backupRequest)return;
   renderWords(groups,blocks);
   setStatus('backup-summary',s.full?`拡張バックアップ（暗号化なし）：全${groups.length}ブロック ＋ 統合QR 1枚（PGPアーマード形式）を自動作成しました。サイト名・合言葉・記号リスト・マイレシピ設定を保存。シードフレーズ${s.includeSeed?'も保存':'は未保存（同じカードを別途用意）'}。`:`設定のみ（暗号化なし）：24単語 ＋ QR 1枚を自動作成しました。サイト名・合言葉は含みません。シードフレーズ${s.includeSeed?'を保存':'は未保存'}。`);
  }catch(e){if(request!==backupRequest)return;currentMnemonicWords=[];$('seed-words-container').textContent='バックアップ未作成：'+e.message;if($('seed-qr-list'))$('seed-qr-list').replaceChildren();setStatus('backup-summary',e.message,true);}
 };

 function isFrame(b){return b[0]===0x43&&b[1]===0x58&&b[2]===0x42&&b[3]===2;}
 function parsePlainBody(innerBody,encrypted=false,kdfProfile=null,tagHex='',twoFaMode=0,shamir=null,combo=null){
  if(innerBody[0]===0x43&&innerBody[1]===0x4d&&innerBody[2]===0x58&&innerBody[3]===2){
   if(innerBody.length<74)throw new Error('拡張データの長さが不正です。');
   const cfgData=unpack256BitToRecipe(innerBody.slice(4,36)),v=new DataView(innerBody.buffer,innerBody.byteOffset,innerBody.byteLength);
   const a=v.getUint16(36,false),b=v.getUint16(38,false),c=v.getUint16(40,false);
   if(a>4096||b>4096||c>1024||42+a+b+c+32!==innerBody.length)throw new Error('保存文字列の長さが不正です。');
   const decoder=new TextDecoder('utf-8',{fatal:true});let pos=42;
   const site=decoder.decode(innerBody.slice(pos,pos+=a)),secret=decoder.decode(innerBody.slice(pos,pos+=b)),symList=decoder.decode(innerBody.slice(pos,pos+=c));
   cfgData.cfg.symList=symList;
   return{...cfgData,site,secret,expected:innerBody.slice(pos,pos+32),full:true,encrypted,kdfProfile,tagHex,twoFaMode,shamir,combo};
  }
  if(innerBody[0]===0x43&&innerBody[1]===0x4d&&innerBody[2]===0x53&&innerBody[3]===2){
   if(innerBody.length<38)throw new Error('設定データの長さが不正です。');
   const cfgData=unpack256BitToRecipe(innerBody.slice(4,36)),v=new DataView(innerBody.buffer,innerBody.byteOffset,innerBody.byteLength);
   const c=v.getUint16(36,false);
   if(c>1024||38+c!==innerBody.length)throw new Error('記号設定の長さが不正です。');
   const decoder=new TextDecoder('utf-8',{fatal:true});
   cfgData.cfg.symList=decoder.decode(innerBody.slice(38,38+c));
   return{...cfgData,full:false,encrypted,kdfProfile,tagHex,twoFaMode,shamir,combo};
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
   if(body[0]===0x43&&body[1]===0x4d&&body[2]===0x45&&(body[3]===2||body[3]===3)){
    const {innerBody,kdfProfile,combo,isLegacyPK2Migrated}=await decryptBodyCME2(body,password,twoFaOpts);
    const res=parsePlainBody(innerBody,true,kdfProfile,tagHex,combo,null,combo);
    if(isLegacyPK2Migrated)res.isLegacyPK2Migrated=true;
    return res;
   }
   return parsePlainBody(body,false,null,tagHex,0,null,null);
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
    throw new Error('異なる秘密分散バックアップのシェアが混在しています。同じバックアップから生成されたシェア同士を入力してください。');
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
  if(cmeBody[0]===0x43&&cmeBody[1]===0x4d&&cmeBody[2]===0x45&&(cmeBody[3]===2||cmeBody[3]===3)){
   const {innerBody,kdfProfile,combo,isLegacyPK2Migrated}=await decryptBodyCME2(cmeBody,password,twoFaOpts);
   const res=parsePlainBody(innerBody,true,kdfProfile,hexTag(refSetId.slice(0,4)),combo,{m:refM,n:refN,usedShares:selected.map(s=>s.index)},combo);
   if(isLegacyPK2Migrated)res.isLegacyPK2Migrated=true;
   return res;
  }
  return parsePlainBody(cmeBody,false,null,hexTag(refSetId.slice(0,4)),0,{m:refM,n:refN,usedShares:selected.map(s=>s.index)},null);
 }
 function saveUI(){return{cfg:getRecipeConfig(),site:$('sim-site').value,secret:$('sim-secret').value,seed:appliedSeed,seedInput:$('input-seed-number').value,inc:$('chk-include-card-seed').checked,kind:$('backup-kind').value,words:currentMnemonicWords.slice(),box:$('seed-words-container').innerHTML,summary:$('backup-summary').textContent,cqPinLen:$('cq-pin-length')?.value,cqSymLen:$('cq-symbol-length')?.value,cqSymMode:$('cq-symbol-mode')?.value,cqSymList:$('cq-symbol-list')?.value};}
 function restoreUI(s){currentDisplayMode='recipe';setRecipeConfig(s.cfg);$('sim-site').value=s.site;$('sim-secret').value=s.secret;if(s.cqPinLen!==undefined&&$('cq-pin-length'))$('cq-pin-length').value=s.cqPinLen;if(s.cqSymLen!==undefined&&$('cq-symbol-length'))$('cq-symbol-length').value=s.cqSymLen;if(s.cqSymMode!==undefined&&$('cq-symbol-mode'))$('cq-symbol-mode').value=s.cqSymMode;if(s.cqSymList!==undefined&&$('cq-symbol-list'))$('cq-symbol-list').value=s.cqSymList;updateMainMatrix(s.seed);$('input-seed-number').value=s.seedInput;$('chk-include-card-seed').checked=s.inc;$('backup-kind').value=s.kind;updateSimulationUI();currentMnemonicWords=s.words;$('seed-words-container').innerHTML=s.box;$('btn-copy-seed').disabled=!s.words.length;setStatus('backup-summary',s.summary);}
 restoreRecipeFromSeedInput=async function(){
  const request=++restoreRequest,statusEl=$('restore-status');$('btn-restore-seed').disabled=true;statusEl.className='status-msg';statusEl.textContent='全ブロックを検証しています…';
  let previous=null;
  try{
   const rawTrimmed=$('input-restore-seed').value.trim();
   if(rawTrimmed.startsWith('MCBK1:')||rawTrimmed.startsWith('MCQR1:'))throw new Error('旧MCBK1/MCQR1形式のデータは、下の「3. 拡張バックアップ（暗号化・秘密分散・二段階認証）＆ 印刷QRからの復元」の復元欄に入力してください。');
   let blocks=[];
   if(rawTrimmed.includes('-----BEGIN CRYPTOMATRIX')||rawTrimmed.includes('-----BEGIN ')){
    blocks=dearmorBlocks(rawTrimmed);
    if(!blocks.length)throw new Error('PGPアーマードテキストの解析に失敗しました。');
   }else{
    const words=rawTrimmed.toLowerCase().split(/\s+/).filter(Boolean);
    if(words.length<24||words.length%24!==0||words.length>512*24)throw new Error('24単語単位（またはPGPアーマードテキスト）で入力してください。');
    for(let i=0;i<words.length;i+=24)blocks.push(await bip39WordsToEntropy(words.slice(i,i+24).join(' ')));
   }
   let data;
   if(isFrame(blocks[0])){
    if(blocks.length===1)throw new Error('これは複数ブロックバックアップの一部です。他のブロックが欠落しています。');
    const {body}=await reassembleStreamGroup(blocks,false);
    if(isShamirBody(body)||(body[0]===0x43&&body[1]===0x4d&&body[2]===0x45&&(body[3]===2||body[3]===3))){
     throw new Error('このフレーズは暗号化または秘密分散されています。下の「3. 拡張バックアップ（暗号化・秘密分散・二段階認証）＆ 印刷QRからの復元」の復元欄に入力してください。');
    }
    data=await decodeFull(blocks,'',false,null);
    if(data.encrypted||data.shamir){
     throw new Error('このフレーズは暗号化または秘密分散されています。下の「3. 拡張バックアップ（暗号化・秘密分散・二段階認証）＆ 印刷QRからの復元」の復元欄に入力してください。');
    }
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
    if(!equal(actual,data.expected))throw new Error(data.includeCardSeed?'生成値の照合に失敗しました。対応バージョン・設定を確認してください。':'シードフレーズが未保存で、現在のカードでは生成値が一致しません。生成時と同じカードを適用して再度復元してください。');
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
  currentDisplayMode='recipe';
  const designBar = document.getElementById('gesture-design-bar');
  if (designBar) designBar.style.display = 'none';
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
  // This handler intentionally lives in the later, independent initializer.
  // The generated-password controls must continue to work even if an optional
  // UI setup step in the earlier initializer fails.
  const transferVisiblePasswordToKeeWeb = (event) => {
   event.preventDefault();
   event.stopImmediatePropagation();
   const pw = ($('sim-output-pw')?.textContent || '').trim();
   if (!pw) { alert('転送するパスワードがありません。先にパスワードを生成してください。'); return; }
   const site = ($('sim-site')?.value || '').trim();
   const seed = ($('input-seed-number')?.value || '0').trim();
   const baseAppUrl = window.location.href.split(/[?#]/)[0];
   const isMaster = site.toLowerCase().includes('master');
   try {
    localStorage.setItem('cm_active_seed', seed);
    let transferId = '';
    if (isMaster) {
     transferId = window.setPendingKeeWebTransfer('cm_pending_master_pass', pw);
    } else {
     transferId = window.setPendingKeeWebTransfer('cm_pending_entry', {
      site: site || 'CryptoMatrix 生成パスワード',
      password: pw,
      passphrase: ($('sim-secret')?.value || '').trim(),
      username: 'CryptoMatrix',
      url: `${baseAppUrl}#seed=${encodeURIComponent(seed)}${site ? '&site=' + encodeURIComponent(site) : ''}`,
      notes: 'CryptoMatrixで生成したパスワードです。',
      timestamp: Date.now()
     });
    }
    const btns = [$('btn-transfer-to-keeweb'), $('btn-sticky-transfer')].filter(Boolean);
    btns.forEach((btn) => {
      btn.textContent = isMaster ? '✅ マスターPWをKeeWebへ転送' : '✅ KeeWebを開いて追加';
      btn.style.background='#dcfce7'; btn.style.borderColor='#86efac'; btn.style.color='#15803d';
    });
    setTimeout(() => updateTransferButtonsUI(), 2500);
    if (!window.openKeeWeb(transferId)) throw new Error('KeeWebを開けませんでした。ポップアップの許可を確認してください。');
   } catch (error) {
    alert(`KeePassへの転送を開始できませんでした。${error?.message || 'もう一度お試しください。'}`);
   }
  };
  ['btn-transfer-to-keeweb', 'btn-sticky-transfer'].forEach((id) => {
   $(id)?.addEventListener('click', transferVisiblePasswordToKeeWeb, true);
  });
  const initialDesignBar = document.getElementById('gesture-design-bar');
  if (initialDesignBar) initialDesignBar.style.display = 'none';
  const btnRest=$('btn-restore-seed');
  if(btnRest){
   btnRest.addEventListener('click',(e)=>{e.stopImmediatePropagation();void restoreRecipeFromSeedInput();},true);
  }
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
   currentDisplayMode='recipe';
   const designBar = document.getElementById('gesture-design-bar');
   if (designBar) designBar.style.display = 'none';
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
    currentDisplayMode='recipe';
    const designBar = document.getElementById('gesture-design-bar');
    if (designBar) designBar.style.display = 'none';
    if($('section-recipe-detail'))$('section-recipe-detail').classList.remove('is-collapsed');
    if($('card-quick'))$('card-quick').classList.add('is-collapsed');
    syncCollapseButtons();
   });
  }
  document.querySelectorAll('#section-recipe-detail .rc-input').forEach(el=>{
   const onManualRecipeEdit=()=>{
    currentDisplayMode='recipe';
    const designBar = document.getElementById('gesture-design-bar');
    if (designBar) designBar.style.display = 'none';
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
  $('btn-sticky-stroke')?.addEventListener('click',()=>playStrokeGestureTrace());
  $('btn-sticky-pause')?.addEventListener('click',()=>togglePauseMatrixTrace());
  $('btn-sticky-stop')?.addEventListener('click',()=>{
    stopMatrixTrace();
    const banner = document.getElementById('sim-step-banner');
    if (banner) banner.textContent = '⏹ 再生を停止しました。';
  });
  $('btn-sticky-copy')?.addEventListener('click',()=>$('btn-copy-pw')?.click());
  $('btn-sticky-top')?.addEventListener('click',()=>{
   const stageEl=$('matrix-stage-box')||$('div-encrypto-matrix-main');
   if(stageEl)window.scrollTo({top:Math.max(0,window.scrollY+stageEl.getBoundingClientRect().top-8),behavior:'smooth'});
  });
  const liveRow=$('live-result-row'),stickyBar=$('sticky-pw-bar'),pageFooter=$('page-footer');
  const btnStickyToggle=$('btn-sticky-toggle'),btnStickyMinPill=$('btn-sticky-min-pill');
  if(btnStickyToggle&&btnStickyMinPill&&stickyBar){
   btnStickyToggle.addEventListener('click',()=>{
    stickyBar.classList.add('is-minimized');
    btnStickyMinPill.style.display='inline-flex';
   });
   btnStickyMinPill.addEventListener('click',()=>{
    stickyBar.classList.remove('is-minimized');
    btnStickyMinPill.style.display='none';
   });
  }
  if(liveRow&&stickyBar){
   const updateStickyVisibility=()=>{
    const r=liveRow.getBoundingClientRect();
    const outOfView=r.bottom<0||r.top>window.innerHeight;
    stickyBar.classList.toggle('visible',outOfView);
    if(btnStickyMinPill){
     if(outOfView&&stickyBar.classList.contains('is-minimized')){
      btnStickyMinPill.style.display='inline-flex';
     }else if(!outOfView){
      btnStickyMinPill.style.display='none';
     }
    }
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
    const text=(activeSec2Format==='armored'&&sec2ArmoredText)?sec2ArmoredText:Array.from({length:words.length/24},(_,i)=>words.slice(i*24,i*24+24).join(' ')).join('\n');
    await copyWithAutoClear(text,()=>setStatus('backup-summary','🛡️ クリップボードの復元データを自動消去しました。'));
    setStatus('backup-summary',activeSec2Format==='armored'?'PGPアーマード形式の拡張バックアップをコピーしました（30秒後にクリップボードから自動消去されます）。':`${words.length/24}ブロック・${words.length}単語をコピーしました（30秒後にクリップボードから自動消去されます）。`);
   }catch(_){setStatus('backup-summary','コピーできませんでした。画面の全ブロックを順番どおり控えてください。',true);}
  },true);
  $('btn-save-seed-txt')?.addEventListener('click',()=>{
   if(!currentMnemonicWords.length)return;
   const words=currentMnemonicWords.slice();
   const isArmored=(activeSec2Format==='armored'&&sec2ArmoredText);
   const text=isArmored?sec2ArmoredText:Array.from({length:words.length/24},(_,i)=>words.slice(i*24,i*24+24).join(' ')).join('\n');
   const filename=isArmored?'cryptomatrix-backup-pgp.txt':'cryptomatrix-backup-seed.txt';
   downloadBlob(new Blob([text],{type:'text/plain;charset=utf-8'}),filename);
   setStatus('backup-summary',`💾 復元テキスト（${filename}）を保存しました。`);
  });
  $('btn-save-seed-qr')?.addEventListener('click',()=>{
   const qrSvg=$('seed-qr-list')?.querySelector('svg');
   if(!qrSvg){
    setStatus('backup-summary','保存可能なQRコードがありません。',true);
    return;
   }
   const isArmored=(activeSec2Format==='armored');
   const filename=isArmored?'cryptomatrix-backup-pgp-qr.png':'cryptomatrix-backup-seed-qr.png';
   saveSvgAsPng(qrSvg,filename);
   setStatus('backup-summary',`🖼️ QRコード画像（${filename}）を保存しました。`);
  });
  $('btn-sec2-transfer-keeweb')?.addEventListener('click',async()=>{
   if(!currentMnemonicWords.length){
    alert('転送する復元データがありません。先にシード番号を入力してフレーズを生成してください。');
    return;
   }
   const words=currentMnemonicWords.slice();
   const isArmored=(activeSec2Format==='armored'&&sec2ArmoredText);
   const text=isArmored?sec2ArmoredText:Array.from({length:words.length/24},(_,i)=>words.slice(i*24,i*24+24).join(' ')).join('\n');
   const seedNum=$('input-seed-number')?.value||'0';
   const siteVal=($('sim-site')?.value||'').trim();
   const pw=($('sim-output-pw')?.textContent||'').trim();

   const attachments=[];
   const qrSvg=$('seed-qr-list')?.querySelector('svg');
   if(qrSvg){
    try{
     const qrBase64=await svgToPngBase64(qrSvg,640);
     if(qrBase64){
      attachments.push({
       filename:isArmored?'cryptomatrix-backup-pgp-qr.png':'cryptomatrix-backup-seed-qr.png',
       base64:qrBase64,
       mime:'image/png'
      });
     }
    }catch(_){}
   }

   try{
    const keyData=await generateKeePassXmlKeyfile({seedNum:parseSeedValue(seedNum),password:pw});
    if(keyData&&keyData.xml){
     attachments.push({
      filename:`matrix-card-${seedNum}.key`,
      text:keyData.xml,
      mime:'application/x-kdbx-keyfile'
     });
    }
   }catch(_){}

   const title=siteVal?`${siteVal} (CryptoMatrix設定)`:'CryptoMatrix 復元設定・キー';
   const notes=[
    '【CryptoMatrix 復元・バックアップ情報】',
    `■ カード配列シード番号 (seed): ${seedNum}`,
    `■ 復元形式: ${isArmored?'PGPアーマード形式':'BIP39 24単語ブロック形式'}`,
    ...(siteVal?[`■ 対象サイト/サービス: ${siteVal}`]:[]),
    '',
    '【復元データ】',
    text,
    '',
    '【添付ファイルのご案内（両方添付・安心保管）】',
    '1. QRコード画像 (.png): 読み取るだけで一発復元できます。',
    `2. KeePassキーファイル (.key): matrix-card-${seedNum}.key （データベースの鍵ファイルとしても活用可能）`,
    '',
    '【復元方法】',
    'CryptoMatrixの「復元」欄に上記テキストを貼り付けるか、添付のQRコード画像を読み取らせるだけで、カード配列・合言葉・レシピ設定を100%復元できます。'
   ].join('\n');

   const baseAppUrl = window.location.href.split(/[?#]/)[0];
   localStorage.setItem('cm_active_seed',seedNum);
   // Security Hardening (A04): Never persist cm_last_generated_pw in plaintext in transfer path
   setPendingKeeWebTransfer('cm_pending_entry', {
    site:title,
    password:pw,
    passphrase:($('sim-secret')?.value||'').trim(),
    username:`CryptoMatrix-Seed#${seedNum}`,
    url:`${baseAppUrl}#seed=${seedNum}${siteVal?'&site='+encodeURIComponent(siteVal):''}`,
    notes:notes,
    attachments:attachments,
    timestamp:Date.now()
   });

   const btn=$('btn-sec2-transfer-keeweb');
   if(btn){
    const origText=btn.innerHTML;
    btn.innerHTML='✅ KeeWebへ転送完了！KeeWebを開く…';
    btn.style.background='#dcfce7';
    btn.style.borderColor='#86efac';
    btn.style.color='#15803d';
    setTimeout(()=>{
     btn.innerHTML=origText;
     btn.style.background='#f0f9ff';
     btn.style.borderColor='#0284c7';
     btn.style.color='#0369a1';
    },2500);
   }
   if (!openKeeWeb()) alert('KeeWebを開けませんでした。ポップアップの許可を確認してください。');
  });

  $('btn-sec2-transfer-timelock')?.addEventListener('click', () => {
    if (!currentMnemonicWords.length) {
      alert('転送する復元データがありません。先にシード番号を入力してフレーズを生成してください。');
      return;
    }
    if (!window.TimeLockApp?.receiveTransferredPayload) {
      alert('タイムロック機能が利用できません。');
      return;
    }
    const words = currentMnemonicWords.slice();
    const isArmored = (activeSec2Format === 'armored' && sec2ArmoredText);
    const text = isArmored ? sec2ArmoredText : Array.from({length: words.length / 24}, (_, i) => words.slice(i * 24, i * 24 + 24).join(' ')).join('\n');
    const seedNum = $('input-seed-number')?.value || '0';

    window.TimeLockApp.receiveTransferredPayload({
      source: 'sec2',
      label: 'セクション2 BIP39復元フレーズ（カード・レシピ設定）',
      bytes: new TextEncoder().encode(text),
      armoredText: text,
      factorLabel: '平文（未暗号化）',
      shamirM: 1,
      shamirN: 1,
      createdPassword: '',
      filename: isArmored ? `cryptomatrix-backup-seed-${seedNum}.asc` : `cryptomatrix-backup-seed-${seedNum}.txt`
    });
    setStatus('backup-summary', '⏳ BIP39復元フレーズを「⏳ タイムロック」タブへ転記しました。タイムロック側で時間暗号化を設定してください。');
  });
  initKeyfileModalEvents();

  $('btn-zeroize')?.addEventListener('click',async()=>{
   stopMatrixTrace();
   if(clipTimer){clearTimeout(clipTimer);clipTimer=null;}
   try{await navigator.clipboard.writeText('');}catch(_){}
   if($('input-seed-number'))$('input-seed-number').value='0';
   updateMainMatrix(0);
   setRecipeConfig({});
   Object.keys(localStorage).filter(k=>k.startsWith('cm_')).forEach(k=>{try{localStorage.removeItem(k);}catch(_){}});
   if($('cq-pin-length'))$('cq-pin-length').value='4';
   if($('cq-symbol-length'))$('cq-symbol-length').value='20';
   if($('cq-symbol-mode'))$('cq-symbol-mode').value='2';
   if($('cq-symbol-list'))$('cq-symbol-list').value='-_!#';
   if($('chk-include-card-seed'))$('chk-include-card-seed').checked=true;
   if($('backup-kind'))$('backup-kind').value='settings';
   if($('bq-opt-password'))$('bq-opt-password').checked=true;
   if($('bq-opt-keyfile'))$('bq-opt-keyfile').checked=false;
   if($('bq-opt-passkey'))$('bq-opt-passkey').checked=false;
   if($('bq-shamir'))$('bq-shamir').value='1-1';
   function scrubDOM(el){
    if(!el)return;
    const len=el.value?el.value.length:0;
    if(len>0){try{el.value='0'.repeat(len);el.value='\u0000'.repeat(len);}catch(_){}}
    el.value='';
   }
   for(const id of['sim-site','sim-secret','input-restore-seed','input-restore-password','input-restore-keyfile','bq-password','bq-password-confirm','bq-import','bq-restore-password','bq-keyfile','bq-restore-keyfile','bv-text-content','bv-password','bv-password-confirm','bv-restore-password','bv-restore-text','bv-keyfile','bv-restore-keyfile','tl-text-content','tl-password','tl-password-confirm','tl-restore-password','tl-restore-text','tl-keyfile','tl-restore-keyfile','tl-duress-pw','tl-duress-pw-conf','tl-duress-text','tl-manual-beacon-input','duress-modal-pw','duress-modal-pw-conf','duress-modal-seed','duress-modal-site','duress-modal-secret','duress-vault-pw','duress-vault-pw-conf','duress-vault-text','km-password','km-password-confirm','keyfile-modal-seed']){
    scrubDOM($(id));
   }
   if($('bv-decrypted-content'))$('bv-decrypted-content').textContent='';
   if($('bv-decrypt-result'))$('bv-decrypt-result').style.display='none';
   if($('bv-encrypt-result'))$('bv-encrypt-result').style.display='none';
   $('tl-clear-output')?.click();
   $('tl-restore-clear')?.click();
   if($('duress-modal')){delete $('duress-modal').dataset.realPassword;$('duress-modal').hidden=true;}
   if($('keyfile-modal'))$('keyfile-modal').hidden=true;
   if(Array.isArray(currentMnemonicWords)){currentMnemonicWords.fill('');currentMnemonicWords.length=0;}
   sec2ArmoredText='';
   if($('seed-words-container'))$('seed-words-container').textContent='';
   if($('seed-armored-text'))scrubDOM($('seed-armored-text'));
   if(Array.isArray(currentMatrixData)){for(let i=0;i<currentMatrixData.length;i++)currentMatrixData[i]='';}
   try{window.gc?.();}catch(_){}
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
  argon2Profiles:ARGON2_PROFILES,
  copyWithAutoClear:(text,onCleared)=>copyWithAutoClear(text,onCleared),
  estimatePasswordEntropy:pw=>estimatePasswordEntropy(pw),
  syncBlindInputs:()=>syncBlindInputs(),
  setBlindMode:active=>setBlindMode(active),
  isBlindMode:()=>blindMode,
  createEncryptedBip39Backup:async(extended,password,kdfProfile=1,options={})=>{
   if(parseSeedValue($('input-seed-number').value)!==appliedSeed){updateMainMatrix($('input-seed-number').value);updateSimulationUI();}
   const s=snapshotBackup(extended,true),core=packRecipeTo256Bit(s.cfg,true,s.seed);
   const plainBody=await buildPlainBody(s,core);
   const shamirM=Number(options?.shamirM||1),shamirN=Number(options?.shamirN||1);
   const usePass=options?.usePassword!==undefined?!!options.usePassword:!!password;
   const useKeyfile=!!options?.useKeyfile;
   const usePasskey=!!options?.usePasskey;
   if(!usePass&&!useKeyfile&&!usePasskey&&shamirN<=1){
    throw new Error('保護方法（パスワード、キーファイル、パスキー、または2分割以上の秘密分散）を少なくとも1つ選択してください。');
   }
   let bodyToFrame,combo=0,factors=null;
   if(usePass||useKeyfile||usePasskey){
    factors={usePassword:usePass,useKeyfile,usePasskey,keyfileBytes:options?.keyfileBytes};
    if(options?.duress?.enabled){
      const dSeed=parseSeedValue(options.duress.seed||'11223344');
      const dSite=options.duress.site||'shopping.example.com';
      const dSecret=options.duress.secret||'shopping-safe-pass';
      let dVal='';
      try{
       originalMatrix(dSeed);
       dVal=evaluateRecipeSteps(dSite,dSecret,s.cfg).map(x=>x.ch).join('');
      }finally{
       originalMatrix(s.seed);
      }
      const dSnap={full:extended,includeSeed:true,seed:dSeed,site:dSite,secret:dSecret,cfg:s.cfg,value:dVal};
      const dCore=packRecipeTo256Bit(s.cfg,true,dSeed);
      const decoyPlainBody=await buildPlainBody(dSnap,dCore);
      bodyToFrame=await encryptDuressDualCME(plainBody,password,decoyPlainBody,options.duress.password,kdfProfile,factors);
     }else{
     bodyToFrame=await encryptBodyCME2(plainBody,password,kdfProfile,factors);
    }
    if(usePass&&!useKeyfile&&!usePasskey)combo=0;
    else if(usePass&&useKeyfile&&!usePasskey)combo=1;
    else if(usePass&&!useKeyfile&&usePasskey)combo=2;
    else if(usePass&&useKeyfile&&usePasskey)combo=3;
    else if(!usePass&&useKeyfile&&!usePasskey)combo=4;
    else if(!usePass&&!useKeyfile&&usePasskey)combo=5;
    else if(!usePass&&useKeyfile&&usePasskey)combo=6;
   }else{
    bodyToFrame=plainBody;
    combo=null;
   }
   if(shamirN>1){
    const setId=(await sha(bodyToFrame)).slice(0,8);
    const rawShares=shamirSplit(bodyToFrame,shamirM,shamirN);
    const shares=[],allGroups=[];
    for(let k=1;k<=shamirN;k++){
     const shareBody=concat(new Uint8Array([0x43,0x4d,0x53,3,shamirM,shamirN,k,0]),setId,rawShares[k-1]);
     const sBlocks=await frameBodyToBlocks(shareBody),sGroups=[];
     for(const b of sBlocks)sGroups.push(await entropyToBip39Words(b));
     shares.push({index:k,m:shamirM,n:shamirN,groups:sGroups,blocks:sBlocks});
     allGroups.push(...sGroups);
    }
    return{groups:allGroups,shares,blocks:shares.flatMap(x=>x.blocks),tagHex:hexTag(setId.slice(0,4)),kdfProfile:combo!==null?Number(kdfProfile):null,extended:!!extended,shamirM,shamirN,combo,usePassword:usePass,useKeyfile,usePasskey,passkeyContext:factors?.createdPrf||factors?.passkeyContext||null};
   }
   const blocks=await frameBodyToBlocks(bodyToFrame),groups=[];
   for(const b of blocks)groups.push(await entropyToBip39Words(b));
   const tagHex=hexTag(blocks[0].slice(8,12));
   return{groups,shares:null,blocks,tagHex,kdfProfile:combo!==null?Number(kdfProfile):null,extended:!!extended,shamirM:1,shamirN:1,combo,usePassword:usePass,useKeyfile,usePasskey,passkeyContext:factors?.createdPrf||factors?.passkeyContext||null};
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
  },
  zeroize:b=>zeroize(b),
  ChaCha20Poly1305,
  encryptBodyCME2:(plainBody,password,kdfProfile=1,factors={})=>encryptBodyCME3(plainBody,password,kdfProfile,factors),
  encryptBodyCME3:(plainBody,password,kdfProfile=1,factors={})=>encryptBodyCME3(plainBody,password,kdfProfile,factors),
  encryptDuressDualCME:(realBody,realPassword,decoyBody,decoyPassword,kdfProfile=1,factors={})=>encryptDuressDualCME(realBody,realPassword,decoyBody,decoyPassword,kdfProfile,factors),
  decryptBodyCME2:(cmeBody,password,twoFaOpts=null)=>decryptBodyCME2(cmeBody,password,twoFaOpts),
  decryptBodyCME:(cmeBody,password,twoFaOpts=null)=>decryptBodyCME(cmeBody,password,twoFaOpts),
  shamirSplit:(secretBytes,m,n)=>shamirSplit(secretBytes,m,n),
  shamirCombine:shareItems=>shamirCombine(shareItems),
  sha:b=>sha(b),
  sha512:b=>sha512(b),
  concat:(...arrs)=>concat(...arrs),
  frameBodyToBlocks:body=>frameBodyToBlocks(body),
  entropyToBip39Words:b=>entropyToBip39Words(b),
  bip39WordsToEntropy:w=>bip39WordsToEntropy(w),
  downloadBlob:(blob,filename)=>downloadBlob(blob,filename),
  saveSvgAsPng:(svgEl,filename)=>saveSvgAsPng(svgEl,filename),
  svgToPngBase64:svgEl=>svgToPngBase64(svgEl),
  exportKeePassXmlWithAttachments:opts=>exportKeePassXmlWithAttachments(opts),
  getValidSeedOrPrompt:statusElId=>getValidSeedOrPrompt(statusElId),
  generateKeePassXmlKeyfile:opts=>generateKeePassXmlKeyfile(opts),
  exportKeePassXmlKeyfile:opts=>exportKeePassXmlKeyfile(opts),
  showKeyfileModal:(opts,cb)=>showKeyfileModal(opts,cb),
  closeKeyfileModal:()=>closeKeyfileModal(),
  derivePasskeyPrf:(salt32,credId,opts)=>derivePasskeyPrf(salt32,credId,opts),
  getSavedPasskeyCredential:()=>getSavedPasskeyCredential(),
  savePasskeyCredential:(rawCredId,meta)=>savePasskeyCredential(rawCredId,meta),
  clearSavedPasskeyCredential:()=>clearSavedPasskeyCredential(),
  registerNewPasskey:async(opts={})=>{
   const dummySalt=crypto.getRandomValues(new Uint8Array(32));
   const res=await derivePasskeyPrf(dummySalt,null,{forceNew:true});
   return res;
  },
  setPendingKeeWebTransfer:(key,data,ttlMs=60000)=>setPendingKeeWebTransfer(key,data,ttlMs),
  openKeeWeb:()=>window.openKeeWeb(),
  promptLegacyPK2Consent:()=>window.promptLegacyPK2Consent()
 });
})();
/* END CARD READING v2 + EXTENDED BIP39 BACKUP v2 */
