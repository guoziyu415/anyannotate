import Foundation
import XCTest
@testable import AnyAnnotate

final class MarkdownFormatterTests: XCTestCase {
    func testEntryKeepsQuoteAndAnnotationSeparate() {
        let clip = Clip(
            quote: "First line\nSecond line",
            annotation: "My takeaway",
            kind: .thought,
            tags: ["#plugin", "#idea"],
            sourceApplication: "Codex",
            createdAt: Date(timeIntervalSince1970: 0)
        )

        let markdown = MarkdownFormatter.entry(for: clip)

        XCTAssertTrue(markdown.contains("> First line\n> Second line"))
        XCTAssertTrue(markdown.contains("**Annotation:**  \nMy takeaway"))
        XCTAssertTrue(markdown.contains("**Tags:** #plugin #idea"))
        XCTAssertTrue(markdown.contains("**Source:** Codex"))
    }

    func testEntryOmitsEmptyAnnotationAndTags() {
        let clip = Clip(
            quote: "Save only the quote",
            annotation: "",
            kind: .highlight,
            tags: [],
            sourceApplication: nil,
            createdAt: Date(timeIntervalSince1970: 0)
        )

        let markdown = MarkdownFormatter.entry(for: clip)

        XCTAssertFalse(markdown.contains("**Annotation:**"))
        XCTAssertFalse(markdown.contains("**Tags:**"))
        XCTAssertTrue(markdown.contains("**Category:** Highlight"))
    }

    func testNoteStoreCanResetCustomDefaultLocation() {
        let suiteName = "AnyAnnotateTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = NoteStore(defaults: defaults)
        let customURL = URL(fileURLWithPath: "/tmp/custom-anyannotate.md")

        store.setNoteURL(customURL)
        XCTAssertEqual(store.noteURL, customURL)

        store.resetNoteURL()
        XCTAssertEqual(store.noteURL, store.defaultNoteURL)
    }

    func testMigrationMovesTheOldNotesFolderAndSavedLocation() throws {
        let documents = FileManager.default.temporaryDirectory
            .appendingPathComponent("AnyAnnotateTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: documents) }
        let legacyFolder = documents.appendingPathComponent(NoteStore.Legacy.folderName, isDirectory: true)
        try FileManager.default.createDirectory(at: legacyFolder, withIntermediateDirectories: true)
        try "# Notes\n\nKeep me\n".write(to: legacyFolder.appendingPathComponent("Inbox.md"), atomically: true, encoding: .utf8)

        let suiteName = "AnyAnnotateTests.\(UUID().uuidString)"
        let legacySuiteName = "AnyAnnotateLegacyTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        let legacyDefaults = UserDefaults(suiteName: legacySuiteName)!
        defer {
            defaults.removePersistentDomain(forName: suiteName)
            legacyDefaults.removePersistentDomain(forName: legacySuiteName)
        }
        try "# Projects\n".write(to: legacyFolder.appendingPathComponent("Projects.md"), atomically: true, encoding: .utf8)
        legacyDefaults.set(legacyFolder.appendingPathComponent("Projects.md").path, forKey: "notePath")

        let store = NoteStore(defaults: defaults, documentsDirectory: documents)
        store.migrateLegacyData(legacyDefaults: legacyDefaults)

        let newFolder = documents.appendingPathComponent(NoteStore.folderName, isDirectory: true)
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacyFolder.path))
        XCTAssertEqual(try String(contentsOf: newFolder.appendingPathComponent("Inbox.md"), encoding: .utf8), "# Notes\n\nKeep me\n")
        XCTAssertEqual(store.noteURL.path, newFolder.appendingPathComponent("Projects.md").path)

        // A reset after migrating must not bring back the old location.
        store.resetNoteURL()
        store.migrateLegacyData(legacyDefaults: legacyDefaults)
        XCTAssertEqual(store.noteURL, store.defaultNoteURL)
    }

    func testMigrationKeepsUsingTheOldInboxWhenBothFoldersExist() throws {
        let documents = FileManager.default.temporaryDirectory
            .appendingPathComponent("AnyAnnotateTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: documents) }
        let legacyFolder = documents.appendingPathComponent(NoteStore.Legacy.folderName, isDirectory: true)
        let newFolder = documents.appendingPathComponent(NoteStore.folderName, isDirectory: true)
        try FileManager.default.createDirectory(at: legacyFolder, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: newFolder, withIntermediateDirectories: true)
        try "# Notes\n".write(to: legacyFolder.appendingPathComponent("Inbox.md"), atomically: true, encoding: .utf8)

        let suiteName = "AnyAnnotateTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = NoteStore(defaults: defaults, documentsDirectory: documents)
        store.migrateLegacyData(legacyDefaults: nil)

        XCTAssertTrue(FileManager.default.fileExists(atPath: legacyFolder.path))
        XCTAssertEqual(store.noteURL.path, legacyFolder.appendingPathComponent("Inbox.md").path)
    }
}
