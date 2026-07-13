set -eu

# Builds the full Apple xcframework as flat static-library slices. Prefer
# `cargo make swift-xcframework`.

# Reproducible-build path normalization. Without this, every `.a` binary inside
# the xcframework embeds absolute paths from `file!()` macros (in deps, in
# iroh, and in std/core/alloc panic sites). Local builds carry
# `/Users/<you>/.cargo/...` + `/Users/<you>/.rustup/...`; CI carries
# `/Users/runner/...`. The same source on different hosts produces different
# byte streams (and hence a different `IrohLib.xcframework.zip` SHA-256). The
# four remaps below cover every absolute path rustc emits: cargo registry,
# cargo git deps, the source checkout, and the rustup-managed std sysroot.
# `scripts/release/zip_xcframework.sh` then packages the resulting (now
# host-independent) bytes into the deterministic zip whose checksum is baked
# into `Package.swift` by `cargo make prepare-release` and re-asserted by CI.
CARGO_PFX="${CARGO_HOME:-$HOME/.cargo}"
RUSTUP_PFX="${RUSTUP_HOME:-$HOME/.rustup}"
REPO_PFX="$(pwd)"
BASE_RUSTFLAGS="${RUSTFLAGS:-} \
  --remap-path-prefix=${CARGO_PFX}/registry=/cargo/registry \
  --remap-path-prefix=${CARGO_PFX}/git=/cargo/git \
  --remap-path-prefix=${RUSTUP_PFX}=/rustup \
  --remap-path-prefix=${REPO_PFX}=/build"
export RUSTFLAGS="$BASE_RUSTFLAGS"
# --remap-path-prefix is Rust-only. Several deps (notably `ring`) compile bundled
# C sources via build.rs + the `cc` crate, and those object files also embed
# absolute source paths. `-ffile-prefix-map` is clang/gcc's analogue. The `cc`
# crate forwards CFLAGS to every invocation. Keep the path remapping in a
# reusable value so target-specific deployment-minimum flags can be supplied to
# the C/assembly objects that the `cc` crate builds for each Apple target.
COMMON_CFLAGS="${CFLAGS:-} \
  -ffile-prefix-map=${CARGO_PFX}/registry=/cargo/registry \
  -ffile-prefix-map=${CARGO_PFX}/git=/cargo/git \
  -ffile-prefix-map=${REPO_PFX}=/build"
export CFLAGS="$COMMON_CFLAGS"

# Apple deployment-target floors. The new iroh-rs deps call
# `nw_path_is_ultra_constrained` (iOS 17 / macOS 14); rustc's default
# `*-apple-ios` floor (10) and the unset macOS floor produce undefined-symbol
# link errors. Keep these in sync with Package.swift `platforms:`.
export IPHONEOS_DEPLOYMENT_TARGET="18.0"
export MACOSX_DEPLOYMENT_TARGET="14.5"

# Env
UDL_NAME="iroh_ffi"
FRAMEWORK_NAME="Iroh"
SWIFT_INTERFACE="IrohLib"
INCLUDE_DIR="include/apple"

# Resolve the cargo target dir (honours CARGO_TARGET_DIR / .cargo config).
TARGET_DIR=$(cargo metadata --format-version 1 --no-deps | python3 -c 'import json,sys;print(json.load(sys.stdin)["target_directory"])')

# Build default lib (for the bindgen step)
cargo build --lib

# Compile the rust. The deployment target env vars cover rustc, but C/assembly
# objects built by dependencies through the `cc` crate need explicit clang
# min-version flags or they inherit the Xcode SDK's deployment floor.
echo "Building aarch64-apple-ios"
CFLAGS="$COMMON_CFLAGS -miphoneos-version-min=${IPHONEOS_DEPLOYMENT_TARGET}" \
  cargo build --release --target aarch64-apple-ios
echo "Building aarch64-apple-ios-sim"
CFLAGS="$COMMON_CFLAGS -mios-simulator-version-min=${IPHONEOS_DEPLOYMENT_TARGET}" \
  cargo build --release --target aarch64-apple-ios-sim
echo "Building x86_64-apple-ios"
# Work around curve25519-dalek 5.0.0-rc.0 failing to load its x86 proc-macro
# backend in this cross-target build; the serial backend is fine for the
# Intel simulator slice and keeps arm64 device/sim builds unchanged.
RUSTFLAGS="$BASE_RUSTFLAGS --cfg curve25519_dalek_backend=\"serial\"" \
  CFLAGS="$COMMON_CFLAGS -mios-simulator-version-min=${IPHONEOS_DEPLOYMENT_TARGET}" \
  cargo build --release --target x86_64-apple-ios
echo "Building aarch64-apple-darwin"
CFLAGS="$COMMON_CFLAGS -mmacosx-version-min=${MACOSX_DEPLOYMENT_TARGET}" \
  cargo build --release --target aarch64-apple-darwin

# Generate every output from scratch so stale framework-bundle slices cannot
# leak into a release assembled with the flat `-library` layout.
rm -rf "$FRAMEWORK_NAME.xcframework"
rm -rf "$INCLUDE_DIR"
mkdir -p "$INCLUDE_DIR"

# UniFfi bindgen
cargo run --bin uniffi-bindgen generate --language swift --out-dir ./$INCLUDE_DIR --library "$TARGET_DIR/debug/lib${UDL_NAME}.dylib" --config uniffi.toml

# Stage the C module headers once for all three xcframework slices.
HEADERS_STAGE="$TARGET_DIR/apple-xcf-headers"
rm -rf "$HEADERS_STAGE"
mkdir -p "$HEADERS_STAGE"
cp "$INCLUDE_DIR/${UDL_NAME}FFI.h" "$HEADERS_STAGE/${UDL_NAME}FFI.h"
cat > "$HEADERS_STAGE/Export.h" <<EOF
#include "${UDL_NAME}FFI.h"
EOF
cat > "$HEADERS_STAGE/module.modulemap" <<EOF
module $FRAMEWORK_NAME {
    umbrella header "Export.h"
    export *
    module * { export * }
}
EOF

# Make the fat static library for the simulator slice.
SIM_FAT="$TARGET_DIR/apple-sim-fat/lib${UDL_NAME}.a"
mkdir -p "$(dirname "$SIM_FAT")"
rm -f "$SIM_FAT"
lipo -create \
    "$TARGET_DIR/aarch64-apple-ios-sim/release/lib${UDL_NAME}.a" \
    "$TARGET_DIR/x86_64-apple-ios/release/lib${UDL_NAME}.a" \
    -output "$SIM_FAT"

# Let Xcode generate the xcframework metadata from the compiled archives. A
# flat static-library xcframework is linked into consumers and is not copied as
# an empty Iroh.framework bundle, avoiding App Store bundle-plist validation.
xcodebuild -create-xcframework \
    -library "$TARGET_DIR/aarch64-apple-ios/release/lib${UDL_NAME}.a" \
    -headers "$HEADERS_STAGE" \
    -library "$SIM_FAT" \
    -headers "$HEADERS_STAGE" \
    -library "$TARGET_DIR/aarch64-apple-darwin/release/lib${UDL_NAME}.a" \
    -headers "$HEADERS_STAGE" \
    -output "$FRAMEWORK_NAME.xcframework"

# Move swift interface
sed "s/${UDL_NAME}FFI/$FRAMEWORK_NAME/g" "$INCLUDE_DIR/$UDL_NAME.swift" > "$INCLUDE_DIR/$SWIFT_INTERFACE.swift"

rm -f "$SWIFT_INTERFACE/Sources/$SWIFT_INTERFACE/$SWIFT_INTERFACE.swift"
cp "$INCLUDE_DIR/$SWIFT_INTERFACE.swift" \
    "$SWIFT_INTERFACE/Sources/$SWIFT_INTERFACE/$SWIFT_INTERFACE.swift"

# Package.swift consumes the generated `Iroh.xcframework` directly in local
# development; release consumers download the deterministic zip.
