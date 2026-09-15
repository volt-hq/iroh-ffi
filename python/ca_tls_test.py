"""The UniFFI custom trust surface rejects invalid input without consuming its builder."""
import pytest

from iroh import EndpointBuilder, IrohError


async def test_custom_ca_validation_preserves_builder():
    builder = EndpointBuilder()
    builder.apply_minimal()
    for roots in ([], [b""], [b"not DER"], [b"x"] * 9, [bytes(16385)]):
        with pytest.raises(IrohError):
            builder.ca_roots(roots)
    endpoint = await builder.bind()
    try:
        assert endpoint.bound_sockets()
    finally:
        await endpoint.close()
