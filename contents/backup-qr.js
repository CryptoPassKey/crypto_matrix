/* Matrix Card Backup & QR Restore (Unified BIP39 24-word x N-block + CME2 Encryption + Shamir M-of-N Secret Sharing + Serverless 2FA)

 * - Section 2 auto-displays unencrypted 24-word (settings-only) or 24-word x N-block (CMX2/CXB2 extended) phrases & QR codes.

 * - Section 3 creates password-encrypted 24-word x N-block (CME2/CXB2) phrases & QR codes, with optional GF(2^8) Shamir's Secret Sharing (M-of-N) and Serverless 2FA (Keyfile / WebAuthn Passkey PRF).

 * - Every QR code encodes a 24-word BIP39 block directly. Legacy MCBK1/MCQR1 strings remain supported on restore.

 */

(() => {

'use strict';

const $=id=>document.getElementById(id), enc=new TextEncoder(), ITER_LEGACY=310000, MAX=40000, CHUNK=420, MAXPARTS=48;

function openKeeWeb() {

 try {

  return window.openKeeWeb ? window.openKeeWeb() : null;

 } catch (_) {

  return null;

 }

}

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



function downloadBlob(blob,filename){

 const url=URL.createObjectURL(blob);

 const a=document.createElement('a');

 a.href=url;a.download=filename;

 document.body.appendChild(a);a.click();a.remove();

 setTimeout(()=>URL.revokeObjectURL(url),5000);

}

if(typeof window!=='undefined'){

 window.downloadBlob=downloadBlob;

}



function getProtectionConfig(){

 const usePass=$('bq-opt-password')?.checked??true;

 const useKeyfile=$('bq-opt-keyfile')?.checked??false;

 const usePasskey=$('bq-opt-passkey')?.checked??false;
 const shamirVal=($('bq-shamir')?.value||'1-1').split('-').map(Number);

 const shamirM=shamirVal[0]||1,shamirN=shamirVal[1]||1;

 return{usePass,useKeyfile,usePasskey,shamirM,shamirN};

}



function comboLabel(combo){

 if(combo===0)return '復元用パスワード単独';

 if(combo===1)return '復元用パスワード ＋ キーファイル（二段階認証）';

 if(combo===2)return '復元用パスワード ＋ パスキー認証（二段階認証）';

 if(combo===3)return '復元用パスワード ＋ キーファイル ＋ パスキー認証（多要素認証）';

 if(combo===4)return 'キーファイル単独（パスワード不要）';

 if(combo===5)return 'パスキー認証単独（パスワード不要）';

 if(combo===6)return 'キーファイル ＋ パスキー認証（パスワード不要・二段階認証）';

 return '暗号化なし';

}



function twoFaLabel(mode){

 if(typeof mode==='number')return comboLabel(mode);

 if(mode==='keyfile')return comboLabel(1);

 if(mode==='passkey')return comboLabel(2);

 return 'なし（復元用パスワードのみ）';

}



function settingsSignature(){

 return JSON.stringify([

  MatrixCardPreset.getAppliedSeed(),

  getRecipeConfig(),

  $('sim-site').value,

  $('sim-secret').value,

  $('bq-scope')?.value,

  $('bq-kdf')?.value,

  $('bq-shamir')?.value,

  $('bq-opt-password')?.checked,

  $('bq-opt-keyfile')?.checked,

  $('bq-opt-passkey')?.checked

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

 if($('bq-save-txt'))$('bq-save-txt').disabled=true;

 if($('bq-save-qr'))$('bq-save-qr').disabled=true;

 if($('bq-save-cmenc'))$('bq-save-cmenc').disabled=true;

 if($('bq-transfer-keeweb'))$('bq-transfer-keeweb').disabled=true;
 if($('bq-test-restore'))$('bq-test-restore').disabled=true;

 if($('bq-save-xml'))$('bq-save-xml').disabled=true;

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



function vaultB64(bytes){

 let s='';

 const chunk=8192;

 for(let i=0;i<bytes.length;i+=chunk){

  s+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));

 }

 return btoa(s);

}



function vaultUnb64(str){

 const clean=str.replace(/[\r\n\s]/g,'');

 const bin=atob(clean);

 const bytes=new Uint8Array(bin.length);

 for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);

 return bytes;

}



function armorVault(bytes,tag='ENCRYPTED DATA',type='VAULT'){

 const cleanTag=(tag||'').trim();

 const header=type?(cleanTag?`CRYPTOMATRIX ${type} ${cleanTag}`:`CRYPTOMATRIX ${type}`):(cleanTag?`CRYPTOMATRIX ${cleanTag}`:'CRYPTOMATRIX');

 const b64=vaultB64(bytes);

 const wrapped=b64.match(/.{1,64}/g)?.join('\n')||b64;

 return `-----BEGIN ${header}-----\n${wrapped}\n-----END ${header}-----`;

}



function dearmorVault(str){

 const results=[];

 const regex=/-----BEGIN CRYPTOMATRIX[^-]*-----([\s\S]*?)-----END CRYPTOMATRIX[^-]*-----/g;

 let match;

 while((match=regex.exec(str))!==null){

  const b64Str=match[1].trim();

  if(b64Str){

   try{results.push(vaultUnb64(b64Str));}catch(_){}

  }

 }

 if(results.length)return results;

 const trimmed=str.trim();

 if(/^[A-Za-z0-9+/=_\-\s]+$/.test(trimmed)){

  try{return[vaultUnb64(trimmed)];}catch(_){}

 }

 return[];

}



function renderEncryptedWords(groups,shares=null,armoredText='',phraseText='',isMulti=false){

 const box=$('bq-words-container');

 if(!box)return;

 let chipsHtml='';

 if(shares&&shares.length>1){

  chipsHtml=shares.map(s=>

   `<div class="backup-block-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;background:#eef8f2;padding:6px 10px;border-radius:6px;border:1px solid #b9cec0;width:100%;margin-top:10px;">`+

   `<span>🔐 秘密分散シェア ${s.index} / ${s.n}（任意の ${s.m} シェアで復元可能 ・ 全${s.groups.length}ブロック／${s.groups.length*24}単語）</span>`+

   `<div class="bv-no-print" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">`+

   `<button type="button" class="btn btn-secondary btn-copy-share" data-share-index="${s.index}" style="padding:3px 8px;font-size:0.75rem;">シェア ${s.index}/${s.n} をコピー</button>`+

   `<button type="button" class="btn btn-outline btn-save-share-txt" data-share-index="${s.index}" style="padding:3px 8px;font-size:0.75rem;">💾 テキスト保存</button>`+

   `<button type="button" class="btn btn-outline btn-save-share-qr" data-share-index="${s.index}" style="padding:3px 8px;font-size:0.75rem;">🖼️ QR保存</button>`+

   `</div>`+

   `</div>`+

   s.groups.map((group,g)=>

    `<div class="backup-block-title" style="margin-top:8px;font-size:0.8rem;color:var(--text-sub);width:100%;">シェア ${s.index}/${s.n} — ブロック ${g+1} / ${s.groups.length}（24単語）</div>`+

    `<div class="seed-words-grid" style="margin:6px 0 12px 0;">`+

    group.map((w,i)=>`<div class="seed-chip"><span class="seed-num">#${String(g*24+i+1).padStart(2,'0')}</span><span class="seed-txt">${escapeHtml(w)}</span></div>`).join('')+

    `</div>`

   ).join('')

  ).join('');

 }else{

  chipsHtml=groups.map((group,g)=>

   `<div class="backup-block-title" style="width:100%;margin-top:8px;">暗号化ブロック ${g+1} / ${groups.length}（24単語）</div>`+

   `<div class="seed-words-grid" style="margin:6px 0 12px 0;">`+

   group.map((w,i)=>`<div class="seed-chip"><span class="seed-num">#${String(g*24+i+1).padStart(2,'0')}</span><span class="seed-txt">${escapeHtml(w)}</span></div>`).join('')+

   `</div>`

  ).join('');

 }



 if(isMulti){

  box.innerHTML=`

   <div class="bv-no-print" style="width:100%; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px; background:#f1f5f9; padding:8px 12px; border-radius:6px; border:1px solid #cbd5e1;">

     <div style="font-size:0.82rem; font-weight:700; color:#334155;">

       📜 出力形式（現在: <span id="bq-active-format-label">PGPアーマード形式</span>）

     </div>

     <button type="button" class="btn btn-outline" id="bq-btn-toggle-format" style="font-size:0.78rem; padding:4px 10px;">

       🔄 表示切替：BIP39 24単語ブロック形式 ⇄ PGPアーマード形式

     </button>

   </div>

   <div id="bq-words-chips-wrap" hidden style="width:100%;">

     ${chipsHtml}

   </div>

  `;

  $('bq-btn-toggle-format')?.addEventListener('click',()=>{

   if(!artifact)return;

   const next=(artifact.activeFormat==='armored'?'words':'armored');

   updateSec3Display(next,false);

  });

 }else{

  box.innerHTML=chipsHtml;

 }



 box.querySelectorAll('.btn-copy-share').forEach(btn=>{

  btn.addEventListener('click',async()=>{

   const idx=Number(btn.dataset.shareIndex);

   const target=shares?.find(x=>x.index===idx);

   if(!target)return;

   const isArmored=(artifact?.activeFormat==='armored');

   const shareText=(isArmored&&artifact?.armoredShares?.[idx-1])

    ?artifact.armoredShares[idx-1]

    :target.groups.map(g=>g.join(' ')).join('\n');

   try{

    if(MatrixCardPreset.copyWithAutoClear){

     await MatrixCardPreset.copyWithAutoClear(shareText,()=>message('bq-status',`🛡️ クリップボードのシェア ${idx}/${target.n} を自動消去しました。`));

    }else{

     await navigator.clipboard.writeText(shareText);

    }

    message('bq-status',`秘密分散シェア ${idx} / ${target.n}（${isArmored?'PGPアーマード形式':`${target.groups.length}ブロック・${target.groups.length*24}単語`}）をコピーしました（30秒後に自動消去）。別の保管場所へ保存してください。`);

   }catch(e){message('bq-status',e.message,true);}

  });

 });



 box.querySelectorAll('.btn-save-share-txt').forEach(btn=>{

  btn.addEventListener('click',()=>{

   const idx=Number(btn.dataset.shareIndex);

   const target=shares?.find(x=>x.index===idx);

   if(!target)return;

   const isArmored=(artifact?.activeFormat==='armored');

   const shareText=(isArmored&&artifact?.armoredShares?.[idx-1])

    ?artifact.armoredShares[idx-1]

    :target.groups.map(g=>g.join(' ')).join('\n');

   const txtName=`cryptomatrix-share${idx}.txt`;

   downloadBlob(new Blob([shareText],{type:'text/plain;charset=utf-8'}),txtName);

   message('bq-status',`💾 シェア${idx}のテキスト（${txtName}）を保存しました。`);

  });

 });



 box.querySelectorAll('.btn-save-share-qr').forEach(btn=>{

  btn.addEventListener('click',()=>{

   const idx=Number(btn.dataset.shareIndex);

   const figures=$('bq-qr-list')?.querySelectorAll('figure');

   const fig=figures?.[idx-1];

   const svg=fig?.querySelector('svg');

   if(!svg){message('bq-status',`シェア${idx}に保存可能なQRコードがありません。`,true);return;}

   const qrName=`cryptomatrix-share${idx}-qr.png`;

   if(window.MatrixCardPreset&&window.MatrixCardPreset.saveSvgAsPng){

    window.MatrixCardPreset.saveSvgAsPng(svg,qrName);

   }

   message('bq-status',`🖼️ シェア${idx}のQRコード画像（${qrName}）を保存しました。`);

  });

 });

}



function appendQrOrNotice(figure,qrText){

 try{

  if(qrText.length>2200)throw new Error('capacity');

  figure.appendChild(qrSVG(qrText));

  return true;

 }catch(_){

  const notice=document.createElement('div');

  notice.className='bv-no-print';

  notice.style.cssText='font-size:0.78rem;color:#92400e;background:#fffbeb;border:1px solid #fef3c7;border-radius:6px;padding:8px;margin-bottom:6px;';

  notice.textContent='⚠️ データ量がQRコードの上限を超えたため、統合QRは表示しません。PGPアーマード形式または暗号化ファイル（.cmenc）を保存してください。';

  figure.appendChild(notice);

  return false;

 }

}



function updateSec3Display(format,isInitial=false){

 if(!artifact)return;

 artifact.activeFormat=format;

 const isArmored=(format==='armored');

 const {total,shamirN,shamirM,factorLabel,shares,groups,armoredText,phraseText,armoredShares,texts,extended,encrypted,kdfProfile,usePass}=artifact;



 if($('bq-output'))$('bq-output').value=(isArmored?armoredText:phraseText);

 artifact.packet=(isArmored?armoredText:phraseText);

 const wrap=$('bq-words-chips-wrap');

 if(wrap)wrap.hidden=isArmored;

 if($('bq-active-format-label')){

  $('bq-active-format-label').textContent=(isArmored?'PGPアーマード形式':'BIP39 24単語ブロック形式');

 }

 if($('bq-copy'))$('bq-copy').disabled=false;

 if($('bq-save-txt'))$('bq-save-txt').disabled=false;

 if($('bq-save-qr'))$('bq-save-qr').disabled=false;

 if($('bq-save-cmenc'))$('bq-save-cmenc').disabled=false;

 if($('bq-transfer-keeweb'))$('bq-transfer-keeweb').disabled=false;
 if($('bq-test-restore'))$('bq-test-restore').disabled=false;

 if($('bq-save-xml'))$('bq-save-xml').disabled=false;

 if($('bq-print'))$('bq-print').disabled=false;



 if(isInitial){

  message('bq-status',shamirN>1

   ?`【✅ 自動復元テスト合格】作成完了：PGPアーマード形式 秘密分散（${shamirM}-of-${shamirN}・保護：${factorLabel}）全${shamirN}シェア ＋ シェア別統合QR ${shamirN}枚。各シェアのQRを異なる保管場所へ分散保管し、保管前に任意の${shamirM}枚で復元テストを行ってください。`

   :(isArmored

    ?`【✅ 自動復元テスト合格】作成完了：PGPアーマード形式（全${total}ブロック統合・保護：${factorLabel}）＋ 統合QR 1枚。印刷・保管前に下で復元テストを行ってください。`

    :`【✅ 自動復元テスト合格】作成完了：BIP39フレーズ 全${total}ブロック（${total*24}単語・保護：${factorLabel}）＋ 統合QR 1枚。印刷・保管前に下で復元テストを行ってください。`));

 }else{

  message('bq-status',shamirN>1

   ?(isArmored

    ?`PGPアーマード形式に切り替えました：秘密分散（${shamirM}-of-${shamirN}・全${shamirN}シェア・各シェア統合QR 1枚）。`

    :`BIP39 24単語ブロック形式に切り替えました：秘密分散（${shamirM}-of-${shamirN}・全${shamirN}シェア・各${shares[0].groups.length}ブロック／${shares[0].groups.length*24}単語統合）。`)

   :(isArmored

    ?`PGPアーマード形式に切り替えました：全${total}ブロック統合（PGPアーマード形式・保護：${factorLabel}）＋ 統合QR 1枚。`

    :`BIP39 24単語ブロック形式に切り替えました：全${total}ブロック（${total*24}単語・保護：${factorLabel}）＋ 統合QR 1枚。`));

 }



 const frag=document.createDocumentFragment();

 if(shares&&shares.length>1){

  for(let i=0;i<shares.length;i++){

   const s=shares[i];

   const qrText=isArmored?(armoredShares[i]||texts[i]):texts[i];

   const figure=document.createElement('figure'),caption=document.createElement('figcaption');

   appendQrOrNotice(figure,qrText);

   const modeLabel=isArmored?'PGPアーマード':'BIP39';

   const encTitle=encrypted?`暗号化${modeLabel}（保護：${factorLabel}）`:`${modeLabel} 秘密分散（暗号化なし）`;

   caption.textContent=`${encTitle} 秘密分散シェア ${s.index} / ${s.n}（任意の${s.m}枚のQRで復元可能）\n${isArmored?`全${s.groups.length}ブロック統合QR（1枚）`:`全${s.groups.length}ブロック・${s.groups.length*24}単語を1枚のQRに統合`}\n${extended?'拡張バックアップ（サイト名・合言葉含む）':'設定のみ（シードフレーズ・マイレシピ設定）'}`;

   const dlBtn=document.createElement('button');

   dlBtn.type='button';dlBtn.className='btn btn-outline bv-no-print bq-btn-qr-single';

   dlBtn.style.cssText='margin-top:6px; padding:3px 8px; font-size:0.75rem;';

   dlBtn.textContent=`🖼️ シェア${s.index}のQRを保存 (PNG)`;

   dlBtn.addEventListener('click',()=>{

    const svg=figure.querySelector('svg');

    if(!svg)return;

    const filename=`cryptomatrix-share${s.index}-qr.png`;

    if(window.MatrixCardPreset&&window.MatrixCardPreset.saveSvgAsPng){

     window.MatrixCardPreset.saveSvgAsPng(svg,filename);

    }

    message('bq-status',`🖼️ シェア${s.index}のQRコード画像（${filename}）を保存しました。`);

   });

   caption.appendChild(dlBtn);

   figure.appendChild(caption);

   frag.appendChild(figure);

  }

 }else{

  const qrText=isArmored?armoredText:phraseText;

  const figure=document.createElement('figure'),caption=document.createElement('figcaption');

  appendQrOrNotice(figure,qrText);

  const modeLabel=isArmored?'PGPアーマード':'BIP39';

  caption.textContent=`${modeLabel} 暗号化バックアップ（全${total}ブロック${isArmored?'統合QR 1枚':`・${total*24}単語を1枚のQRに統合`}）\n保護方式：${factorLabel} / ${extended?'拡張バックアップ（サイト名・合言葉含む）':'設定のみ（シードフレーズ・マイレシピ設定）'}`;

  const dlBtn=document.createElement('button');

  dlBtn.type='button';dlBtn.className='btn btn-outline bv-no-print bq-btn-qr-single';

  dlBtn.style.cssText='margin-top:6px; padding:3px 8px; font-size:0.75rem;';

  dlBtn.textContent='🖼️ このQRを保存 (PNG)';

  dlBtn.addEventListener('click',()=>{

   const svg=figure.querySelector('svg');

   if(!svg)return;

   const filename='cryptomatrix-encrypted-qr.png';

   if(window.MatrixCardPreset&&window.MatrixCardPreset.saveSvgAsPng){

    window.MatrixCardPreset.saveSvgAsPng(svg,filename);

   }

   message('bq-status',`🖼️ 暗号化QRコード画像（${filename}）を保存しました。`);

  });

  caption.appendChild(dlBtn);

  figure.appendChild(caption);

  frag.appendChild(figure);

 }

 $('bq-qr-list').replaceChildren(frag);



 const qrCount=(shares&&shares.length>1)?shares.length:1;

 if($('bq-save-qr')){

  $('bq-save-qr').textContent=qrCount>1?`🖼️ 全てのQRを一括保存 (PNG) (${qrCount}枚)`:'🖼️ QR画像保存 (PNG)';

 }



 const shamirDesc=shamirN>1

  ?`秘密分散：${shamirM}-of-${shamirN}（全${shamirN}シェア・QR ${shamirN}枚／任意の${shamirM}枚で復元、各シェア${shares[0].groups.length}ブロック統合）。`

  :`全${total}ブロック（${isArmored?'PGPアーマード統合QR 1枚':`${total*24}単語・QR 1枚に統合`}）。`;

 const protDesc=`保護方式：${factorLabel}。`;

 $('bq-print-summary').textContent=`${isArmored?'PGPアーマード':'BIP39'}復元用QR：${shamirDesc}${extended?'拡張バックアップ（シードフレーズ・マイレシピ設定・サイト名・合言葉）':'設定のみ（シードフレーズ・マイレシピ設定）'}。${encrypted?`暗号化方式：${MatrixCardPreset.kdfLabel?MatrixCardPreset.kdfLabel(kdfProfile):'CME2'}。`:''}${protDesc}${usePass?'復元用パスワードは別保管し、印刷しないでください。':''}`;

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





let activeDuressContext = null;

let activeDuressCallback = null;

let activeDuressCancelCallback = null;



function showDuressModal(context, realPassword, onConfirm, onCancel){

 if (activeDuressCallback || activeDuressCancelCallback) closeDuressModal();

 activeDuressContext = context;

 activeDuressCallback = onConfirm;

 activeDuressCancelCallback = onCancel || null;

 const modal = $('duress-modal');

 if(!modal) return onConfirm(null);



 if($('duress-modal-error')) $('duress-modal-error').style.display = 'none';

 if($('duress-choice-btns')) $('duress-choice-btns').hidden = false;

 if($('duress-modal-config')) $('duress-modal-config').hidden = true;

 if($('duress-sec3-fields')) $('duress-sec3-fields').hidden = (context !== 'sec3');

 if($('duress-sec4-fields')) $('duress-sec4-fields').hidden = (context !== 'sec4');



 modal.dataset.realPassword = realPassword || '';

 modal.hidden = false;

}



function closeDuressModal(){

 const modal = $('duress-modal');

 if(modal){

  modal.hidden = true;

  delete modal.dataset.realPassword;

 }

 for(const id of ['duress-modal-pw','duress-modal-pw-conf','duress-vault-pw','duress-vault-pw-conf']){

  const el = $(id);

  if(el) el.value = '';

 }

 if(activeDuressCancelCallback){

  try{ activeDuressCancelCallback(); }catch(_){}

  activeDuressCancelCallback = null;

 }

 activeDuressCallback = null;

 activeDuressContext = null;

}



async function createBackup(){

 clearArtifact();const token=createToken;



 const kdfProfile=Number($('bq-kdf')?.value??1);

 const {usePass,useKeyfile,usePasskey,shamirM,shamirN}=getProtectionConfig();

 if(!usePass&&!useKeyfile&&!usePasskey&&shamirN<=1){

  message('bq-status','保護方法（パスワード、キーファイル、パスキー、または2分割以上の秘密分散）を少なくとも1つ選択してください。',true);

  return;

 }

 try{

  api();

  const extended=$('bq-scope').value==='extended';

  let password='';

  if(usePass){

   password=$('bq-password').value;

   if(Array.from(password).length<12||password!==$('bq-password-confirm').value){

    throw Error('復元用パスワードを12文字以上で入力し、再入力欄と一致させてください。');

   }

  }

  let keyfileBytes=null;

  if(useKeyfile){

   keyfileBytes=await getCreationKeyfileBytes();

   if(!keyfileBytes||!keyfileBytes.length)throw Error('キーファイルを選択するか、「専用キーファイル(.key)を新規作成・保存」を押してください。');

  }



  const doExecute = async (duressOpts) => {

   const isEncrypted=(usePass||useKeyfile||usePasskey);

   const kdfName=MatrixCardPreset.kdfLabel?MatrixCardPreset.kdfLabel(kdfProfile):'PBKDF2-HMAC-SHA512';

   message('bq-status',isEncrypted

    ?`暗号化バックアップ（PGPアーマード ＆ 統合QR）を作成しています…（${kdfName}）`

    :`秘密分散バックアップ（PGPアーマード ＆ 統合QR）を作成しています…`);

   try{

    const signature=settingsSignature();

    const res=await MatrixCardPreset.createEncryptedBip39Backup(extended,password,kdfProfile,{usePassword:usePass,useKeyfile,usePasskey,keyfileBytes,shamirM,shamirN,duress:duressOpts});

  if(token!==createToken||signature!==settingsSignature())return;

  const {groups,shares,combo}=res;

  const total=groups.length;

  const isMulti=total>1||(shares&&shares.length>1);

  const texts=[];

  let phraseText='',armoredText='',armoredShares=[];



  const factorsDesc=[];

  if(usePass)factorsDesc.push('復元用パスワード');

  if(useKeyfile)factorsDesc.push('キーファイル');

  if(usePasskey)factorsDesc.push('パスキー');

  const factorLabel=factorsDesc.length?factorsDesc.join(' ＋ '):'暗号化なし（秘密分散のみ）';



  let rawBytes=null,rawShareBytes=[];

  if(shares&&shares.length>1){

   phraseText=shares.map(s=>s.groups.map(g=>g.join(' ')).join('\n')).join('\n\n');

   armoredShares=shares.map(s=>{

    const sBytes=MatrixCardPreset.concat(...s.blocks);

    rawShareBytes.push({index:s.index,n:s.n,m:s.m,bytes:s.bytes||sBytes});

    return armorVault(sBytes,`SHAMIR SHARE ${s.index}/${s.n}`,'BACKUP');

   });

   armoredText=armoredShares.join('\n\n');

   for(const s of shares){

    const shareWords=s.groups.map(g=>g.join(' ')).join('\n');

    texts.push(shareWords);

   }

  }else{

   phraseText=groups.map(g=>g.join(' ')).join('\n');

   const allBlocksBytes=MatrixCardPreset.concat(...res.blocks);

   rawBytes=allBlocksBytes;

   armoredText=armorVault(allBlocksBytes,'BACKUP','');

   texts.push(phraseText);

  }



  renderEncryptedWords(groups,shares,armoredText,phraseText,isMulti);

  // 作成と同時に自動復元テスト（セルフ検証）を実行
  let autoVerifyPassed=false,autoVerifyMsg="";
  try{
   if(!usePasskey){
    const testWords=[];
    if(shares&&shares.length>1){
     for(let i=0;i<shamirM;i++){
      for(const g of shares[i].groups)testWords.push(...g);
     }
    }else{
     for(const g of groups)testWords.push(...g);
    }
    const decRes=await MatrixCardPreset.decodeBip39Blocks(testWords,password,true,{keyfileBytes});
    validateConfig(decRes.cfg);
    autoVerifyPassed=true;
   }else{
    autoVerifyPassed=!!(res && (res.groups?.length || res.blocks?.length));
   }
  }catch(vErr){
   console.warn("Auto restore verification notice:", vErr);
   autoVerifyMsg=vErr.message;
  }
  const activeFormat=isMulti?'armored':'words';

  // Passwords are intentionally not retained in the result object. KeeWeb export

  // asks for it again only at the moment the user explicitly transfers an entry.

  artifact={activeFormat,armoredText,phraseText,armoredShares,isMulti,total,signature,encrypted:isEncrypted,extended,texts,groups,shares,kdfProfile:isEncrypted?kdfProfile:null,shamirM,shamirN,combo,usePass,useKeyfile,usePasskey,factorLabel,rawBytes,rawShareBytes,autoVerifyPassed,autoVerifyMsg,createdPassword:password};

  $('backup-qr').dataset.ready='true';

  $('bq-copy').disabled=false;$('bq-print').disabled=false;

  if(usePass){$('bq-password').value='';$('bq-password-confirm').value='';}

  updateSec3Display(activeFormat,true);

   }catch(e){if(token===createToken)message('bq-status',e.message,true);}

  };



  const skipDuress = (localStorage.getItem('cm_skip_duress_popup') === 'true') || window.__SKIP_DURESS_MODAL__;

  if(skipDuress || !usePass){

   await doExecute(null);

  } else {

   showDuressModal('sec3', password, (duressOpts) => {

    void doExecute(duressOpts);

   });

  }

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

 if(!decoded.includeCardSeed)throw Error('バックアップにシードフレーズが含まれていません。');

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

  if(/-----BEGIN CRYPTOMATRIX VAULT\b/i.test(text)){

   document.dispatchEvent(new CustomEvent('cm-route-vault-text',{detail:{text}}));

   message('bq-scan-status','保管庫（セクション4）のデータを検出したため、復号欄へ自動的に移動しました。');

   return;

  }

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

  }else if(text.includes('-----BEGIN CRYPTOMATRIX')){

   const chunks=dearmorVault(text);

   if(!chunks.length)throw Error('暗号化アーマードテキストの解析に失敗しました。');

   const words=[];

   for(const chunk of chunks){

    if(chunk.length%32!==0)throw Error('ブロック長が不正です（32バイト単位ではありません）。');

    for(let off=0;off<chunk.length;off+=32){

     const phrase=await MatrixCardPreset.entropyToBip39Words(chunk.subarray(off,off+32));

     words.push(...(Array.isArray(phrase)?phrase:phrase.split(' ')));

    }

   }

   d=await MatrixCardPreset.decodeBip39Blocks(words,password,true,keyfileBytes?{keyfileBytes}:null);

   validateConfig(d.cfg);

  }else{

   const words=text.toLowerCase().split(/\s+/).filter(Boolean);

   if(words.length<24||words.length%24!==0||words.length>512*24){

    throw Error('BIP39の24単語単位（24単語、または24単語×必要ブロック数）またはPGPアーマード形式で入力してください。');

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

  const protLine=d.combo!==undefined&&d.combo!==null?`保護方式：${comboLabel(d.combo)}（検証済み）`:d.twoFaMode?`二段階認証：${twoFaLabel(d.twoFaMode)}（検証済み）`:'';

  $('bq-preview').textContent=[

   `検証済み：${d.full?'拡張バックアップ（シードフレーズ・マイレシピ設定・サイト名・合言葉）':'設定のみ（シードフレーズ・マイレシピ設定）'} ／ ${encDesc}`,

   `入力ブロック数：${d.blockCount||1}ブロック（${(d.blockCount||1)*24}単語） ／ ${shamirLine}`,

   ...(protLine?[protLine]:[]),

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

 const d=pending.decoded;

 const needPass=(d.combo===undefined||d.combo===0||d.combo===1||d.combo===2||d.combo===3);

 if(pending.input!==$('bq-import').value.trim()||(needPass&&pending.password!==$('bq-restore-password').value)){

  clearPending();message('bq-scan-status','入力が変更されました。もう一度「読み込み・検証して内容を確認」を押してください。',true);return;

 }

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

  const pk2WarnNote=d.isLegacyPK2Migrated?'\n\n⚠️【データ救出完了】以前のパスキー保護形式から復元されました。安全のため、速やかにセクション3にて最新のバックアップ（パスキーまたはパスワード保護）を再作成してください。':'';

  message('bq-scan-status',(d.full

   ?`✅ 復元完了（${d.encrypted?'暗号化復号済み':'暗号化なし'}${shamirNote}）。サイト名・合言葉・カード・マイレシピ設定を復元し、生成パスワードが保存時と完全一致することも確認しました。`

   :`✅ 復元完了（${d.encrypted?'暗号化復号済み':'暗号化なし'}${shamirNote}）。カードとマイレシピ設定を復元しました。サイト名・合言葉は生成時と同じものを入力してください。`)+pk2WarnNote);

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

  const allowCdn=($('bv-cdn')?.checked ?? $('bq-cdn')?.checked ?? true);

  if(!decoderPromise)decoderPromise=script('vendor/jsQR.js').catch(async()=>{if(!allowCdn)throw Error('お使いのブラウザでQRコードを読み取るには、「標準カメラ読取非対応のブラウザ（iPhone等）ではQR読取補助ライブラリを使用して読み取る」にチェックを入れてください。');await script('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');}).catch(e=>{decoderPromise=null;throw e;});

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



 // 2. PGP Armored CRYPTOMATRIX QR Code

 if(trimmed.includes('-----BEGIN CRYPTOMATRIX')){

  if(/-----BEGIN CRYPTOMATRIX VAULT\b/i.test(trimmed)){

   document.dispatchEvent(new CustomEvent('cm-route-vault-text',{detail:{text:trimmed}}));

   message('bq-scan-status','保管庫（セクション4）のデータを検出したため、復号欄へ自動的に移動しました。');

   return true;

  }

  if(trimmed.includes('SHAMIR SHARE')&&$('bq-import').value.includes('-----BEGIN CRYPTOMATRIX')){

   $('bq-import').value=$('bq-import').value.trim()+'\n\n'+trimmed;

   clearPending();stopCamera();

   message('bq-scan-status','PGPアーマード形式のシェアQRを追加読み取りしました。続けて他のシェアQRを読み取るか、「読み込み・検証して内容を確認」を押してください。');

  }else{

   parts=null;$('bq-import').value=trimmed;clearPending();stopCamera();

   message('bq-scan-status','PGPアーマード形式のQRを読み取りました。必要なら復元用パスワードを入力し、「読み込み・検証して内容を確認」を押してください。');

  }

  return true;

 }



 // 3. Unified BIP39 24-word (or multi-block 24-word x N, including Shamir M-of-N shares) QR Code

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

  if(file.size>25*1024*1024)throw Error('ファイルサイズは25MB以内にしてください。');

  if(file.name.toLowerCase().endsWith('.cmenc')){

   const bytes=new Uint8Array(await file.arrayBuffer());

   const armored=armorVault(bytes,'BACKUP','');

   await ingest(armored);

   return;

  }

  if(file.name.toLowerCase().endsWith('.txt')){

   const txt=await file.text();

   await ingest(txt.trim());

   return;

  }

  const decode=await getDecoder();const image=await createImageBitmap(file);

  try{

   const scale=Math.min(1,1800/Math.max(image.width,image.height)),canvas=document.createElement('canvas');

   canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));

   canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);

   const texts=await decode(canvas);

   if(!texts.length)throw Error('QRが見つかりません。1枚のQRを大きく明るく写し、再度選択してください。');

   for(const text of texts)await ingest(text);

  }finally{image.close();}

 }catch(e){message('bq-scan-status',e.message,true);}

}



async function readImages(files){

 const list=Array.from(files||[]);

 if(!list.length)return;

 stopCamera();

 try{

  for(const file of list)await readImage(file);

  if(list.length>1)message('bq-scan-status','複数ファイルを読み込みました。必要なシェアが揃ったら「読み込み・検証して内容を確認」を押してください。');

 }finally{if($('bq-image'))$('bq-image').value='';}

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

  el.textContent=`文字種・長さ目安：十分な長さ（${ent.length}文字・文字種基準上限約 ${ent.bits} bits※ランダム非辞書語前提）${matchMsg}`;

  el.style.color='#065f46';

 }

}



const SELECT_DESCRIPTIONS = {

 'backup-kind': {

  'settings': 'ℹ️ シードフレーズとマイレシピ設定のみを保存します（サイト名・合言葉は別途手動入力が必要）。',

  'full': 'ℹ️ シードフレーズ・マイレシピ設定・サイト名・合言葉をすべて保存し、復元時に即座に完全復元されます。'

 },

 'bq-scope': {

  'extended': 'ℹ️ シードフレーズ・マイレシピ設定・サイト名・合言葉をすべて保存し、復元時に即座に完全復元されます。',

  'basic': 'ℹ️ シードフレーズとマイレシピ設定のみを保存します（サイト名・合言葉は別途手動入力が必要）。'

 },

 'bq-shamir': {

  '1-1': 'ℹ️ 秘密分散を行わず、1枚のQRコードにすべてを収めます。',

  '2-3': 'ℹ️ 全3シェア（QR 3枚）に暗号分割。任意の2枚で復元可能・1枚流出しても数学的に解読不能。',

  '2-2': 'ℹ️ 全2シェア（QR 2枚）に暗号分割。2枚両方が揃うと復元可能。',

  '3-5': 'ℹ️ 全5シェア（QR 5枚）に暗号分割。任意の3枚で復元可能・2枚以下の流出では解読不能。'

 },

 'bq-kdf': {

  '3': '🛡️ RFC 9106準拠 Argon2id（メモリ64MB / KeePass・Bitwarden等で広く標準採用） ＋ 二重カスケード暗号（AES-256-GCM ＋ ChaCha20-Poly1305） ＋ Key-Committing HMAC（処理時間：約0.4秒）。メモリハード性によりGPU・ASIC並列解析を強力に抑制。',

  '4': '🛡️ Argon2id（メモリ128MB / 3反復 / PC推奨・高強度） ＋ 二重カスケード暗号 ＋ Key-Committing HMAC（処理時間：PC約0.8秒）。耐GPU並列解析をさらに強化。【⚠️モバイル注意】スマートフォンのメモリ制限により復元時に高負荷またはクラッシュする場合があります。',

  '5': '🛡️ Argon2id（メモリ256MB / 4反復 / PC限定・超高強度） ＋ 二重カスケード暗号 ＋ Key-Committing HMAC（処理時間：PC約1.8秒）。極限の耐総当たり強度。【🚫スマホ復元困難】大容量メモリを要求するため、スマートフォンのブラウザではメモリ不足により復元が極めて困難または不可能です。PC専用バックアップとして運用してください。',

  '1': '🛡️ PBKDF2-HMAC-SHA512 2,100,000回 ＋ HKDF-SHA512 ＋ 二重カスケード暗号（AES-256-GCM ＋ ChaCha20-Poly1305） ＋ Key-Committing HMAC（処理時間：約2秒）。Web Crypto標準に準拠した推奨設定。',

  '2': '🛡️ PBKDF2-HMAC-SHA512 5,000,000回 ＋ HKDF-SHA512 ＋ 二重カスケード暗号（AES-256-GCM ＋ ChaCha20-Poly1305） ＋ Key-Committing HMAC（処理時間：約4〜5秒）。超高回数ストレッチングによる耐GPU高強度設定。',

  '0': '🛡️ PBKDF2-HMAC-SHA512 600,000回 ＋ HKDF-SHA512 ＋ 二重カスケード暗号（AES-256-GCM ＋ ChaCha20-Poly1305） ＋ Key-Committing HMAC（処理時間：約0.6秒）。高速処理用の標準設定。'

 },

 'bv-shamir': {

  '1-1': 'ℹ️ 秘密分散を行わず、1個の暗号化データとして保存・出力します。',

  '2-3': 'ℹ️ 全3シェアに暗号分割。任意の2シェアで復元可能・1シェア流出しても数学的に解読不能。',

  '2-2': 'ℹ️ 全2シェアに暗号分割。2シェア両方が揃うと復元可能。',

  '3-5': 'ℹ️ 全5シェアに暗号分割。任意の3シェアで復元可能・2シェア以下の流出では解読不能。'

 },

 'bv-kdf': {

   '3': '🛡️ RFC 9106準拠 Argon2id（メモリ64MB / 3反復 / PC・スマホ両用推奨） ＋ 二重カスケード暗号（AES-256-GCM ＋ ChaCha20-Poly1305） ＋ Key-Committing HMAC（処理時間：PC約0.4秒 / スマホ約1秒）。モバイル端末でも安全に復元可能。メモリハード性によりGPU・ASIC並列解析を強力に抑制。',

   '4': '🛡️ Argon2id（メモリ128MB / 3反復 / PC推奨・高強度） ＋ 二重カスケード暗号 ＋ Key-Committing HMAC（処理時間：PC約0.8秒）。耐GPU並列解析をさらに強化。【⚠️モバイル注意】スマートフォンのメモリ制限により復元時に高負荷またはクラッシュする場合があります。',

   '5': '🛡️ Argon2id（メモリ256MB / 4反復 / PC限定・超高強度） ＋ 二重カスケード暗号 ＋ Key-Committing HMAC（処理時間：PC約1.8秒）。極限の耐総当たり強度。【🚫スマホ復元困難】大容量メモリを要求するため、スマートフォンのブラウザではメモリ不足により復元が極めて困難または不可能です。PC専用バックアップとして運用してください。',

   '1': '🛡️ PBKDF2-HMAC-SHA512 2,100,000回 ＋ HKDF-SHA512 ＋ 二重カスケード暗号（AES-256-GCM ＋ ChaCha20-Poly1305） ＋ Key-Committing HMAC（処理時間：約2秒）。Web Crypto標準に準拠した推奨設定。',

   '2': '🛡️ PBKDF2-HMAC-SHA512 5,000,000回 ＋ HKDF-SHA512 ＋ 二重カスケード暗号（AES-256-GCM ＋ ChaCha20-Poly1305） ＋ Key-Committing HMAC（処理時間：約4〜5秒）。超高回数ストレッチングによる耐GPU高強度設定。',

   '0': '🛡️ PBKDF2-HMAC-SHA512 600,000回 ＋ HKDF-SHA512 ＋ 二重カスケード暗号（AES-256-GCM ＋ ChaCha20-Poly1305） ＋ Key-Committing HMAC（処理時間：約0.6秒）。高速処理用の標準設定。'

  }

};



function updateSelectDescriptions(){

 for(const [selectId, descs] of Object.entries(SELECT_DESCRIPTIONS)){

  const sel=$(selectId), descEl=$(selectId+'-desc');

  if(sel&&descEl){

   const val=sel.value;

   descEl.textContent=descs[val]||'';

  }

 }

 // Check KDF warning banners for Argon2id 128MB / 256MB

 for(const prefix of ['bq','bv']){

  const kdfSel=$(prefix+'-kdf'), warnEl=$(prefix+'-kdf-warning');

  if(kdfSel&&warnEl){

   const v=kdfSel.value;

   if(v==='5'){

    warnEl.style.display='block';

    warnEl.style.background='#fef2f2';

    warnEl.style.color='#991b1b';

    warnEl.style.border='1.5px solid #f87171';

    warnEl.innerHTML='🚫 <strong>【PC限定運用・スマホ復元困難】</strong> メモリ256MB / 4反復設定は極めて強固ですが、スマートフォンのブラウザ（特にiPhone Safari等）ではタブのメモリ制限により復元時にメモリ不足でクラッシュ・失敗します。<strong>PC専用バックアップとして運用し、復元もPCで行う場合のみ選択してください。</strong>';

   }else if(v==='4'){

    warnEl.style.display='block';

    warnEl.style.background='#fffbeb';

    warnEl.style.color='#92400e';

    warnEl.style.border='1.5px solid #fcd34d';

    warnEl.innerHTML='⚠️ <strong>【PC推奨・スマホ高負荷注意】</strong> メモリ128MB / 3反復設定は高強度ですが、スマートフォン端末での復元時に端末スペックによって動作が非常に重くなるか、メモリ不足エラーになる場合があります。';

   }else{

    warnEl.style.display='none';

    warnEl.innerHTML='';

   }

  }

 }

}



function syncProtectionUI(){

 updateSelectDescriptions();

 const {usePass,useKeyfile,usePasskey,shamirM,shamirN}=getProtectionConfig();

 if($('bq-password-row'))$('bq-password-row').hidden=!usePass;

 if($('bq-keyfile-row'))$('bq-keyfile-row').hidden=!useKeyfile;

 if($('bq-passkey-row'))$('bq-passkey-row').hidden=!usePasskey;

 if($('bq-kdf-row'))$('bq-kdf-row').hidden=!(usePass||useKeyfile||usePasskey);



 const badge=$('bq-protection-badge');

 if(badge){

  const factors=[];

  if(usePass)factors.push('復元用パスワード');

  if(useKeyfile)factors.push('キーファイル');

  if(usePasskey)factors.push('パスキー認証');



  let factorText='';

  if(factors.length===0){

   if(shamirN>1){

    factorText='暗号化なし（秘密分散のみ）';

    badge.style.background='#fef3c7';

    badge.style.color='#92400e';

    badge.style.borderColor='#fcd34d';

   }else{

    factorText='⚠️ 保護方式が選択されていません（いずれか1つ以上を選択してください）';

    badge.style.background='#fee2e2';

    badge.style.color='#991b1b';

    badge.style.borderColor='#fca5a5';

   }

  }else{

   factorText=factors.join(' ＋ ')+(factors.length>1?'（多要素保護）':'（単独保護）');

   badge.style.background='#dcfce7';

   badge.style.color='#065f46';

   badge.style.borderColor='#86efac';

  }

  const shamirText=shamirN>1?` ＋ 秘密分散（${shamirM}-of-${shamirN}）`:'';

  badge.textContent=`現在の保護方式：${factorText}${shamirText}`;

 }

}



async function generateAndDownloadKeyfile(){

 const seedNum=window.MatrixCardPreset?.getValidSeedOrPrompt?window.MatrixCardPreset.getValidSeedOrPrompt('bq-status'):(parseSeedValue?parseSeedValue($('input-seed-number')?.value):0);

 if(seedNum===null)return;

 const usePass=$('bq-opt-password')?.checked;

 let pw='';

 if(usePass){

  const candidatePw=$('bq-password')?.value||'';

  if(Array.from(candidatePw).length>=12)pw=candidatePw;

 }

 const usePasskey=$('bq-opt-passkey')?.checked;

 if(window.__SKIP_KEYFILE_MODAL__ || !window.MatrixCardPreset?.showKeyfileModal){

  try{

   const filename=`cryptomatrix-card-${seedNum}.key`;

   const res=await window.MatrixCardPreset.exportKeePassXmlKeyfile({

    seedNum,

    password:pw,

    filename

   });

   generatedKeyfileBytes=enc.encode(res.keyData.xml);

   generatedKeyfileName=res.filename;

   if($('bq-keyfile-status'))$('bq-keyfile-status').textContent=`✅ カード（シード: ${seedNum}）からKeePass正規キーファイル（${generatedKeyfileName}）を作成・セットしました（ダウンロード済み）。復元時に必要です。`;

   message('bq-status',`✅ カード（シード: ${seedNum}）${pw?'＋復元用パスワード':''} からKeePass正規キーファイル（${generatedKeyfileName}）を作成・セットしました。`);

  }catch(e){

   message('bq-status','キーファイルの生成に失敗しました: '+e.message,true);

  }

  return;

 }



 window.MatrixCardPreset.showKeyfileModal({seedNum,defaultPassword:pw,defaultPasskey:usePasskey,context:'sec3'},async(opts)=>{

  try{

   const filename=`cryptomatrix-card-${opts.seedNum}.key`;

   const res=await window.MatrixCardPreset.exportKeePassXmlKeyfile({

    seedNum:opts.seedNum,

    password:opts.password,

    passkeyFactor:opts.passkeyFactor,

    passkeyCred:opts.passkeyCred,

    filename

   });

   generatedKeyfileBytes=enc.encode(res.keyData.xml);

   generatedKeyfileName=res.filename;

   if($('bq-keyfile-status'))$('bq-keyfile-status').textContent=`✅ カード（シード: ${opts.seedNum}）からKeePass正規キーファイル（${generatedKeyfileName}）を作成・セットしました（ダウンロード済み）。復元時に必要です。`;

   message('bq-status',`🔑 カード（シード: ${opts.seedNum}）${opts.factorSummary||''} からKeePass正規キーファイル（${generatedKeyfileName}）を作成・セットしました。`);

  }catch(e){

   message('bq-status','キーファイルの生成に失敗しました: '+e.message,true);

  }

 });

}



function initHelpTooltips(){

 let popover=$('help-popover');

 if(!popover){

  popover=document.createElement('div');

  popover.id='help-popover';

  popover.className='help-popover';

  popover.innerHTML=

   `<div class="help-popover-header">`+

   `<span class="help-popover-title">💡 解説</span>`+

   `<button type="button" class="help-popover-close" aria-label="閉じる">✕</button>`+

   `</div>`+

   `<div class="help-popover-body" id="help-popover-body"></div>`;

  document.body.appendChild(popover);

 }

 const bodyEl=$('help-popover-body');

 let activeBtn=null,hideTimer=null;



 function show(btn){

  clearTimeout(hideTimer);

  const text=btn.dataset.help;

  if(!text)return;

  if(activeBtn&&activeBtn!==btn)activeBtn.classList.remove('active');

  activeBtn=btn;

  btn.classList.add('active');

  if(bodyEl)bodyEl.textContent=text;

  popover.classList.add('visible');



  const rect=btn.getBoundingClientRect();

  const popWidth=Math.min(320,window.innerWidth-28);

  popover.style.maxWidth=popWidth+'px';

  const popHeight=popover.offsetHeight||100;

  let left=rect.left+window.scrollX+(rect.width/2)-(popWidth/2);

  left=Math.max(14,Math.min(left,window.innerWidth-popWidth-14));

  let top=rect.bottom+window.scrollY+8;

  if(rect.bottom+popHeight+16>window.innerHeight&&rect.top-popHeight-16>0){

   top=rect.top+window.scrollY-popHeight-8;

  }

  popover.style.left=Math.round(left)+'px';

  popover.style.top=Math.round(top)+'px';

 }



 function hide(){

  clearTimeout(hideTimer);

  popover.classList.remove('visible');

  if(activeBtn){

   activeBtn.classList.remove('active');

   activeBtn=null;

  }

 }



 function scheduleHide(){

  clearTimeout(hideTimer);

  hideTimer=setTimeout(hide,200);

 }



 document.addEventListener('mouseover',e=>{

  const btn=e.target.closest?.('.help-btn');

  if(btn){show(btn);return;}

  if(e.target.closest?.('.help-popover'))clearTimeout(hideTimer);

 });



 document.addEventListener('mouseout',e=>{

  const btn=e.target.closest?.('.help-btn');

  if(btn){scheduleHide();return;}

  if(e.target.closest?.('.help-popover'))scheduleHide();

 });



 document.addEventListener('click',e=>{

  const btn=e.target.closest?.('.help-btn');

  if(btn){

   e.preventDefault();

   e.stopPropagation();

   if(activeBtn===btn&&popover.classList.contains('visible')){

    hide();

   }else{

    show(btn);

   }

   return;

  }

  if(e.target.closest?.('.help-popover-close')){

   e.preventDefault();

   hide();

   return;

  }

  if(!e.target.closest?.('.help-popover'))hide();

 });



 window.addEventListener('scroll',()=>{if(popover.classList.contains('visible'))hide();},{passive:true});

 document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});

}



/* ===================================================================

 * Section 4: Bonus Vault (Universal Text / Password / File Encryption & Shamir Sharing)

 * =================================================================== */

function initBonusVault(){

 const root=$('bonus-vault');

 if(!root)return;

 let bvOpToken = 0;



 let vaultKeyfileBytes=null,vaultKeyfileName='';



 function bvMessage(id,text,error=false){

  const el=$(id);if(!el)return;

  el.textContent=text;el.className='status-msg'+(text?(error?' err':' ok'):'');

 }



 function downloadBlob(blob,filename){

  const url=URL.createObjectURL(blob);

  const a=document.createElement('a');

  a.href=url;a.download=filename;

  document.body.appendChild(a);a.click();a.remove();

  setTimeout(()=>URL.revokeObjectURL(url),5000);

 }



 function packCMV1(type,name,payload){

  const isFile=type==='file';

  const nameBytes=enc.encode(name||'');

  const salt=crypto.getRandomValues(new Uint8Array(32));

  const data=payload instanceof Uint8Array?payload:new Uint8Array(0);

  const now=BigInt(Date.now());

  const headerLen=4+1+1+32+8+2+nameBytes.length+4;

  const out=new Uint8Array(headerLen+data.length);

  const dv=new DataView(out.buffer);



  out[0]=0x43;out[1]=0x4d;out[2]=0x56;out[3]=0x31;

  out[4]=isFile?1:0;

  out[5]=0;

  out.set(salt,6);

  dv.setBigUint64(38,now,false);

  dv.setUint16(46,nameBytes.length,false);

  out.set(nameBytes,48);

  const pOffset=48+nameBytes.length;

  dv.setUint32(pOffset,data.length,false);

  out.set(data,pOffset+4);

  return out;

 }



 function unpackCMV1(bytes){

  if(bytes.length<52)throw new Error('データ形式が不正です（サイズ不足）。');

  if(bytes[0]!==0x43||bytes[1]!==0x4d||bytes[2]!==0x56||bytes[3]!==0x31){

   throw new Error('暗号化データまたは秘密分散のデータヘッダが一致しません。');

  }

  const isFile=bytes[4]===1;

  const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);

  const nameLen=dv.getUint16(46,false);

  if(bytes.length<48+nameLen+4)throw new Error('データヘッダが破損しています。');

  const name=new TextDecoder().decode(bytes.subarray(48,48+nameLen));

  const pOffset=48+nameLen;

  const payloadLen=dv.getUint32(pOffset,false);

  if(bytes.length!==pOffset+4+payloadLen)throw new Error('データコンテンツの長さが不正か、欠落・破損しています。');

  const payload=bytes.slice(pOffset+4,pOffset+4+payloadLen);

  return{type:isFile?'file':'text',name,payload};

 }



 const tabEncrypt=$('bv-tab-btn-encrypt');

 const tabDecrypt=$('bv-tab-btn-decrypt');

 const panelEncrypt=$('bv-panel-encrypt');

 const panelDecrypt=$('bv-panel-decrypt');



 function renderVaultQrHtml(text,caption){

  if(text.length>2200){

   return `<div class="bv-no-print" style="font-size:0.74rem;color:#92400e;background:#fffbeb;border:1px solid #fef3c7;border-radius:4px;padding:6px;max-width:260px;">⚠️ データ長（${(text.length/1024).toFixed(1)} KB）がQR上限（約2.2KB）を超えるためQRコードは省略されました。暗号化ファイル保存またはテキストをご利用ください。</div>`;

  }

  try{

   const svg=qrSVG(text);

   return `<figure class="bv-qr-figure" style="margin:0;text-align:center;background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;padding:6px;display:inline-block;flex-shrink:0;">${svg.outerHTML}<figcaption style="font-size:0.72rem;color:#475569;margin-top:2px;">${caption}</figcaption></figure>`;

  }catch(_){

   return `<div class="bv-no-print" style="font-size:0.74rem;color:#92400e;background:#fffbeb;border:1px solid #fef3c7;border-radius:4px;padding:6px;max-width:260px;">⚠️ QRコードの生成をスキップしました。</div>`;

  }

 }



 function setTab(mode){

  if(typeof bvStopCamera==='function')bvStopCamera();

  if(mode==='encrypt'){

   tabEncrypt.className='btn';tabDecrypt.className='btn btn-outline';

   panelEncrypt.hidden=false;panelDecrypt.hidden=true;

  }else{

   tabEncrypt.className='btn btn-outline';tabDecrypt.className='btn';

   panelEncrypt.hidden=true;panelDecrypt.hidden=false;

  }

 }

 tabEncrypt?.addEventListener('click',()=>setTab('encrypt'));

 tabDecrypt?.addEventListener('click',()=>setTab('decrypt'));



 $('bv-type-text')?.addEventListener('change',()=>{

  $('bv-input-text-area').hidden=false;

  $('bv-input-file-area').hidden=true;

 });

 $('bv-type-file')?.addEventListener('change',()=>{

  $('bv-input-text-area').hidden=true;

  $('bv-input-file-area').hidden=false;

 });



 $('bv-file-input')?.addEventListener('change',()=>{

  const f=$('bv-file-input')?.files?.[0];

  if(f&&$('bv-file-info')){

   $('bv-file-info').textContent=`✅ 選択中: ${f.name} (${(f.size/1024).toFixed(1)} KB) — ブラウザ内だけで暗号化されます。`;

  }

 });



 function syncVaultProtectionUI(){

 updateSelectDescriptions();

  const usePass=$('bv-opt-password')?.checked??true;

  const useKeyfile=$('bv-opt-keyfile')?.checked??false;

  const usePasskey=$('bv-opt-passkey')?.checked??false;

  const shamirVal=($('bv-shamir')?.value||'1-1').split('-').map(Number);

  const shamirM=shamirVal[0]||1,shamirN=shamirVal[1]||1;



  if($('bv-password-row'))$('bv-password-row').hidden=!usePass;

  if($('bv-keyfile-row'))$('bv-keyfile-row').hidden=!useKeyfile;

  if($('bv-passkey-row'))$('bv-passkey-row').hidden=!usePasskey;

  if($('bv-kdf-row'))$('bv-kdf-row').hidden=!(usePass||useKeyfile||usePasskey);



  const badge=$('bv-protection-badge');

  if(badge){

   const factors=[];

   if(usePass)factors.push('復元用パスワード');

   if(useKeyfile)factors.push('キーファイル');

   if(usePasskey)factors.push('パスキー認証');



   let factorText='';

   if(factors.length===0){

    if(shamirN>1){

     factorText='暗号化なし（秘密分散のみ）';

     badge.style.background='#fef3c7';badge.style.color='#92400e';badge.style.borderColor='#fcd34d';

    }else{

     factorText='⚠️ 保護方式が選択されていません';

     badge.style.background='#fee2e2';badge.style.color='#991b1b';badge.style.borderColor='#fca5a5';

    }

   }else{

    factorText=factors.join(' ＋ ')+(factors.length>1?'（多要素保護）':'（単独保護）');

    badge.style.background='#dcfce7';badge.style.color='#065f46';badge.style.borderColor='#86efac';

   }

   const shamirText=shamirN>1?` ＋ 秘密分散（${shamirM}-of-${shamirN}）`:'';

   badge.textContent=`現在の保護方式：${factorText}${shamirText}`;

  }

 }









 for(const id of ['bv-opt-password','bv-opt-keyfile','bv-opt-passkey','bv-shamir','bv-kdf']){

  $(id)?.addEventListener('change',syncVaultProtectionUI);

 }

 syncVaultProtectionUI();



 function updateVaultPassEntropy(){

  const el=$('bv-pw-entropy');if(!el)return;

  const pw=$('bv-password')?.value||'',pw2=$('bv-password-confirm')?.value||'';

  if(!pw){el.textContent='パスワード強度診断：未入力（12文字以上必須）';el.style.color='var(--text-sub)';return;}

  const ent=MatrixCardPreset.estimatePasswordEntropy?MatrixCardPreset.estimatePasswordEntropy(pw):{bits:0,length:Array.from(pw).length,unique:new Set(Array.from(pw)).size};

  const matchMsg=pw2?(pw===pw2?' ／ 再入力：一致 ✅':' ／ 再入力：不一致 ⚠️'):'';

  if(ent.length<12){

   el.textContent=`パスワード強度診断：文字数不足（現在 ${ent.length}文字 ／ 最低12文字必要）${matchMsg}`;

   el.style.color='#b91c1c';

  }else{

   el.textContent=`文字種・長さ目安：十分な長さ（${ent.length}文字・文字種基準上限約 ${ent.bits} bits※ランダム非辞書語前提）${matchMsg}`;

   el.style.color='#065f46';

  }

 }

 $('bv-password')?.addEventListener('input',updateVaultPassEntropy);

 $('bv-password-confirm')?.addEventListener('input',updateVaultPassEntropy);



 $('bv-gen-keyfile')?.addEventListener('click',async()=>{

  const seedNum=window.MatrixCardPreset?.getValidSeedOrPrompt?window.MatrixCardPreset.getValidSeedOrPrompt('bv-encrypt-status'):(parseSeedValue?parseSeedValue($('input-seed-number')?.value):0);

  if(seedNum===null)return;

  const usePass=$('bv-opt-password')?.checked;

  let pw='';

  if(usePass){

   const candidatePw=$('bv-password')?.value||'';

   if(Array.from(candidatePw).length>=12)pw=candidatePw;

  }

  const usePasskey=$('bv-opt-passkey')?.checked;

  if(window.__SKIP_KEYFILE_MODAL__ || !window.MatrixCardPreset?.showKeyfileModal){

   try{

    const filename=`vault-card-${seedNum}.key`;

    const res=await window.MatrixCardPreset.exportKeePassXmlKeyfile({

     seedNum,

     password:pw,

     filename

    });

    vaultKeyfileBytes=enc.encode(res.keyData.xml);

    vaultKeyfileName=res.filename;

    if($('bv-keyfile-status'))$('bv-keyfile-status').textContent=`✅ カード（シード: ${seedNum}）からKeePass正規キーファイル（${vaultKeyfileName}）を作成・ダウンロードしました。復号時に必要です。`;

    bvMessage('bv-encrypt-status',`✅ カード（シード: ${seedNum}）${pw?'＋復元用パスワード':''} からKeePass正規キーファイル（${vaultKeyfileName}）を作成しました。`);

   }catch(e){

    bvMessage('bv-encrypt-status','キーファイルの生成に失敗しました: '+e.message,true);

   }

   return;

  }



  window.MatrixCardPreset.showKeyfileModal({seedNum,defaultPassword:pw,defaultPasskey:usePasskey,context:'sec4'},async(opts)=>{

   try{

    const filename=`vault-card-${opts.seedNum}.key`;

    const res=await window.MatrixCardPreset.exportKeePassXmlKeyfile({

     seedNum:opts.seedNum,

     password:opts.password,

     passkeyFactor:opts.passkeyFactor,

     passkeyCred:opts.passkeyCred,

     filename

    });

    vaultKeyfileBytes=enc.encode(res.keyData.xml);

    vaultKeyfileName=res.filename;

    if($('bv-keyfile-status'))$('bv-keyfile-status').textContent=`✅ カード（シード: ${opts.seedNum}）からKeePass正規キーファイル（${vaultKeyfileName}）を作成・ダウンロードしました。`;

    bvMessage('bv-encrypt-status',`🔑 カード（シード: ${opts.seedNum}）${opts.factorSummary||''} からKeePass正規キーファイル（${vaultKeyfileName}）を作成しました。`);

   }catch(e){

    bvMessage('bv-encrypt-status','キーファイルの生成に失敗しました: '+e.message,true);

   }

  });

 });



 $('bv-keyfile')?.addEventListener('change',()=>{

  const f=$('bv-keyfile')?.files?.[0];

  if(f&&$('bv-keyfile-status'))$('bv-keyfile-status').textContent=`✅ キーファイル選択済み：${f.name}（${f.size} bytes）`;

 });



 async function getVaultKeyfileBytes(inputElId){

  const file=$(inputElId)?.files?.[0];

  if(file)return new Uint8Array(await file.arrayBuffer());

  if(inputElId==='bv-keyfile'&&vaultKeyfileBytes)return vaultKeyfileBytes;

  return null;

 }



 $('bv-btn-encrypt')?.addEventListener('click',async()=>{

  const myToken = ++bvOpToken;

  if (activeDuressContext === 'sec4') closeDuressModal();

  bvMessage('bv-encrypt-status','');

  const isFile=$('bv-type-file')?.checked;

  const usePass=$('bv-opt-password')?.checked??true;

  const useKeyfile=$('bv-opt-keyfile')?.checked??false;

  const usePasskey=$('bv-opt-passkey')?.checked??false;

  const shamirVal=($('bv-shamir')?.value||'1-1').split('-').map(Number);

  const shamirM=shamirVal[0]||1,shamirN=shamirVal[1]||1;



  if(!usePass&&!useKeyfile&&!usePasskey&&shamirN<=1){

   bvMessage('bv-encrypt-status','保護方法（パスワード、キーファイル、パスキー、または秘密分散）を少なくとも1つ選択してください。',true);

   return;

  }



  const sensitiveBuffers = new Set();

  const trackSensitive = (buf) => {

   if (buf && (buf instanceof Uint8Array || buf.buffer instanceof ArrayBuffer)) sensitiveBuffers.add(buf);

   return buf;

  };

  const scrubSensitive = (buf) => {

   if (buf && sensitiveBuffers.has(buf)) {

    MatrixCardPreset.zeroize?.(buf);

    sensitiveBuffers.delete(buf);

   }

  };

  const scrubAllSensitive = () => {

   for (const buf of sensitiveBuffers) {

    MatrixCardPreset.zeroize?.(buf);

   }

   sensitiveBuffers.clear();

  };



  let payload=null,name='';

  let keyfileWorkingCopy=null;

  let bodyToShare = null;



  try{

   if(isFile){

    const file=$('bv-file-input')?.files?.[0];

    if(!file){bvMessage('bv-encrypt-status','暗号化したいファイルを選択してください。',true);return;}

    name=file.name;

    const rawBuf = new Uint8Array(await file.arrayBuffer());

    if (myToken !== bvOpToken) {

     MatrixCardPreset.zeroize?.(rawBuf);

     scrubAllSensitive();

     return;

    }

    payload = trackSensitive(rawBuf);

   }else{

    const txt=$('bv-text-content')?.value;

    if(!txt||!txt.trim().length){bvMessage('bv-encrypt-status','暗号化したいテキストまたはパスワードを入力してください。',true);return;}

    name='';

    payload = trackSensitive(enc.encode(txt));

   }



   let password='';

   if(usePass){

    password=$('bv-password')?.value||'';

    const pw2=$('bv-password-confirm')?.value||'';

    if(Array.from(password).length<12||password!==pw2){

     bvMessage('bv-encrypt-status','復元用パスワードを12文字以上で入力し、再入力欄と一致させてください。',true);

     return;

    }

   }



   if(useKeyfile){

    const rawKf = await getVaultKeyfileBytes('bv-keyfile');

    if (myToken !== bvOpToken) {

     if (rawKf && rawKf !== vaultKeyfileBytes) MatrixCardPreset.zeroize?.(rawKf);

     scrubAllSensitive();

     return;

    }

    if(!rawKf||!rawKf.length){

     bvMessage('bv-encrypt-status','キーファイルを選択するか、「専用キーファイル」を作成してください。',true);

     return;

    }

    keyfileWorkingCopy = trackSensitive(new Uint8Array(rawKf));

    if (rawKf !== vaultKeyfileBytes) MatrixCardPreset.zeroize?.(rawKf);

   }



   const kdfProfile=Number($('bv-kdf')?.value||1);



   const doVaultEncrypt = async (duressOpts) => {

    activeDuressCancelCallback = null;

    if (myToken !== bvOpToken) { scrubAllSensitive(); return; }

    bvMessage('bv-encrypt-status','暗号化・秘密分散を処理しています…');

    let packed = null, decoyPacked = null;

    try{

     packed = trackSensitive(packCMV1(isFile?'file':'text',name,payload));

     if (payload) { scrubSensitive(payload); payload = null; }



     if(usePass||useKeyfile||usePasskey){

      if(duressOpts?.enabled){

       const decoyRaw = trackSensitive(enc.encode(duressOpts.text||''));

       decoyPacked = trackSensitive(packCMV1('text','',decoyRaw));

       scrubSensitive(decoyRaw);

       bodyToShare=await MatrixCardPreset.encryptDuressDualCME(packed,password,decoyPacked,duressOpts.password,kdfProfile,{

        usePassword:usePass,

        useKeyfile,

        usePasskey,

        keyfileBytes:keyfileWorkingCopy

       });

      }else{

       bodyToShare=await MatrixCardPreset.encryptBodyCME2(packed,password,kdfProfile,{

        usePassword:usePass,

        useKeyfile,

        usePasskey,

        keyfileBytes:keyfileWorkingCopy

       });

      }

      if (packed) { scrubSensitive(packed); packed = null; }

      if (decoyPacked) { scrubSensitive(decoyPacked); decoyPacked = null; }

      if (keyfileWorkingCopy) { scrubSensitive(keyfileWorkingCopy); keyfileWorkingCopy = null; }

     }else{

      bodyToShare=packed;

     }



     if (myToken !== bvOpToken) {

      scrubAllSensitive();

      if (bodyToShare) MatrixCardPreset.zeroize?.(bodyToShare);

      return;

     }



     const container=$('bv-result-shares-container');

     const actions=$('bv-result-actions');

     container.replaceChildren();actions.replaceChildren();



     if(shamirN>1){

      const setId=(await MatrixCardPreset.sha(bodyToShare)).slice(0,8);

      if (myToken !== bvOpToken) {

       scrubAllSensitive();

       if (bodyToShare) MatrixCardPreset.zeroize?.(bodyToShare);

       return;

      }

      const rawShares=MatrixCardPreset.shamirSplit(bodyToShare,shamirM,shamirN);

      if (bodyToShare === packed) { scrubSensitive(packed); packed = null; }

      const shares=[];



      for(let k=1;k<=shamirN;k++){

       const shareBytes=MatrixCardPreset.concat(new Uint8Array([0x43,0x4d,0x53,3,shamirM,shamirN,k,0]),setId,rawShares[k-1]);

       const arm=armorVault(shareBytes,`SHAMIR SHARE ${k}/${shamirN}`,'VAULT');

       let sBlocks=[],sPhrase='';

       try{

        sBlocks=await MatrixCardPreset.frameBodyToBlocks(shareBytes);

        const sWords=[];

        for(const b of sBlocks){

         const w=await MatrixCardPreset.entropyToBip39Words(b);

         sWords.push(Array.isArray(w)?w.join(' '):w);

        }

        sPhrase=sWords.join('\n');

       }catch(_){

        sBlocks=[];

        sPhrase='';

       }

       if (myToken !== bvOpToken) {

        scrubAllSensitive();

        if (bodyToShare) MatrixCardPreset.zeroize?.(bodyToShare);

        return;

       }

       const hasWords=sBlocks.length>0;

       const bCount=sBlocks.length||Math.ceil((shareBytes.length+36)/20);

       shares.push({index:k,bytes:shareBytes,arm,phrase:sPhrase,blocksCount:bCount,hasWords,activeFormat:(hasWords&&bCount===1)?'words':'armored'});

      }



      if (myToken !== bvOpToken) {

       scrubAllSensitive();

       if (bodyToShare) MatrixCardPreset.zeroize?.(bodyToShare);

       return;

      }



      const baseName=isFile?(name||'vault-data'):'vault-text';



     container.innerHTML=shares.map(s=>{

      const isMulti=(s.blocksCount>1);

      const defaultText=(s.activeFormat==='words')?s.phrase:s.arm;

      const sizeWarn=s.arm.length>8000?`<div class="bv-size-warning" style="font-size:0.74rem; color:#b91c1c; background:#fee2e2; border:1px solid #fca5a5; border-radius:4px; padding:6px; margin-top:6px;">⚠️ データ長（${(s.arm.length/1024).toFixed(1)} KB）が大きいため、紙への印刷保管ではなく「暗号化ファイル保存 (.cmenc)」を推奨します。</div>`:'';

      return `

       <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:10px; margin-bottom:12px;">

         <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:8px;">

           <strong style="font-size:0.86rem; color:#0369a1;">🧩 秘密分散シェア ${s.index} / ${shamirN}（任意の ${shamirM} シェアで復元可能・${s.blocksCount}ブロック）</strong>

           <div class="bv-no-print" style="display:flex; gap:6px; flex-wrap:wrap;">

             <button type="button" class="btn btn-secondary bv-btn-copy-share" data-index="${s.index}" style="padding:4px 8px; font-size:0.75rem;">シェア${s.index}をコピー</button>

             <button type="button" class="btn btn-outline bv-btn-dl-share" data-index="${s.index}" style="padding:4px 8px; font-size:0.75rem;">💾 保存 (.cmenc)</button>

             <button type="button" class="btn btn-outline bv-btn-txt-share" data-index="${s.index}" style="padding:4px 8px; font-size:0.75rem;">💾 テキスト保存 (.txt)</button>

             <button type="button" class="btn btn-outline bv-btn-qr-share" data-index="${s.index}" style="padding:4px 8px; font-size:0.75rem;" ${s.arm.length>2200?'disabled':''}>🖼️ QR画像保存 (PNG)</button>

             <button type="button" class="btn btn-outline bv-btn-kw-share" data-index="${s.index}" style="padding:4px 8px; font-size:0.75rem; font-weight:700; color:#0369a1; border-color:#0284c7; background:#f0f9ff;" title="このシェアをKeePass(KeeWeb)に保存">📥 KeePassに保存</button>

             ${(isMulti&&s.hasWords)?`<button type="button" class="btn btn-outline bv-btn-toggle-share" data-index="${s.index}" style="padding:4px 8px; font-size:0.75rem;">🔄 表示切替</button>`:''}

           </div>

         </div>

         <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-start;">

           ${renderVaultQrHtml(s.arm, `シェア ${s.index} / ${shamirN} QR`)}

           <div style="flex:1; min-width:240px;">

             <textarea readonly id="bv-share-ta-${s.index}" style="width:100%; height:90px; font-size:0.72rem; font-family:monospace; background:#ffffff; border:1px solid #cbd5e1; border-radius:4px; padding:6px; box-sizing:border-box;">${escapeHtml(defaultText)}</textarea>

             <div class="bv-print-full-text">${escapeHtml(s.arm)}</div>

             ${sizeWarn}

           </div>

         </div>

       </div>

      `;}).join('');



     container.querySelectorAll('.bv-btn-toggle-share').forEach(btn=>{

      btn.addEventListener('click',()=>{

       const idx=Number(btn.dataset.index);

       const s=shares.find(x=>x.index===idx);

       if(!s)return;

       s.activeFormat=s.activeFormat==='armored'?'words':'armored';

       const ta=$(`bv-share-ta-${idx}`);

       if(ta)ta.value=(s.activeFormat==='armored'?s.arm:s.phrase);

      });

     });



     container.querySelectorAll('.bv-btn-copy-share').forEach(btn=>{

      btn.addEventListener('click',async()=>{

       const idx=Number(btn.dataset.index);

       const s=shares.find(x=>x.index===idx);

       if(!s)return;

       const textToCopy=s.activeFormat==='armored'?s.arm:s.phrase;

       await MatrixCardPreset.copyWithAutoClear(textToCopy);

       bvMessage('bv-encrypt-status',`シェア ${idx}/${shamirN} をクリップボードにコピーしました（30秒後自動消去）。`);

      });

     });



     container.querySelectorAll('.bv-btn-dl-share').forEach(btn=>{

      btn.addEventListener('click',()=>{

       const idx=Number(btn.dataset.index);

       const s=shares.find(x=>x.index===idx);

       if(!s)return;

       downloadBlob(new Blob([s.bytes],{type:'application/octet-stream'}),`${baseName}.share${idx}.cmenc`);

      });

     });



     container.querySelectorAll('.bv-btn-kw-share').forEach(btn=>{

      btn.addEventListener('click',async()=>{

       const idx=Number(btn.dataset.index);

       const s=shares.find(x=>x.index===idx);

       if(!s)return;

       const shareText=(s.activeFormat==='armored'?s.arm:s.phrase);

       const title=`${baseName} (シェア ${s.index}/${shamirN})`;

       const attachments=[];

       const svg=container.querySelectorAll('.bv-qr-figure svg')?.[idx-1];

       if(svg&&window.MatrixCardPreset?.svgToPngBase64){

        try{

         const qrB64=await window.MatrixCardPreset.svgToPngBase64(svg,640);

         if(qrB64){

          attachments.push({

           filename:`${baseName}.share${idx}-qr.png`,

           base64:qrB64,

           mime:'image/png'

          });

         }

        }catch(_){}

       }

       if(s.bytes){

        try{

         let bin='';const bytes=s.bytes,chunk=8192;

         for(let i=0;i<bytes.length;i+=chunk)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));

         attachments.push({

          filename:`${baseName}.share${idx}.cmenc`,

          base64:btoa(bin),

          mime:'application/octet-stream'

         });

        }catch(_){}

       }

       const notes=[

        `【CryptoMatrix 秘密分散シェア ${s.index}/${shamirN}】`,

        `■ 復元条件: 全${shamirN}シェア中、任意の${shamirM}シェアで復元可能`,

        `■ ブロック数: ${s.blocksCount}`,

        '',

        '【シェアデータ】',

        shareText,

        '',

        '【添付ファイルのご案内】',

        ...(svg?[`1. QRコード画像: ${baseName}.share${idx}-qr.png`]:[]),

        `2. 暗号化ファイル (.cmenc): ${baseName}.share${idx}.cmenc`,

        '',

        '【復元方法】',

        '任意の必要シェア分のテキストまたは添付QRコード/.cmencファイルをCryptoMatrix保管庫の復元タブに入力してください。'

       ].join('\n');



       const baseAppUrl = window.location.href.split(/[?#]/)[0];

       (window.MatrixCardPreset?.setPendingKeeWebTransfer || window.setPendingKeeWebTransfer)('cm_pending_entry', {

        site:title,

        password:password||'',

        username:`Shamir-Share#${s.index}`,

        url:`${baseAppUrl}#bonus-vault`,

        notes:notes,

        attachments:attachments,

        timestamp:Date.now()

       });

       btn.innerHTML='✅ 転送完了！';

       setTimeout(()=>{ btn.innerHTML='📥 KeePassに保存'; },2500);

       openKeeWeb();

      });

     });



     container.querySelectorAll('.bv-btn-txt-share').forEach(btn=>{

      btn.addEventListener('click',()=>{

       const idx=Number(btn.dataset.index);

       const s=shares.find(x=>x.index===idx);

       if(!s)return;

       const textToSave=s.activeFormat==='armored'?s.arm:s.phrase;

       const txtName=`${baseName}.share${idx}.txt`;

       downloadBlob(new Blob([textToSave],{type:'text/plain;charset=utf-8'}),txtName);

       bvMessage('bv-encrypt-status',`💾 シェア${idx}のテキスト（${txtName}）を保存しました。`);

      });

     });



     container.querySelectorAll('.bv-btn-qr-share').forEach(btn=>{

      btn.addEventListener('click',()=>{

       const idx=Number(btn.dataset.index);

       const s=shares.find(x=>x.index===idx);

       if(!s)return;

       const card=btn.closest('div[style*="background:#f8fafc"]');

       const svg=card?card.querySelector('.bv-qr-figure svg'):null;

       if(!svg){bvMessage('bv-encrypt-status',`シェア${idx}に保存可能なQRコードがありません。`,true);return;}

       const qrName=`${baseName}-share${idx}-qr.png`;

       if(window.MatrixCardPreset&&window.MatrixCardPreset.saveSvgAsPng){

        window.MatrixCardPreset.saveSvgAsPng(svg,qrName);

       }

       bvMessage('bv-encrypt-status',`🖼️ シェア${idx}のQRコード画像（${qrName}）を保存しました。`);

      });

     });



     container.querySelectorAll('.bv-btn-xml-share').forEach(btn=>{

      btn.addEventListener('click',async()=>{

       const idx=Number(btn.dataset.index);

       const s=shares.find(x=>x.index===idx);

       if(!s)return;

       const card=btn.closest('div[style*="background:#f8fafc"]');

       const svg=card?card.querySelector('.bv-qr-figure svg'):null;

       const textToSave=s.activeFormat==='armored'?s.arm:s.phrase;

       const title=`${baseName} - Share ${idx} of ${shamirN}`;

       const notes=

`【Crypto Matrix 秘密分散シェア情報】

■ シェア番号: ${idx} / ${shamirN}

■ 復元しきい値: 任意の ${shamirM} シェアが必要

■ ブロック数: ${s.blocksCount}



【添付ファイルのご案内】

1. matrix-qr.png: シェア${idx}のQRコード画像${svg?'':'（※2.2KB超のため添付なし）'}

2. matrix-backup.txt: シェア${idx}のテキスト（${s.activeFormat==='armored'?'PGPアーマード形式':'BIP39形式'}）

※ KeePass / KeeWeb内で添付ファイルをダブルクリックすると、いつでもQR画像やテキストを取り出しできます。`;



       if(window.MatrixCardPreset&&window.MatrixCardPreset.exportKeePassXmlWithAttachments){

        try{

         const outXmlName=await window.MatrixCardPreset.exportKeePassXmlWithAttachments({

          title:title,

          username:`Shamir-${shamirM}-of-${shamirN}`,

          password:password||'',

          notes:notes,

          qrSvg:svg,

          backupText:textToSave

         });

         bvMessage('bv-encrypt-status',`📦 KeePass用インポートファイル（${outXmlName}）を出力しました！KeePassやKeeWebにドラッグ＆ドロップすると、シェアQRやデータが添付ファイルとして登録されます。`);

        }catch(e){

         bvMessage('bv-encrypt-status','KeePass用ファイルの出力に失敗しました: '+e.message,true);

        }

       }

      });

     });



     const dlAllQrBtn=document.createElement('button');

     dlAllQrBtn.id='bv-btn-save-all-qr';

     dlAllQrBtn.type='button';dlAllQrBtn.className='btn btn-outline bv-no-print';

     dlAllQrBtn.style.fontSize='0.78rem';

     dlAllQrBtn.textContent=`🖼️ 全てのQRを一括保存 (PNG) (${shamirN}枚)`;

     dlAllQrBtn.addEventListener('click',async()=>{

      const cards=container.querySelectorAll('div[style*="background:#f8fafc"]');

      for(let k=1;k<=shamirN;k++){

       const card=cards[k-1];

       const svg=card?card.querySelector('.bv-qr-figure svg'):null;

       if(svg&&window.MatrixCardPreset&&window.MatrixCardPreset.saveSvgAsPng){

        const qrName=`${baseName}-share${k}-qr.png`;

        window.MatrixCardPreset.saveSvgAsPng(svg,qrName);

       }

       if(k<shamirN)await new Promise(r=>setTimeout(r,250));

      }

      bvMessage('bv-encrypt-status',`🖼️ 全${shamirN}個のシェアQRコード画像を一括保存しました。`);

     });

     actions.appendChild(dlAllQrBtn);



     const dlAllTxtBtn=document.createElement('button');

     dlAllTxtBtn.id='bv-btn-save-all-txt';

     dlAllTxtBtn.type='button';dlAllTxtBtn.className='btn btn-outline bv-no-print';

     dlAllTxtBtn.style.fontSize='0.78rem';

     dlAllTxtBtn.textContent=`💾 全シェアのテキストを一括保存 (.txt)`;

     dlAllTxtBtn.addEventListener('click',async()=>{

      for(let k=1;k<=shamirN;k++){

       const s=shares.find(x=>x.index===k);

       if(!s)continue;

       const textToSave=s.activeFormat==='armored'?s.arm:s.phrase;

       const txtName=`${baseName}.share${k}.txt`;

       downloadBlob(new Blob([textToSave],{type:'text/plain;charset=utf-8'}),txtName);

       if(k<shamirN)await new Promise(r=>setTimeout(r,250));

      }

      bvMessage('bv-encrypt-status',`💾 全${shamirN}個のシェアテキストファイルを一括保存しました。`);

     });

     actions.appendChild(dlAllTxtBtn);



     const dlAllCmencBtn=document.createElement('button');

     dlAllCmencBtn.id='bv-btn-save-all-cmenc';

     dlAllCmencBtn.type='button';dlAllCmencBtn.className='btn btn-outline bv-no-print';

     dlAllCmencBtn.style.fontSize='0.78rem';

     dlAllCmencBtn.textContent=`💾 全シェアの暗号化ファイルを一括保存 (.cmenc)`;

     dlAllCmencBtn.addEventListener('click',async()=>{

      for(let k=1;k<=shamirN;k++){

       const s=shares.find(x=>x.index===k);

       if(!s)continue;

       downloadBlob(new Blob([s.bytes],{type:'application/octet-stream'}),`${baseName}.share${k}.cmenc`);

       if(k<shamirN)await new Promise(r=>setTimeout(r,250));

      }

      bvMessage('bv-encrypt-status',`💾 全${shamirN}個の暗号化ファイル(.cmenc)を一括保存しました。`);

     });

     actions.appendChild(dlAllCmencBtn);



     const printBtn=document.createElement('button');

     printBtn.type='button';printBtn.className='btn btn-outline bv-no-print';

     printBtn.style.fontSize='0.78rem';

     printBtn.textContent='🖨️ 全シェアQR・保管シートを印刷';

     printBtn.addEventListener('click',()=>{

      document.body.classList.add('print-vault-mode');

      window.print();

      setTimeout(()=>document.body.classList.remove('print-vault-mode'),1000);

     });

     actions.appendChild(printBtn);



     bvMessage('bv-encrypt-status',`秘密分散データ（${shamirM}-of-${shamirN}）を作成しました。全${shamirN}個のシェア（QRコード／ファイル）を別々に保管してください。任意の${shamirM}個で復元できます。`);

    }else{

     const armored=armorVault(bodyToShare,'ENCRYPTED DATA','VAULT');

     let vBlocks=[],vPhrase='';

     try{

      vBlocks=await MatrixCardPreset.frameBodyToBlocks(bodyToShare);

      const vWords=[];

      for(const b of vBlocks){

       const w=await MatrixCardPreset.entropyToBip39Words(b);

       vWords.push(Array.isArray(w)?w.join(' '):w);

      }

      vPhrase=vWords.join('\n');

     }catch(_){

      vBlocks=[];

      vPhrase='';

     }

     if (myToken !== bvOpToken) {

      if (payload) MatrixCardPreset.zeroize(payload);

      if (bodyToShare) MatrixCardPreset.zeroize(bodyToShare);

      return;

     }

     const hasWords=vBlocks.length>0;

     const isMulti=(vBlocks.length>1);

     let singleFormat=(hasWords&&!isMulti)?'words':'armored';

     const defaultSingleText=(singleFormat==='words')?vPhrase:armored;

     const outFileName=isFile?(name+'.cmenc'):'vault-secret.cmenc';

     const sizeWarn=armored.length>8000?`<div class="bv-size-warning" style="font-size:0.74rem; color:#b91c1c; background:#fee2e2; border:1px solid #fca5a5; border-radius:4px; padding:6px; margin-top:6px;">⚠️ データ長（${(armored.length/1024).toFixed(1)} KB）が大きいため、紙への印刷保管ではなく「暗号化ファイル保存 (.cmenc)」を推奨します。</div>`:'';

     const blockLabel=hasWords?` / ${vBlocks.length}ブロック`:'';



     if (myToken !== bvOpToken) {

      if (payload) MatrixCardPreset.zeroize(payload);

      if (bodyToShare) MatrixCardPreset.zeroize(bodyToShare);

      return;

     }



     container.innerHTML=`

       <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:10px;">

         <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:8px;">

           <strong style="font-size:0.86rem; color:#0369a1;">🔒 暗号化データ（${bodyToShare.length} bytes${blockLabel}）</strong>

           <div class="bv-no-print" style="display:flex; gap:6px; flex-wrap:wrap;">

             <button type="button" class="btn btn-secondary" id="bv-btn-copy-single" style="padding:4px 8px; font-size:0.75rem;">テキストをコピー</button>

             <button type="button" class="btn btn-outline" id="bv-btn-dl-single" style="padding:4px 8px; font-size:0.75rem;">💾 ファイル保存 (.cmenc)</button>

             <button type="button" class="btn btn-outline" id="bv-btn-txt-single" style="padding:4px 8px; font-size:0.75rem;">💾 テキスト保存 (.txt)</button>

             <button type="button" class="btn btn-outline" id="bv-btn-qr-single" style="padding:4px 8px; font-size:0.75rem;" ${armored.length>2200?'disabled':''}>🖼️ QR画像保存 (PNG)</button>

              <button type="button" class="btn btn-outline" id="bv-btn-kw-single" style="padding:4px 8px; font-size:0.75rem; font-weight:700; color:#0369a1; border-color:#0284c7; background:#f0f9ff;" title="KeePass(KeeWeb)に新規エントリーとして保存（QR画像・キーファイルを両方自動添付）">📥 KeePassに保存</button>

             ${(isMulti&&hasWords)?`<button type="button" class="btn btn-outline" id="bv-btn-toggle-single" style="padding:4px 8px; font-size:0.75rem;">🔄 表示切替（PGP ⇄ BIP39）</button>`:''}

           </div>

         </div>

         <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-start;">

           ${renderVaultQrHtml(armored, '暗号化データ QR')}

           <div style="flex:1; min-width:240px;">

             <textarea readonly id="bv-single-ta" style="width:100%; height:90px; font-size:0.72rem; font-family:monospace; background:#ffffff; border:1px solid #cbd5e1; border-radius:4px; padding:6px; box-sizing:border-box;">${escapeHtml(defaultSingleText)}</textarea>

             <div class="bv-print-full-text">${escapeHtml(armored)}</div>

             ${sizeWarn}

           </div>

         </div>

       </div>

     `;



     if(isMulti){

      $('bv-btn-toggle-single')?.addEventListener('click',()=>{

       singleFormat=singleFormat==='armored'?'words':'armored';

       const ta=$('bv-single-ta');

       if(ta)ta.value=(singleFormat==='armored'?armored:vPhrase);

      });

     }



     $('bv-btn-copy-single')?.addEventListener('click',async()=>{

      const textToCopy=(singleFormat==='armored'?armored:vPhrase);

      await MatrixCardPreset.copyWithAutoClear(textToCopy);

      bvMessage('bv-encrypt-status','暗号化データをコピーしました（30秒後自動消去）。');

     });



     $('bv-btn-dl-single')?.addEventListener('click',()=>{

      downloadBlob(new Blob([bodyToShare],{type:'application/octet-stream'}),outFileName);

      bvMessage('bv-encrypt-status',`暗号化ファイルを「${outFileName}」としてダウンロードしました。`);

     });



     $('bv-btn-txt-single')?.addEventListener('click',()=>{

      const textToSave=(singleFormat==='armored'?armored:vPhrase);

      const txtName=(isFile?(name+'.txt'):'vault-secret.txt');

      downloadBlob(new Blob([textToSave],{type:'text/plain;charset=utf-8'}),txtName);

      bvMessage('bv-encrypt-status',`💾 テキストファイル（${txtName}）を保存しました。`);

     });



     $('bv-btn-qr-single')?.addEventListener('click',()=>{

      const svg=container.querySelector('.bv-qr-figure svg');

      if(!svg){bvMessage('bv-encrypt-status','保存可能なQRコードがありません。',true);return;}

      const qrName=(isFile?(name+'-qr.png'):'vault-secret-qr.png');

      if(window.MatrixCardPreset&&window.MatrixCardPreset.saveSvgAsPng){

       window.MatrixCardPreset.saveSvgAsPng(svg,qrName);

      }

      bvMessage('bv-encrypt-status',`🖼️ QRコード画像（${qrName}）を保存しました。`);

     });



     $('bv-btn-kw-single')?.addEventListener('click',async()=>{

      const textToSave=(singleFormat==='armored'?armored:vPhrase);

      const title=isFile?`Vault - ${name}`:'Vault - 暗号化保管データ';

      const attachments=[];

      const svg=container.querySelector('.bv-qr-figure svg');

      if(svg&&window.MatrixCardPreset?.svgToPngBase64){

       try{

        const qrB64=await window.MatrixCardPreset.svgToPngBase64(svg,640);

        if(qrB64){

         attachments.push({

          filename:isFile?`${name}-qr.png`:'vault-secret-qr.png',

          base64:qrB64,

          mime:'image/png'

         });

        }

       }catch(_){}

      }



      const seedNum=$('input-seed-number')?.value||'0';

      if(window.MatrixCardPreset?.generateKeePassXmlKeyfile){

       try{

        const keyData=await window.MatrixCardPreset.generateKeePassXmlKeyfile({

         seedNum:(typeof parseSeedValue==='function'?parseSeedValue(seedNum):(parseInt(seedNum,10)||0))

        });

        if(keyData&&keyData.xml){

         attachments.push({

          filename:`matrix-card-${seedNum}.key`,

          text:keyData.xml,

          mime:'application/x-kdbx-keyfile'

         });

        }

       }catch(_){}

      }



      if(bodyToShare){

       try{

        let bin='';const bytes=bodyToShare,chunk=8192;

        for(let i=0;i<bytes.length;i+=chunk)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));

        attachments.push({

         filename:outFileName,

         base64:btoa(bin),

         mime:'application/octet-stream'

        });

       }catch(_){}

      }



      const notes=[

       '【CryptoMatrix 暗号化保管庫 (Bonus Vault) エントリー】',

       `■ 種別: ${isFile?'ファイル暗号化':'テキスト/パスワード暗号化'}`,

       `■ ファイル名: ${name || 'N/A'}`,

       `■ サイズ: ${bodyToShare.length} bytes`,

       `■ ブロック数: ${vBlocks.length}`,

       '',

       '【暗号化データ】',

       textToSave,

       '',

       '【添付ファイルのご案内（全形式添付・安心保管）】',

       ...(svg?['1. QRコード画像 (.png): 読み取るだけで一発復号できます。']:[]),

       `2. KeePassキーファイル (.key): matrix-card-${seedNum}.key`,

       `3. 暗号化ファイル (.cmenc): ${outFileName}（画面にドラッグ＆ドロップで一発復号可能）`,

       '',

       '【復号方法】',

       'CryptoMatrixの「4. 汎用セキュア保管庫」の復号タブに上記暗号化データを貼り付けるか、添付のQRコード画像または.cmencファイルを読み込ませるだけで復号できます。'

      ].join('\n');



      const baseAppUrl = window.location.href.split(/[?#]/)[0];

      (window.MatrixCardPreset?.setPendingKeeWebTransfer || window.setPendingKeeWebTransfer)('cm_pending_entry', {

       site:title,

       password:password||'',

       username:isFile?'Vault-File':'Vault-Secret',

       url:`${baseAppUrl}#bonus-vault`,

       notes:notes,

       attachments:attachments,

       timestamp:Date.now()

      });



       const btn=$('bv-btn-kw-single');

       if(btn){

        const origText=btn.innerHTML;

        btn.innerHTML='✅ KeeWeb転送準備完了！ <a href="keeweb/index.html" target="_blank" style="color:#15803d; text-decoration:underline;">[🔑 KeeWebを開く]</a>';

        btn.style.background='#dcfce7';

        btn.style.borderColor='#86efac';

        btn.style.color='#15803d';

        setTimeout(()=>{

         btn.innerHTML=origText;

         btn.style.background='#f0f9ff';

         btn.style.borderColor='#0284c7';

         btn.style.color='#0369a1';

        },3500);

       }

       bvMessage('bv-encrypt-status','✅ KeeWeb転送データを準備しました。');

       {const _el=$('bv-encrypt-status');if(_el){const _a=document.createElement('a');_a.href='keeweb/index.html';_a.target='_blank';_a.textContent='[🔑 KeeWebを開く]';_a.style.cssText='color:#0284c7;font-weight:700;text-decoration:underline;margin-left:6px;';_el.appendChild(_a);}}

       openKeeWeb();

     });



     $('bv-btn-xml-single')?.addEventListener('click',async()=>{

      const svg=container.querySelector('.bv-qr-figure svg');

      const textToSave=(singleFormat==='armored'?armored:vPhrase);

      const title=isFile?`Vault - ${name}`:'Vault - Secure Secret';

      const notes=

`【Crypto Matrix 暗号化保管庫 (Bonus Vault) エントリ】

■ 種別: ${isFile?'ファイル暗号化':'テキスト/パスワード暗号化'}

■ ファイル名: ${name || 'N/A'}

■ サイズ: ${bodyToShare.length} bytes

■ ブロック数: ${vBlocks.length}



【添付ファイルのご案内】

1. matrix-qr.png: 暗号化QRコード画像${svg?'':'（※2.2KB超のため添付なし）'}

2. matrix-backup.txt: 暗号化テキスト（${singleFormat==='armored'?'PGPアーマード形式':'BIP39形式'}）

※ KeePass / KeeWeb内で添付ファイルをダブルクリックすると、いつでもQR画像やテキストを取り出しできます。`;



      if(window.MatrixCardPreset&&window.MatrixCardPreset.exportKeePassXmlWithAttachments){

       try{

        const outXmlName=await window.MatrixCardPreset.exportKeePassXmlWithAttachments({

         title:title,

         username:isFile?name:'Vault-User',

         password:password||'',

         notes:notes,

         qrSvg:svg,

         backupText:textToSave

        });

        bvMessage('bv-encrypt-status',`📦 KeePass用インポートファイル（${outXmlName}）を出力しました！KeePassやKeeWebにドラッグ＆ドロップすると、暗号化QRやデータが添付ファイルとして登録されます。`);

       }catch(e){

        bvMessage('bv-encrypt-status','KeePass用ファイルの出力に失敗しました: '+e.message,true);

       }

      }

     });



     const printBtn=document.createElement('button');

     printBtn.type='button';printBtn.className='btn btn-outline bv-no-print';

     printBtn.style.fontSize='0.78rem';

     printBtn.textContent='🖨️ QRコード・保管シートを印刷';

     printBtn.addEventListener('click',()=>{

      if(armored.length>8000){

       if(!confirm(`データサイズが大きいため（約${(armored.length/1024).toFixed(1)} KB）、紙への印刷から手動入力で復元するのは非常に困難です。暗号化ファイル（.cmenc）での保存を強く推奨します。\n\nそれでも印刷しますか？`)){

        return;

       }

      }

      document.body.classList.add('print-vault-mode');

      window.print();

      setTimeout(()=>document.body.classList.remove('print-vault-mode'),1000);

     });

     actions.appendChild(printBtn);



     if (myToken !== bvOpToken) {

      if (payload) MatrixCardPreset.zeroize(payload);

      if (bodyToShare) MatrixCardPreset.zeroize(bodyToShare);

      return;

     }



     if(isFile){

      downloadBlob(new Blob([bodyToShare],{type:'application/octet-stream'}),outFileName);

     }

     bvMessage('bv-encrypt-status',`暗号化が完了しました。${isFile?`「${outFileName}」を保存しました。`:''}`);

    }



     if (myToken !== bvOpToken) {

      scrubAllSensitive();

      if (bodyToShare) MatrixCardPreset.zeroize?.(bodyToShare);

      return;

     }



     $('bv-encrypt-result').hidden=false;

     $('bv-encrypt-result').style.display='';

     if(usePass){$('bv-password').value='';$('bv-password-confirm').value='';}

    }catch(e){

     if (myToken !== bvOpToken) return;

     bvMessage('bv-encrypt-status',e.message,true);

    }finally{

     if (myToken !== bvOpToken) {

      scrubAllSensitive();

      if (bodyToShare) MatrixCardPreset.zeroize?.(bodyToShare);

     }else{

      scrubAllSensitive();

     }

    }

   };



   const skipDuress = (localStorage.getItem('cm_skip_duress_popup') === 'true') || window.__SKIP_DURESS_MODAL__;

   let duressOpts = null;

   if (!skipDuress && usePass) {

    const choice = await new Promise(resolve => {

     showDuressModal('sec4', password,

      opts => resolve({ cancelled: false, opts }),

      () => resolve({ cancelled: true }));

    });

    if (choice.cancelled || myToken !== bvOpToken) return;

    duressOpts = choice.opts;

   }

   await doVaultEncrypt(duressOpts);

  }catch(err){

   if (myToken !== bvOpToken) return;

   bvMessage('bv-encrypt-status', err.message, true);

  }finally{

   scrubAllSensitive();

   if (myToken !== bvOpToken && bodyToShare) MatrixCardPreset.zeroize?.(bodyToShare);

  }

 });

 $('bv-restore-file')?.addEventListener('change',()=>{

  const files=$('bv-restore-file')?.files;

  if(files&&files.length){

   $('bv-restore-file-name').textContent=`✅ ${files.length}個のファイル選択済み: `+[...files].map(f=>f.name).join(', ');

  }

 });



 let lastDecryptedResult=null;



 $('bv-btn-decrypt')?.addEventListener('click',async()=>{

  const myToken = ++bvOpToken;

  if (activeDuressContext === 'sec4') closeDuressModal();

  bvMessage('bv-decrypt-status','');

  $('bv-decrypt-result').hidden=true;



  const sensitiveBuffers = new Set();

  const trackSensitive = (buf) => {

   if (buf && (buf instanceof Uint8Array || buf.buffer instanceof ArrayBuffer)) sensitiveBuffers.add(buf);

   return buf;

  };

  const scrubSensitive = (buf) => {

   if (buf && sensitiveBuffers.has(buf)) {

    MatrixCardPreset.zeroize?.(buf);

    sensitiveBuffers.delete(buf);

   }

  };

  const scrubAllSensitive = () => {

   for (const buf of sensitiveBuffers) {

    MatrixCardPreset.zeroize?.(buf);

   }

   sensitiveBuffers.clear();

  };



  let items = [];

  let keyfileWorkingCopy = null;

  let combinedBody = null;

  let plainBody = null;

  let unpacked = null;

  let resultCommitted = false;



  try {

   const rawFiles=$('bv-restore-file')?.files;

   const rawText=$('bv-restore-text')?.value||'';



   if(rawFiles&&rawFiles.length){

    for(const f of rawFiles){

     const rawBytes = new Uint8Array(await f.arrayBuffer());

     if (myToken !== bvOpToken) {

      MatrixCardPreset.zeroize?.(rawBytes);

      scrubAllSensitive();

      return;

     }

     items.push(trackSensitive(rawBytes));

    }

   }

   if(rawText.trim().length){

    const words=rawText.trim().toLowerCase().split(/\s+/).filter(Boolean);

    if(words.length>=24&&words.length%24===0&&!rawText.includes('-----BEGIN')){

     const allBlocks=[];

     for(let i=0;i<words.length;i+=24){

      const blk = await MatrixCardPreset.bip39WordsToEntropy(words.slice(i,i+24).join(' '));

      if (myToken !== bvOpToken) {

       if (blk) MatrixCardPreset.zeroize?.(blk);

       scrubAllSensitive();

       return;

      }

      allBlocks.push(trackSensitive(blk));

     }

     const grpMap=new Map();

     for(const blk of allBlocks){

      if(MatrixCardPreset.isFrame(blk)){

       const tag=Array.from(blk.slice(8,12)).map(b=>b.toString(16).padStart(2,'0')).join('');

       if(!grpMap.has(tag))grpMap.set(tag,[]);

       grpMap.get(tag).push(blk);

      }else{

       items.push(blk);

      }

     }

     for(const [,grp] of grpMap){

      const res = await MatrixCardPreset.reassembleStreamGroup(grp,true);

      if (myToken !== bvOpToken) {

       if (res?.body) MatrixCardPreset.zeroize?.(res.body);

       scrubAllSensitive();

       return;

      }

      items.push(trackSensitive(res.body));

     }

    }else{

     const parsed=dearmorVault(rawText);

     for(const p of parsed) items.push(trackSensitive(p));

    }

   }



   if (myToken !== bvOpToken) { scrubAllSensitive(); return; }

   if(!items.length){

    bvMessage('bv-decrypt-status','復号する暗号化ファイルを選択するか、暗号化テキストを貼り付けてください。',true);

    return;

   }



   const password=$('bv-restore-password')?.value||'';

   const rawKf = await getVaultKeyfileBytes('bv-restore-keyfile');

   if (myToken !== bvOpToken) {

    if (rawKf && rawKf !== vaultKeyfileBytes) MatrixCardPreset.zeroize?.(rawKf);

    scrubAllSensitive();

    return;

   }

   if (rawKf) {

    keyfileWorkingCopy = trackSensitive(new Uint8Array(rawKf));

    if (rawKf !== vaultKeyfileBytes) MatrixCardPreset.zeroize?.(rawKf);

   }

   const twoFaOpts={keyfileBytes: keyfileWorkingCopy};



   bvMessage('bv-decrypt-status','復元・復号を処理しています…');



   const shamirShares=[];

   for(const b of items){

    if(b.length>16&&b[0]===0x43&&b[1]===0x4d&&b[2]===0x53&&b[3]===3){

     const m=b[4],n=b[5],k=b[6];

     const setId=hexTag(b.slice(8,16));

     const data=trackSensitive(b.slice(16));

     shamirShares.push({index:k,m,n,setId,data});

    }

   }



   if(shamirShares.length>0){

    const first=shamirShares[0];

    if(shamirShares.some(x=>x.setId!==first.setId||x.m!==first.m||x.n!==first.n||x.data.length!==first.data.length)){

     throw new Error('異なる秘密分散セットのシェア、またはデータ長の異なるシェアが混在しています。');

    }

    const uniqueMap=new Map();

    for(const s of shamirShares){

     if(uniqueMap.has(s.index)){

      const existing = uniqueMap.get(s.index);

      if(!equalBytes(existing.data, s.data)){

       throw new Error(`シェア番号 #${s.index} に内容の異なる重複シェアが検出されました。破損または改ざんされたシェアです。`);

      }

     } else {

      uniqueMap.set(s.index, s);

     }

    }

    const unique=[...uniqueMap.values()];



    if(unique.length<first.m){

     throw new Error(`秘密分散データ（${first.m}-of-${first.n}）です。復元には最低 ${first.m} 個の異なるシェアが必要ですが、現在 ${unique.length} 個しかありません。不足しているシェアを追加してください。`);

    }

    combinedBody = trackSensitive(MatrixCardPreset.shamirCombine(unique.slice(0,first.m)));

    const actualSetId=hexTag((await MatrixCardPreset.sha(combinedBody)).slice(0,8));

    if (myToken !== bvOpToken) { scrubAllSensitive(); return; }

    if(actualSetId!==first.setId){

     throw new Error('秘密分散シェアの整合性検証（SHA-256）に失敗しました。シェアの破損、改ざん、または異なるシェアの混在が検出されました。');

    }

   }else{

    combinedBody=items[0];

   }



   let isMigrated=false;

   if(combinedBody.length>4&&combinedBody[0]===0x43&&combinedBody[1]===0x4d&&combinedBody[2]===0x45&&(combinedBody[3]===2||combinedBody[3]===3)){

    const dec=await MatrixCardPreset.decryptBodyCME2(combinedBody,password,twoFaOpts);

    if (myToken !== bvOpToken) {

     if (dec?.innerBody) MatrixCardPreset.zeroize?.(dec.innerBody);

     scrubAllSensitive();

     return;

    }

    plainBody=trackSensitive(dec.innerBody);

    isMigrated=!!dec.isLegacyPK2Migrated;

   }else{

    plainBody=combinedBody;

   }



   if (myToken !== bvOpToken) {

    scrubAllSensitive();

    return;

   }

   unpacked=unpackCMV1(plainBody);

   if (unpacked?.payload) {

    trackSensitive(unpacked.payload);

   }

   if (myToken !== bvOpToken) {

    scrubAllSensitive();

    return;

   }



   if (lastDecryptedResult?.payload && lastDecryptedResult.payload !== unpacked?.payload) {

    MatrixCardPreset.zeroize?.(lastDecryptedResult.payload);

   }

   lastDecryptedResult=unpacked;



   const legacyWarn = isMigrated

    ? '\n\n⚠️【データ救出完了】以前のパスキー保護形式から復元されました。安全のため、速やかに保管庫の最新バックアップを再作成してください。'

    : '';



   if(unpacked.type==='file'){

    $('bv-decrypted-title').textContent=`✅ ファイルの復号に成功しました！「${unpacked.name||'restored-file'}」`;

    $('bv-decrypted-content').textContent=`【復号完了ファイル情報】\nファイル名: ${unpacked.name}\nファイルサイズ: ${(unpacked.payload.length/1024).toFixed(1)} KB (${unpacked.payload.length} bytes)\n\n※自動的にダウンロードが開始されます。始まらない場合は右上の「💾 ファイルをダウンロード」を押してください。`;

    $('bv-copy-decrypted').style.display='none';

    $('bv-download-decrypted').style.display='inline-block';

    downloadBlob(new Blob([unpacked.payload],{type:'application/octet-stream'}),unpacked.name||'restored-file');

    bvMessage('bv-decrypt-status',`✅ ファイルの復元完了: 「${unpacked.name}」をダウンロードしました。` + legacyWarn);

   }else{

    const text=new TextDecoder().decode(unpacked.payload);

    $('bv-decrypted-title').textContent='✅ 機密テキスト／パスワードの復号に成功しました！';

    $('bv-decrypted-content').textContent=text;

    $('bv-decrypted-meta').textContent=`文字数: ${text.length} 文字（UTF-8 ${unpacked.payload.length} bytes）`;

    $('bv-copy-decrypted').style.display='inline-block';

    $('bv-download-decrypted').style.display='none';

    bvMessage('bv-decrypt-status','✅ 復号完了：テキストを表示しました。' + legacyWarn);

   }



   $('bv-decrypt-result').hidden=false;

   $('bv-decrypt-result').style.display='';



   // Transfer ownership of the displayed result; all other operation buffers are temporary.

   if (unpacked?.payload) sensitiveBuffers.delete(unpacked.payload);

   resultCommitted = true;



  }catch(e){

   if (myToken !== bvOpToken) return;

   bvMessage('bv-decrypt-status',e.message,true);

  }finally{

   scrubAllSensitive();

   if (!resultCommitted && lastDecryptedResult === unpacked) lastDecryptedResult = null;

  }

 });

 $('bv-download-decrypted')?.addEventListener('click',()=>{

  if(!lastDecryptedResult||lastDecryptedResult.type!=='file')return;

  downloadBlob(new Blob([lastDecryptedResult.payload],{type:'application/octet-stream'}),lastDecryptedResult.name||'restored-file');

 });

 $('bv-copy-decrypted')?.addEventListener('click',async()=>{

  const text=$('bv-decrypted-content')?.textContent||'';

  if(!text)return;

  await MatrixCardPreset.copyWithAutoClear(text,()=>bvMessage('bv-decrypt-status','🛡️ クリップボードの復号データを自動消去しました。'));

  bvMessage('bv-decrypt-status','✅ 復号テキストをコピーしました（30秒後に自動消去）。');

 });



 let bvScannedShares=new Map();

 let bvCameraEpoch=0,bvStream=null,bvTimer=null;



 function bvStopCamera(note=''){

  bvCameraEpoch++;

  if(bvTimer){clearTimeout(bvTimer);bvTimer=null;}

  if(bvStream){bvStream.getTracks().forEach(t=>t.stop());bvStream=null;}

  const video=$('bv-video');

  if(video){video.pause();video.srcObject=null;video.hidden=true;}

  if($('bv-btn-camera-stop'))$('bv-btn-camera-stop').disabled=true;

  if($('bv-btn-camera'))$('bv-btn-camera').disabled=false;

  if(note)bvMessage('bv-decrypt-status',note);

 }



 async function bvIngest(text){

  if(!text||typeof text!=='string')return false;

  const trimmed=text.trim();

  const words=trimmed.toLowerCase().split(/\s+/).filter(Boolean);

  const isWords=(words.length>=24&&words.length%24===0);

  const isArmored=trimmed.includes('-----BEGIN CRYPTOMATRIX');



  if(/-----BEGIN CRYPTOMATRIX BACKUP\b/i.test(trimmed)){

   document.dispatchEvent(new CustomEvent('cm-route-backup-text',{detail:{text:trimmed}}));

   bvMessage('bv-decrypt-status','セクション3の暗号化バックアップを検出したため、復元欄へ自動的に移動しました。');

   return true;

  }



  if(!isWords&&!isArmored){

   bvMessage('bv-decrypt-status','認識可能な保管庫データ（CRYPTOMATRIX形式またはBIP39 24単語）ではありません。',true);

   return false;

  }

  if(isWords){

   try{

    const b=await MatrixCardPreset.bip39WordsToEntropy(words.slice(0,24).join(' '));

    if(MatrixCardPreset.isFrame(b)){

     const cur=$('bv-restore-text').value.trim();

     $('bv-restore-text').value=cur?(cur+'\n\n'+trimmed):trimmed;

     bvStopCamera();

     bvMessage('bv-decrypt-status','✅ BIP39 24単語ブロックQRを読み取りました。「復号・復元を実行」を押してください。');

     return true;

    }

   }catch(_){}

  }

  const shareMatch=/-----BEGIN CRYPTOMATRIX VAULT SHAMIR SHARE (\d+)\/(\d+)-----/i.exec(trimmed);

  if(shareMatch){

   const k=Number(shareMatch[1]),n=Number(shareMatch[2]);

   if(bvScannedShares.has(k) && bvScannedShares.get(k) !== trimmed){

    bvMessage('bv-decrypt-status',`⚠️ シェア番号 #${k} は既に読み取られていますが、内容が異なる不正な重複シェアです。改ざんまたは破損の可能性があります。`,true);

    return false;

   }

   bvScannedShares.set(k,trimmed);

   $('bv-restore-text').value=[...bvScannedShares.values()].join('\n\n');

   let m=2;

   try{

    const parsed=dearmorVault(trimmed);

    if(parsed.length&&parsed[0].length>16&&parsed[0][0]===0x43&&parsed[0][1]===0x4d&&parsed[0][2]===0x53&&parsed[0][3]===3){

     m=parsed[0][4];

    }

   }catch(_){}

   if(bvScannedShares.size<m){

    bvMessage('bv-decrypt-status',`🧩 秘密分散シェア #${k}（${m}-of-${n}）を読み取りました（現在 ${bvScannedShares.size} / 必要 ${m} シェア）。続けて別のシェアQRをかざしてください。`);

    return false;

   }else{

    bvStopCamera();

    bvMessage('bv-decrypt-status',`✅ 秘密分散の必要シェア（${bvScannedShares.size} / ${m} シェア）のQR読み取りが完了しました！パスワードまたは認証要素を入力して「復号・復元を実行」を押してください。`);

    return true;

   }

  }else{

   $('bv-restore-text').value=trimmed;

   bvStopCamera();

   bvMessage('bv-decrypt-status','✅ 暗号化QRコードを読み取りました！パスワードまたは認証要素を入力して「復号・復元を実行」を押してください。');

   return true;

  }

 }



 async function bvStartCamera(){

  bvStopCamera();

  const epoch=++bvCameraEpoch;

  if($('bv-btn-camera'))$('bv-btn-camera').disabled=true;

  if($('bv-btn-camera-stop'))$('bv-btn-camera-stop').disabled=false;

  try{

   if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){

    throw Error('カメラ復元にはHTTPS（またはlocalhost）環境が必要です。QR画像ファイルの選択またはテキスト貼り付けをご利用ください。');

   }

   const decode=await getDecoder();

   if(epoch!==bvCameraEpoch)return;

   const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});

   if(epoch!==bvCameraEpoch){media.getTracks().forEach(t=>t.stop());return;}

   bvStream=media;

   const video=$('bv-video');

   if(video){

    video.srcObject=media;

    video.hidden=false;

    await video.play();

   }

   if(epoch!==bvCameraEpoch)return;

   bvMessage('bv-decrypt-status','印刷した保管庫QRコードをカメラ枠内に大きく映してください。');

   const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});

   const tick=async()=>{

    if(epoch!==bvCameraEpoch)return;

    try{

     if(video&&video.readyState>=2&&video.videoWidth){

      const scale=Math.min(1,1400/video.videoWidth);

      canvas.width=Math.round(video.videoWidth*scale);

      canvas.height=Math.round(video.videoHeight*scale);

      ctx.drawImage(video,0,0,canvas.width,canvas.height);

      for(const t of await decode(canvas)){

       if(epoch!==bvCameraEpoch)return;

       if(await bvIngest(t))return;

      }

     }

    }catch(e){

     if(epoch===bvCameraEpoch)bvMessage('bv-decrypt-status',e.message,true);

    }

    if(epoch===bvCameraEpoch)bvTimer=setTimeout(tick,250);

   };

   void tick();

  }catch(e){

   if(epoch!==bvCameraEpoch)return;

   bvStopCamera();

   bvMessage('bv-decrypt-status',e.name==='NotAllowedError'?'カメラの使用が許可されていません。':e.message,true);

  }

 }



 $('bv-btn-camera')?.addEventListener('click',()=>bvStartCamera());

 $('bv-btn-camera-stop')?.addEventListener('click',()=>bvStopCamera('カメラを停止しました。'));



 $('bv-restore-qr-img')?.addEventListener('change',async()=>{

  const file=$('bv-restore-qr-img')?.files?.[0];

  if(!file)return;

  bvStopCamera();

  try{

   bvMessage('bv-decrypt-status','QR画像ファイルを解析しています…');

   const decode=await getDecoder();

   const image=await createImageBitmap(file);

   try{

    const scale=Math.min(1,1800/Math.max(image.width,image.height)),canvas=document.createElement('canvas');

    canvas.width=Math.max(1,Math.round(image.width*scale));

    canvas.height=Math.max(1,Math.round(image.height*scale));

    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);

    const texts=await decode(canvas);

    if(!texts.length)throw Error('QRコードが見つかりませんでした。明るくブレのないQR画像を選択してください。');

    let hit=false;

    for(const t of texts){

     if(await bvIngest(t))hit=true;

    }

   }finally{

    image.close();

   }

  }catch(e){

   bvMessage('bv-decrypt-status',e.message,true);

  }finally{

   $('bv-restore-qr-img').value='';

  }

 });

 document.addEventListener('cm-route-vault-text',event=>{

  const text=event.detail?.text;

  if(!text)return;

  const restoreText=$('bv-restore-text');

  if(restoreText)restoreText.value=text;

  $('bv-tab-btn-decrypt')?.click();

  $('bonus-vault')?.scrollIntoView({behavior:'smooth',block:'start'});

  bvMessage('bv-decrypt-status','保管庫データを自動入力しました。必要な復元用パスワード／キーを入力して復号してください。');

 });

 document.addEventListener('cm-route-vault-files',async event=>{

  const files=Array.from(event.detail?.files||[]);

  if(!files.length)return;

  const entries=[];

  for(const file of files){

   if(file.name.toLowerCase().endsWith('.txt'))entries.push((await file.text()).trim());

   else entries.push(armorVault(new Uint8Array(await file.arrayBuffer()),'VAULT',''));

  }

  await bvIngest(entries.join('\n\n'));

 });

 $('btn-zeroize')?.addEventListener('click',()=>{

  bvOpToken++;

  bvStopCamera();

  if(lastDecryptedResult?.payload)MatrixCardPreset.zeroize?.(lastDecryptedResult.payload);

  lastDecryptedResult=null;

  if(vaultKeyfileBytes)MatrixCardPreset.zeroize?.(vaultKeyfileBytes);

  vaultKeyfileBytes=null;

  vaultKeyfileName='';

  bvScannedShares.clear();

  if($('bv-keyfile-status'))$('bv-keyfile-status').textContent='';

  if($('bv-decrypted-content'))$('bv-decrypted-content').textContent='';

  if($('bv-decrypted-title'))$('bv-decrypted-title').textContent='';

  if($('bv-decrypted-meta'))$('bv-decrypted-meta').textContent='';

  if($('bv-decrypt-result')){$('bv-decrypt-result').hidden=true;$('bv-decrypt-result').style.display='none';}

  if($('bv-encrypt-result')){$('bv-encrypt-result').hidden=true;$('bv-encrypt-result').style.display='none';}

  if($('bv-result-shares-container'))$('bv-result-shares-container').replaceChildren();

  if($('bv-result-actions'))$('bv-result-actions').replaceChildren();

  bvMessage('bv-encrypt-status','');

  bvMessage('bv-decrypt-status','');

 });

}



document.addEventListener('DOMContentLoaded',()=>{

 initBonusVault();

 initHelpTooltips();

 $('bq-cdn')?.addEventListener('change',()=>{if($('bv-cdn'))$('bv-cdn').checked=$('bq-cdn').checked;});

 $('bv-cdn')?.addEventListener('change',()=>{if($('bq-cdn'))$('bq-cdn').checked=$('bv-cdn').checked;});

 syncProtectionUI();

 updateSelectDescriptions();

 $('backup-kind')?.addEventListener('change',updateSelectDescriptions);

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

   const isArmored=(artifact.activeFormat==='armored');

   if(MatrixCardPreset.copyWithAutoClear){

    await MatrixCardPreset.copyWithAutoClear(artifact.packet,()=>message('bq-status','🛡️ クリップボードの暗号化データを自動消去しました。'));

   }else{

    await navigator.clipboard.writeText(artifact.packet);

   }

   message('bq-status',isArmored

    ?'PGPアーマード形式の暗号化バックアップをコピーしました（30秒後にクリップボードから自動消去されます）。'

    :`暗号化BIP39フレーズ（全${artifact.total}ブロック・${artifact.total*24}単語）をコピーしました（30秒後にクリップボードから自動消去されます）。`);

  }catch(e){message('bq-status',e.message+' コピーできない場合は欄内のテキストを手動で控えてください。',true);}

 });

 $('bq-save-txt')?.addEventListener('click',()=>{

  if(!artifact)return;

  const textToSave=$('bq-output')?.value||artifact.packet||(artifact.activeFormat==='armored'?artifact.armoredText:artifact.phraseText)||'';

  if(!textToSave){message('bq-status','保存可能なテキストがありません。',true);return;}

  const filename=(artifact.shamirN>1)?`cryptomatrix-encrypted-backup-${artifact.shamirM}of${artifact.shamirN}.txt`:'cryptomatrix-encrypted-backup.txt';

  downloadBlob(new Blob([textToSave],{type:'text/plain;charset=utf-8'}),filename);

  message('bq-status',`💾 暗号化バックアップテキスト（${filename}）を保存しました。`);

 });

 $('bq-save-qr')?.addEventListener('click',async()=>{

  const svgs=$('bq-qr-list')?.querySelectorAll('svg');

  if(!svgs||!svgs.length){message('bq-status','保存可能なQRコードがありません。',true);return;}

  if(svgs.length===1){

   const filename='cryptomatrix-encrypted-qr.png';

   if(window.MatrixCardPreset&&window.MatrixCardPreset.saveSvgAsPng){

    window.MatrixCardPreset.saveSvgAsPng(svgs[0],filename);

   }

   message('bq-status',`🖼️ 暗号化QRコード画像（${filename}）を保存しました。`);

   return;

  }

  for(let i=0;i<svgs.length;i++){

   const filename=artifact?.shamirN>1?`cryptomatrix-share${i+1}-qr.png`:`cryptomatrix-block${i+1}-qr.png`;

   if(window.MatrixCardPreset&&window.MatrixCardPreset.saveSvgAsPng){

    window.MatrixCardPreset.saveSvgAsPng(svgs[i],filename);

   }

   if(i<svgs.length-1)await new Promise(r=>setTimeout(r,250));

  }

  message('bq-status',`🖼️ 全${svgs.length}枚のQRコード画像を一括保存しました。`);

 });

 $('bq-save-cmenc')?.addEventListener('click',async()=>{

  if(!artifact)return;

  if(artifact.shamirN>1&&artifact.rawShareBytes?.length){

   for(let i=0;i<artifact.rawShareBytes.length;i++){

    const s=artifact.rawShareBytes[i];

    const filename=`cryptomatrix-encrypted-share${s.index}.cmenc`;

    downloadBlob(new Blob([s.bytes],{type:'application/octet-stream'}),filename);

    if(i<artifact.rawShareBytes.length-1)await new Promise(r=>setTimeout(r,250));

   }

   message('bq-status',`📁 全${artifact.shamirN}シェアの暗号化ファイル（.cmenc）を一括保存しました。`);

  }else if(artifact.rawBytes){

   const filename='cryptomatrix-encrypted-backup.cmenc';

   downloadBlob(new Blob([artifact.rawBytes],{type:'application/octet-stream'}),filename);

   message('bq-status',`📁 暗号化ファイル（${filename}）を保存しました。`);

  }else{

   message('bq-status','保存可能な暗号化バイナリがありません。',true);

  }

 });

  $('bq-test-restore')?.addEventListener('click',()=>{
  if(!artifact)return;
  const isArmored=(artifact.activeFormat==='armored');
  let textToImport='';
  if(artifact.shares&&artifact.shares.length>1){
   if(isArmored){
    textToImport=artifact.armoredShares.slice(0,artifact.shamirM).join('\n\n');
   }else{
    textToImport=artifact.shares.slice(0,artifact.shamirM).map(s=>s.groups.map(g=>g.join(' ')).join('\n')).join('\n\n');
   }
  }else{
   textToImport=isArmored?artifact.armoredText:artifact.phraseText;
  }
  const importElem=$('bq-import');
  if(importElem){
   importElem.value=textToImport;
  }
  if(artifact.createdPassword&&$('bq-restore-password')){
   $('bq-restore-password').value=artifact.createdPassword;
  }
  const sec3Restore=$('section-3-restore')||$('bq-import');
  if(sec3Restore)sec3Restore.scrollIntoView({behavior:'smooth'});
  message('bq-scan-status','作成されたバックアップデータを復元入力欄に転記しました。「読み込み・検証して内容を確認」を押して手動テストを行ってください。');
 });

 $('bq-transfer-keeweb')?.addEventListener('click',async()=>{

  if(!artifact)return;

  const siteVal=($('sim-site')?.value||'').trim();

  const cardPw=($('sim-output-pw')?.textContent||'').trim();

  const existingBqPw=($('bq-password')?.value||'').trim();

  const restorePw=artifact.usePass?(existingBqPw||window.prompt('KeeWebの保護された「パスワード」欄へ保存する復元用パスワードを入力してください（メモ欄には保存しません）。','')||''):'';

  if(artifact.usePass&&!restorePw){message('bq-status','KeeWeb転送を中止しました。復元用パスワードはKeePassの保護されたパスワード欄に保存するため、入力が必要です。',true);return;}

  const pw=artifact.usePass?restorePw:cardPw||'';

  const seedNum=$('input-seed-number')?.value||'0';

  const isArmored=(artifact.activeFormat==='armored');

  const textToSave=$('bq-output')?.value||artifact.packet||(isArmored?artifact.armoredText:artifact.phraseText)||'';



  // Synchronously request window open during active user gesture on touch devices / iOS Safari

  let pendingWin = openKeeWeb();



  const attachments=[];

  const qrSvgs=Array.from($('bq-qr-list')?.querySelectorAll('svg')||[]);

  if(window.MatrixCardPreset?.svgToPngBase64){

   for(let i=0;i<qrSvgs.length;i++){

    try{

     const qrBase64=await window.MatrixCardPreset.svgToPngBase64(qrSvgs[i],640);

     if(qrBase64)attachments.push({filename:qrSvgs.length>1?`cryptomatrix-encrypted-share${i+1}-qr.png`:'cryptomatrix-encrypted-qr.png',base64:qrBase64,mime:'image/png'});

    }catch(_){}

   }

  }



  if(window.MatrixCardPreset?.generateKeePassXmlKeyfile){

   try{

    const keyData=await window.MatrixCardPreset.generateKeePassXmlKeyfile({

     seedNum:(typeof parseSeedValue==='function'?parseSeedValue(seedNum):(parseInt(seedNum,10)||0)),

     password:cardPw||pw

    });

    if(keyData&&keyData.xml){

     attachments.push({

      filename:`matrix-card-${seedNum}.key`,

      text:keyData.xml,

      mime:'application/x-kdbx-keyfile'

     });

    }

   }catch(_){}

  }



  if(artifact.rawBytes){

   try{

    let bin='';const bytes=artifact.rawBytes,chunk=8192;

    for(let i=0;i<bytes.length;i+=chunk)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));

    attachments.push({

     filename:'cryptomatrix-encrypted-backup.cmenc',

     base64:btoa(bin),

     mime:'application/octet-stream'

    });

   }catch(_){}

  }

  if(artifact.rawShareBytes?.length){

   for(const share of artifact.rawShareBytes){

    try{

     let bin='';const bytes=share.bytes,chunk=8192;

     for(let i=0;i<bytes.length;i+=chunk)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));

     attachments.push({filename:`cryptomatrix-encrypted-share${share.index}.cmenc`,base64:btoa(bin),mime:'application/octet-stream'});

    }catch(_){}

   }

  }



  const title=siteVal?`${siteVal} (CryptoMatrix暗号化バックアップ)`:'CryptoMatrix 暗号化バックアップ';

  const notes=[

   '【CryptoMatrix 暗号化バックアップ情報】',

   `■ 保護方式: ${artifact.factorLabel}`,

   `■ カード配列シード番号 (seed): ${seedNum}`,

   `■ 復元形式: ${isArmored?'PGPアーマード形式':'BIP39 24単語ブロック形式'}`,

   `■ 秘密分散: ${artifact.shamirN>1?`${artifact.shamirM}-of-${artifact.shamirN} 秘密分散`:'なし（単一暗号化）'}`,

   ...(siteVal?[`■ 対象サイト/サービス: ${siteVal}`]:[]),

   '■ 復元用パスワード: KeePassの保護された「パスワード」欄にのみ保存（このメモには記録しません）',

   '',

   '【暗号化バックアップデータ】',

   textToSave,

   '',

   '【添付ファイルのご案内（全形式添付・安心保管）】',

   '1. cryptomatrix-encrypted-qr.png: 暗号化QRコード画像（スマホ・PCカメラで読み取り可能）',

   `2. matrix-card-${seedNum}.key: KeePassキーファイル（データベースの認証鍵としても使用可能）`,

   ...(artifact.rawBytes?['3. cryptomatrix-encrypted-backup.cmenc: 二重暗号化バイナリファイル（画面にドラッグ＆ドロップで一発復元可能）']:[]),

   '',

   '【復元方法】',

   'CryptoMatrixの「復元」欄に上記の暗号化データを貼り付けるか、添付のQRコード画像または.cmencファイルを読み込ませて復元用パスワードを入力するだけで、設定・合言葉を完全に復元できます。'

  ].join('\n');



  const baseAppUrl = window.location.href.split(/[?#]/)[0];

  localStorage.setItem('cm_active_seed',seedNum);

  (window.MatrixCardPreset?.setPendingKeeWebTransfer || window.setPendingKeeWebTransfer)('cm_pending_entry',{

   site:title,

   password:pw,

   username:`Protected-${artifact.factorLabel}`,

   url:`${baseAppUrl}#seed=${seedNum}${siteVal?'&site='+encodeURIComponent(siteVal):''}`,

   notes:notes,

   attachments:attachments,

   timestamp:Date.now()

  });



  const btn=$('bq-transfer-keeweb');

  if(btn){

   const origText=btn.innerHTML;

   btn.innerHTML='✅ KeeWeb転送準備完了！';

   btn.style.background='#dcfce7';

   btn.style.borderColor='#86efac';

   btn.style.color='#15803d';

   setTimeout(()=>{

    btn.innerHTML=origText;

    btn.style.background='#f0f9ff';

    btn.style.borderColor='#0284c7';

    btn.style.color='#0369a1';

   },3500);

  }

  message('bq-status','✅ KeeWeb転送データを準備しました。');

  {const _el=$('bq-status');if(_el){const _a=document.createElement('a');_a.href='keeweb/index.html';_a.target='_blank';_a.textContent='[🔑 KeeWebを開く]';_a.style.cssText='color:#0284c7;font-weight:700;text-decoration:underline;margin-left:6px;';_el.appendChild(_a);}}

  if(!pendingWin) openKeeWeb();

 });

 $('bq-save-xml')?.addEventListener('click',async()=>{

  if(!artifact)return;

  const qrSvg=$('bq-qr-list')?.querySelector('svg');

  const site=$('sim-site')?.value||'1Password';

  const existingBqXmlPw=($('bq-password')?.value||'').trim();

  const pw=artifact.usePass?(existingBqXmlPw||window.prompt('KeePassインポート用の保護されたパスワード欄へ保存する復元用パスワードを入力してください（メモ欄には保存しません）。','')||''):($('sim-output-pw')?.textContent||'').trim();

  if(artifact.usePass&&!pw){message('bq-status','KeePass用ファイルの出力を中止しました。復元用パスワードの入力が必要です。',true);return;}

  const notes=

`【Crypto Matrix 暗号化バックアップ情報】

■ 保護方式: ${artifact.factorLabel}

■ 対象サイト: ${site}

■ ブロック数: ${artifact.total}

■ 秘密分散: ${artifact.shamirN>1?`${artifact.shamirM}-of-${artifact.shamirN}`:'なし'}



【添付ファイルのご案内】

1. matrix-qr.png: 暗号化統合QRコード画像

2. matrix-backup.txt: 暗号化バックアップテキスト（${artifact.activeFormat==='armored'?'PGPアーマード形式':'BIP39 24単語ブロック形式'}）

※ KeePass / KeeWeb内で添付ファイルをダブルクリックすると、いつでもQR画像やテキストを表示・取り出しできます。`;



  if(window.MatrixCardPreset&&window.MatrixCardPreset.exportKeePassXmlWithAttachments){

   try{

    const filename=await window.MatrixCardPreset.exportKeePassXmlWithAttachments({

     title:`${site}-暗号化バックアップ`,

     username:`Protected-${artifact.factorLabel}`,

     password:pw,

     notes:notes,

     qrSvg:qrSvg,

     backupText:artifact.packet

    });

    message('bq-status',`📦 KeePass用インポートファイル（${filename}）を出力しました！KeePassやKeeWebにドラッグ＆ドロップすると、暗号化QRやデータが添付ファイルとして登録されます。`);

   }catch(e){

    message('bq-status','KeePass用ファイルの出力に失敗しました: '+e.message,true);

   }

  }

 });

 $('bq-print')?.addEventListener('click',()=>{

  if(!artifact||artifact.signature!==settingsSignature()){clearArtifact('入力・設定が変わりました。作成し直してください。');return;}

  window.print();

 });

 const syncOptions=()=>{syncProtectionUI();clearArtifact('保存条件が変わりました。暗号化バックアップを作成し直してください。');updatePassEntropy();};

 for(const id of ['bq-scope','bq-kdf','bq-shamir','bq-opt-password','bq-opt-keyfile','bq-opt-passkey','bq-password','bq-password-confirm']){

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

 $('bq-image')?.addEventListener('change',()=>void readImages($('bq-image').files));

 document.addEventListener('cm-route-backup-text',event=>{

  const text=event.detail?.text;

  if(!text)return;

  if($('bq-import'))$('bq-import').value=text;

  $('backup-qr')?.scrollIntoView({behavior:'smooth',block:'start'});

  message('bq-scan-status','暗号化バックアップを自動入力しました。必要な復元用パスワード／キーを入力して内容を確認してください。');

 });

 document.addEventListener('cm-route-backup-files',event=>void readImages(event.detail?.files));

 $('bq-reset-parts')?.addEventListener('click',()=>{parts=null;clearPending();message('bq-scan-status','読取中のQRブロックをリセットしました。');});

  

 $('btn-zeroize')?.addEventListener('click',()=>{

  createToken++;

  reviewToken++;

  stopCamera();

  if(generatedKeyfileBytes)MatrixCardPreset.zeroize?.(generatedKeyfileBytes);

  generatedKeyfileBytes=null;

  generatedKeyfileName='';

  closeDuressModal();

  clearArtifact();

  clearPending();

  parts=null;

  if($('bq-keyfile-status'))$('bq-keyfile-status').textContent='';

  message('bq-status','');

  message('bq-scan-status','');

 });



 $('btn-duress-close')?.addEventListener('click', closeDuressModal);

 $('btn-duress-skip')?.addEventListener('click', ()=>{

  if($('chk-duress-remember-skip')?.checked) localStorage.setItem('cm_skip_duress_popup','true');

  const cb = activeDuressCallback;

  activeDuressCancelCallback = null;

  closeDuressModal();

  if(cb) cb(null);

 });

 const DURESS_SAMPLE_SERVICES = [

  {

   site: 'amazon.co.jp',

   secret: 'AmazonShopping2026',

   pw: 'Amz#Shop2026Secure',

   vault: '【Amazon日常注文メモ】\n登録メアド: myuser@gmail.com\n注文用パスワード: Amz#Shop2026Secure\nポイント残高: 1,480pt\n定期おトク便: ミネラルウォーター（毎月第2火曜）'

  },

  {

   site: 'rakuten.co.jp',

   secret: 'RakutenIchiba#1',

   pw: 'Raku#Pass2026!Point',

   vault: '【楽天会員メモ】\n楽天ID: myuser@gmail.com\nパスワード: Raku#Pass2026!Point\n楽天ポイント: 820pt (期間限定: 200pt)\nお気に入り店舗: 楽天市場グルメ館'

  },

  {

   site: 'yahoo.co.jp',

   secret: 'YahooJapanPass#26',

   pw: 'Yahoo#Net2026Safe!',

   vault: '【Yahoo! JAPANメモ】\nYahoo! JAPAN ID: myuser_jp\nパスワード: Yahoo#Net2026Safe!\nPayPay連携: 連携済み（残高 540円）\nヤフオク出品中: 不要ゲームソフト'

  },

  {

   site: 'mercari.com',

   secret: 'MercariFleaMarket#2',

   pw: 'Mercari#2026Trade$',

   vault: '【メルカリアカウント】\nログイン: myuser@gmail.com\nパスワード: Mercari#2026Trade$\nメルペイ残高: 1,200円\n発送待ち: 文庫本 1点'

  },

  {

   site: 'yodobashi.com',

   secret: 'YodobashiCamera#2026',

   pw: 'Yodo#Camera2026Gold',

   vault: '【ヨドバシ・ドット・コム】\nID: myuser@gmail.com\nパスワード: Yodo#Camera2026Gold\nゴールドポイント: 2,340pt\nお届け先: 自宅'

  },

  {

   site: 'netflix.com',

   secret: 'NetflixMovieNight#3',

   pw: 'NetFlix#View2026Stream',

   vault: '【Netflixサブスクメモ】\nアカウント: family@gmail.com\nパスワード: NetFlix#View2026Stream\nプラン: スタンダード (月額1,490円)\nマイリスト: おすすめドキュメンタリー'

  },

  {

   site: 'spotify.com',

   secret: 'SpotifyMusicFan#2026',

   pw: 'Spoti#Sound2026Play!',

   vault: '【Spotifyアカウント】\nユーザー: music_user_2026\nパスワード: Spoti#Sound2026Play!\nプレイリスト: ドライブ用BGM 2026\nお気に入りポッドキャスト: ニュース解説'

  },

  {

   site: 'line.me',

   secret: 'LineChatSafePass#26',

   pw: 'Line#Talk2026Passkey',

   vault: '【LINEバックアップ情報】\nアカウント電話番号: 090-XXXX-XXXX\n引き継ぎパスワード: Line#Talk2026Passkey\nLINE Pay残高: 350円\nスタンプ購入履歴: 5件'

  }

 ];



 function populateDuressRandomPreset(){

  const rndSeed = String(Math.floor(10000000 + Math.random() * 90000000));

  const item = DURESS_SAMPLE_SERVICES[Math.floor(Math.random() * DURESS_SAMPLE_SERVICES.length)];

  if(activeDuressContext === 'sec3'){

   if($('duress-modal-site')) $('duress-modal-site').value = item.site;

   if($('duress-modal-secret')) $('duress-modal-secret').value = item.secret;

   if($('duress-modal-seed')) $('duress-modal-seed').value = rndSeed;

  } else {

   if($('duress-vault-text')) $('duress-vault-text').value = item.vault;

  }

 }



 document.querySelectorAll('.btn-toggle-pw-visibility').forEach(btn => {

  btn.addEventListener('click', () => {

   const targets = (btn.dataset.target || '').split(',').map(s => $(s.trim())).filter(Boolean);

   if(!targets.length) return;

   const isCurrentlyPassword = targets[0].type === 'password';

   targets.forEach(el => { el.type = isCurrentlyPassword ? 'text' : 'password'; });

   btn.textContent = isCurrentlyPassword ? '🙈 伏字にする' : '👁️ パスワードを表示';

  });

 });



 $('btn-duress-open-config')?.addEventListener('click', ()=>{

  if($('duress-choice-btns')) $('duress-choice-btns').hidden = true;

  if($('duress-modal-config')) $('duress-modal-config').hidden = false;

  if(activeDuressContext === 'sec3'){

   if(!$('duress-modal-site')?.value) populateDuressRandomPreset();

   $('duress-modal-pw')?.focus();

  } else {

   if(!$('duress-vault-text')?.value) populateDuressRandomPreset();

   $('duress-vault-pw')?.focus();

  }

 });

 $('btn-duress-modal-random')?.addEventListener('click', populateDuressRandomPreset);

 $('btn-duress-confirm-dual')?.addEventListener('click', ()=>{

  const errEl = $('duress-modal-error');

  const showErr = msg => { if(errEl){ errEl.textContent = msg; errEl.style.display='block'; } };

  const realPw = $('duress-modal')?.dataset.realPassword || '';

  if(activeDuressContext === 'sec3'){

   const dPass = $('duress-modal-pw')?.value || '';

   const dPassConf = $('duress-modal-pw-conf')?.value || '';

   if(dPass.length < 12) return showErr('おとり用パスワードは12文字以上で入力してください。');

   if(dPass !== dPassConf) return showErr('おとり用パスワードが確認用と一致しません。');

   if(dPass === realPw) return showErr('おとり用パスワードには、本命パスワードと異なるパスワードを設定してください。');

   if($('chk-duress-remember-skip')?.checked) localStorage.setItem('cm_skip_duress_popup','true');

   const duressOpts = {

    enabled: true,

    password: dPass,

    seed: $('duress-modal-seed')?.value || '11223344',

    site: $('duress-modal-site')?.value || 'shopping.example.com',

    secret: $('duress-modal-secret')?.value || 'shopping-safe-pass'

   };

   const cb = activeDuressCallback;

   activeDuressCancelCallback = null;

   closeDuressModal();

   if(cb) cb(duressOpts);

  } else {

   const dPass = $('duress-vault-pw')?.value || '';

   const dPassConf = $('duress-vault-pw-conf')?.value || '';

   if(dPass.length < 12) return showErr('おとり用パスワードは12文字以上で入力してください。');

   if(dPass !== dPassConf) return showErr('おとり用パスワードが確認用と一致しません。');

   if(dPass === realPw) return showErr('おとり用パスワードには、本命パスワードと異なるパスワードを設定してください。');

   if($('chk-duress-remember-skip')?.checked) localStorage.setItem('cm_skip_duress_popup','true');

   const dText = $('duress-vault-text')?.value || '【日常メモ】\nアマゾン: myuser@gmail.com / Pass123\n楽天ポイント: 500pt';

   const duressOpts = {

    enabled: true,

    password: dPass,

    text: dText

   };

   const cb = activeDuressCallback;

   activeDuressCancelCallback = null;

   closeDuressModal();

   if(cb) cb(duressOpts);

  }

 });



  window.addEventListener('pagehide',()=>stopCamera());

  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')stopCamera();});

 });

})();
