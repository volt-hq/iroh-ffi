# `@hansjm10/volt-iroh`

> A Volt-owned distribution of the Iroh Node.js bindings

This package preserves the JavaScript and native API from the upstream
[`iroh-ffi`](https://github.com/n0-computer/iroh-ffi) project. Volt owns this
npm namespace and release path; the original n0 authors and contributors retain
attribution in the repository history and dual-license notices.

## Install

```sh
npm install --save-exact @hansjm10/volt-iroh@1.1.1-volt.1
```

See the fork's
[owned release documentation](https://github.com/volt-hq/iroh-ffi/blob/volt/owned-iroh/iroh-js/OWNED_RELEASE.md)
for the exact upstream base, carried fixes, platform matrix, and release/bootstrap
procedure.

## Development

```sh
# debug build
cargo make js-build

# build and run the native JS regression suite
cargo make test-js
```

## License

This project is licensed under either of

 * Apache License, Version 2.0 (`LICENSE-APACHE` in each published package)
 * MIT license (`LICENSE-MIT` in each published package)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in this project by you, as defined in the Apache-2.0 license,
shall be dual licensed as above, without any additional terms or conditions.
