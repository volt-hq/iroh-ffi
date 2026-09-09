#!/usr/bin/env python3
"""Reject the known private Apple UDP implementation in Swift release slices.

Regression: volt-hq/volt-app#261. This is a targeted artifact guard, not a
general certification that a binary uses only public APIs. Dynamic resolution
means checking undefined Mach-O symbols alone does not catch this regression.
"""

import argparse
import mmap
from pathlib import Path


def verify(root: Path) -> None:
    libraries = sorted(root.glob("*/libiroh_ffi.a"))
    if not libraries:
        raise ValueError(f"No Swift static-library slices found in {root}")
    for library in libraries:
        with library.open("rb") as source:
            if source.seek(0, 2) == 0:
                raise ValueError(f"Empty library: {library}")
            with mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as data:
                for symbol in (b"sendmsg_x\0", b"recvmsg_x\0"):
                    if data.find(symbol) != -1:
                        name = symbol[:-1].decode("ascii")
                        raise ValueError(f"Private Apple UDP API {name} in {library}")
        print(f"Public UDP guard passed: {library}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xcframework", type=Path)
    args = parser.parse_args()
    try:
        verify(args.xcframework)
    except (OSError, ValueError) as error:
        parser.exit(1, f"ERROR: {error}\n")
