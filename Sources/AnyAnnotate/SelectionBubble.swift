import AppKit

final class SelectionBubbleController: NSObject {
    private let panel: NSPanel
    private var annotateAction: (() -> Void)?

    override init() {
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 86, height: 36),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        super.init()

        let background = NSVisualEffectView(frame: panel.contentView?.bounds ?? .zero)
        background.material = .popover
        background.state = .active
        background.wantsLayer = true
        background.layer?.cornerRadius = 10
        background.layer?.masksToBounds = true

        let button = NSButton(title: "Annotate", target: self, action: #selector(annotate))
        button.image = NSImage(systemSymbolName: "square.and.pencil", accessibilityDescription: nil)
        button.imagePosition = .imageLeading
        button.bezelStyle = .rounded
        button.isBordered = false
        button.font = .systemFont(ofSize: 13, weight: .medium)
        button.frame = background.bounds.insetBy(dx: 8, dy: 4)
        button.autoresizingMask = [.width, .height]
        background.addSubview(button)

        panel.contentView = background
        panel.level = .popUpMenu
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.isReleasedWhenClosed = false
    }

    func show(at point: NSPoint, onAnnotate: @escaping () -> Void) {
        annotateAction = onAnnotate

        let screen = NSScreen.screens.first(where: { $0.frame.contains(point) }) ?? NSScreen.main
        let visibleFrame = screen?.visibleFrame ?? .zero
        let panelSize = panel.frame.size
        var origin = NSPoint(x: point.x + 10, y: point.y + 12)

        if origin.x + panelSize.width > visibleFrame.maxX - 8 {
            origin.x = point.x - panelSize.width - 10
        }
        if origin.y + panelSize.height > visibleFrame.maxY - 8 {
            origin.y = point.y - panelSize.height - 12
        }
        origin.x = max(visibleFrame.minX + 8, origin.x)
        origin.y = max(visibleFrame.minY + 8, origin.y)

        panel.setFrameOrigin(origin)
        panel.orderFrontRegardless()
    }

    func hide() {
        panel.orderOut(nil)
        annotateAction = nil
    }

    @objc private func annotate() {
        let action = annotateAction
        hide()
        action?()
    }
}
