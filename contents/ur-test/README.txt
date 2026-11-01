QuickDrop — UR / BC-UR test page

Main page:
- index.html redirects to ur-quickdrop-test-fixed.html
- ur-quickdrop-test-fixed.html is the current BC-UR browser test page

Other files:
- qr-encoder.js and jsQR.js are kept separately for inspection/provenance; the HTML embeds their code and does not need these files alongside it.

Run:
1. Open the folder URL (index.html) or ur-quickdrop-test-fixed.html. The BC-UR JS library is loaded from esm.sh with crc@3.8.0 pinned explicitly. The page loads the Buffer polyfill first, assigns the same constructor to globalThis.Buffer, and only then imports BC-UR; this is required by cbor-sync's instanceof Buffer check. Internet access is required for initial load.
2. For camera reception, serve over HTTPS or localhost (camera permissions do not normally work from file://).
3. On sender, enter text or choose a file, click "URを生成", then "再生". Sender QR frames are painted into a persistent Canvas rather than rebuilt as SVG.
4. On receiver, click "カメラ開始" and scan the animated QR. The page prefers the browser's native BarcodeDetector API when QR support is available; otherwise it falls back to the bundled jsQR scanner. Active scanner mode is shown below the camera controls.

Protocol and performance settings:
- Uses @ngraveio/bc-ur 1.1.13, UREncoder/URDecoder, and standard UR type `bytes`.
- Payload is wrapped in a compact private QDP v1 binary envelope, not a JSON numeric array. It stores kind, filename, MIME type, payload length, original bytes, and a SHA-256 digest.
- UR fragment payload length is adjustable with a continuous slider from 80 to 1400 bytes (step 20, default 300). Changing the slider after preparation regenerates the UR stream immediately.
- Default display interval is 250 ms (4 frames/second); UI options range from 200 ms (5 fps) to 750 ms (about 1.3 fps).
- Camera request asks for up to 1920x1080 at 30 fps as an ideal, not a hard requirement. Native BarcodeDetector scans the video element; jsQR fallback samples a downscaled 1440px maximum canvas.
- Repeated identical camera-read frames are ignored before passing them to URDecoder.
- Max original payload: 500 KiB (test limit).
- This is UR-compatible at the `ur:bytes` transport level, but the inner QDP v1 envelope is CryptoMatrix-specific; other UR apps will not interpret the original payload automatically.
- SHA-256 is checked after reconstruction. UR's own encoding/checksum handling is delegated to the library.
- No encryption. Do not use real secrets in a shared/public environment.
- The current environment cannot validate camera-to-camera performance; measure with the target phone and PC. BarcodeDetector availability varies by browser.
