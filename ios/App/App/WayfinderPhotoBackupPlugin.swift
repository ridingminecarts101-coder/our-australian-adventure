import Foundation
import Capacitor

enum WayfinderBackupExclusion {
    static func applyToPersistentDirectories() throws {
        let manager = FileManager.default
        for directory in [FileManager.SearchPathDirectory.documentDirectory, .libraryDirectory] {
            guard var url = manager.urls(for: directory, in: .userDomainMask).first else {
                throw CocoaError(.fileNoSuchFile)
            }
            if !manager.fileExists(atPath: url.path) {
                try manager.createDirectory(at: url, withIntermediateDirectories: true)
            }
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try url.setResourceValues(values)
            let confirmed = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
            guard confirmed.isExcludedFromBackup == true else {
                throw CocoaError(.fileWriteUnknown)
            }
        }
    }
}

@objc(WayfinderPhotoBackupPlugin)
public final class WayfinderPhotoBackupPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WayfinderPhotoBackupPlugin"
    public let jsName = "WayfinderPhotoBackup"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exclude", returnType: CAPPluginReturnPromise)
    ]

    @objc public func prepare(_ call: CAPPluginCall) {
        do {
            try WayfinderBackupExclusion.applyToPersistentDirectories()
            call.resolve()
        } catch {
            call.reject("Could not prepare device-only photo storage.", nil, error)
        }
    }

    @objc public func exclude(_ call: CAPPluginCall) {
        guard let path = call.getString("path"),
              path.hasPrefix("wayfinder/photos/"),
              path.hasSuffix(".jpg"),
              !path.contains(".."),
              !path.contains("\\") else {
            call.reject("Invalid Wayfinder photo path.")
            return
        }

        let manager = FileManager.default
        guard let documents = manager.urls(for: .documentDirectory, in: .userDomainMask).first else {
            call.reject("The app Documents directory is unavailable.")
            return
        }
        var url = documents.appendingPathComponent(path, isDirectory: false).standardizedFileURL
        let photoRoot = documents.appendingPathComponent("wayfinder/photos", isDirectory: true)
            .standardizedFileURL.path + "/"
        guard url.path.hasPrefix(photoRoot), manager.fileExists(atPath: url.path) else {
            call.reject("The Wayfinder photo does not exist in app storage.")
            return
        }

        do {
            try WayfinderBackupExclusion.applyToPersistentDirectories()
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try url.setResourceValues(values)
            let confirmed = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
            guard confirmed.isExcludedFromBackup == true else {
                call.reject("iOS did not confirm the device-only photo flag.")
                return
            }
            call.resolve()
        } catch {
            call.reject("Could not keep this photo out of device backup.", nil, error)
        }
    }
}

final class WayfinderBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WayfinderPhotoBackupPlugin())
    }
}
