# Airgap Link Test Lab

Independent experiment page for screen-to-camera, offline QR transport.

## Open

On GitHub Pages, the expected path is:

`https://cryptopasskey.github.io/crypto_matrix/contents/test/`

Local testing also works when served over HTTPS or localhost. Camera access requires a secure context.

## Dependencies

No new external libraries are downloaded.

- TX QR matrix: existing `../qr-encoder.js` (`window.MatrixQRCode`)
- RX fallback: existing `../vendor/jsQR.js`
- Preferred RX decoder: browser-native `BarcodeDetector` when it supports QR Code
- Camera: `navigator.mediaDevices.getUserMedia`
- Optional compression: browser-native `CompressionStream('deflate')` / `DecompressionStream('deflate')`

The page does not make application-level network requests. It uses local files from the repository.

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

Deflate is optional and is only used when the compressed result plus its 8-byte `CMZ1` length header is smaller than the original. The receiver detects and expands the `CMZ1` wrapper after reassembly.

Encrypted data is already close to random and normally does not compress. For encrypted `.cmtl` files, leave compression off unless testing; the feature is mainly useful for compressible plaintext before encryption. A receiver that does not understand the optional `CMZ1` wrapper will produce the compressed wrapper bytes rather than the original data.

## UI/test settings

- Fragment size: 80–800 bytes (default 180 bytes)
- TX frame rate: 3–30 fps (default 6 fps)
- Parity: 2 parity frames per 8 data fragments
- QR quiet zone: 4 modules
- QR canvas: 720 × 720
- RX scanner: native `BarcodeDetector`, with local jsQR fallback when unavailable or when native detection throws
- Maximum source file size: 10 MiB in the UI (the protocol limits each transfer to at most 100,000 data fragments)

## Self-test coverage

The page's **プロトコル自己テスト** checks:

- CRC32 known vector: `123456789 → CBF43926`
- Frame construction and parse
- Four two-loss positions in an 8-fragment group
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
