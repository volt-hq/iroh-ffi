package computer.iroh

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class CustomCATest {
    @Test fun invalidRootsPreserveBuilder() = runBlocking {
        val builder = EndpointBuilder()
        builder.applyMinimal()
        val invalid = listOf(
            emptyList(), listOf(byteArrayOf()), listOf("not DER".toByteArray()),
            List(9) { byteArrayOf(1) }, listOf(ByteArray(16385)),
        )
        for (roots in invalid) {
            assertFailsWith<Exception> { builder.caRoots(roots) }
        }
        val endpoint = builder.bind()
        assertTrue(endpoint.boundSockets().isNotEmpty())
        endpoint.shutdown()
    }
}
