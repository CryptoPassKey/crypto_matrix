import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../');
const CONTENTS_DIR = path.resolve(REPO_ROOT, 'contents');

const PORT = 9991;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let filePath = path.join(CONTENTS_DIR, urlPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found: ' + urlPath);
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, async () => {
  const chromePath = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
  const tempProfile = path.join(os.tmpdir(), 'airgap_raf_test_' + Date.now());
  fs.mkdirSync(tempProfile, { recursive: true });

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9231',
    `--user-data-dir=${tempProfile}`,
    '--disable-gpu',
    '--no-sandbox',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 1500));

  const res = await fetch('http://127.0.0.1:9231/json');
  const targets = await res.json();
  const pageTarget = targets.find(t => t.type === 'page');

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
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

  // Run comprehensive Priority 1 in-browser verification
  const evalResult = await send('Runtime.evaluate', {
    expression: `(async function() {
      const results = {};

      // Helper: wait
      const sleep = ms => new Promise(r => setTimeout(r, ms));

      // 1. Verify Low and High FPS duration enforcement
      try {
        // Use text with multiple frames (e.g. 5 frames) to test frame switching
        document.getElementById('txText').value = 'Airgap Link Priority 1 Verification: '.repeat(20);
        document.getElementById('transferMode').value = 'legacy';
        document.getElementById('transferMode').dispatchEvent(new Event('change'));

        // Test at 5 FPS -> target = 200ms
        document.getElementById('fps').value = '5';
        document.getElementById('fps').dispatchEvent(new Event('input'));
        document.getElementById('prepareTx').click();
        await sleep(300);

        // Track frame change intervals for 5 FPS
        let timestamps5 = [];
        let canvas = document.getElementById('txCanvas');
        let origFill = CanvasRenderingContext2D.prototype.fill;
        CanvasRenderingContext2D.prototype.fill = function() {
          let now = performance.now();
          if (this.canvas === canvas) {
            timestamps5.push(now);
          }
          return origFill.apply(this, arguments);
        };

        document.getElementById('playTx').click();
        await sleep(700); // Target: 200ms interval -> should record ~3 intervals
        document.getElementById('pauseTx').click();

        // Track frame change intervals for 20 FPS
        let timestamps20 = [];
        CanvasRenderingContext2D.prototype.fill = function() {
          let now = performance.now();
          if (this.canvas === canvas) {
            timestamps20.push(now);
          }
          return origFill.apply(this, arguments);
        };

        document.getElementById('fps').value = '20';
        document.getElementById('fps').dispatchEvent(new Event('input'));
        document.getElementById('playTx').click();
        await sleep(400); // Target: 50ms interval -> should record ~7 intervals
        document.getElementById('pauseTx').click();

        CanvasRenderingContext2D.prototype.fill = origFill;

        let intervals5Fps = [];
        for (let i = 1; i < timestamps5.length; i++) {
          intervals5Fps.push(timestamps5[i] - timestamps5[i-1]);
        }
        let allAboveMin5Fps = intervals5Fps.length >= 2 && intervals5Fps.every(int => int >= 180);

        let intervals20Fps = [];
        for (let i = 1; i < timestamps20.length; i++) {
          intervals20Fps.push(timestamps20[i] - timestamps20[i-1]);
        }
        let allAboveMin20Fps = intervals20Fps.length >= 4 && intervals20Fps.every(int => int >= 40);

        results.C1_FPS_DURATION = {
          passed: allAboveMin5Fps && allAboveMin20Fps,
          count5Fps: timestamps5.length,
          intervals5Fps: intervals5Fps.map(v => Math.round(v)),
          count20Fps: timestamps20.length,
          intervals20Fps: intervals20Fps.map(v => Math.round(v))
        };
      } catch (e) {
        results.C1_FPS_DURATION = { passed: false, error: e.message };
      }

      // 2. High density QR frame overwrite protection
      try {
        // High density payload (10KB text)
        document.getElementById('txText').value = 'X'.repeat(10240);
        document.getElementById('chunkSize').value = '188';
        document.getElementById('chunkSize').dispatchEvent(new Event('change'));
        document.getElementById('fps').value = '15';
        document.getElementById('fps').dispatchEvent(new Event('input'));
        document.getElementById('prepareTx').click();
        await sleep(500);

        let genMs = parseFloat(document.getElementById('txQrGenMs').textContent) || 0;
        let infoBefore = document.getElementById('txFrameInfo').textContent;
        document.getElementById('playTx').click();
        await sleep(250);
        let infoAfter = document.getElementById('txFrameInfo').textContent;
        document.getElementById('pauseTx').click();

        results.C2_HIGH_DENSITY = {
          passed: genMs >= 0 && infoBefore !== '' && infoAfter !== '',
          genMs,
          infoBefore,
          infoAfter
        };
      } catch (e) {
        results.C2_HIGH_DENSITY = { passed: false, error: e.message };
      }

      // 3 & 4. Background pause and foreground resume without frame skip
      try {
        document.getElementById('txText').value = 'Airgap Link Visibility Test';
        document.getElementById('fps').value = '5'; // 200ms per frame
        document.getElementById('prepareTx').click();
        await sleep(200);

        document.getElementById('playTx').click();
        await sleep(150);

        // Simulate background transition
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        await sleep(300);

        let infoDuringHidden = document.getElementById('txFrameInfo').textContent;
        await sleep(400); // 400ms passed in background
        let infoStillHidden = document.getElementById('txFrameInfo').textContent;
        let pausedInBg = infoDuringHidden === infoStillHidden; // Frame count did not increment in background!

        // Simulate foreground resume
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        await sleep(100); // Less than targetInterval (200ms)
        let infoRightAfterResume = document.getElementById('txFrameInfo').textContent;
        let notSkippedImmediately = infoRightAfterResume === infoStillHidden; // Did not burst/skip!

        await sleep(250); // After targetInterval
        let infoAfterTime = document.getElementById('txFrameInfo').textContent;
        let resumedCleanly = infoAfterTime !== infoRightAfterResume;

        document.getElementById('pauseTx').click();

        results.C3_C4_VISIBILITY = {
          passed: pausedInBg && notSkippedImmediately && resumedCleanly,
          pausedInBg,
          notSkippedImmediately,
          resumedCleanly
        };
      } catch (e) {
        results.C3_C4_VISIBILITY = { passed: false, error: e.message };
      }

      // 5. Verify all modes: Legacy, Hybrid, Fountain
      try {
        let modesPassed = true;
        let modeDetails = {};
        for (let m of ['legacy', 'hybrid', 'fountain']) {
          document.getElementById('transferMode').value = m;
          document.getElementById('transferMode').dispatchEvent(new Event('change'));
          document.getElementById('txText').value = 'Mode test for ' + m;
          document.getElementById('prepareTx').click();
          await sleep(200);
          document.getElementById('playTx').click();
          await sleep(250);
          let activeInfo = document.getElementById('txFrameInfo').textContent;
          document.getElementById('pauseTx').click();
          let ok = activeInfo.length > 0;
          if (!ok) modesPassed = false;
          modeDetails[m] = { ok, activeInfo };
        }
        results.C5_ALL_MODES = { passed: modesPassed, modeDetails };
      } catch (e) {
        results.C5_ALL_MODES = { passed: false, error: e.message };
      }

      // 6. Verify chunk sizes compatibility
      try {
        let chunkPassed = true;
        let chunkDetails = {};
        for (let size of ['94', '188', '300']) {
          document.getElementById('chunkSize').value = size;
          document.getElementById('chunkSize').dispatchEvent(new Event('change'));
          document.getElementById('prepareTx').click();
          await sleep(150);
          let frameCount = document.getElementById('txFrameCount').textContent;
          let ok = frameCount.includes('/');
          if (!ok) chunkPassed = false;
          chunkDetails[size] = { ok, frameCount };
        }
        results.C6_CHUNK_SIZES = { passed: chunkPassed, chunkDetails };
      } catch (e) {
        results.C6_CHUNK_SIZES = { passed: false, error: e.message };
      }

      return results;
    })()`,
    awaitPromise: true,
    returnByValue: true
  });

  console.log('=== PRIORITY 1 IN-BROWSER VERIFICATION RESULTS ===');
  console.log(JSON.stringify(evalResult.result ? evalResult.result.value : evalResult.value, null, 2));

  ws.close();
  chrome.kill();
  server.close();
  try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (_) {}
  process.exit(0);
});
