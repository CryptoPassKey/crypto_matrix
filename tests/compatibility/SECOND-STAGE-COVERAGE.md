# Second-stage security regression coverage

This matrix reuses existing application tests and records limitations rather than claiming untested behavior.

| Area | Existing / added test | Current coverage | Remaining gap |
|---|---|---|---|
| TimeLock | `recover-beacon-info.test.js`, `tl-beacon-url.test.js` | Capsule metadata parsing, Quicknet chain binding, round-derived beacon URLs, invalid metadata rejection | Full tlock BLS verification, Mode A/B create→decrypt, keyfile/passkey/duress combinations are not yet exercised in CI. The test runtime does not currently load production `TLockBundle` in a reproducible offline harness. |
| TimeSecret | `zeroize-timesecret.test.js` (extended) | Real vault creation, password decrypt, wrong-password rejection, UI plaintext zeroization, retained vault and successful reopen | Restart persistence, keyfile/passkey authentication and management-policy mutation matrices remain open. |
| Seed Vault | `seed-vault-migration-matrix.test.js` (new) | Legacy plaintext migration, encrypted-at-rest record, save/update behavior, initial-load snapshot semantics, missing device-key failure without plaintext downgrade | Browser-specific IndexedDB persistence and real-device multi-tab races are not covered by jsdom. |
| QR/Data Transfer | `data-transfer-protocol-matrix.test.js` (new) | Protocol self-tests plus Base45 edge cases and malformed header rejection; built-in tests cover shuffled frames, parity recovery, duplicate suppression, CRC tampering and mixed transfer IDs | Camera capture/decoder interoperability and device performance require device-level tests. |
| Historical formats | `compat-audit.js`, `fixtures.json` | Fixed CMV1/CME2/CME3/BIP39 fixture decryption | The fixture file first appears in commit `2d28474de2c50f8ecbc7956b5e7433fc8c67a3a4` (2026-11-07), but lacks per-fixture originating release/commit metadata. It is not independently proven pre-release provenance. No new historical ciphertext has been fabricated. |

## Test integrity rules

- Production cryptographic source and container formats are unchanged.
- Existing protocol self-tests are invoked rather than duplicating their algorithms.
- TimeLock cryptographic round-trip and verifiable historical fixture provenance remain explicit gaps; neither is reported as PASS.
- Future historical fixtures must come from an actual prior release/build and record source tag/commit, creation date, parameters, and expected plaintext hash.
