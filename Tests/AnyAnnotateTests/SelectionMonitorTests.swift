import AppKit
import XCTest
@testable import AnyAnnotate

final class SelectionMonitorTests: XCTestCase {
    func testMissingSelectionDoesNotPresentBubble() {
        XCTAssertFalse(SelectionMonitor.hasMeaningfulSelection(nil))
        XCTAssertFalse(SelectionMonitor.hasMeaningfulSelection(""))
        XCTAssertFalse(SelectionMonitor.hasMeaningfulSelection("  \n\t"))
    }

    func testRealTextSelectionPresentsBubble() {
        XCTAssertTrue(SelectionMonitor.hasMeaningfulSelection("Selected text"))
    }

    func testDragTriggersSelectionInspection() {
        XCTAssertTrue(
            SelectionMonitor.shouldInspectSelection(
                mouseDown: NSPoint(x: 10, y: 10),
                mouseUp: NSPoint(x: 20, y: 10),
                clickCount: 1
            )
        )
    }

    func testDoubleClickTriggersSelectionInspection() {
        XCTAssertTrue(
            SelectionMonitor.shouldInspectSelection(
                mouseDown: NSPoint(x: 10, y: 10),
                mouseUp: NSPoint(x: 10, y: 10),
                clickCount: 2
            )
        )
    }

    func testOrdinaryClickDoesNotTriggerSelectionInspection() {
        XCTAssertFalse(
            SelectionMonitor.shouldInspectSelection(
                mouseDown: NSPoint(x: 10, y: 10),
                mouseUp: NSPoint(x: 11, y: 11),
                clickCount: 1
            )
        )
    }

    func testUnchangedDragSelectionIsIgnored() {
        let selection = SelectionSnapshot(text: "Existing selection", fingerprint: "same-range")
        XCTAssertFalse(
            SelectionMonitor.representsNewSelection(
                before: selection,
                after: selection,
                clickCount: 1
            )
        )
    }

    func testChangedDragSelectionIsAccepted() {
        XCTAssertTrue(
            SelectionMonitor.representsNewSelection(
                before: SelectionSnapshot(text: "Old", fingerprint: "old-range"),
                after: SelectionSnapshot(text: "New", fingerprint: "new-range"),
                clickCount: 1
            )
        )
    }

    func testDoubleClickCanReuseTheSameSelection() {
        let selection = SelectionSnapshot(text: "Word", fingerprint: "same-range")
        XCTAssertTrue(
            SelectionMonitor.representsNewSelection(
                before: selection,
                after: selection,
                clickCount: 2
            )
        )
    }
}
