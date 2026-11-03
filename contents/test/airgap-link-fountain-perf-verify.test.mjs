// airgap-link-fountain-perf-verify.test.mjs
// Verification test suite for Priority 5: Fountain Reconstruction Optimization
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const PORT = 9995;
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
    '--remote-debugging-port=9226',
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
        const res = await fetch('http://127.0.0.1:9226/json');
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

    // Execute in-browser Priority 5 tests
    const evalRes = await sendCommand('Runtime.evaluate', {
      expression: `(async () => {
        const results = {};
        const Fountain = window.AirgapLinkFountain;
        const Core = window.AirgapLinkCore;

        function generateTestBytes(size) {
          const buf = new Uint8Array(size);
          let s = 0xabcdef;
          for (let i = 0; i < size; i++) {
            s = (s * 1664525 + 1013904223) >>> 0;
            buf[i] = s & 0xff;
          }
          return buf;
        }

        // --- P5.1: Ingest & Mathematical Correctness ---
        {
          const data = generateTestBytes(1024);
          const enc = new Fountain.Encoder(data, { chunkSize: 94, id: 'A1B2C3D4' });
          const rx = new Fountain.Receiver();
          
          // Drop 2 packets (index 2 and 8)
          const systematic = [];
          for (let i = 0; i < enc.seqLen; i++) {
            const p = await enc.nextPart();
            if (i !== 2 && i !== 8) systematic.push(p.frame);
          }
          // Feed out of order
          for (let i = systematic.length - 1; i >= 0; i--) await rx.feed(systematic[i]);

          // Feed repair packets
          let repairFed = 0;
          while (!rx.isComplete() && repairFed < 100) {
            const p = await enc.nextPart();
            await rx.feed(p.frame);
            repairFed++;
          }

          const restored = rx.bytes();
          let exactMatch = restored.length === data.length;
          for (let i = 0; i < data.length && exactMatch; i++) {
            if (restored[i] !== data[i]) exactMatch = false;
          }

          results.P5_1_MATHEMATICAL_CORRECTNESS = {
            passed: exactMatch && rx.isComplete(),
            exactMatch,
            decodedBlocks: rx.simpleParts.size,
            recoveredCount: rx.recoveredIndexes.size,
            repairFed
          };
        }

        // --- P5.2: Calculation Performance across Chunk Sizes ---
        {
          const sizes = [10 * 1024, 50 * 1024, 100 * 1024];
          const perfData = {};
          let allUnderBudget = true;

          for (const size of sizes) {
            const data = generateTestBytes(size);
            const chunkSize = 180;
            const enc = new Fountain.Encoder(data, { chunkSize });
            const K = enc.seqLen;
            const rx = new Fountain.Receiver();

            const sys = [];
            for (let i = 0; i < K; i++) sys.push(await enc.nextPart());

            // 20% loss
            const drop = new Set();
            const dropCount = Math.floor(K * 0.2);
            for (let d = 0; d < dropCount; d++) drop.add(d * 5);

            enc.startRepairPhase();
            const repairs = [];
            for (let r = 0; r < Math.max(K * 2, 200); r++) repairs.push(await enc.nextPart());

            const t0 = performance.now();
            let fed = 0;
            for (let i = 0; i < K; i++) {
              if (!drop.has(i)) { await rx.feed(sys[i].frame); fed++; }
            }
            for (let r = 0; r < repairs.length && !rx.isComplete(); r++) {
              await rx.feed(repairs[r].frame);
              fed++;
            }
            const totalMs = performance.now() - t0;
            const avgPerPacketMs = totalMs / fed;
            if (avgPerPacketMs > 5.0) allUnderBudget = false;

            perfData['size_' + (size / 1024) + 'KB'] = {
              totalMs: Number(totalMs.toFixed(2)),
              avgPerPacketMs: Number(avgPerPacketMs.toFixed(3)),
              fed,
              complete: rx.isComplete()
            };
          }

          results.P5_2_CALCULATION_PERFORMANCE = {
            passed: allUnderBudget,
            perfData
          };
        }

        // --- P5.3: Deduplication & Early Systematic Skip ---
        {
          const data = generateTestBytes(500);
          const enc = new Fountain.Encoder(data, { chunkSize: 100 });
          const rx = new Fountain.Receiver();
          const p1 = await enc.nextPart();
          const r1 = await rx.feed(p1.frame);

          // Feed same systematic frame again
          const r2 = await rx.feed(p1.frame);

          // Feed repair frame twice
          enc.startRepairPhase();
          const repair = await enc.nextPart();
          const r3 = await rx.feed(repair.frame);
          const r4 = await rx.feed(repair.frame);

          results.P5_3_DEDUPLICATION = {
            passed: r1.duplicate === false && r2.duplicate === true && r3.duplicate === false && r4.duplicate === true,
            sysFirstDuplicate: r1.duplicate,
            sysSecondDuplicate: r2.duplicate,
            repairFirstDuplicate: r3.duplicate,
            repairSecondDuplicate: r4.duplicate
          };
        }

        // --- P5.4: Inverted Index & Memory Lifecycle ---
        {
          const rx = new Fountain.Receiver();
          rx.reset();
          const hasInvertedIndex = rx.indexToEquations instanceof Map;
          
          // Ingest frames and verify index updates
          const data = generateTestBytes(1000);
          const enc = new Fountain.Encoder(data, { chunkSize: 180 });
          enc.startRepairPhase();
          const frame1 = (await enc.nextPart()).frame;
          await rx.feed(frame1);

          const indexMapSizeAfterFeed = rx.indexToEquations.size;
          rx.reset();
          const indexMapSizeAfterReset = rx.indexToEquations.size;

          results.P5_4_MEMORY_AND_LIFECYCLE = {
            passed: hasInvertedIndex && indexMapSizeAfterFeed > 0 && indexMapSizeAfterReset === 0,
            hasInvertedIndex,
            indexMapSizeAfterFeed,
            indexMapSizeAfterReset
          };
        }

        // --- P5.5: UI Live Scan Pipeline Integration ---
        {
          const txInput = document.getElementById('txInput');
          if (txInput) txInput.value = 'Priority 5 Verification Live UI Ingestion Test';
          const transferModeSelect = document.getElementById('transferMode');
          if (transferModeSelect) {
            transferModeSelect.value = 'fountain';
            transferModeSelect.dispatchEvent(new Event('change'));
          }

          results.P5_5_UI_INTEGRATION = {
            passed: !!transferModeSelect && transferModeSelect.value === 'fountain',
            modeSelected: transferModeSelect ? transferModeSelect.value : null
          };
        }

        return results;
      })()`,
      returnByValue: true,
      awaitPromise: true
    });

    console.log('=== PRIORITY 5 IN-BROWSER FOUNTAIN OPTIMIZATION VERIFICATION RESULTS ===');
    console.log(JSON.stringify(evalRes.result.value, null, 2));

    const testResults = evalRes.result.value;
    let allPassed = true;
    for (const [name, res] of Object.entries(testResults)) {
      if (!res.passed) {
        console.error(`FAIL: ${name}`);
        allPassed = false;
      }
    }

    if (allPassed) {
      console.log('\n>>> ALL PRIORITY 5 TESTS PASSED SUCCESSFULLY! <<<');
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
