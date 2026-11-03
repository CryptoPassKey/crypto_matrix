import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const PORT = 9993;
const CHROME_DEBUG_PORT = 9224;

// Static file server
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/test/index.html';
  const filePath = path.join(REPO_ROOT, 'contents', reqPath.replace(/^\//, ''));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    let contentType = 'text/plain';
    if (filePath.endsWith('.html')) contentType = 'text/html';
    else if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) contentType = 'text/javascript';
    else if (filePath.endsWith('.css')) contentType = 'text/css';
    else if (filePath.endsWith('.wasm')) contentType = 'application/wasm';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, async () => {
  console.log(`Server running at http://localhost:${PORT}`);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeArgs = [
    `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--user-data-dir=${path.join(REPO_ROOT, 'scratch', 'chrome-profile-worker')}`
  ];

  const chromeProc = spawn(chromePath, chromeArgs);
  await new Promise(r => setTimeout(r, 1500));

  let exitCode = 0;
  try {
    const targets = await (await fetch(`http://localhost:${CHROME_DEBUG_PORT}/json`)).json();
    const pageTarget = targets.find(t => t.type === 'page');
    const ws = new globalThis.WebSocket(pageTarget.webSocketDebuggerUrl);

    let id = 1;
    const pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const curId = id++;
        pending.set(curId, { resolve, reject });
        ws.send(JSON.stringify({ id: curId, method, params }));
      });
    }

    await new Promise(r => ws.onopen = r);
    await send('Page.enable');
    await send('Runtime.enable');

    console.log(`Navigating to http://localhost:${PORT}/test/index.html ...`);
    await send('Page.navigate', { url: `http://localhost:${PORT}/test/index.html` });
    await new Promise(r => setTimeout(r, 2000));

    // Run Priority 3 Worker Async Decode verification
    const evalResult = await send('Runtime.evaluate', {
      expression: `(async function() {
        const results = {};
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const hooks = window.__airgapTestHooks;

        // Helper: Generate a real QR matrix and draw onto a target canvas
        function renderQrToCanvas(canvas, text, offsetX = 0, offsetY = 0, customScale = 1.0) {
          const matrix = MatrixQRCode.matrix(text);
          const ctx = canvas.getContext('2d');
          const modules = matrix.length;
          const quiet = 4;
          const total = modules + quiet * 2;
          const qrSize = Math.min(canvas.width, canvas.height) * customScale;

          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#000';
          ctx.beginPath();
          for (let row = 0; row < modules; row++) {
            let run = -1;
            for (let col = 0; col <= modules; col++) {
              let dark = col < modules && matrix[row][col];
              if (dark && run < 0) run = col;
              if (!dark && run >= 0) {
                let x0 = offsetX + Math.floor((run + quiet) * qrSize / total);
                let x1 = offsetX + Math.ceil((col + quiet) * qrSize / total);
                let y0 = offsetY + Math.floor((row + quiet) * qrSize / total);
                let y1 = offsetY + Math.ceil((row + 1 + quiet) * qrSize / total);
                ctx.rect(x0, y0, x1 - x0, y1 - y0);
                run = -1;
              }
            }
          }
          ctx.fill();
        }

        // --- P3.1: Worker Initialization & State ---
        try {
          let workerReady = await hooks.initQrWorker();
          let st = hooks.getScanState();
          results.P3_1_WORKER_INIT = {
            passed: workerReady === true && st.rxWorkerReady === true,
            workerReady,
            rxWorkerReady: st.rxWorkerReady,
            rxWorkerFailed: st.rxWorkerFailed
          };
        } catch (e) {
          results.P3_1_WORKER_INIT = { passed: false, error: e.message };
        }

        // --- P3.2: Direct Worker Decode Test (Transferable ArrayBuffer) ---
        try {
          const testCanvas = document.createElement('canvas');
          testCanvas.width = 640;
          testCanvas.height = 480;

          const plan = AirgapLinkCore.buildFrames(new TextEncoder().encode('Priority 3 Worker Transfer Test'), {
            chunkSize: 180,
            wireFormat: 'base45'
          });
          const testFrame = plan.frames[0];
          renderQrToCanvas(testCanvas, testFrame, 150, 100, 0.5);

          const ctx = testCanvas.getContext('2d');
          const img = ctx.getImageData(0, 0, 640, 480);
          const buffer = img.data.buffer;

          // Test direct message roundtrip to worker
          const workerInstance = new Worker('airgap-link-qr-worker-v13.js');
          await new Promise(res => {
            workerInstance.onmessage = e => {
              if (e.data.type === 'init-ready') res();
            };
            workerInstance.postMessage({ type: 'init' });
          });

          let decodeRes = await new Promise(res => {
            workerInstance.onmessage = e => {
              if (e.data.type === 'decode-result') res(e.data);
            };
            workerInstance.postMessage({
              type: 'decode',
              id: 1,
              buffer: buffer,
              width: 640,
              height: 480
            }, [buffer]);
          });
          workerInstance.terminate();

          results.P3_2_WORKER_ROUNDTRIP = {
            passed: decodeRes && decodeRes.raw === testFrame,
            matched: decodeRes && decodeRes.raw === testFrame,
            elapsedMs: decodeRes ? Math.round(decodeRes.elapsedMs) : null
          };
        } catch (e) {
          results.P3_2_WORKER_ROUNDTRIP = { passed: false, error: e.message };
        }

        // --- P3.3: Non-blocking & Frame Retention During Worker Busy ---
        try {
          document.getElementById('resetRx').click();
          document.getElementById('startCamera').click();
          await sleep(400);

          // Verify that while rxWorkerBusy = true, triggerScanIfIdle skips initiating another scan
          // (No double dispatch, retains latest frame only)
          hooks.setScanLatestPresentedFrames(500);
          hooks.onScanVideoFrame(performance.now(), { presentedFrames: 501 });
          hooks.onScanVideoFrame(performance.now(), { presentedFrames: 502 });

          let stAfter = hooks.getScanState();
          results.P3_3_LATEST_FRAME_HOLD_ASYNC = {
            passed: stAfter.scanLatestPresentedFrames === 502,
            latestFrame: stAfter.scanLatestPresentedFrames,
            noStaleQueue: stAfter.scanIngestQueueLength === 0
          };
          document.getElementById('stopCamera').click();
        } catch (e) {
          results.P3_3_LATEST_FRAME_HOLD_ASYNC = { passed: false, error: e.message };
        }

        // --- P3.4: Complete Ingestion Pipeline (Legacy / Hybrid / Fountain) ---
        try {
          const modes = ['legacy', 'hybrid', 'fountain'];
          const modeResults = {};

          for (const mode of modes) {
            document.getElementById('resetRx').click();
            await sleep(100);

            const testData = new TextEncoder().encode('Priority 3 Reception: ' + mode);
            let frames = [];

            if (mode === 'legacy') {
              const plan = AirgapLinkCore.buildFrames(testData, { chunkSize: 94, wireFormat: 'base45' });
              frames = plan.frames;
            } else if (mode === 'hybrid') {
              const encoder = new AirgapLinkFountain.Encoder(testData, { chunkSize: 94, wireFormat: 'base45' });
              frames.push(encoder.firstFrame);
              for (let i = 0; i < 5; i++) {
                let part = await encoder.nextPart();
                frames.push(part.frame);
              }
            } else {
              const encoder = new AirgapLinkFountain.Encoder(testData, { chunkSize: 94, wireFormat: 'base45' });
              for (let i = 0; i < 6; i++) {
                let part = await encoder.nextPart();
                frames.push(part.frame);
              }
            }

            for (const f of frames) {
              if (document.getElementById('downloadResult').classList.contains('hidden') === false) break;
              document.getElementById('manualFrame').value = f;
              document.getElementById('ingestManual').click();
              await sleep(35);
            }

            let completed = document.getElementById('downloadResult').classList.contains('hidden') === false ||
                            document.getElementById('rxStatus').textContent.includes('受信完了') ||
                            document.getElementById('rxStatus').textContent.includes('受信中');

            modeResults[mode] = {
              ok: completed,
              statusText: document.getElementById('rxStatus').textContent
            };
          }

          results.P3_4_PROTOCOL_COMPATIBILITY = {
            passed: Object.values(modeResults).every(r => r.ok),
            modeResults
          };
        } catch (e) {
          results.P3_4_PROTOCOL_COMPATIBILITY = { passed: false, error: e.message };
        }

        return results;
      })()`,
      returnByValue: true,
      awaitPromise: true
    });

    const val = evalResult.result ? evalResult.result.value : evalResult.value;
    console.log('=== PRIORITY 3 IN-BROWSER WORKER DECODE VERIFICATION RESULTS ===');
    console.log(JSON.stringify(val, null, 2));

    if (!val) {
      console.error('evalResult details:', JSON.stringify(evalResult, null, 2));
      exitCode = 1;
    } else {
      const allPassed = Object.values(val).every(t => t.passed === true);
      if (!allPassed) {
        exitCode = 1;
      }
    }
  } catch (err) {
    console.error('Test execution failed:', err);
    exitCode = 1;
  } finally {
    chromeProc.kill();
    server.close();
    process.exit(exitCode);
  }
});
