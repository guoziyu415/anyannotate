import Carbon

final class GlobalHotKeys {
    private enum HotKeyID: UInt32 {
        case annotate = 1
        case quickSave = 2
    }

    var onAnnotation: (() -> Void)?
    var onQuickSave: (() -> Void)?

    private var annotationRef: EventHotKeyRef?
    private var quickSaveRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?

    func register() {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )

        InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, _ in
                guard let event else { return noErr }
                var hotKeyID = EventHotKeyID()
                let status = GetEventParameter(
                    event,
                    EventParamName(kEventParamDirectObject),
                    EventParamType(typeEventHotKeyID),
                    nil,
                    MemoryLayout<EventHotKeyID>.size,
                    nil,
                    &hotKeyID
                )
                guard status == noErr else { return status }
                DispatchQueue.main.async {
                    AppDelegate.shared?.handleHotKey(id: hotKeyID.id)
                }
                return noErr
            },
            1,
            &eventType,
            nil,
            &eventHandler
        )

        let modifiers = UInt32(optionKey | cmdKey)
        let annotationID = EventHotKeyID(signature: Self.signature, id: HotKeyID.annotate.rawValue)
        let quickSaveID = EventHotKeyID(signature: Self.signature, id: HotKeyID.quickSave.rawValue)

        RegisterEventHotKey(
            UInt32(kVK_ANSI_A),
            modifiers,
            annotationID,
            GetApplicationEventTarget(),
            0,
            &annotationRef
        )
        RegisterEventHotKey(
            UInt32(kVK_ANSI_S),
            modifiers,
            quickSaveID,
            GetApplicationEventTarget(),
            0,
            &quickSaveRef
        )
    }

    func unregister() {
        if let annotationRef { UnregisterEventHotKey(annotationRef) }
        if let quickSaveRef { UnregisterEventHotKey(quickSaveRef) }
        if let eventHandler { RemoveEventHandler(eventHandler) }
    }

    private static let signature: OSType = {
        let bytes: [UInt8] = Array("ANCL".utf8)
        return bytes.reduce(0) { ($0 << 8) | OSType($1) }
    }()
}
