/* Matrix Card Backup & QR Restore (Unified BIP39 24-word x N-block + CME2 Encryption + Shamir M-of-N Secret Sharing + Serverless 2FA)
 * - Section 2 auto-displays unencrypted 24-word (settings-only) or 24-word x N-block (CMX2/CXB2 extended) phrases & QR codes.
 * - Section 3 creates password-encrypted 24-word x N-block (CME2/CXB2) phrases & QR codes, with optional GF(2^8) Shamir's Secret Sharing (M-of-N) and Serverless 2FA (Keyfile / WebAuthn Passkey PRF).
 * - Every QR code encodes a 24-word BIP39 block directly. Legacy MCBK1/MCQR1 strings remain supported on restore.
 */
(() => {
'use strict';
const $=id=>document.getElementById(id), enc=new TextEncoder(), ITER_LEGACY=310000, MAX=40000, CHUNK=420, MAXPARTS=48;
const AAD_LEGACY='MCBK1:E:PBKDF2-SHA256:310000:AES-256-GCM';
let artifact=null,createToken=0,reviewToken=0,pending=null,parts=null;
let cameraEpoch=0,stream=null,timer=null,decoderPromise=null;
let generatedKeyfileBytes=null,generatedKeyfileName='';

function message(id,text,error=false){const el=$(id);if(el){el.textContent=text;el.dataset.error=String(error);}}
function api(){if(!globalThis.crypto?.subtle)throw Error('暗号化・検証にはWeb Crypto対応ブラウザと安全な接続（HTTPSまたはlocalhost）が必要です。');return crypto.subtle;}
function b64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function unb64(text){if(typeof text!=='string'||text.length>MAX||!/^[A-Za-z0-9_-]+$/.test(text))throw Error('バックアップ文字列が不正です。');try{return Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}catch(_){throw Error('バックアップの符号化を確認してください。');}}
async function hashHex(bytes){return [...new Uint8Array(await api().digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function shaBytes(bytes){return new Uint8Array(await api().digest('SHA-256',bytes));}
function equalBytes(a,b){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
function hexTag(b){return [...b].map(v=>v.toString(16).padStart(2,'0')).join('');}

function settingsSignature(){
 return JSON.stringify([
  MatrixCardPreset.getAppliedSeed(),
  getRecipeConfig(),
  $('sim-site').value,
  $('sim-secret').value,
  $('bq-scope')?.value,
  $('bq-kdf')?.value,
  $('bq-shamir')?.value,
  $('bq-2fa-mode')?.value
 ]);
}

function clearArtifact(note=''){
 createToken++;artifact=null;
 if($('backup-qr'))$('backup-qr').dataset.ready='false';
 if($('bq-output'))$('bq-output').value='';
 if($('bq-words-container'))$('bq-words-container').replaceChildren();
 if($('bq-qr-list'))$('bq-qr-list').replaceChildren();
 if($('bq-print-summary'))$('bq-print-summary').textContent='';
 if($('bq-copy'))$('bq-copy').disabled=true;
 if($('bq-print'))$('bq-print').disabled=true;
 if(note)message('bq-status',note);
}

function clearPending(){
 reviewToken++;pending=null;
 if($('bq-preview')){$('bq-preview').hidden=true;$('bq-preview').textContent='';}
 if($('bq-apply'))$('bq-apply').disabled=true;
}

function profileFor(cfg){return cfg.lenMode===5?'C2':cfg.lenMode===3?'C1_PIN':cfg.lenMode===4?'C1_ALNUM':'L2';}
function profileLabel(p){return p==='C2'?'かんたん生成モード — パスワード（英大小・数字・記号）':p==='C1_PIN'?'かんたん生成モード — 銀行などの暗証番号（数字のみ）':p==='C1_ALNUM'||p==='C1'?'かんたん生成モード（旧互換） — パスワード（英大小・数字）':'1. マイ・レシピ全組み合わせ設定';}
function twoFaLabel(mode){
 if(mode===1||mode==='keyfile')return 'キーファイル2要素ロック（復元用パスワード ＋ キーファイル）';
 if(mode===2||mode==='passkey')return 'パスキー2要素ロック（復元用パスワード ＋ パスキー認証）';
 return 'なし（復元用パスワードのみ）';
}

function validateConfig(cfg){
 const ranges={kwOrder:[0,9],kwFilter:[0,6],kwNum:[1,63],shiftDir:[0,13],shiftN:[0,63],shiftM:[0,63],baseCorner:[0,9],pickPattern:[0,17],symMode:[0,3],symFbDir:[0,10],symFbDist:[1,39],symFbCorner:[0,4],preTarget:[0,7],prePattern:[0,13],preOffset:[0,63],sufTarget:[0,7],sufPattern:[0,13],sufOffset:[0,63],ancTile:[0,39],ancMode:[0,6],ancPos:[0,63],postMode:[0,4],lenMode:[0,5],lenVal:[1,128]};
 for(const [key,[a,b]]of Object.entries(ranges))if(!Number.isInteger(cfg[key])||cfg[key]<a||cfg[key]>b)throw Error('設定値が不正です：'+key);
 if(cfg.lenMode===4&&cfg.lenVal<4)throw Error('英数字カードモードの長さが不正です。');
 if(cfg.lenMode===5&&cfg.lenVal<5)throw Error('記号ありカードモードの長さが不正です。');
 if(cfg.lenMode===5&&![0,1,2].includes(cfg.symMode))throw Error('記号ありカードモードの記号ルールが不正です。');
 if(cfg.lenMode===5&&cfg.symMode===2&&!cfg.symList)throw Error('ホワイトリストが空です。');
 if(typeof cfg.symList!=='string'||enc.encode(cfg.symList).length>1024||[...cfg.symList].some(c=>!ALL_ASCII_SYMBOLS.includes(c)))throw Error('記号設定が不正です。');
}

function qrSVG(text){
 if(MatrixCardPreset.qrSVG){const s=MatrixCardPreset.qrSVG(text);if(s)return s;}
 if(!window.MatrixQRCode)throw Error('QRコード生成プログラムの読み込みに失敗しました。ページを再読み込みしてください。');
 const matrix=MatrixQRCode.matrix(text),n=matrix.length+8,ns='http://www.w3.org/2000/svg';
 const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${n} ${n}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','復元用QR');svg.setAttribute('shape-rendering','crispEdges');
 const bg=document.createElementNS(ns,'rect');bg.setAttribute('width',String(n));bg.setAttribute('height',String(n));bg.setAttribute('fill','#fff');bg.setAttribute('class','qr-white');svg.appendChild(bg);
 let d='';for(let r=0;r<matrix.length;r++)for(let c=0;c<matrix.length;c++)if(matrix[r][c])d+=`M${c+4},${r+4}h1v1h-1z`;
 const path=document.createElementNS(ns,'path');path.setAttribute('d',d);path.setAttribute('fill','#000');path.setAttribute('class','qr-black');svg.appendChild(path);return svg;
}

function renderEncryptedWords(groups,shares=null){
 const box=$('bq-words-container');
 if(!box)return;
 if(shares&&shares.length>1){
  box.innerHTML=shares.map(s=>
   `<div class="backup-block-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;background:#eef8f2;padding:6px 10px;border-radius:6px;border:1px solid #b9cec0;">`+
   `<span>🔐 秘密分散シェア ${s.index} / ${s.n}（任意の ${s.m} シェアで復元可能 ・ 全${s.groups.length}ブロック／${s.groups.length*24}単語）</span>`+
   `<button type="button" class="btn btn-secondary btn-copy-share" data-share-index="${s.index}" style="padding:3px 10px;font-size:0.76rem;">シェア ${s.index}/${s.n} をコピー</button>`+
   `</div>`+
   s.groups.map((group,g)=>
    `<div class="backup-block-title" style="margin-top:4px;font-size:0.8rem;color:var(--text-sub);">シェア ${s.index}/${s.n} — ブロック ${g+1} / ${s.groups.length}（24単語）</div>`+
    group.map((w,i)=>`<div class="seed-chip"><span class="seed-num">#${String(g*24+i+1).padStart(2,'0')}</span><span class="seed-txt">${escapeHtml(w)}</span></div>`).join('')
   ).join('')
  ).join('');
  box.querySelectorAll('.btn-copy-share').forEach(btn=>{
   btn.addEventListener('click',async()=>{
    const idx=Number(btn.dataset.shareIndex);
    const target=shares.find(x=>x.index===idx);
    if(!target)return;
    const shareText=target.groups.map(g=>g.join(' ')).join('\n');
    try{
     if(MatrixCardPreset.copyWithAutoClear){
      await MatrixCardPreset.copyWithAutoClear(shareText,()=>message('bq-status',`🛡️ クリップボードのシェア ${idx}/${target.n} を自動消去しました。`));
     }else{
      await navigator.clipboard.writeText(shareText);
     }
     message('bq-status',`秘密分散シェア ${idx} / ${target.n}（${target.groups.length}ブロック・${target.groups.length*24}単語）をコピーしました（30秒後に自動消去）。別の保管場所へ保存してください。`);
    }catch(e){message('bq-status',e.message,true);}
   });
  });
  return;
 }
 box.innerHTML=groups.map((group,g)=>
  `<div class="backup-block-title">暗号化ブロック ${g+1} / ${groups.length}（24単語）</div>`+
  group.map((w,i)=>`<div class="seed-chip"><span class="seed-num">#${String(g*24+i+1).padStart(2,'0')}</span><span class="seed-txt">${escapeHtml(w)}</span></div>`).join('')
 ).join('');
}

async function getCreationKeyfileBytes(){
 const file=$('bq-keyfile')?.files?.[0];
 if(file)return new Uint8Array(await file.arrayBuffer());
 if(generatedKeyfileBytes)return generatedKeyfileBytes;
 return null;
}

async function getRestoreKeyfileBytes(){
 const file=$('bq-restore-keyfile')?.files?.[0]||$('input-restore-keyfile')?.files?.[0];
 if(file)return new Uint8Array(await file.arrayBuffer());
 if(generatedKeyfileBytes)return generatedKeyfileBytes;
 return null;
}

async function createBackup(){
 clearArtifact();const token=createToken;
 const kdfProfile=Number($('bq-kdf')?.value??1);
 const shamirVal=($('bq-shamir')?.value||'1-1').split('-').map(Number);
 const shamirM=shamirVal[0]||1,shamirN=shamirVal[1]||1;
 const twoFaMode=$('bq-2fa-mode')?.value||'none';
 message('bq-status',`暗号化バックアップ（BIP39 24単語×必要ブロック数）を作成しています…（${MatrixCardPreset.kdfLabel?MatrixCardPreset.kdfLabel(kdfProfile):'PBKDF2-HMAC-SHA512'}）`);
 try{
  api();
  const extended=$('bq-scope').value==='extended';
  const password=$('bq-password').value;
  if(Array.from(password).length<12||password!==$('bq-password-confirm').value){
   throw Error('復元用パスワードを12文字以上で入力し、再入力欄と一致させてください。');
  }
  let keyfileBytes=null;
  if(twoFaMode==='keyfile'){
   keyfileBytes=await getCreationKeyfileBytes();
   if(!keyfileBytes||!keyfileBytes.length)throw Error('二段階ロック用のキーファイルを選択するか、「専用キーファイル(.key)を新規作成・保存」を押してください。');
  }
  const signature=settingsSignature();
  const res=await MatrixCardPreset.createEncryptedBip39Backup(extended,password,kdfProfile,{shamirM,shamirN,twoFaMode,keyfileBytes});
  if(token!==createToken||signature!==settingsSignature())return;
  const {groups,shares}=res;
  const total=groups.length;
  const frag=document.createDocumentFragment(),texts=[];
  let phraseText='';
  if(shares&&shares.length>1){
   phraseText=shares.map(s=>s.groups.map(g=>g.join(' ')).join('\n')).join('\n\n');
   for(const s of shares){
    const shareWords=s.groups.map(g=>g.join(' ')).join('\n');
    texts.push(shareWords);
    const figure=document.createElement('figure'),caption=document.createElement('figcaption');
    figure.appendChild(qrSVG(shareWords));
    caption.textContent=`暗号化BIP39 秘密分散シェア ${s.index} / ${s.n}（任意の${s.m}枚のQRで復元可能）\n全${s.groups.length}ブロック・${s.groups.length*24}単語を1枚のQRに統合\n${extended?'拡張バックアップ（サイト名・合言葉含む）':'設定のみ（カードシード・マイレシピ設定）'}`;
    figure.appendChild(caption);frag.appendChild(figure);
   }
  }else{
   phraseText=groups.map(g=>g.join(' ')).join('\n');
   texts.push(phraseText);
   const figure=document.createElement('figure'),caption=document.createElement('figcaption');
   figure.appendChild(qrSVG(phraseText));
   caption.textContent=`暗号化BIP39バックアップ（全${total}ブロック・${total*24}単語を1枚のQRに統合）\n${extended?'拡張バックアップ（サイト名・合言葉含む）':'設定のみ（カードシード・マイレシピ設定）'} / 復元用パスワードは別保管`;
   figure.appendChild(caption);frag.appendChild(figure);
  }
  renderEncryptedWords(groups,shares);
  artifact={packet:phraseText,total,signature,encrypted:true,extended,texts,groups,shares,kdfProfile,shamirM,shamirN,twoFaMode};
  $('bq-output').value=phraseText;
  $('bq-qr-list').replaceChildren(frag);
  const shamirDesc=shamirN>1?`秘密分散：${shamirM}-of-${shamirN}（全${shamirN}シェア・QR ${shamirN}枚／任意の${shamirM}枚で復元、各シェア${shares[0].groups.length}ブロック統合）。`:`全${total}ブロック（${total*24}単語・QR 1枚に統合）。`;
  const twoFaDesc=twoFaMode!=='none'?`二段階ロック：${twoFaLabel(twoFaMode)}。`:'';
  $('bq-print-summary').textContent=`暗号化BIP39復元用QR：${shamirDesc}${extended?'拡張バックアップ（カードシード・マイレシピ設定・サイト名・合言葉）':'設定のみ（カードシード・マイレシピ設定）'}。暗号化方式：${MatrixCardPreset.kdfLabel?MatrixCardPreset.kdfLabel(kdfProfile):'CME2'}。${twoFaDesc}復元用パスワードは別保管し、印刷しないでください。`;
  $('backup-qr').dataset.ready='true';
  $('bq-copy').disabled=false;$('bq-print').disabled=false;
  $('bq-password').value='';$('bq-password-confirm').value='';
  message('bq-status',shamirN>1
   ?`作成完了：秘密分散（${shamirM}-of-${shamirN}）暗号化BIP39フレーズ 全${shamirN}シェア ＋ シェア別統合QR ${shamirN}枚（1シェア＝QR 1枚、各${shares[0].groups.length}ブロック・${shares[0].groups.length*24}単語統合）。各シェアのQRを異なる保管場所へ分散保管し、保管前に任意の${shamirM}枚で復元テストを行ってください。`
   :`作成完了：暗号化BIP39フレーズ 全${total}ブロック（${total*24}単語）＋ 統合QR 1枚。印刷・保管前に下で復元テストを行ってください。`);
 }catch(e){if(token===createToken)message('bq-status',e.message,true);}
}

// Legacy MCBK1 fallback support for backward compatibility
async function deriveLegacy(password,salt,usage){
 if(enc.encode(password).length>4096)throw Error('復元用パスワードが長すぎます。');
 const key=await api().importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
 return api().deriveKey({name:'PBKDF2',salt,iterations:ITER_LEGACY,hash:'SHA-256'},key,{name:'AES-GCM',length:256},false,[usage]);
}
async function unpackLegacyPacket(packet,password){
 if(packet.length>MAX)throw Error('バックアップの長さが上限を超えています。');
 let bytes;
 if(packet.startsWith('MCBK1:P:')){
  const fields=packet.slice(8).split('.');if(fields.length!==2||!/^[a-f0-9]{64}$/.test(fields[1]))throw Error('バックアップの形式が不正です。');
  bytes=unb64(fields[0]);if(await hashHex(bytes)!==fields[1])throw Error('バックアップが破損しています（検証値不一致）。');
 }else if(packet.startsWith('MCBK1:E:')){
  const fields=packet.slice(8).split('.');if(fields.length!==3)throw Error('暗号化バックアップの形式が不正です。');
  const salt=unb64(fields[0]),iv=unb64(fields[1]),cipher=unb64(fields[2]);
  if(salt.length!==16||iv.length!==12||cipher.length<17)throw Error('暗号化バックアップの長さが不正です。');
  if(!password)throw Error('復元用パスワードを入力してください。');
  try{const key=await deriveLegacy(password,salt,'decrypt');bytes=new Uint8Array(await api().decrypt({name:'AES-GCM',iv,additionalData:enc.encode(AAD_LEGACY),tagLength:128},key,cipher));}
  catch(_){throw Error('復元用パスワードが違うか、バックアップが破損しています。');}
 }else throw Error('未対応のバックアップ文字列です。');
 const p=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!p||typeof p!=='object'||p.t!=='MC'||p.v!==1||!['C1','C2','L2'].includes(p.p)||!['E','B'].includes(p.s))throw Error('未対応のバックアップ形式です。');
 const core=unb64(p.c);if(core.length!==32)throw Error('設定データ長が不正です。');
 const decoded=unpack256BitToRecipe(core);validateConfig(decoded.cfg);
 if(!decoded.includeCardSeed)throw Error('バックアップにカードシードが含まれていません。');
 if(p.s==='E'){
  if('y'in p&&typeof p.y==='string')decoded.cfg.symList=p.y;
  return{...decoded,site:p.n,secret:p.w,expected:Uint8Array.from(p.h.match(/.{2}/g),h=>parseInt(h,16)),full:true,encrypted:packet.startsWith('MCBK1:E:'),kdfProfile:'legacy',blockCount:1,twoFaMode:0,shamir:null};
 }
 return{...decoded,full:false,encrypted:packet.startsWith('MCBK1:E:'),kdfProfile:'legacy',blockCount:1,twoFaMode:0,shamir:null};
}

async function review(){
 clearPending();let token=reviewToken;message('bq-scan-status','検証しています…');
 try{
  let text=$('bq-import').value.trim();
  if(!text)throw Error('復元フレーズ（24単語×必要ブロック数）を入力するか、QRコードを読み取ってください。');
  const password=$('bq-restore-password').value;
  const keyfileBytes=await getRestoreKeyfileBytes();
  let d;
  if(text.startsWith('MCQR1:')){
   const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
   let completed=false;
   for(const line of lines)if(await ingest(line))completed=true;
   if(!completed)return;
   token=reviewToken;text=$('bq-import').value.trim();
  }
  if(text.startsWith('MCBK1:')){
   d=await unpackLegacyPacket(text,password);
  }else{
   const words=text.toLowerCase().split(/\s+/).filter(Boolean);
   if(words.length<24||words.length%24!==0||words.length>512*24){
    throw Error('BIP39の24単語単位（24単語、または24単語×必要ブロック数）で入力してください。');
   }
   d=await MatrixCardPreset.decodeBip39Blocks(words,password,true,keyfileBytes?{keyfileBytes}:null);
   validateConfig(d.cfg);
  }
  if(token!==reviewToken)return;
  pending={decoded:d,input:$('bq-import').value.trim(),password};
  const pCode=profileFor(d.cfg);
  const encDesc=d.encrypted
   ?(d.kdfProfile==='legacy'?'暗号化あり（旧MCBK1形式）':`暗号化あり（${MatrixCardPreset.kdfLabel?MatrixCardPreset.kdfLabel(d.kdfProfile):'CME2'}）`)
   :'暗号化なし';
  const shamirLine=d.shamir?`秘密分散：${d.shamir.m}-of-${d.shamir.n} 分散（シェア ${d.shamir.usedShares.map(x=>'#'+x).join('・')} から合成済み）`:'秘密分散：なし（単一バックアップ）';
  const twoFaLine=d.twoFaMode?`二段階ロック：${twoFaLabel(d.twoFaMode)}（検証済み）`:'';
  $('bq-preview').textContent=[
   `検証済み：${d.full?'拡張バックアップ（カードシード・マイレシピ設定・サイト名・合言葉）':'設定のみ（カードシード・マイレシピ設定）'} ／ ${encDesc}`,
   `入力ブロック数：${d.blockCount||1}ブロック（${(d.blockCount||1)*24}単語） ／ ${shamirLine}`,
   ...(twoFaLine?[twoFaLine]:[]),
   `読み方：${profileLabel(pCode)} ／ カード配列シード番号：${d.includeCardSeed?d.seedNumber:'未保存（現在のカードを使用）'}`,
   d.full?`サイト名：${d.site}\n合言葉：保存あり（安全のためここには表示しません）`:'サイト名・合言葉：含まれていません（現在ページ上部に入力されている値を使用します）',
   `文字数設定：${d.cfg.lenVal}文字（長さモード ${d.cfg.lenMode}）`,
   'まだ復元を適用していません。下の「確認した内容で復元を実行」を押すと現在の入力・設定へ反映します。'
  ].join('\n');
  $('bq-preview').hidden=false;$('bq-apply').disabled=false;
  message('bq-scan-status','検証が完了しました。内容を確認して「確認した内容で復元を実行」を押してください。');
 }catch(e){if(token===reviewToken)message('bq-scan-status',e.message,true);}
}

async function applyRestore(){
 if(!pending)return;
 if(pending.input!==$('bq-import').value.trim()||pending.password!==$('bq-restore-password').value){
  clearPending();message('bq-scan-status','入力が変更されました。もう一度「読み込み・検証して内容を確認」を押してください。',true);return;
 }
 const d=pending.decoded;
 const old={cfg:getRecipeConfig(),seed:MatrixCardPreset.getAppliedSeed(),seedInput:$('input-seed-number').value,site:$('sim-site').value,secret:$('sim-secret').value,inc:$('chk-include-card-seed').checked,kind:$('backup-kind')?.value,cqPinLen:$('cq-pin-length')?.value,cqSymLen:$('cq-symbol-length')?.value,cqSymMode:$('cq-symbol-mode')?.value,cqSymList:$('cq-symbol-list')?.value};
 let touched=false;clearArtifact('復元を実行したため、以前の暗号化QR表示を消去しました。');$('bq-apply').disabled=true;
 try{
  touched=true;
  setRecipeConfig(d.cfg);
  $('chk-include-card-seed').checked=d.includeCardSeed;
  if(d.includeCardSeed){$('input-seed-number').value=String(d.seedNumber);updateMainMatrix(d.seedNumber);}
  if(d.full){$('sim-site').value=d.site;$('sim-secret').value=d.secret;}
  if($('backup-kind'))$('backup-kind').value=d.full?'full':'settings';
  updateSimulationUI();
  if(MatrixCardPreset.getIssue())throw Error(MatrixCardPreset.getIssue());
  const value=currentEvalSteps.map(s=>s.ch).join('');
  if(!value)throw Error('復元後の生成値が空です。入力・設定を確認してください。');
  if(d.full&&d.expected){
   const actual=await shaBytes(enc.encode(value));
   if(!equalBytes(actual,d.expected))throw Error('復元後の生成値が保存時と一致しません。生成時と同じカード・版であるか確認してください。');
  }
  await generateAndRenderSeedPhrase();
  clearPending();$('bq-restore-password').value='';
  const shamirNote=d.shamir?`・秘密分散 ${d.shamir.m}-of-${d.shamir.n} 合成済み`:'';
  message('bq-scan-status',d.full
   ?`✅ 復元完了（${d.encrypted?'暗号化復号済み':'暗号化なし'}${shamirNote}）。サイト名・合言葉・カード・マイレシピ設定を復元し、生成パスワードが保存時と完全一致することも確認しました。`
   :`✅ 復元完了（${d.encrypted?'暗号化復号済み':'暗号化なし'}${shamirNote}）。カードとマイレシピ設定を復元しました。サイト名・合言葉は生成時と同じものを入力してください。`);
 }catch(e){
  if(touched){
   setRecipeConfig(old.cfg);$('sim-site').value=old.site;$('sim-secret').value=old.secret;$('chk-include-card-seed').checked=old.inc;
   if(old.kind!==undefined&&$('backup-kind'))$('backup-kind').value=old.kind;
   if(old.cqPinLen!==undefined&&$('cq-pin-length'))$('cq-pin-length').value=old.cqPinLen;
   if(old.cqSymLen!==undefined&&$('cq-symbol-length'))$('cq-symbol-length').value=old.cqSymLen;
   if(old.cqSymMode!==undefined&&$('cq-symbol-mode'))$('cq-symbol-mode').value=old.cqSymMode;
   if(old.cqSymList!==undefined&&$('cq-symbol-list'))$('cq-symbol-list').value=old.cqSymList;
   updateMainMatrix(old.seed);$('input-seed-number').value=old.seedInput;updateSimulationUI();void generateAndRenderSeedPhrase();
  }
  message('bq-scan-status','❌ 復元しませんでした。元の入力・設定に戻しました：'+e.message,true);
  if(pending)$('bq-apply').disabled=false;
 }
}

function script(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');let done=false;const t=setTimeout(()=>finish(false),12000);function finish(ok){if(done)return;done=true;clearTimeout(t);s.onload=s.onerror=null;if(!ok)s.remove();ok?resolve():reject(Error('読取ライブラリを読み込めませんでした。'));}s.src=src;s.onload=()=>finish(true);s.onerror=()=>finish(false);document.head.appendChild(s);});}
async function getDecoder(){
 if(window.BarcodeDetector){try{if(!BarcodeDetector.getSupportedFormats||(await BarcodeDetector.getSupportedFormats()).includes('qr_code')){const detector=new BarcodeDetector({formats:['qr_code']});return async canvas=>(await detector.detect(canvas)).map(r=>r.rawValue);}}catch(_){}}
 if(!window.jsQR){
  if(!decoderPromise)decoderPromise=script('vendor/jsQR.js').catch(async()=>{if(!$('bq-cdn').checked)throw Error('お使いのブラウザでQRコードを読み取るには、上の「標準カメラ読取非対応のブラウザ（iPhone等）ではQR読取補助ライブラリを使用して読み取る」にチェックを入れてください。');await script('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');}).catch(e=>{decoderPromise=null;throw e;});
  await decoderPromise;
 }
 if(typeof window.jsQR!=='function')throw Error('QR読取ライブラリが利用できません。');
 return async canvas=>{const ctx=canvas.getContext('2d',{willReadFrequently:true}),im=ctx.getImageData(0,0,canvas.width,canvas.height),r=jsQR(im.data,im.width,im.height,{inversionAttempts:'attemptBoth'});return r?[r.data]:[];};
}

function stopCamera(note=''){
 cameraEpoch++;if(timer){clearTimeout(timer);timer=null;}if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
 const video=$('bq-video');if(video){video.pause();video.srcObject=null;video.hidden=true;}$('bq-stop').disabled=true;$('bq-camera').disabled=false;if(note)message('bq-scan-status',note);
}

async function ingest(text){
 if(typeof text!=='string'||text.length>MAX+200)throw Error('QRデータが大きすぎます。');
 const trimmed=text.trim();
 if(!trimmed)return false;

 // 1. Legacy MCBK1 / MCQR1 fallback
 if(trimmed.startsWith('MCBK1:')){
  $('bq-import').value=trimmed;clearPending();stopCamera();
  message('bq-scan-status','QRを読み取りました。必要なら復元用パスワードを入力し、「読み込み・検証して内容を確認」を押してください。');
  return true;
 }
 const m=/^MCQR1:([a-f0-9]{16}):(\d{1,2})\/(\d{1,2}):(.+)$/.exec(trimmed);
 if(m){
  const id=m[1],index=Number(m[2]),total=Number(m[3]),chunk=m[4];
  if(total<1||total>MAXPARTS||index<1||index>total||chunk.length>CHUNK)throw Error('QR分割情報が不正です。');
  if(!parts||parts.kind!=='mcqr')parts={kind:'mcqr',id,total,map:new Map()};
  if(parts.id!==id||parts.total!==total)throw Error('別のバックアップのQRが混在しています。読取をリセットして、同じバックアップの全枚を読んでください。');
  if(parts.map.has(index)&&parts.map.get(index)!==chunk)throw Error('同じ番号に異なるデータがあります。');
  parts.map.set(index,chunk);
  message('bq-scan-status',`${parts.map.size} / ${total}枚を読み取りました。`);
  if(parts.map.size===total){
   const packet=Array.from({length:total},(_,i)=>parts.map.get(i+1)).join('');
   if(packet.length>MAX||(await hashHex(enc.encode(packet))).slice(0,16)!==id)throw Error('QR全体の検証に失敗しました。');
   parts=null;$('bq-import').value=packet;clearPending();stopCamera();
   message('bq-scan-status',`全${total}枚の読取・結合が完了しました。必要なら復元用パスワードを入力して検証してください。`);
   return true;
  }
  return false;
 }

 // 2. Unified BIP39 24-word (or multi-block 24-word x N, including Shamir M-of-N shares) QR Code
 const words=trimmed.toLowerCase().split(/\s+/).filter(Boolean);
 if(words.length>=24&&words.length%24===0&&words.length<=512*24){
  for(let offset=0;offset<words.length;offset+=24){
   const slice=words.slice(offset,offset+24),phrase24=slice.join(' ');
   const bytes=await bip39WordsToEntropy(phrase24);
   if(!MatrixCardPreset.isFrame(bytes)){
    if(words.length!==24)throw Error('単一24単語フレーズと拡張ブロックが混在しています。');
    unpack256BitToRecipe(bytes);
    parts=null;$('bq-import').value=phrase24;clearPending();stopCamera();
    message('bq-scan-status','24単語のBIP39復元QRを読み取りました。「読み込み・検証して内容を確認」を押してください。');
    return true;
   }
   const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
   const index=v.getUint16(4,false),total=v.getUint16(6,false);
   const id=hexTag(bytes.slice(8,12));
   if(total<2||total>512||index<1||index>total)throw Error('BIP39拡張ブロック番号が不正です。');
   if(!parts||parts.kind!=='bip39')parts={kind:'bip39',groups:new Map(),shamir:null};
   if(!parts.groups.has(id)){
    if(parts.groups.size>0&&!parts.shamir){
     throw Error('別のバックアップのQRが混在しています。「読取中のQRをリセット」を押して同じバックアップの全ブロックを読んでください。');
    }
    parts.groups.set(id,{total,map:new Map()});
   }
   const grp=parts.groups.get(id);
   if(grp.total!==total)throw Error('ブロック総数が一致しないQRが混在しています。');
   if(grp.map.has(index)&&grp.map.get(index).phrase24!==phrase24)throw Error('同じブロック番号に異なる24単語データがあります。');
   grp.map.set(index,{phrase24,bytes});
   if(grp.map.size<total){
    const shareProgress=parts.shamir?`（完了済みシェア：${parts.shamir.completedShares.size} / ${parts.shamir.m}）`:'';
    message('bq-scan-status',`${grp.map.size} / ${total} ブロック（各24単語）を読み取りました${shareProgress}。順不同で残りのQRも読み取れます。`);
   }else{
    const orderedEntries=Array.from({length:total},(_,i)=>grp.map.get(i+1));
    const fullPhrase=orderedEntries.map(e=>e.phrase24).join('\n');
    const orderedBlocks=orderedEntries.map(e=>e.bytes);
    const {body}=await MatrixCardPreset.reassembleStreamGroup(orderedBlocks,false);
    if(MatrixCardPreset.isShamirBody&&MatrixCardPreset.isShamirBody(body)){
     const sm=body[4],sn=body[5],sk=body[6],setIdHex=hexTag(body.slice(8,16));
     if(parts.shamir&&parts.shamir.setIdHex!==setIdHex){
      parts.groups.delete(id);
      throw Error('異なる秘密分散バックアップのシェアQRが混在しています。');
     }
     if(!parts.shamir)parts.shamir={m:sm,n:sn,setIdHex,completedShares:new Map()};
     parts.shamir.completedShares.set(sk,fullPhrase);
     $('bq-import').value=[...parts.shamir.completedShares.values()].join('\n\n');
     clearPending();
     if(parts.shamir.completedShares.size>=sm){
      const doneList=[...parts.shamir.completedShares.keys()].map(x=>'#'+x).join('・');
      parts=null;stopCamera();
      message('bq-scan-status',`秘密分散（${sm}-of-${sn}）の必要 ${sm} シェア（シェア ${doneList}）すべてのQR読取・結合が完了しました。復元用パスワードを入力し、「読み込み・検証して内容を確認」を押してください。`);
      return true;
     }else{
      message('bq-scan-status',`秘密分散シェア #${sk}（全${total}ブロック）の読取が完了しました（現在 ${parts.shamir.completedShares.size} / 必要 ${sm} シェア）。続けて別のシェアのQRコードを読み取ってください。`);
     }
    }else{
     parts=null;$('bq-import').value=fullPhrase;clearPending();stopCamera();
     message('bq-scan-status',`全 ${total} ブロック（${total*24}単語）のQR読取・順序結合が完了しました。暗号化している場合は復元用パスワードを入力し、「読み込み・検証して内容を確認」を押してください。`);
     return true;
    }
   }
  }
  return false;
 }

 message('bq-scan-status','認識可能なBIP39 24単語QRコードではありません。',true);
 return false;
}

async function startCamera(){
 stopCamera();const epoch=cameraEpoch;$('bq-camera').disabled=true;$('bq-stop').disabled=false;
 try{
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('カメラ復元にはHTTPS（またはlocalhost）と対応ブラウザが必要です。QR画像の選択や24単語貼り付けも使えます。');
  const decode=await getDecoder();if(epoch!==cameraEpoch)return;
  const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
  if(epoch!==cameraEpoch){media.getTracks().forEach(t=>t.stop());return;}
  stream=media;const video=$('bq-video');video.srcObject=media;video.hidden=false;await video.play();if(epoch!==cameraEpoch)return;
  message('bq-scan-status','印刷したQR（24単語ブロック）を枠内に大きく映してください。複数枚ある場合は順不同で全ブロックを読み取ります。');
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  const tick=async()=>{if(epoch!==cameraEpoch)return;try{if(video.readyState>=2&&video.videoWidth){const scale=Math.min(1,1400/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);ctx.drawImage(video,0,0,canvas.width,canvas.height);for(const text of await decode(canvas)){if(epoch!==cameraEpoch)return;if(await ingest(text))return;}}}catch(e){if(epoch===cameraEpoch)message('bq-scan-status',e.message,true);}if(epoch===cameraEpoch)timer=setTimeout(tick,250);};void tick();
 }catch(e){if(epoch!==cameraEpoch)return;stopCamera();message('bq-scan-status',e.name==='NotAllowedError'?'カメラが許可されていません。ブラウザのカメラ権限を確認するか、QR画像・24単語入力を使ってください。':e.message,true);}
}

async function readImage(file){
 if(!file)return;stopCamera();
 try{
  if(file.size>25*1024*1024)throw Error('画像は25MB以内にしてください。');
  const decode=await getDecoder();const image=await createImageBitmap(file);
  try{
   const scale=Math.min(1,1800/Math.max(image.width,image.height)),canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
   canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
   const texts=await decode(canvas);
   if(!texts.length)throw Error('QRが見つかりません。1枚のQRを大きく明るく写し、再度選択してください。');
   for(const text of texts)await ingest(text);
  }finally{image.close();}
 }catch(e){message('bq-scan-status',e.message,true);}finally{$('bq-image').value='';}
}

function updatePassEntropy(){
 const el=$('bq-pw-entropy');if(!el)return;
 const pw=$('bq-password')?.value||'',pw2=$('bq-password-confirm')?.value||'';
 if(!pw){el.textContent='パスワード強度診断：未入力（12文字以上必須）';el.style.color='var(--text-sub)';return;}
 const ent=MatrixCardPreset.estimatePasswordEntropy?MatrixCardPreset.estimatePasswordEntropy(pw):{bits:0,length:Array.from(pw).length,unique:new Set(Array.from(pw)).size};
 const matchMsg=pw2?(pw===pw2?' ／ 再入力：一致 ✅':' ／ 再入力：不一致 ⚠️'):'';
 if(ent.length<12){
  el.textContent=`パスワード強度診断：文字数不足（現在 ${ent.length}文字 ／ 最低12文字必要・推定 ${ent.bits} bits）${matchMsg}`;
  el.style.color='#b91c1c';
 }else if(ent.bits<80||ent.unique<6){
  el.textContent=`パスワード強度診断：中程度（${ent.length}文字・推定 ${ent.bits} bits）— より多様な文字種または16文字以上のパスフレーズを推奨${matchMsg}`;
  el.style.color='#b45309';
 }else{
  el.textContent=`パスワード強度診断：高強度 ✅（${ent.length}文字・固有${ent.unique}種・推定探索空間 ${ent.bits} bits）${matchMsg}`;
  el.style.color='#065f46';
 }
}

function sync2FaUI(){
 const mode=$('bq-2fa-mode')?.value||'none';
 if($('bq-keyfile-row'))$('bq-keyfile-row').hidden=mode!=='keyfile';
 if($('bq-passkey-row'))$('bq-passkey-row').hidden=mode!=='passkey';
}

function generateAndDownloadKeyfile(){
 const raw=crypto.getRandomValues(new Uint8Array(64));
 const hex=[...raw].map(b=>b.toString(16).padStart(2,'0')).join('');
 const content=`CRYPTOMATRIX-2FA-KEYFILE-V1:${hex}\n`;
 generatedKeyfileBytes=enc.encode(content);
 generatedKeyfileName='cryptomatrix-2fa.key';
 try{
  const blob=new Blob([generatedKeyfileBytes],{type:'application/octet-stream'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=generatedKeyfileName;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
 }catch(_){}
 if($('bq-keyfile-status'))$('bq-keyfile-status').textContent=`✅ 専用キーファイル（${generatedKeyfileName}）を作成・セットしました（ダウンロード済み）。復元時に必要なため、バックアップとは別の場所に保管してください。`;
}

document.addEventListener('DOMContentLoaded',()=>{
 sync2FaUI();
 $('bq-create')?.addEventListener('click',()=>void createBackup());
 $('bq-clear')?.addEventListener('click',()=>{clearArtifact('画面上の暗号化バックアップ表示を消去しました。コピー・印刷済みのデータは消えません。');$('bq-password').value='';$('bq-password-confirm').value='';generatedKeyfileBytes=null;if($('bq-keyfile-status'))$('bq-keyfile-status').textContent='';updatePassEntropy();});
 $('bq-gen-keyfile')?.addEventListener('click',generateAndDownloadKeyfile);
 $('bq-keyfile')?.addEventListener('change',()=>{
  const f=$('bq-keyfile')?.files?.[0];
  if(f&&$('bq-keyfile-status'))$('bq-keyfile-status').textContent=`✅ キーファイル選択済み：${f.name}（${f.size} bytes）`;
  clearArtifact('キーファイルが変更されました。暗号化バックアップを作成し直してください。');
 });
 $('bq-copy')?.addEventListener('click',async()=>{
  try{
   if(!artifact||artifact.signature!==settingsSignature())throw Error('現在の入力・設定で作成し直してください。');
   if(MatrixCardPreset.copyWithAutoClear){
    await MatrixCardPreset.copyWithAutoClear(artifact.packet,()=>message('bq-status','🛡️ クリップボードの暗号化フレーズを自動消去しました。'));
   }else{
    await navigator.clipboard.writeText(artifact.packet);
   }
   message('bq-status',`暗号化BIP39フレーズ（全${artifact.total}ブロック・${artifact.total*24}単語）をコピーしました（30秒後にクリップボードから自動消去されます）。`);
  }catch(e){message('bq-status',e.message+' コピーできない場合は欄内の24単語ブロックを手動で控えてください。',true);}
 });
 $('bq-print')?.addEventListener('click',()=>{
  if(!artifact||artifact.signature!==settingsSignature()){clearArtifact('入力・設定が変わりました。作成し直してください。');return;}
  window.print();
 });
 const syncOptions=()=>{sync2FaUI();clearArtifact('保存条件が変わりました。暗号化バックアップを作成し直してください。');updatePassEntropy();};
 for(const id of ['bq-scope','bq-kdf','bq-shamir','bq-2fa-mode','bq-password','bq-password-confirm']){
  const el=$(id);if(el)for(const type of ['input','change'])el.addEventListener(type,syncOptions);
 }
 const invalidator=()=>clearArtifact('入力・設定が変わったため古い暗号化QR表示を消去しました。現在の内容で作成し直してください。');
 for(const el of document.querySelectorAll('.rc-input,#sim-site,#sim-secret,#input-seed-number,#chk-include-card-seed,#cq-symbol-mode,#cq-symbol-list'))for(const type of ['input','change'])el.addEventListener(type,invalidator,true);
 for(const id of ['btn-update-matrix','btn-random-matrix','btn-reset-recipe','btn-random-recipe','btn-restore-seed'])$(id)?.addEventListener('click',invalidator,true);
 document.addEventListener('matrix-card-settings-changed',invalidator);
 $('bq-review')?.addEventListener('click',()=>void review());
 $('bq-apply')?.addEventListener('click',()=>void applyRestore());
 $('bq-import')?.addEventListener('input',clearPending);
 $('bq-restore-password')?.addEventListener('input',clearPending);
 $('bq-restore-keyfile')?.addEventListener('change',clearPending);
 $('bq-camera')?.addEventListener('click',()=>void startCamera());
 $('bq-stop')?.addEventListener('click',()=>stopCamera('カメラを停止しました。'));
 $('bq-image')?.addEventListener('change',()=>void readImage($('bq-image').files?.[0]));
 $('bq-reset-parts')?.addEventListener('click',()=>{parts=null;clearPending();message('bq-scan-status','読取中のQRブロックをリセットしました。');});
 window.addEventListener('pagehide',()=>stopCamera());
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')stopCamera();});
});
})();
