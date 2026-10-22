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
// Private libsystem call (macOS 10.14+), also used by Chromium and Claude's own disclaimer helper.
@_silgen_name("responsibility_spawnattrs_setdisclaim")
func responsibility_spawnattrs_setdisclaim(_ attributes: UnsafeMutablePointer<posix_spawnattr_t?>, _ disclaim: Int32) -> Int32
let args = CommandLine.arguments
if args.count >= 3 && args[1] == "launch" {
    guard args[2].hasSuffix(".app/Contents/MacOS/Claude") else { fail("Invalid helper arguments.") }
    // Disclaim responsibility so macOS privacy checks (Screen Recording, Accessibility) use
    // Claude's own signed grants, not Hatstand's ad-hoc identity that changes on every rebuild.
    var attributes: posix_spawnattr_t?
    posix_spawnattr_init(&attributes)
    posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETSID | POSIX_SPAWN_CLOEXEC_DEFAULT))
    guard responsibility_spawnattrs_setdisclaim(&attributes, 1) == 0 else { fail("Could not start Claude.") }
    var actions: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&actions)
    for fd: Int32 in 0...2 {
        posix_spawn_file_actions_addopen(&actions, fd, "/dev/null", fd == 0 ? O_RDONLY : O_WRONLY, 0)
    }
    let argv = args.dropFirst(2).map { strdup($0) } + [nil]
    var pid: pid_t = 0
    let status = posix_spawn(&pid, args[2], &actions, &attributes, argv, environ)
    guard status == 0 else { fail("Could not start Claude: \(String(cString: strerror(status))).") }
    print(pid)
} else if args.count == 2 && args[1] == "list" {
    let count = proc_listallpids(nil, 0)
    guard count > 0 else { fail("Could not enumerate processes.") }
    var pids = [Int32](repeating: 0, count: Int(count) + 1024)
    let found = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<Int32>.size))
    guard found > 0 else { fail("Could not enumerate processes.") }
    let observations = pids.prefix(Int(found)).compactMap(observe)
    FileHandle.standardOutput.write(try JSONEncoder().encode(observations))
} else if (args.count == 6 && ["focus", "close", "force-close"].contains(args[1]))
            || (args.count == 7 && args[1] == "open-url") {
    guard let pid = Int32(args[2]), pid > 0, let current = observe(pid),
          current.createdAt == args[3], canonical(current.executable) == canonical(args[4]) else {
        fail("The process changed. Refresh and try again.")
    }
    let dirs = current.arguments.filter { $0.hasPrefix("--user-data-dir=") }
    guard dirs.count == 1, canonical(String(dirs[0].dropFirst("--user-data-dir=".count))) == canonical(args[5]) else {
        fail("The process changed. Refresh and try again.")
    }
    if args[1] == "focus" || args[1] == "open-url" {
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
        if args[1] == "open-url" {
            // Only a Claude Code session link, or a new session with a prompt and folder, delivered to this PID:
            // every Claude shares one bundle ID, so a normal URL open would reach whichever account macOS picks.
            let allowed = "^claude://code/(continue\\?session=local_[A-Za-z0-9-]{1,64}"
                + "|new\\?q=[A-Za-z0-9%._~!*'()-]{1,20000}&folder=[A-Za-z0-9%._~!*'()-]{1,4000})$"
            guard args[6].range(of: allowed, options: .regularExpression) != nil else { fail("Invalid Claude link.") }
            let open = NSAppleEventDescriptor(eventClass: AEEventClass(kInternetEventClass),
                eventID: AEEventID(kAEGetURL),
                targetDescriptor: NSAppleEventDescriptor(processIdentifier: pid),
                returnID: AEReturnID(kAutoGenerateReturnID), transactionID: AETransactionID(kAnyTransactionID))
            open.setParam(NSAppleEventDescriptor(string: args[6]), forKeyword: AEKeyword(keyDirectObject))
            do {
                _ = try open.sendEvent(options: [.waitForReply], timeout: 5)
            } catch {
                fail("Could not open this session in Claude. Allow Hatstand to control Claude in System Settings > Privacy & Security > Automation.")
            }
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
