import AppKit

struct CapturedSelection {
    let text: String
    let sourceApplication: String?
    let screenPoint: NSPoint
}

final class SelectionMonitor {
    var onSelection: ((CapturedSelection) -> Void)?
    var onSelectionCleared: (() -> Void)?

    private let selectionCapture: SelectionCapture
    private var mouseDownMonitor: Any?
    private var mouseUpMonitor: Any?
    private var dismissMonitor: Any?
    private var mouseDownPoint: NSPoint?
    private var mouseDownSelection: SelectionSnapshot?
    private var mouseDownProcessIdentifier: pid_t?
    private var mouseDownGeneration = 0
    private var captureGeneration = 0

    init(selectionCapture: SelectionCapture) {
        self.selectionCapture = selectionCapture
    }

    func start() {
        guard mouseDownMonitor == nil else { return }

        mouseDownMonitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self else { return }
                self.invalidateCapture()
                self.clearMouseDownSnapshot()
                self.mouseDownPoint = NSEvent.mouseLocation
                guard let application = NSWorkspace.shared.frontmostApplication,
                      application.processIdentifier != ProcessInfo.processInfo.processIdentifier
                else { return }
                let processIdentifier = application.processIdentifier
                self.mouseDownProcessIdentifier = processIdentifier
                let generation = self.mouseDownGeneration
                self.selectionCapture.captureSnapshot(
                    in: processIdentifier,
                    delay: 0
                ) { [weak self] snapshot in
                    guard let self,
                          generation == self.mouseDownGeneration,
                          processIdentifier == self.mouseDownProcessIdentifier
                    else { return }
                    self.mouseDownSelection = snapshot
                }
            }
        }

        mouseUpMonitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseUp) { [weak self] event in
            let point = NSEvent.mouseLocation
            let clickCount = event.clickCount
            DispatchQueue.main.async {
                self?.handleMouseUp(at: point, clickCount: clickCount)
            }
        }

        dismissMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.rightMouseDown, .scrollWheel]
        ) { [weak self] _ in
            DispatchQueue.main.async {
                self?.invalidateCapture()
                self?.clearMouseDownSnapshot()
                self?.onSelectionCleared?()
            }
        }
    }

    func stop() {
        [mouseDownMonitor, mouseUpMonitor, dismissMonitor].forEach { monitor in
            if let monitor {
                NSEvent.removeMonitor(monitor)
            }
        }
        mouseDownMonitor = nil
        mouseUpMonitor = nil
        dismissMonitor = nil
        invalidateCapture()
        clearMouseDownSnapshot()
    }

    private func handleMouseUp(at point: NSPoint, clickCount: Int) {
        let shouldInspect = Self.shouldInspectSelection(
            mouseDown: mouseDownPoint,
            mouseUp: point,
            clickCount: clickCount
        )
        mouseDownPoint = nil

        guard shouldInspect else {
            invalidateCapture()
            clearMouseDownSnapshot()
            onSelectionCleared?()
            return
        }
        guard selectionCapture.isAccessibilityTrusted else {
            clearMouseDownSnapshot()
            return
        }
        guard let sourceApplication = NSWorkspace.shared.frontmostApplication else {
            clearMouseDownSnapshot()
            return
        }
        guard sourceApplication.processIdentifier != ProcessInfo.processInfo.processIdentifier else {
            clearMouseDownSnapshot()
            return
        }

        captureGeneration += 1
        let generation = captureGeneration
        let sourceName = sourceApplication.localizedName
        let sourcePID = sourceApplication.processIdentifier

        selectionCapture.captureSnapshot(in: sourcePID) { [weak self] selection in
            guard let self, generation == self.captureGeneration else { return }
            defer {
                self.clearMouseDownSnapshot()
            }
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == sourcePID else { return }

            guard let selection,
                  Self.hasMeaningfulSelection(selection.text),
                  Self.representsNewSelection(
                    before: self.mouseDownProcessIdentifier == sourcePID ? self.mouseDownSelection : nil,
                    after: selection,
                    clickCount: clickCount
                  )
            else {
                self.onSelectionCleared?()
                return
            }
            let text = selection.text.trimmingCharacters(in: .whitespacesAndNewlines)
            self.onSelection?(
                CapturedSelection(
                    text: text,
                    sourceApplication: sourceName,
                    screenPoint: point
                )
            )
        }
    }

    private func invalidateCapture() {
        captureGeneration += 1
    }

    private func clearMouseDownSnapshot() {
        mouseDownGeneration += 1
        mouseDownSelection = nil
        mouseDownProcessIdentifier = nil
    }

    static func shouldInspectSelection(
        mouseDown: NSPoint?,
        mouseUp: NSPoint,
        clickCount: Int
    ) -> Bool {
        if clickCount >= 2 {
            return true
        }
        guard let mouseDown else { return false }
        return hypot(mouseUp.x - mouseDown.x, mouseUp.y - mouseDown.y) >= 4
    }

    static func hasMeaningfulSelection(_ selectedText: String?) -> Bool {
        guard let selectedText else { return false }
        return !selectedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    static func representsNewSelection(
        before: SelectionSnapshot?,
        after: SelectionSnapshot,
        clickCount: Int
    ) -> Bool {
        guard clickCount < 2, let before else { return true }
        return before.fingerprint != after.fingerprint
    }
}
