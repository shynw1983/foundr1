import Foundation
import Security

// A local helper keeps secrets out of process arguments, shell history and files.
do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let request = try JSONSerialization.jsonObject(with: input) as? [String: Any],
          let operation = request["operation"] as? String,
          let storeId = request["storeId"] as? String,
          UUID(uuidString: storeId) != nil,
          let account = request["account"] as? String,
          ["credentials", "session"].contains(account) else { exit(2) }
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "jp.foundr1.camera-bridge.\(storeId)", kSecAttrAccount as String: account]
    if operation == "read" {
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(search as CFDictionary, &result)
        if status == errSecItemNotFound { print("null"); exit(0) }
        guard status == errSecSuccess, let data = result as? Data else { exit(3) }
        FileHandle.standardOutput.write(data)
    } else if operation == "write", let value = request["value"] {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { exit(3) }
        print("{\"saved\":true}")
    } else { exit(2) }
} catch { exit(2) }
