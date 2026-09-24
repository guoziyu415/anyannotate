import AppKit

final class ToastController {
    private var panel: NSPanel?

    func show(_ message: String) {
        panel?.orderOut(nil)

        let label = NSTextField(labelWithString: message)
        label.textColor = .white
        label.font = .systemFont(ofSize: 13, weight: .medium)
        label.alignment = .center

        let width = max(180, label.intrinsicContentSize.width + 40)
        let contentView = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: width, height: 44))
        contentView.material = .hudWindow
        contentView.state = .active
        contentView.wantsLayer = true
        contentView.layer?.cornerRadius = 12
        label.frame = contentView.bounds.insetBy(dx: 14, dy: 8)
        contentView.addSubview(label)

        let panel = NSPanel(
            contentRect: contentView.bounds,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        panel.contentView = contentView
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.ignoresMouseEvents = true

        if let screen = NSScreen.main {
            let frame = screen.visibleFrame
            panel.setFrameOrigin(
                NSPoint(x: frame.midX - width / 2, y: frame.maxY - 90)
            )
        }

        panel.orderFrontRegardless()
        self.panel = panel

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { [weak self, weak panel] in
            panel?.orderOut(nil)
            if self?.panel === panel {
                self?.panel = nil
            }
        }
    }
}
