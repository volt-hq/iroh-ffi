#!/usr/bin/env bash
# Use the owned runner's installed toolchain without changing rustup defaults,
# Xcode selection or ~/.cargo/bin. The binary-download action supplies Intel
# cargo-make on ARM64; a pinned source install avoids that dependency on Rosetta.
set -euo pipefail

test "$(uname -m)" = arm64
test "${DEVELOPER_DIR:?}" = /Applications/Xcode-26.6.0.app/Contents/Developer
xcodebuild -version | grep -Fx 'Xcode 26.6'
# Homebrew and the numbered rustup installation lack the Apple target libs.
# The existing stable installation contains them. Verify its exact compiler
# below; never update the channel or change the runner's default toolchain.
toolchain_bin=$(dirname "$(rustup which --toolchain stable rustc)")
export PATH="$toolchain_bin:$PATH"
echo "$toolchain_bin" >> "${GITHUB_PATH:?}"
rustc --version | grep -Fx 'rustc 1.97.1 (8bab26f4f 2026-07-14)'
for target in aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios aarch64-apple-darwin aarch64-apple-ios-macabi; do
  sysroot=$(rustc --print target-libdir --target "$target")
  compgen -G "$sysroot/libstd-*.rlib" > /dev/null || { echo "Missing existing Rust target: $target" >&2; exit 1; }
done

tool_root="${RUNNER_TEMP:?}/volt-swift-tools"
cargo install cargo-make --version 0.37.24 --locked --root "$tool_root"
"$tool_root/bin/cargo-make" make --version
echo "$tool_root/bin" >> "${GITHUB_PATH:?}"
