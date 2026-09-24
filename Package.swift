// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "AnyAnnotate",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "AnyAnnotate", targets: ["AnyAnnotate"])
    ],
    targets: [
        .executableTarget(
            name: "AnyAnnotate",
            path: "Sources/AnyAnnotate"
        ),
        .testTarget(
            name: "AnyAnnotateTests",
            dependencies: ["AnyAnnotate"],
            path: "Tests/AnyAnnotateTests"
        )
    ]
)
