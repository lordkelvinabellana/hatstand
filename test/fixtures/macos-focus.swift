// A synthetic Cocoa app for exercising Dock-style reopen behavior, without Claude accounts.
import AppKit
import Foundation
let folder = CommandLine.arguments.first { $0.hasPrefix("--user-data-dir=") }!
    .dropFirst("--user-data-dir=".count)
let root = URL(fileURLWithPath: String(folder))
final class Delegate: NSObject, NSApplicationDelegate {
    let window = NSWindow(contentRect: NSRect(x: 120, y: 120, width: 300, height: 160),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    var reopens = 0
    var command = ""
    func applicationDidFinishLaunching(_ notification: Notification) {
        window.title = "Hatstand focus regression fixture"
        window.isReleasedWhenClosed = false
        window.close()
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [self] _ in
            let next = (try? String(contentsOf: root.appendingPathComponent("command"), encoding: .utf8)) ?? ""
            if next != command {
                command = next
                switch next {
                case "closed": window.close()
                case "hidden": NSApp.hide(nil)
                default: break
                }
            }
            let status: [String: Any] = ["visible": window.isVisible, "minimized": window.isMiniaturized,
                "hidden": NSApp.isHidden, "active": NSApp.isActive, "reopens": reopens, "command": command]
            if let data = try? JSONSerialization.data(withJSONObject: status) {
                try? data.write(to: root.appendingPathComponent("status.json"), options: .atomic)
            }
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        reopens += 1
        sender.unhide(nil)
        window.deminiaturize(nil)
        window.makeKeyAndOrderFront(nil)
        return true
    }
}
let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
