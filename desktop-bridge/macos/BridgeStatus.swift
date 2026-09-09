import AppKit
import UserNotifications

final class BridgeMenu: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Foundr1 Bridge")
    var item: NSStatusItem!
    var state: [String: Any] = [:]
    var timer: Timer?
    var previousFresh: Bool?
    var lastFailureID: String?
    let names = ["uber_eats":"Uber", "rocket_now":"火箭", "demae_can":"出前馆"]
    var fresh: Bool { age(state["heartbeatAt"]) < 15 }
    func age(_ value: Any?) -> Double { Date().timeIntervalSince1970 - ((value as? Double ?? 0) / 1000) }
    func time(_ value: Any?) -> String {
        guard let number = value as? Double, number > 0 else { return "尚未检查" }
        let formatter = DateFormatter(); formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: Date(timeIntervalSince1970: number / 1000))
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu(); menu.delegate = self; item.menu = menu
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.refresh() }
    }
    func refresh() {
        if let data = try? Data(contentsOf: directory.appendingPathComponent("status.json")),
           let value = try? JSONSerialization.jsonObject(with: data) as? [String:Any] { state = value }
        let platforms = state["platforms"] as? [String:[String:Any]] ?? [:]
        let attention = platforms.values.contains { ($0["task"] as? [String:Any])?["ok"] as? Bool == false || ($0["page"] as? [String:Any])?["ok"] as? Bool == false }
        let busy = state["current"] is [String:Any]
        if UserDefaults.standard.bool(forKey:"failureNotifications") {
            if previousFresh == true && !fresh { notify("Bridge 连接中断", "服务心跳已中断，请检查本机状态。") }
            if let failed = (state["recent"] as? [[String:Any]])?.first, failed["ok"] as? Bool == false,
               let id = failed["id"] as? String, id != lastFailureID {
                lastFailureID = id
                if age(failed["at"]) < 60 { notify("Bridge 任务需要处理", failed["error"] as? String ?? "请打开 Store 查看失败详情。") }
            }
        }
        previousFresh = fresh
        let title = !fresh ? "离线" : busy ? "执行中" : !(state["serviceError"] as? String ?? "").isEmpty ? "连接异常" : age(state["lastServerAt"]) > 90 ? "连接待确认" : attention ? "需处理" : "在线"
        item.button?.title = " Bridge · \(title)"
        item.button?.image = NSImage(systemSymbolName: !fresh ? "bolt.slash" : busy ? "arrow.triangle.2.circlepath" : attention ? "exclamationmark.triangle" : "link", accessibilityDescription: title)
        item.button?.toolTip = "Foundr1 Bridge · \(title)"
    }
    func line(_ menu: NSMenu, _ text: String, action: String? = nil) {
        let row = NSMenuItem(title: text, action: action == nil ? nil : #selector(select(_:)), keyEquivalent: "")
        row.target = self; row.representedObject = action; menu.addItem(row)
    }
    func menuNeedsUpdate(_ menu: NSMenu) {
        refresh(); menu.removeAllItems()
        line(menu, "Foundr1 Bridge  ·  \(state["version"] as? String ?? "—")")
        line(menu, state["deviceName"] as? String ?? "本机连接服务")
        line(menu, fresh ? "服务运行中 · 服务器连接：\(time(state["lastServerAt"]))" : "服务未运行或心跳已中断")
        if let error = state["serviceError"] as? String, !error.isEmpty { line(menu, error) }
        menu.addItem(.separator())
        if let task = state["current"] as? [String:Any] {
            line(menu, "当前：\(names[task["platform"] as? String ?? ""] ?? "平台") · \(taskName(task["type"]))")
            let phases = ["starting":"开始处理", "locating":"查找商品", "applying":"写入并核对", "auditing":"读取销售状态", "capturing":"读取菜单", "retrying":"重试中", "preflight":"检查菜单", "content":"更新菜单内容", "creating":"创建非公开商品", "relationships":"关联分类与选项", "verifying":"回读验证", "retiring":"处理停用项目"]
            let phase = task["phase"] as? String ?? ""
            line(menu, "\(phases[phase] ?? "执行中") · 已运行 \(Int(age(task["startedAt"]))) 秒")
            if let name = task["targetName"] as? String, !name.isEmpty { line(menu, "当前对象：\(name)") }
            let actions = ["read_menu":"读取菜单列表", "read_options":"读取选项组和选项", "read_availability":"核对销售状态（不修改）", "save":"保存菜单"]
            if let action = task["action"] as? String, let title = actions[action] { line(menu, title) }
            if let completed = task["completed"] as? Int, let total = task["total"] as? Int, total > 0 { line(menu, "本阶段完成：\(completed) / \(total)") }
            if let last = task["lastResponseAt"] as? Double, last > 0 { line(menu, "最近成功响应：\(Int(age(last))) 秒前") }
            if task["requestState"] as? String == "retrying" { line(menu, "正在重试读取 · \(task["retry"] as? Int ?? 0) / 2") }
            line(menu, "任务：\(task["id"] as? String ?? "—")")
            if age(task["updatedAt"]) > 120 { line(menu, "较长时间未更新进度，请查看任务详情") }
        } else { line(menu, "当前：\(state["activity"] as? String ?? "未知")") }
        line(menu, "排队数量：请在网页任务历史查看")
        if FileManager.default.fileExists(atPath:directory.appendingPathComponent("action.json").path) { line(menu, "本地操作已提交，等待当前任务结束") }
        line(menu, "查看任务详情／失败重试", action: "history")
        menu.addItem(.separator())
        let platforms = state["platforms"] as? [String:[String:Any]] ?? [:]
        for key in ["uber_eats","rocket_now","demae_can"] {
            let platform = platforms[key] ?? [:]
            let page = platform["page"] as? [String:Any]
            let task = platform["task"] as? [String:Any]
            line(menu, "\(names[key]!) · 页面：\(page == nil ? "未检查" : page?["ok"] as? Bool == true ? "可访问" : "需处理") · \(time(page?["at"]))")
            if let task = task { line(menu, "  最近任务：\(task["ok"] as? Bool == true ? "成功" : task["error"] as? String ?? "失败") · \(time(task["at"]))") }
            line(menu, "打开 \(names[key]!) 专用后台", action: "open:\(key)")
        }
        menu.addItem(.separator())
        line(menu, "本次启动后的最近结果")
        for task in (state["recent"] as? [[String:Any]] ?? []).prefix(3) {
            line(menu, "\(time(task["at"]))  \(names[task["platform"] as? String ?? ""] ?? "平台") · \(task["ok"] as? Bool == true ? "任务完成" : "任务失败")")
        }
        line(menu, "打开 Store 销售状态", action: "store")
        line(menu, "打开 OS 菜单管理", action: "os")
        line(menu, "检查连接（任务结束后）", action: "check")
        line(menu, "安全重启 Bridge（任务结束后）", action: "restart")
        line(menu, "复制脱敏诊断信息", action: "diagnostics")
        line(menu, UserDefaults.standard.bool(forKey:"failureNotifications") ? "关闭异常通知" : "启用异常通知…", action:"notifications")
        let launch = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/jp.foundr1.bridge-menu.plist")
        line(menu, "菜单栏开机启动：\(FileManager.default.fileExists(atPath: launch.path) ? "已安装" : "未安装")")
        line(menu, "仅退出菜单栏（Bridge 继续运行）", action: "quit")
    }
    func taskName(_ value: Any?) -> String {
        return ["audit_inventory":"读取销售状态", "set_inventory_availability":"同步销售状态", "publish_menu_changes":"发布菜单", "capture_menu_snapshot":"读取菜单"][value as? String ?? ""] ?? "后台任务"
    }
    func notify(_ title: String, _ body: String) {
        let content=UNMutableNotificationContent();content.title=title;content.body=body;content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier:UUID().uuidString,content:content,trigger:nil))
    }
    @objc func select(_ sender: NSMenuItem) {
        guard let action = sender.representedObject as? String else { return }
        if action == "quit" { NSApp.terminate(nil); return }
        if action == "notifications" {
            if UserDefaults.standard.bool(forKey:"failureNotifications") { UserDefaults.standard.set(false,forKey:"failureNotifications") }
            else { UNUserNotificationCenter.current().requestAuthorization(options:[.alert,.sound]) { granted,_ in UserDefaults.standard.set(granted,forKey:"failureNotifications") } }
            return
        }
        if action == "diagnostics" {
            let text = (try? JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys])).flatMap { String(data:$0, encoding:.utf8) } ?? "无状态记录"
            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType:.string); return
        }
        if ["os","store","history"].contains(action) {
            let paths = ["os":"/os/menus","store":"/store/menu","history":"/store/menu/inventory-history"]
            // Never follow a URL supplied by task data.
            if let url = URL(string:"https://www.foundr1.jp" + paths[action]!) { NSWorkspace.shared.open(url) }; return
        }
        if !fresh { let alert=NSAlert();alert.messageText="Bridge 当前离线";alert.informativeText="请先恢复本机 Bridge 服务。不会强制中断或重跑库存任务。";alert.runModal();return }
        if action == "restart" {
            let alert=NSAlert();alert.messageText="安全重启 Bridge？";alert.informativeText="当前任务结束后重启，不重试失败任务，也不改变销售状态。";alert.addButton(withTitle:"确认");alert.addButton(withTitle:"取消")
            if alert.runModal() != .alertFirstButtonReturn { return }
        }
        do {
            let file=directory.appendingPathComponent("action.json")
            if FileManager.default.fileExists(atPath:file.path) { throw NSError(domain:"已有操作等待执行",code:1) }
            let data=try JSONSerialization.data(withJSONObject:["action":action,"at":Date().timeIntervalSince1970*1000])
            try data.write(to:file,options:.atomic)
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
        } catch { let alert=NSAlert();alert.messageText="操作未提交";alert.informativeText="已有操作等待执行，或本地状态目录不可用。";alert.runModal() }
    }
}
let app = NSApplication.shared
let delegate = BridgeMenu()
app.delegate = delegate
app.run()
