
import { Buffer } from 'https://esm.sh/buffer@6.0.3';
globalThis.Buffer = Buffer;
const { UR, UREncoder, URDecoder } = await import('https://esm.sh/@ngraveio/bc-ur@1.1.13?bundle&target=es2022&deps=crc@3.8.0');
(()=>{'use strict';
const $=id=>document.getElementById(id),MAX=500*1024;let encoder=null,playTimer=null,frameIndex=0,stream=null,scanTimer=null,scanBusy=false,decoder=null,completed=null,sendParts=0,seenParts=new Set();
const enc=new TextEncoder(),dec=new TextDecoder();
async function sha256(bytes){const h=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('')}
let fragmentLength=300;
const ENVELOPE_MAGIC=Uint8Array.of(0x51,0x44,0x50,0x01); // QDP v1
async function buildEnvelope(payload,name,mime,kind){
 const nameBytes=enc.encode(name||'received.bin'),mimeBytes=enc.encode(mime||'application/octet-stream');
 if(nameBytes.length>4096||mimeBytes.length>1024)throw Error('ファイル名またはMIME typeが長すぎます');
 const bodyOffset=13+nameBytes.length+mimeBytes.length;
 const result=new Uint8Array(bodyOffset+payload.length+32);
 result.set(ENVELOPE_MAGIC,0);result[4]=kind==='file'?1:0;
 const view=new DataView(result.buffer);
 view.setUint16(5,nameBytes.length,false);view.setUint16(7,mimeBytes.length,false);view.setUint32(9,payload.length,false);
 result.set(nameBytes,13);result.set(mimeBytes,13+nameBytes.length);result.set(payload,bodyOffset);
 result.set(new Uint8Array(await crypto.subtle.digest('SHA-256',payload)),bodyOffset+payload.length);
 return result;
}
function toPayloadBytes(value){
 if(value instanceof Uint8Array)return new Uint8Array(value.buffer,value.byteOffset,value.byteLength).slice();
 if(value instanceof ArrayBuffer)return new Uint8Array(value).slice();
 if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength).slice();
 if(Array.isArray(value)&&value.every(x=>Number.isInteger(x)&&x>=0&&x<=255))return Uint8Array.from(value);
 if(value&&typeof value==='object'){
  if(value.type==='Buffer'&&Array.isArray(value.data))return Uint8Array.from(value.data);
  if(Array.isArray(value.data)&&value.data.every(x=>Number.isInteger(x)&&x>=0&&x<=255))return Uint8Array.from(value.data);
  const keys=Object.keys(value),isIndex=k=>k.length>0&&Array.from(k).every(ch=>ch>='0'&&ch<='9');
  if(keys.length&&keys.every(isIndex)&&keys.every(k=>Number.isInteger(value[k])&&value[k]>=0&&value[k]<=255))
   return Uint8Array.from(keys.sort((a,b)=>Number(a)-Number(b)).map(k=>value[k]));
 }
 throw Error('URのCBOR payloadをバイト列として取り出せません: '+Object.prototype.toString.call(value));
}
async function parseEnvelope(data){
 if(data.length<45||!ENVELOPE_MAGIC.every((v,i)=>data[i]===v))throw Error('QuickDrop転送ヘッダーが不正です（QDP v1ではありません）');
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
 const kind=data[4],nameLength=view.getUint16(5,false),mimeLength=view.getUint16(7,false),payloadLength=view.getUint32(9,false);
 if(kind!==0&&kind!==1)throw Error('未対応のデータ種別です');
 const metadataEnd=13+nameLength+mimeLength,payloadEnd=metadataEnd+payloadLength;
 if(metadataEnd>data.length||payloadEnd+32!==data.length)throw Error('転送データの長さが一致しません');
 const name=dec.decode(data.subarray(13,13+nameLength)),mime=dec.decode(data.subarray(13+nameLength,metadataEnd));
 const payload=data.slice(metadataEnd,payloadEnd),expected=data.subarray(payloadEnd,payloadEnd+32);
 const actual=new Uint8Array(await crypto.subtle.digest('SHA-256',payload));
 let diff=0;for(let i=0;i<32;i++)diff|=actual[i]^expected[i];
 if(diff!==0)throw Error('SHA-256不一致：データが破損しています');
 return {bytes:payload,name:name||'received.bin',mime:mime||'application/octet-stream',kind:kind===0?'text':'file'};
}
function qrSVG(text){const m=MatrixQRCode.matrix(text),n=m.length+8,ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${n} ${n}`);svg.setAttribute('shape-rendering','crispEdges');const bg=document.createElementNS(ns,'rect');bg.setAttribute('width',n);bg.setAttribute('height',n);bg.setAttribute('fill','#fff');svg.append(bg);let d='';for(let r=0;r<m.length;r++)for(let c=0;c<m.length;c++)if(m[r][c])d+=`M${c+4},${r+4}h1v1h-1z`;const p=document.createElementNS(ns,'path');p.setAttribute('d',d);p.setAttribute('fill','#000');svg.append(p);return svg}
function showFrame(){if(!encoder)return;try{const part=encoder.nextPart();$('qrBox').replaceChildren(qrSVG(part));frameIndex++;$('frameInfo').textContent=`表示フレーム ${frameIndex}（Fountain Codeのため総フレーム数は固定ではありません）`;$('sendBar').style.width=`${Math.min(100,frameIndex/Math.max(1,sendParts)*100)}%`;$('sendStatus').textContent=`送信中：URフレームを生成しています`;}catch(e){$('sendStatus').textContent='フレーム生成エラー：'+e.message;$('sendStatus').className='status err';stopPlay()}}
function stopPlay(){if(playTimer)clearTimeout(playTimer);playTimer=null;$('play').disabled=!encoder;$('pause').disabled=true}
function play(){if(!encoder)return;stopPlay();$('play').disabled=true;$('pause').disabled=false;const tick=()=>{if(!playTimer&&$('pause').disabled)return;showFrame();playTimer=setTimeout(tick,Number($('speed').value));};playTimer=setTimeout(tick,0)}
$('prepare').onclick=async()=>{try{stopPlay();let bytes,name,mime,kind;if($('sendFile').files[0]){const f=$('sendFile').files[0];if(f.size>MAX)throw Error('試験ページのファイル上限は500KBです');bytes=new Uint8Array(await f.arrayBuffer());name=f.name;mime=f.type||'application/octet-stream';kind='file'}else{const text=$('sendText').value;if(!text)throw Error('テキストを入力するかファイルを選択してください');bytes=enc.encode(text);if(bytes.length>MAX)throw Error('試験ページのデータ上限は500KBです');name='message.txt';mime='text/plain;charset=utf-8';kind='text'}if(bytes.length>MAX)throw Error('試験ページのデータ上限は500KBです');const envelope=await buildEnvelope(bytes,name,mime,kind);fragmentLength=Number($('fragmentSize')?.value||300);const ur=UR.fromBuffer(Buffer.from(envelope));encoder=new UREncoder(ur,fragmentLength,0);frameIndex=0;sendParts=Math.max(1,Math.ceil(envelope.length/fragmentLength));$('urType').textContent='bytes';$('sendStatus').textContent=`準備完了：元データ ${bytes.length.toLocaleString()} bytes、転送データ ${envelope.length.toLocaleString()} bytes（バイナリヘッダー＋SHA-256）。UR分割目安 ${sendParts} · 1フレーム ${fragmentLength} bytes。`;$('sendStatus').className='status ok';$('play').disabled=false;$('pause').disabled=true;$('fullBtn').disabled=false;showFrame();}catch(e){encoder=null;$('sendStatus').textContent='生成失敗：'+e.message;$('sendStatus').className='status err'}};
$('play').onclick=play;$('pause').onclick=()=>{stopPlay();$('sendStatus').textContent='再生停止中'};$('speed').onchange=()=>{if(playTimer){clearTimeout(playTimer);playTimer=null;play()}};
$('fullBtn').onclick=()=>{document.body.classList.add('full');};$('exitFull').onclick=()=>document.body.classList.remove('full');window.addEventListener('keydown',e=>{if(e.key==='Escape')document.body.classList.remove('full')});
function resetReceive(){decoder=new URDecoder();seenParts.clear();completed=null;$('recvBar').style.width='0%';$('recvInfo').textContent='';$('result').hidden=true;$('recvStatus').textContent='待機中';$('recvStatus').className='status'}
function updateProgress(){if(!decoder)return;let p=0;try{p=decoder.estimatedPercentComplete?.()??decoder.getProgress?.()??0}catch{}p=Math.max(0,Math.min(1,Number(p)||0));$('recvBar').style.width=`${p*100}%`;let details='';try{details=`進捗推定 ${(p*100).toFixed(1)}% · 受信パーツ ${decoder.processedPartsCount??'—'}`}catch{}$('recvInfo').textContent=details}
async function ingest(raw){const part=String(raw||'').trim();if(!/^ur:[a-z0-9-]+\//i.test(part))return false;try{if(seenParts.has(part))return true;if(!decoder)decoder=new URDecoder();decoder.receivePart(part);seenParts.add(part);updateProgress();$('recvStatus').textContent='URフレームを受信中';$('recvStatus').className='status';if(decoder.isComplete()){if(!decoder.isSuccess())throw Error(String(decoder.resultError?.()||'UR復元に失敗しました'));const ur=decoder.resultUR();if(ur.type!=='bytes')throw Error('未対応のUR type: '+String(ur.type));const decoded=ur.decodeCBOR();const transportBytes=toPayloadBytes(decoded);completed=await parseEnvelope(transportBytes);$('result').hidden=false;$('resultMeta').textContent=`${completed.name} · ${completed.bytes.length.toLocaleString()} bytes · UR type: ${ur.type||'bytes'} · SHA-256一致`;$('resultText').value=completed.kind==='text'?dec.decode(completed.bytes):'(ファイルデータです。ファイルとして保存してください)';$('copyResult').disabled=completed.kind!=='text';$('recvStatus').textContent='復元完了・SHA-256一致';$('recvStatus').className='status ok';$('recvBar').style.width='100%';return true}return true}catch(e){$('recvStatus').textContent='読み取りエラー：'+e.message;$('recvStatus').className='status err';return false}}
$('addManual').onclick=async()=>{const ok=await ingest($('manualFrame').value);if(!ok){$('recvStatus').textContent='URフレームとして認識できないか、復元処理でエラーが発生しました';$('recvStatus').className='status err'}};$('resetRecv').onclick=resetReceive;resetReceive();
async function scanTick(){if(!stream)return;try{const v=$('video'),c=$('scanCanvas');if(v.readyState>=2&&v.videoWidth&&!scanBusy){scanBusy=true;const scale=Math.min(1,1200/v.videoWidth);c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(v,0,0,c.width,c.height);const im=ctx.getImageData(0,0,c.width,c.height),r=jsQR(im.data,im.width,im.height,{inversionAttempts:'attemptBoth'});if(r)await ingest(r.data);scanBusy=false}}catch(e){scanBusy=false;$('recvStatus').textContent=e.message;$('recvStatus').className='status err'}if(stream)scanTimer=setTimeout(scanTick,90)}
$('startCamera').onclick=async()=>{try{if(!navigator.mediaDevices?.getUserMedia)throw Error('カメラにはHTTPSまたはlocalhostが必要です');stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:$('facing').checked?'environment':'user'},audio:false});$('video').srcObject=stream;$('video').hidden=false;await $('video').play();$('startCamera').disabled=true;$('stopCamera').disabled=false;$('recvStatus').textContent='カメラ読み取り中';scanTick()}catch(e){stream=null;$('recvStatus').textContent='カメラ開始失敗：'+e.message;$('recvStatus').className='status err'}};
function stopCamera(){if(scanTimer)clearTimeout(scanTimer);scanTimer=null;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}$('video').pause();$('video').srcObject=null;$('video').hidden=true;$('startCamera').disabled=false;$('stopCamera').disabled=true}$('stopCamera').onclick=stopCamera;
$('copyResult').onclick=async()=>{if(!completed||completed.kind!=='text')return;try{await navigator.clipboard.writeText(dec.decode(completed.bytes));$('recvStatus').textContent='コピーしました'}catch{$('recvStatus').textContent='コピーできません。テキスト欄から手動でコピーしてください'}};$('saveResult').onclick=()=>{if(!completed)return;const url=URL.createObjectURL(new Blob([completed.bytes],{type:completed.mime||'application/octet-stream'})),a=document.createElement('a');a.href=url;a.download=completed.name||'received.bin';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
window.addEventListener('pagehide',stopCamera);if(!window.isSecureContext)$('recvStatus').textContent='注意：カメラにはHTTPSまたはlocalhostが必要です。';
})().catch(e=>{document.getElementById('sendStatus').textContent='URライブラリの読み込みに失敗しました：'+e.message;document.getElementById('sendStatus').className='status err'});
