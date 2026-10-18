// Read exact argv boundaries from the kernel; ps output cannot preserve paths with spaces.
// Never emit environment variables, account data, or session contents.
import AppKit
import Darwin
import Foundation

struct Observation: Encodable {
    let pid: Int32
    let executable: String
    let arguments: [String]
    let commandLine: String
    let createdAt: String
    let platform = "darwin"
}

func identity(_ pid: Int32) -> proc_bsdinfo? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size,
          info.pbi_uid == getuid() else { return nil }
    return info
}
func timestamp(_ info: proc_bsdinfo) -> String {
    "\(info.pbi_start_tvsec):\(info.pbi_start_tvusec)"
}
func unreadable(_ pid: Int32, _ before: proc_bsdinfo) -> Observation? {
    // A live Claude process whose argv cannot be inspected must not be reported as stopped.
    if let current = identity(pid), timestamp(before) == timestamp(current) {
        fail("Could not read Claude process arguments. Refresh before changing profile data.")
    }
    return nil
}
func observe(_ pid: Int32) -> Observation? {
    guard let before = identity(pid) else { return nil }
    var path = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    guard proc_pidpath(pid, &path, UInt32(path.count)) > 0 else { return nil }
    let executable = String(cString: path)
    guard executable.hasSuffix(".app/Contents/MacOS/Claude") else { return nil }
    var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
    var size = 0
    guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > 4 else { return unreadable(pid, before) }
    var bytes = [UInt8](repeating: 0, count: size)
    guard sysctl(&mib, 3, &bytes, &size, nil, 0) == 0 else { return unreadable(pid, before) }
    let argc = bytes.withUnsafeBytes { $0.loadUnaligned(as: Int32.self) }
    guard argc > 0, argc < 10000 else { return unreadable(pid, before) }
    var cursor = MemoryLayout<Int32>.size
    // Skip executable path and padding, then read exactly argc NUL-delimited strings.
    while cursor < size && bytes[cursor] != 0 { cursor += 1 }
    while cursor < size && bytes[cursor] == 0 { cursor += 1 }
    var arguments: [String] = []
    for _ in 0..<argc {
        guard cursor < size else { return unreadable(pid, before) }
        let start = cursor
        while cursor < size && bytes[cursor] != 0 { cursor += 1 }
        guard cursor < size, let argument = String(bytes: bytes[start..<cursor], encoding: .utf8) else { return unreadable(pid, before) }
        arguments.append(argument)
        cursor += 1
    }
    guard let after = identity(pid), timestamp(before) == timestamp(after) else { return nil }
    guard !arguments.contains(where: { $0.hasPrefix("--type=") }),
          arguments.contains(where: { $0.hasPrefix("--user-data-dir=") }) else { return nil }
    return Observation(pid: pid, executable: executable, arguments: arguments,
                       commandLine: arguments.joined(separator: " "), createdAt: timestamp(after))
}
func canonical(_ path: String) -> String {
    URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath().path
}
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
let args = CommandLine.arguments
if args.count == 2 && args[1] == "list" {
    let count = proc_listallpids(nil, 0)
    guard count > 0 else { fail("Could not enumerate processes.") }
    var pids = [Int32](repeating: 0, count: Int(count) + 1024)
    let found = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<Int32>.size))
    guard found > 0 else { fail("Could not enumerate processes.") }
    let observations = pids.prefix(Int(found)).compactMap(observe)
    FileHandle.standardOutput.write(try JSONEncoder().encode(observations))
} else if args.count == 6 && ["focus", "close", "force-close"].contains(args[1]) {
    guard let pid = Int32(args[2]), pid > 0, let current = observe(pid),
          current.createdAt == args[3], canonical(current.executable) == canonical(args[4]) else {
        fail("The process changed. Refresh and try again.")
    }
    let dirs = current.arguments.filter { $0.hasPrefix("--user-data-dir=") }
    guard dirs.count == 1, canonical(String(dirs[0].dropFirst("--user-data-dir=".count))) == canonical(args[5]) else {
        fail("The process changed. Refresh and try again.")
    }
    if args[1] == "focus" {
        // Activation alone does not reopen a closed Electron window. Send the same
        // reopen event as a Dock click, addressed to this PID (never the shared bundle ID).
        let reopen = NSAppleEventDescriptor(eventClass: AEEventClass(kCoreEventClass),
            eventID: AEEventID(kAEReopenApplication),
            targetDescriptor: NSAppleEventDescriptor(processIdentifier: pid),
            returnID: AEReturnID(kAutoGenerateReturnID), transactionID: AETransactionID(kAnyTransactionID))
        do {
            _ = try reopen.sendEvent(options: [.waitForReply, .neverInteract], timeout: 3)
        } catch {
            fail("Could not reopen this Claude window. Open it from the Dock and try again.")
        }
        guard let app = NSRunningApplication(processIdentifier: pid),
              app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps]) else {
            fail("Could not focus this Claude window. Open it from the Dock.")
        }
    } else {
        guard kill(pid, args[1] == "close" ? SIGTERM : SIGKILL) == 0 else {
            fail("Could not close this Claude process. Refresh and try again.")
        }
    }
} else { fail("Invalid helper arguments.") }
