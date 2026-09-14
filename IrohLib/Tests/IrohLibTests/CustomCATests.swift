import XCTest
@testable import IrohLib

final class CustomCATests: XCTestCase {
    func testInvalidCustomRootsPreserveBuilder() async throws {
        let builder = EndpointBuilder()
        builder.applyMinimal()
        let invalid: [[Data]] = [
            [], [Data()], [Data("not DER".utf8)],
            Array(repeating: Data([1]), count: 9),
            [Data(repeating: 0, count: 16_385)],
        ]
        for roots in invalid {
            XCTAssertThrowsError(try builder.caRoots(certificates: roots))
        }
        let endpoint = try await builder.bind()
        XCTAssertFalse(endpoint.boundSockets().isEmpty)
        try await endpoint.close()
    }
}
