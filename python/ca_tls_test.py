"""The UniFFI custom trust surface rejects invalid input without consuming its builder."""
import unittest
from iroh import EndpointBuilder, IrohError


class CustomCATest(unittest.IsolatedAsyncioTestCase):
    async def test_custom_ca_validation_preserves_builder(self):
        builder = EndpointBuilder()
        builder.apply_minimal()
        for roots in ([], [b""], [b"not DER"], [b"x"] * 9, [bytes(16385)]):
            with self.assertRaises(IrohError):
                builder.ca_roots(roots)
        endpoint = await builder.bind()
        try:
            self.assertTrue(endpoint.bound_sockets())
        finally:
            await endpoint.close()
