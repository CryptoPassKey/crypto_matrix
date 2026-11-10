# CryptoMatrix cryptographic regression matrix

The automated matrix is defined in `tests/compatibility/crypto-combination-matrix.test.js` and is run by `.github/workflows/audit.yml`.

## CME3 credential combinations

| Combo | Password | Key file | WebAuthn PRF |
|---:|---|---|---|
| 0 | required | no | no |
| 1 | required | required | no |
| 2 | required | no | required |
| 3 | required | required | required |
| 4 | no | required | no |
| 5 | no | no | required |
| 6 | no | required | required |

The test injects a deterministic PRF context at the internal cryptographic boundary. It exercises production KDF, factor composition, HMAC commitment, AES-GCM, and ChaCha20-Poly1305. It does not claim to test real authenticator/browser interoperability, RP ID/origin behavior, registration, or user-verification prompts.

## KDF profiles

| Profile | Algorithm | Parameters | Automated matrix |
|---:|---|---|---|
| 0 | PBKDF2 | 600,000 iterations | all 7 combos |
| 1 | PBKDF2 | 2,100,000 iterations | all 7 combos |
| 2 | PBKDF2 | 5,000,000 iterations | all 7 combos |
| 3 | Argon2id | 64 MiB / 3 iterations | all 7 combos |
| 4 | Argon2id | 128 MiB / 3 iterations | representative combos 0, 3, 4 |
| 5 | Argon2id | 256 MiB / 4 iterations | representative combos 2, 6 |

High-memory profiles use representative combinations to bound normal CI runtime and memory pressure. Historical ciphertext compatibility remains independently checked by the immutable fixtures in `tests/compatibility/compat-audit.js`.

## Fixture rules

- Use synthetic values only.
- Generate fixtures from a known-good baseline revision, not the code under test after a regression.
- Never regenerate historical fixtures merely to make a failing test pass.
- Document source revision, reason, format, and expected plaintext for each fixture change.

## Additional invariants

- CMA1 seed-bound encryption: correct seed/domain roundtrip; wrong seed, wrong domain, and ciphertext tampering must fail.
- CMS3 Shamir: every threshold-sized subset is checked for 2-of-3, 3-of-5, and 4-of-7; fewer than threshold, duplicate indices, and mixed set identifiers must be rejected.
