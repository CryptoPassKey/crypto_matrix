# Airgap Link Test Lab

Independent experiment page for screen-to-camera, offline QR transport.

## Open

On GitHub Pages, the expected path is:

`https://cryptopasskey.github.io/crypto_matrix/contents/test/`

Local testing also works when served over HTTPS or localhost. Camera access requires a secure context.

## Dependencies

The transfer protocol, QR payloads, and camera frames remain local. ZXing-C++ WASM is the optional first-use decoder dependency:

- TX QR matrix: existing `../qr-encoder.js` (`window.MatrixQRCode`)
- RX native decoder: browser-native `BarcodeDetector` when QR Code is supported
- RX WASM decoder: pinned `zxing-wasm@3.1.6` reader-only IIFE and `zxing_reader.wasm`, loaded lazily from jsDelivr
- RX compatibility fallback: existing `../vendor/jsQR.js`
- Camera: `navigator.mediaDevices.getUserMedia`
- Optional compression: browser-native `CompressionStream('deflate')` / `DecompressionStream('deflate')`

The JavaScript reader is served through a same-origin Service Worker route and stored in a dedicated Cache Storage bucket. The WASM module is also cached there. After the first successful setup, ZXing can be initialized offline provided browser site data has not been cleared or evicted. The first ZXing load requires an Internet connection; Auto mode falls back to jsQR if the first load is offline. Frames and transferred payloads are not uploaded.

## CMAL1 transport

Data frames use the requested five-field structure:

`CMAL1:index/total:transferId:CRC32:base64urlPayload`

- Data indices are 1-based.
- `transferId` is 8 uppercase hex characters generated using `crypto.getRandomValues`.
- CRC32 is the standard CRC-32/ISO-HDLC (IEEE) checksum of the decoded fragment bytes.
- Fragment payloads are binary slices encoded as Base64URL for QR-safe ASCII.
- Data frames retain this format when parity is disabled, for the legacy CMAL1 data-frame path.

### Optional two-erasure parity

When enabled, the sender adds two parity packets after each group of up to 8 data fragments:

- `CMAL1:P0-group/total:transferId:CRC32:Base64URL` — XOR parity.
- `CMAL1:P1-group/total:transferId:CRC32:Base64URL` — weighted GF(256) parity.

The parity payload contains a version byte, member count, each original fragment length (uint16 big-endian), then the parity bytes. P0 and P1 are independent equations. With both parity packets, the receiver can restore up to 2 missing fragments in the same 8-fragment group. With only one parity packet, it can restore at most 1 missing fragment. More losses, or missing parity packets, require another pass through the animation.

This is a small block erasure code, **not** a fountain code and not RaptorQ. The parity switch can be turned off to emit only the original numeric CMAL1 data frames. The parity extension requires this test page on both ends; legacy receivers should use parity OFF.

## Compression experiment

Deflate is optional and is only used when the compressed result plus its 12-byte `CMZ1DEFL` marker and length header is smaller than the original. The receiver detects and expands the `CMZ1DEFL` wrapper after reassembly.

Encrypted data is already close to random and normally does not compress. For encrypted `.cmtl` files, leave compression off unless testing; the feature is mainly useful for compressible plaintext before encryption. A receiver that does not understand the optional `CMZ1DEFL` wrapper will produce the compressed wrapper bytes rather than the original data.

## UI/test settings

- Fragment size: 80–800 bytes (default 180 bytes)
- TX frame rate: 3–30 fps (default 6 fps)
- Parity: 2 parity frames per 8 data fragments
- QR quiet zone: 4 modules
- QR canvas: 720 × 720
- RX scanner: selectable Auto / Native BarcodeDetector / ZXing-C++ WASM / jsQR
- Auto preference: Native BarcodeDetector → ZXing-C++ WASM → jsQR
- ZXing-C++ WASM is cached in Cache Storage after first use and works offline after the assets have been cached
- Maximum source file size: 8,000,000 bytes in the UI (the protocol limits each transfer to at most 100,000 data fragments)

## Self-test coverage

The page's **プロトコル自己テスト** checks:

- CRC32 known vector: `123456789 → CBF43926`
- Frame construction and parse
- Six two-loss positions, including the final partial group
- One-loss recovery using only P1
- CRC field tamper rejection
- Numeric CMAL1 frames without parity, including multi-fragment reconstruction

Additional development checks performed before publishing this branch:

- 1,733-byte and 4,000-byte payload round trips
- Two missing data frames at the beginning, middle, and end of a parity group
- Last partial group handling
- Single-erasure recovery when P0 is missing
- 180-byte and 800-byte frame strings accepted by the local QR matrix generator (65 and 125 modules respectively)
- JavaScript syntax checks for the core and UI modules

Camera-to-camera testing still needs to be performed on real target devices. QR generation and decoder behavior vary with display pixel density, camera exposure, autofocus, device/browser implementation, and ambient light.

## Security notes

- Airgap Link is a transport mechanism, not an encryption layer. Transfer encrypted files.
- CRC32 detects accidental frame corruption; it is not an authentication tag and cannot prevent intentional tampering.
- Do not treat a successfully reconstructed file as authentic solely because all CRC32 checks pass. The encrypted file's own authenticated-encryption verification remains authoritative.
- Camera access is requested only after the user presses **カメラ開始**.
- There is no automatic upload, telemetry, or server-side relay.

## Live TX/RX block cursor

Both sides display one cell per original data block.

- TX advances a high-contrast cursor with each QR packet. Numeric data frames highlight one source block; P0/P1 parity frames highlight the corresponding group of up to eight blocks; LT fountain packets highlight every source block referenced by the current XOR equation.
- RX advances the cursor only after a valid packet is accepted by the protocol receiver. A data frame highlights its one block; a P0/P1 frame highlights its complete group; a fountain frame highlights the equation's selected source blocks. A repeated but valid QR still moves the cursor to the frame just read. Corrupt or rejected frames do not move it.
- The cursor is independent from persistent block state: green means directly received, amber means reconstructed from parity/fountain equations, dark means still missing. A direct frame received later changes that block from reconstructed to directly received.
- The RX summary names the last packet sequence or P0/P1 group and its block range. The cursor therefore continues to show the latest scanned QR even after all source blocks have already been recovered.

The legacy receiver exposes this location through `packetBlockIndexes`; the Node protocol test covers data frames, full 8-block groups, and the final partial group. The canvas uses a dark outline with a light halo for contrast over the green/amber state fills.

## LT fountain experiment mode

The page now offers a second transport mode in addition to the original CMAL1/P0/P1 block erasure mode.

- **Legacy CMAL1:** sequential data fragments with optional P0/P1 parity. P0/P1 can recover up to two erased fragments per 8-fragment group.
- **LT fountain mode:** a systematic-plus-rateless XOR transport inspired by the Blockchain Commons Multipart UR (MUR) algorithm. The first K packets carry the K source fragments directly. Later packets select a deterministic pseudo-random subset of source fragments and XOR them together. The selection is reproducible from the sequence number and whole-message CRC32.
- **Receiver:** accepts packets out of order, ignores duplicates, stores XOR equations, and uses peeling-style subset reduction to recover source blocks as soon as an equation contains only one unknown. It verifies the reconstructed whole-message CRC32 before download.

Fountain-mode test packet format (custom CMAL1 extension):

`CMAL1:FseqNum/seqLen:transferId:frameCRC32:Base64URL(payload)`

The binary payload contains a version byte, original message length (uint32 big-endian), whole-message CRC32 (uint32 big-endian), and one fixed-length XOR fragment. The outer frame CRC32 detects accidental corruption of each QR packet; the whole-message CRC32 detects an incorrect reconstruction.

### Compatibility and limitations

This is **not full BC-UR wire compatibility**. The mode borrows the MUR/LT fragment-selection and peeling concepts, but uses the page's own CMAL1 framing and does not serialize `ur:` resources, CBOR, or Bytewords. Both sender and receiver must use this test page and select/detect the fountain extension. Existing CMAL1 numeric and P0/P1 frames remain unchanged.

Fountain decoding is rateless in the sense that the sender can emit additional distinct equations without a fixed end frame. The QR link is one-way: the receiver does not send ACKs or acquisition status back to the sender, so the sender cannot adapt its output to receiver progress. The receiver can collect distinct packets over time and may need more than K packets to reconstruct the message. It does **not** mean every arbitrary K packets are guaranteed to reconstruct the message. The number of useful packets depends on the loss pattern, equation degrees, duplicate equations, and peeling progress. It is not RaptorQ.

The receiver stores only distinct equation index-sets and applies a bounded equation budget of `min(250,000, max(1,024, 8 × K))` per transfer to prevent unbounded memory growth. Repeated equations do not consume the budget. Conflicting values for a previously recovered source block are rejected. A very lossy or unusually long-running transfer can reach this cap and require a reset/retry.

The sender and receiver block maps display one cell per original source block. TX uses a distinct active fill for the source block(s) referenced by the currently displayed QR; it does not claim that the remote receiver has actually acquired a block. RX colors distinguish directly received blocks, blocks recovered from equations, the last valid QR position, and missing blocks. A canvas heatmap is used instead of one DOM element per fragment so large transfers remain manageable.

The fountain chooser uses Web Crypto SHA-256 and BigInt operations, so it requires a modern browser in a secure context. Camera access still requires HTTPS or localhost. This remains an experimental implementation and should not be treated as an audited production codec.

### Fountain self-test

The in-page self-test also checks the MUR fragment-chooser reference vectors for `seqLen=11` (`seqNum=12 → [9]`, `seqNum=13 → [2,5,6,8,9,10]`), reversed packet order, missing systematic fragments, duplicate handling, per-frame CRC rejection, mixed-transfer rejection, and whole-message reconstruction.

## TX/RX block-map layout

The TX block map is placed immediately below the animated QR display. The RX block map is rendered as a separate section directly below the camera preview, not overlaid on top of the camera image. It uses the same grid renderer, width behavior, legend, and cell state colors as TX. This keeps the QR camera view unobstructed while making acquisition progress easy to inspect at a glance. The cursor and received/recovered cell colors remain independent.

For small transfers, the map uses fewer columns (up to 75) so each source block remains large enough to track visually. Both maps use the same mapping and sizing logic.

## Test Lab versioning

The standalone experiment page is labelled **Airgap Link / Test Lab V4**. The visible page title, heading, offline pill, and footer carry the version. Every test-lab UI/runtime behavior change should increment the displayed Test Lab version, use a fresh versioned UI script filename when stale Service Worker caches may survive, and increment the Service Worker cache version.

## Test Lab V3 — TX position-only map

Starting with **Airgap Link / Test Lab V3**, TX's block map communicates only the current QR position. All source blocks use the same neutral base color; only the active QR's source block(s) receive the high-contrast cursor. TX does not claim that a block is sent or unsent because the page controls what is displayed, not what the remote camera has actually received.

The TX summary reports the source-block count and current packet information (Data/P0/P1 or LT sequence and XOR target indexes). RX retains persistent acquisition state: directly received, recovered, and missing blocks, plus a cursor for the last valid QR read.

For each test-page UI release, increment the visible Test Lab major label (V2, V3, V4, ...), use a new UI runtime filename where stale browser caches may be present, and increment the Service Worker cache version.

## Test Lab V4 — TX block-map seek

V4 colors the source block(s) referenced by the currently displayed TX QR, rather than relying on an outline alone. Clicking a cell immediately starts playback from that source block's direct Data packet. In legacy CMAL1/P0/P1 mode, the seek calculation skips preceding groups' parity frames and verifies that the selected frame is the requested Data block. In LT Fountain mode, the encoder replays the corresponding systematic packet (`seqNum = blockIndex + 1`) directly without generating and discarding earlier equations. It then resumes from the previous sequence high-water mark, avoiding a rewind and mass retransmission of already-emitted XOR equations.

The TX map remains a canvas heatmap for large transfers. Pointer clicks map displayed canvas coordinates back to source-block indexes. The focused map also supports keyboard navigation: Tab to focus, arrow keys to choose a block, then Enter to start playback there. RX rendering and persistent direct/recovered/missing states are unchanged.

The camera-to-sender channel remains one-way. There is no receiver ACK or status feedback, and the sender does not know which QR frames the camera successfully read.



## V10 — ZXing-C++ WASM receiver

V10 adds an RX decoder selector while leaving the CMAL1 wire format, TX QR encoding, LT fountain protocol, CRC checks, and receiver reconstruction unchanged.

- **Auto** chooses Native BarcodeDetector when QR support is exposed, otherwise ZXing-C++ WASM, then jsQR if the WASM assets cannot be loaded.
- **ZXing-C++ WASM** forces the reader-only `zxing-wasm@3.1.6` build for direct iPhone Safari comparison.
- **Native BarcodeDetector** and **jsQR** remain individually selectable comparison baselines.
- ZXing receives the same downsized canvas `ImageData` used by jsQR and is restricted to `QRCode`, one symbol per frame, with `tryHarder: false`.
- The JavaScript IIFE is served through a virtual same-origin URL handled by the Service Worker and retained in the independent `airgap-link-zxing-wasm-3.1.6` cache. The WASM binary is cached in the same bucket.
- First use needs an Internet connection to fetch the reader bundle and approximately 1.04 MiB WASM module. This is decoder setup only; QR frames and data remain local. After caching, the scanner can be used offline unless site data is cleared or evicted.
- Real iPhone camera testing is still required. CI validates code wiring and protocol regression tests, not camera performance.

Licenses: the `zxing-wasm` wrapper-specific code is MIT; the underlying `zxing-cpp` is Apache-2.0. See the upstream [zxing-wasm package](https://www.npmjs.com/package/zxing-wasm) and [ZXing-C++ project](https://github.com/zxing-cpp/zxing-cpp).


## UI control smoke test

`airgap-link-ui-smoke.test.cjs` runs the actual V10 UI script against a lightweight DOM stub and verifies:

- Automatic TX test button event registration and prerequisite feedback when RX benchmark mode/camera are not ready
- Benchmark copy button event registration and the zero-results message
- Visible selectable-text fallback when Clipboard API / `execCommand('copy')` is unavailable

The protocol test invokes this smoke test automatically. This does not replace real-device camera-to-camera E2E testing.


## V11 — UI cache-bust release

V11 republishes the corrected benchmark UI from V10 under the new immutable runtime filename `airgap-link-ui-v11.js`. The standalone page now loads that file, and the app Service Worker cache key is incremented to `cm-v2.20.0-airgap-link-test-lab-v11-zxing-wasm` with the V11 runtime in its precache list. This avoids reusing a previously cached V10 UI script after the V10 behavior fix. The ZXing loader remains V10 because its contents and interface are unchanged. CI checks the page/runtime filename, cache key, precache entry, and UI smoke-test target together. Real camera-to-camera testing on iPhone Safari and Android Chrome remains a separate required validation.
