#!/usr/bin/sh

# This script will build a manylinux_2_28 wheel if used in the
# manylinux_2_28_x86_64 container:
#
# The image must be pinned by digest, as in .github/workflows/wheels.yml.
# This helper intentionally does not curl a mutable toolchain installer.

command -v rustup >/dev/null 2>&1 || {
    echo "ERROR: install rustup through a reviewed, pinned mechanism first" >&2
    exit 1
}
rustup toolchain install 1.97.1 --profile minimal
rustup default 1.97.1

# Build the wheels, we only need to build one
for PYBIN in /opt/python/cp311-*/bin; do
    "${PYBIN}/pip" install maturin==1.14.1 uniffi-bindgen==0.31.0
    "${PYBIN}/maturin" build --release --manylinux 2_28
done

# Build just for python 3.11
PATH=/opt/python/cp311-cp311/bin:$PATH
export PATH

# Install our build tools
pip install maturin==1.14.1 uniffi-bindgen==0.31.0

# Build the wheel
maturin build --release --manylinux 2_28
