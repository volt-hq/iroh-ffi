#!/usr/bin/env python3
"""Regression coverage for the Swift artifact's private-API guard."""

import contextlib
import io
from pathlib import Path
import tempfile
import unittest

from verify_apple_public_udp import verify


class Regression261PublicAppleUDPTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def slice(self, name, content):
        library = self.root / name / "libiroh_ffi.a"
        library.parent.mkdir()
        library.write_bytes(content)

    def test_public_socket_names_pass(self):
        self.slice("ios-arm64", b"!<arch>\n\0sendmsg\0recvmsg\0")
        with contextlib.redirect_stdout(io.StringIO()):
            verify(self.root)

    def test_dynamic_private_names_fail_without_undefined_symbols(self):
        for symbol in (b"sendmsg_x", b"recvmsg_x"):
            with self.subTest(symbol=symbol):
                directory = self.root / symbol.decode()
                library = directory / "ios-arm64" / "libiroh_ffi.a"
                library.parent.mkdir(parents=True)
                library.write_bytes(b"!<arch>\nconstant data\0" + symbol + b"\0")
                with self.assertRaisesRegex(ValueError, "Private Apple UDP API"):
                    verify(directory)

    def test_every_slice_is_checked(self):
        self.slice("ios-arm64", b"!<arch>\npublic\0")
        self.slice("macos-arm64", b"!<arch>\nrecvmsg_x\0")
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError, "macos-arm64"):
                verify(self.root)

    def test_missing_slices_fail(self):
        with self.assertRaisesRegex(ValueError, "No Swift static-library"):
            verify(self.root)

    def test_empty_library_fails(self):
        self.slice("ios-arm64", b"")
        with self.assertRaisesRegex(ValueError, "Empty library"):
            verify(self.root)


if __name__ == "__main__":
    unittest.main()
