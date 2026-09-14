# Public TLS test fixtures

These certificates and the server private key are deliberately public test data.
**Never use them for a deployed service or the pairing E2E rig.** The rig must
generate its own CA, keys, and certificates per run.

`root.der` signs `server` (localhost and 127.0.0.1, valid through 2099) and
`expired` (expired in 2020). `other-root.der` is unrelated. The `.pem` files
support Node HTTPS tests; `.der` files support Rust's in-memory TLS handshake.
The root private keys are discarded after generation.

Regenerate with `python3 scripts/generate_tls_test_fixtures.py` from the repository
root. This uses the system OpenSSL and Python standard library, not extra packages.
Generation intentionally produces new keys and certificates; review the fixture
changes together. Tests use these fixtures only and do not call public relays.
