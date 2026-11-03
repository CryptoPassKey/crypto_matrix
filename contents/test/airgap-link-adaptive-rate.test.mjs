// airgap-link-adaptive-rate.test.mjs
// Verification test suite for Priority 6: Adaptive Speed / Rate Control
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const PORT = 9996;
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '/test' || reqPath === '/test/') {
    reqPath = '/contents/test/index.html';
  } else if (!reqPath.startsWith('/contents/')) {
    reqPath = '/contents' + (reqPath.startsWith('/') ? '' : '/') + reqPath;
  }
  const filePath = path.join(REPO_ROOT, reqPath.replace(/\//g, path.sep));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    let contentType = 'application/octet-stream';
    if (filePath.endsWith('.html')) contentType = 'text/html';
    else if (filePath.endsWith('.js')) contentType = 'application/javascript';
    else if (filePath.endsWith('.css')) contentType = 'text/css';
    else if (filePath.endsWith('.wasm')) contentType = 'application/wasm';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not Found: ' + reqPath);
  }
});

server.listen(PORT, async () => {
  console.log(`Server running at http://localhost:${PORT}`);
  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9227',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--mute-audio',
    'about:blank'
  ]);

  let cdpConnected = false;
  let ws = null;

  async function connectCDP() {
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch('http://127.0.0.1:9227/json');
        const list = await res.json();
        const pageTarget = list.find(t => t.type === 'page');
        if (pageTarget && pageTarget.webSocketDebuggerUrl) {
          return pageTarget.webSocketDebuggerUrl;
        }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('Chrome remote debugging target not found');
  }

  try {
    const wsUrl = await connectCDP();
    ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    cdpConnected = true;

    let reqId = 1;
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

    function sendCommand(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = reqId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await sendCommand('Page.enable');
    await sendCommand('Runtime.enable');

    console.log(`Navigating to http://localhost:${PORT}/test/index.html ...`);
    await sendCommand('Page.navigate', { url: `http://localhost:${PORT}/test/index.html` });
    await new Promise(r => setTimeout(r, 1200));

    // Execute in-browser Priority 6 adaptive rate control tests
    const evalRes = await sendCommand('Runtime.evaluate', {
      expression: `(async () => {
        const results = {};
        const controller = window.airgapRateController;
        if (!controller) throw new Error('window.airgapRateController not found');

        // --- R1: Initial State & Configurable Bounds ---
        {
          const chk = document.getElementById('autoFpsEnabled');
          const minInput = document.getElementById('minFps');
          const maxInput = document.getElementById('maxFps');
          const initialEnabled = controller.enabled;
          
          // Configure bounds
          minInput.value = '4';
          maxInput.value = '18';
          minInput.dispatchEvent(new Event('change'));
          maxInput.dispatchEvent(new Event('change'));

          results.R1_INITIAL_STATE_AND_BOUNDS = {
            passed: initialEnabled === false && controller.minFps === 4 && controller.maxFps === 18,
            initialEnabled,
            minFps: controller.minFps,
            maxFps: controller.maxFps
          };
        }

        // --- R2: Gradual Step Up under Stable High-Goodput Conditions ---
        {
          controller.enabled = true;
          controller.minFps = 3;
          controller.maxFps = 20;
          controller.currentFps = 6;
          controller.clearWindow();
          controller.lastEvalTime = performance.now() - 2000;
          controller.cooldownUntil = 0;

          // Simulate 10 high-quality frames: 100% hits, 12ms decode latency, 0 queue, 5 new fountain blocks
          controller.windowAttempts = 10;
          controller.windowHits = 10;
          controller.windowNovel = 8;
          controller.windowDuplicates = 2;
          controller.windowSamples = [11, 12, 13, 12, 11, 14, 12, 12, 11, 13];
          controller.windowQueueSum = 0;
          controller.windowQueueCount = 10;
          controller.windowStartDecoded = 10;
          
          // Mock fountainRx.simpleParts.size = 15 (+5 blocks progress)
          const origSize = window.fountainRx ? window.fountainRx.simpleParts.size : 0;
          if (window.fountainRx) {
            for (let i = 0; i < 15; i++) window.fountainRx.simpleParts.set(i, new Uint8Array(10));
          }

          controller.evaluate(performance.now());
          const fpsAfterStepUp = controller.currentFps;
          const statusAfterStepUp = controller.statusText;
          const isCooldownActive = controller.cooldownUntil > performance.now();

          // In immediate cooldown window, another evaluation must NOT increase speed again
          controller.lastEvalTime = performance.now() - 2000;
          controller.windowAttempts = 10;
          controller.windowHits = 10;
          controller.evaluate(performance.now());
          const fpsDuringCooldown = controller.currentFps;

          // Clean up mock
          if (window.fountainRx) window.fountainRx.simpleParts.clear();

          results.R2_GRADUAL_STEP_UP = {
            passed: fpsAfterStepUp === 7 && isCooldownActive && fpsDuringCooldown === 7,
            fpsBefore: 6,
            fpsAfterStepUp,
            statusAfterStepUp,
            fpsDuringCooldown
          };
        }

        // --- R3: Prompt Backoff on Receiver Queue Backlog ---
        {
          controller.enabled = true;
          controller.currentFps = 10;
          controller.clearWindow();
          controller.lastEvalTime = performance.now() - 2000;
          controller.cooldownUntil = 0;

          // Simulate queue backlog: queue length = 5
          controller.windowAttempts = 6;
          controller.windowHits = 6;
          controller.windowSamples = [15, 16, 15, 14, 15, 16];
          controller.windowQueueSum = 25;
          controller.windowQueueCount = 5;

          // Inject queue items
          window.airgapLinkTest.enqueueIngest('DUMMY');
          window.airgapLinkTest.enqueueIngest('DUMMY');
          window.airgapLinkTest.enqueueIngest('DUMMY');
          window.airgapLinkTest.enqueueIngest('DUMMY');

          controller.evaluate(performance.now());
          const fpsAfterBackoff = controller.currentFps;
          const statusAfterBackoff = controller.statusText;

          // Clear mock queue
          window.airgapLinkTest.getScanState();

          results.R3_QUEUE_BACKOFF = {
            passed: fpsAfterBackoff <= 8 && statusAfterBackoff.includes('キュー滞留'),
            fpsBefore: 10,
            fpsAfterBackoff,
            statusAfterBackoff
          };
        }

        // --- R4: Prompt Backoff on Decode Latency Saturation ---
        {
          controller.enabled = true;
          controller.currentFps = 12; // 83.3ms interval
          controller.clearWindow();
          controller.lastEvalTime = performance.now() - 2000;
          controller.cooldownUntil = 0;

          // Simulate heavy decode latency: P95 = 90ms (exceeds 85% of 83.3ms)
          controller.windowAttempts = 8;
          controller.windowHits = 8;
          controller.windowSamples = [60, 70, 75, 80, 85, 90, 95, 100];
          controller.windowQueueSum = 0;
          controller.windowQueueCount = 8;

          controller.evaluate(performance.now());
          const fpsAfterLatencyDrop = controller.currentFps;
          const statusAfterLatencyDrop = controller.statusText;

          results.R4_LATENCY_BACKOFF = {
            passed: fpsAfterLatencyDrop < 12 && statusAfterLatencyDrop.includes('遅延増加'),
            fpsBefore: 12,
            fpsAfterLatencyDrop,
            statusAfterLatencyDrop
          };
        }

        // --- R5: Backoff on Scan Misses / Low Hit Rate ---
        {
          controller.enabled = true;
          controller.currentFps = 8;
          controller.clearWindow();
          controller.lastEvalTime = performance.now() - 2000;
          controller.cooldownUntil = 0;

          // Simulate only 3 hits out of 10 attempts (30% hit rate)
          controller.windowAttempts = 10;
          controller.windowHits = 3;
          controller.windowSamples = [20, 22, 21];
          controller.windowQueueSum = 0;
          controller.windowQueueCount = 3;

          controller.evaluate(performance.now());
          const fpsAfterMisses = controller.currentFps;
          const statusAfterMisses = controller.statusText;

          results.R5_HIT_RATE_BACKOFF = {
            passed: fpsAfterMisses === 7 && statusAfterMisses.includes('検出率低下'),
            fpsBefore: 8,
            fpsAfterMisses,
            statusAfterMisses
          };
        }

        // --- R6: Stagnation / Redundant Inefficiency Detection ---
        {
          controller.enabled = true;
          controller.minFps = 3;
          controller.currentFps = 6;
          controller.clearWindow();
          controller.lastEvalTime = performance.now() - 2000;
          controller.cooldownUntil = 0;

          // 8 hits, but 7 duplicates, 0 fountain progress
          controller.windowAttempts = 8;
          controller.windowHits = 8;
          controller.windowNovel = 1;
          controller.windowDuplicates = 7; // 87.5% duplicate rate
          controller.windowSamples = [15, 16, 15, 15, 16, 15, 16, 15];
          controller.windowQueueSum = 0;
          controller.windowQueueCount = 8;
          controller.windowStartDecoded = 10;
          // Progress delta = 0

          controller.evaluate(performance.now());
          const fpsAfterStagnation = controller.currentFps;
          const statusAfterStagnation = controller.statusText;

          // Next, test clamping at minFps
          controller.currentFps = 3;
          controller.cooldownUntil = 0;
          controller.lastEvalTime = performance.now() - 2000;
          controller.windowAttempts = 8;
          controller.windowHits = 8;
          controller.windowDuplicates = 7;
          controller.evaluate(performance.now());
          const fpsClampedAtMin = controller.currentFps;

          results.R6_STAGNATION_DETECTION = {
            passed: fpsAfterStagnation === 5 && fpsClampedAtMin === 3 && statusAfterStagnation.includes('復元進捗停滞'),
            fpsBefore: 6,
            fpsAfterStagnation,
            fpsClampedAtMin,
            statusAfterStagnation
          };
        }

        // --- R7: UI Toggle & Restoration of Manual Fixed FPS ---
        {
          const chk = document.getElementById('autoFpsEnabled');
          const autoControls = document.getElementById('autoFpsControls');
          const fpsSlider = document.getElementById('fps');
          const fpsValueLabel = document.getElementById('fpsValue');

          // Check toggle on
          chk.checked = true;
          chk.dispatchEvent(new Event('change'));
          const visibleWhenChecked = autoControls.style.display !== 'none';
          const isControllerEnabled = controller.enabled;

          // Check toggle off
          chk.checked = false;
          chk.dispatchEvent(new Event('change'));
          const hiddenWhenUnchecked = autoControls.style.display === 'none';
          const isControllerDisabled = !controller.enabled;

          // Verify manual slider works normally
          fpsSlider.value = '14';
          fpsSlider.dispatchEvent(new Event('input'));
          const labelRestored = fpsValueLabel.textContent === '14 fps';

          results.R7_UI_TOGGLE_AND_MANUAL_RESTORE = {
            passed: visibleWhenChecked && isControllerEnabled && hiddenWhenUnchecked && isControllerDisabled && labelRestored,
            visibleWhenChecked,
            isControllerEnabled,
            hiddenWhenUnchecked,
            isControllerDisabled,
            labelRestored
          };
        }

        return results;
      })()`,
      returnByValue: true,
      awaitPromise: true
    });

    if (evalRes.exceptionDetails) {
      console.error('Eval error exceptionDetails:', JSON.stringify(evalRes.exceptionDetails, null, 2));
      throw new Error(evalRes.exceptionDetails.text || 'Evaluation failed');
    }

    console.log('=== PRIORITY 6 IN-BROWSER ADAPTIVE RATE CONTROL VERIFICATION RESULTS ===');
    console.log(JSON.stringify(evalRes.result ? evalRes.result.value : evalRes, null, 2));

    const testResults = evalRes.result.value;
    let allPassed = true;
    for (const [name, res] of Object.entries(testResults)) {
      if (!res.passed) {
        console.error(`FAIL: ${name}`);
        allPassed = false;
      }
    }

    if (allPassed) {
      console.log('\n>>> ALL PRIORITY 6 TESTS PASSED SUCCESSFULLY! <<<');
    } else {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Test error:', err);
    process.exitCode = 1;
  } finally {
    if (ws) ws.close();
    chromeProcess.kill();
    server.close();
  }
});
