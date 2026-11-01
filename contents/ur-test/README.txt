QuickDrop — UR / BC-UR test page

Main page:
- index.html redirects to ur-quickdrop-test-fixed.html
- ur-quickdrop-test-fixed.html is the current BC-UR browser test page

Other files:
- qr-encoder.js and jsQR.js are kept separately for inspection/provenance; the HTML embeds their code and does not need these files alongside it.

Run:
1. Open the folder URL (index.html) or ur-quickdrop-test-fixed.html. The BC-UR JS library is loaded from esm.sh with crc@3.8.0 pinned explicitly. The page loads the Buffer polyfill first, assigns the same constructor to globalThis.Buffer, and only then imports BC-UR; this is required by cbor-sync's instanceof Buffer check. Internet access is required for initial load.
2. For camera reception, serve over HTTPS or localhost (camera permissions do not normally work from file://).
3. On sender, enter text or choose a file, click "URを生成", then "再生".
4. On receiver, click "カメラ開始" and scan the animated QR.

Protocol and current performance settings:
- Uses @ngraveio/bc-ur 1.1.13, UREncoder/URDecoder, and standard UR type `bytes`.
- Payload is wrapped in a compact private QDP v1 binary envelope, not a JSON numeric array. It stores kind, filename, MIME type, payload length, original bytes, and a SHA-256 digest.
- UR fragment payload length: 180 bytes. Default display interval: 350 ms (about 2.9 frames/second); UI options range from 250 ms to 1000 ms.
- Repeated identical camera-read frames are ignored before passing them to URDecoder.
- Max original payload: 500 KiB (test limit).
- This is UR-compatible at the `ur:bytes` transport level, but the inner QDP v1 envelope is CryptoMatrix-specific; other UR apps will not interpret the original payload automatically.
- SHA-256 is checked after reconstruction. UR's own encoding/checksum handling is delegated to the library.
- No encryption. Do not use real secrets in a shared/public environment.
- Camera-to-camera end-to-end testing has not been performed in this environment.
