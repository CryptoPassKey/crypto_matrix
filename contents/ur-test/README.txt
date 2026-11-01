QuickDrop — UR / BC-UR test page

Main page:
- index.html redirects to ur-quickdrop-test-fixed.html
- ur-quickdrop-test-fixed.html is the current BC-UR browser test page

Other files:
- qr-encoder.js and jsQR.js are kept separately for inspection/provenance; the HTML embeds their code and does not need these files alongside it.

Run:
1. Open the folder URL (index.html) or ur-quickdrop-test-fixed.html. The BC-UR JS library is loaded from esm.sh with crc@3.8.0 pinned explicitly; Buffer is loaded from esm.sh. Internet access is required for initial load.
2. For camera reception, serve over HTTPS or localhost (camera permissions do not normally work from file://).
3. On sender, enter text or choose a file, click "URを生成", then "再生".
4. On receiver, click "カメラ開始" and scan the animated QR.

Protocol:
- Uses @ngraveio/bc-ur 1.1.13 (MIT), UREncoder/URDecoder, UR type `bytes`.
- Arbitrary data is placed inside a JSON envelope and then encoded as UR bytes, so this test is not a custom registered UR type and is not yet a final QuickDrop wire format.
- Max original payload: 500 KiB (test limit). Envelope is JSON and expands binary files.
- SHA-256 is checked after reconstruction. UR's own encoding/checksum handling is delegated to the library.
- No encryption. Do not use real secrets in a shared/public environment.
- Camera-to-camera end-to-end testing has not been performed in this environment.
