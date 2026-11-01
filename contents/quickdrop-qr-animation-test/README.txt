QuickDrop QR Animation Test

Files:
- quickdrop-test.html : standalone test UI
- qr-encoder.js        : copied from the supplied CryptoMatrix ZIP (MIT notice retained)
- jsQR.js              : copied from the supplied CryptoMatrix ZIP

Run:
1. Keep all three files in the same directory.
2. Serve the directory over HTTPS or localhost (camera access requires a secure context).
3. Open quickdrop-test.html on the sender device and receiver device.
4. On sender, enter text or select a file up to 500 KB, click QRを生成, then 再生.
5. On receiver, click カメラ開始 and point the camera at the animated QR.

The page uses a test-only QD1 protocol: base64url chunks, numbered frames, transfer ID, and SHA-256 integrity verification. It does not use UR/BC-UR and has no fountain-code recovery. If frames are missed, keep the sender animation running; the receiver accepts out-of-order frames and ignores duplicates. This is a prototype, not a security-audited production implementation.
