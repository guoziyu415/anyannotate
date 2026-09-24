import Foundation

enum ClipKind: String, CaseIterable, Identifiable {
    case thought = "Thought"
    case question = "Question"
    case verify = "Verify"
    case highlight = "Highlight"

    var id: String { rawValue }
}

struct Clip {
    let quote: String
    let annotation: String
    let kind: ClipKind
    let tags: [String]
    let sourceApplication: String?
    let createdAt: Date
}

final class NoteStore {
    private enum Keys {
        static let notePath = "notePath"
        static let legacyDataMigrated = "legacyDataMigrated"
    }

    /// Identifiers used by builds released before version 0.3.0.
    enum Legacy {
        static let bundleIdentifier = "com.guoziyu.answerclipper"
        static let folderName = "AnswerClipper"
    }

    static let folderName = "AnyAnnotate"

    private let defaults: UserDefaults
    private let documentsDirectory: URL
    private let fileManager: FileManager

    init(
        defaults: UserDefaults = .standard,
        documentsDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Documents", isDirectory: true),
        fileManager: FileManager = .default
    ) {
        self.defaults = defaults
        self.documentsDirectory = documentsDirectory
        self.fileManager = fileManager
    }

    var noteURL: URL {
        if let storedPath = defaults.string(forKey: Keys.notePath), !storedPath.isEmpty {
            return URL(fileURLWithPath: storedPath)
        }
        return defaultNoteURL
    }

    var defaultNoteURL: URL {
        documentsDirectory
            .appendingPathComponent(Self.folderName, isDirectory: true)
            .appendingPathComponent("Inbox.md", isDirectory: false)
    }

    /// Carries the saved location and the default notes folder over from builds
    /// released before version 0.3.0. Runs once, never overwrites existing data,
    /// and keeps using the old folder if it cannot be moved.
    func migrateLegacyData(legacyDefaults: UserDefaults? = UserDefaults(suiteName: Legacy.bundleIdentifier)) {
        guard !defaults.bool(forKey: Keys.legacyDataMigrated) else { return }
        // Without access to Documents (for example, after the user declines the
        // macOS prompt) the old folder is invisible, so try again on a later launch.
        guard (try? fileManager.contentsOfDirectory(atPath: documentsDirectory.path)) != nil else { return }
        defer { defaults.set(true, forKey: Keys.legacyDataMigrated) }

        if defaults.string(forKey: Keys.notePath) == nil,
           let legacyPath = legacyDefaults?.string(forKey: Keys.notePath), !legacyPath.isEmpty {
            defaults.set(legacyPath, forKey: Keys.notePath)
        }

        let legacyFolder = documentsDirectory.appendingPathComponent(Legacy.folderName, isDirectory: true)
        let newFolder = defaultNoteURL.deletingLastPathComponent()
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: legacyFolder.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            return
        }

        if !fileManager.fileExists(atPath: newFolder.path) {
            // Resolve before moving: symlinks can only be resolved while the old folder exists.
            let storedRelativePath = defaults.string(forKey: Keys.notePath)
                .flatMap { Self.relativePath(of: $0, inside: legacyFolder) }
            do {
                try fileManager.moveItem(at: legacyFolder, to: newFolder)
                if let storedRelativePath {
                    defaults.set(newFolder.path + storedRelativePath, forKey: Keys.notePath)
                }
                return
            } catch {
                // Fall through and keep writing to the existing notes file.
            }
        }

        let legacyInbox = legacyFolder.appendingPathComponent("Inbox.md", isDirectory: false)
        if defaults.string(forKey: Keys.notePath) == nil,
           !fileManager.fileExists(atPath: defaultNoteURL.path),
           fileManager.fileExists(atPath: legacyInbox.path) {
            defaults.set(legacyInbox.path, forKey: Keys.notePath)
        }
    }

    /// Returns the part of `path` after `folder` (starting with "/"), comparing
    /// both the standardized and the symlink-resolved spellings.
    private static func relativePath(of path: String, inside folder: URL) -> String? {
        let file = URL(fileURLWithPath: path)
        for candidate in [file.standardizedFileURL.path, file.resolvingSymlinksInPath().path] {
            for prefix in [folder.standardizedFileURL.path, folder.resolvingSymlinksInPath().path]
            where candidate.hasPrefix(prefix + "/") {
                return String(candidate.dropFirst(prefix.count))
            }
        }
        return nil
    }

    func setNoteURL(_ url: URL) {
        defaults.set(url.path, forKey: Keys.notePath)
    }

    func resetNoteURL() {
        defaults.removeObject(forKey: Keys.notePath)
    }

    func ensureFileExists() throws {
        try ensureFileExists(at: noteURL)
    }

    func ensureFileExists(at url: URL) throws {
        let directory = url.deletingLastPathComponent()
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        if !fileManager.fileExists(atPath: url.path) {
            try "# AnyAnnotate\n\n".write(to: url, atomically: true, encoding: .utf8)
        }
    }

    func append(_ clip: Clip, to destinationURL: URL? = nil) throws {
        let targetURL = destinationURL ?? noteURL
        try ensureFileExists(at: targetURL)
        guard let data = MarkdownFormatter.entry(for: clip).data(using: .utf8) else {
            throw CocoaError(.fileWriteInapplicableStringEncoding)
        }
        let handle = try FileHandle(forWritingTo: targetURL)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
    }
}

enum MarkdownFormatter {
    static func entry(for clip: Clip) -> String {
        let timestamp = timestampFormatter.string(from: clip.createdAt)
        let title = clip.annotation
            .components(separatedBy: .newlines)
            .first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty })
            .map { String($0.prefix(42)) }
            ?? clip.kind.rawValue

        let quote = clip.quote
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .newlines)
            .map { "> \($0)" }
            .joined(separator: "\n")

        var lines = [
            "## \(title)",
            "",
            quote,
            ""
        ]

        if !clip.annotation.isEmpty {
            lines += ["**Annotation:**  ", clip.annotation, ""]
        }

        lines += ["**Category:** \(clip.kind.rawValue)  "]
        if !clip.tags.isEmpty {
            lines += ["**Tags:** \(clip.tags.joined(separator: " "))  "]
        }
        if let sourceApplication = clip.sourceApplication, !sourceApplication.isEmpty {
            lines += ["**Source:** \(sourceApplication)  "]
        }
        lines += ["**Time:** \(timestamp)", "", "---", "", ""]

        return lines.joined(separator: "\n")
    }

    private static let timestampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter
    }()
}
