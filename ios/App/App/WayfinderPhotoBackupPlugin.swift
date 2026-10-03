import Foundation
import Capacitor
import Photos

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
        CAPPluginMethod(name: "exclude", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPhotoLibraryAddAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveToPhotoLibrary", returnType: CAPPluginReturnPromise)
    ]

    @objc public func requestPhotoLibraryAddAccess(_ call: CAPPluginCall) {
        let complete: (PHAuthorizationStatus) -> Void = { status in
            DispatchQueue.main.async {
                if status == .authorized || status == .limited {
                    call.resolve()
                } else {
                    call.reject("Allow Wayfinder to add photos in device Settings.", "PHOTO_LIBRARY_DENIED")
                }
            }
        }
        let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        if status == .notDetermined {
            PHPhotoLibrary.requestAuthorization(for: .addOnly, handler: complete)
        } else {
            complete(status)
        }
    }

    @objc public func saveToPhotoLibrary(_ call: CAPPluginCall) {
        let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        guard status == .authorized || status == .limited else {
            call.reject("Allow Wayfinder to add photos in device Settings.", "PHOTO_LIBRARY_DENIED")
            return
        }
        guard let path = call.getString("path"),
              let expression = try? NSRegularExpression(pattern: "^wayfinder/photos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,128}\\.jpg$", options: [.caseInsensitive]),
              expression.firstMatch(in: path, range: NSRange(location: 0, length: (path as NSString).length)) != nil,
              let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            call.reject("Invalid Wayfinder photo path.")
            return
        }
        let url = documents.appendingPathComponent(path, isDirectory: false)
            .resolvingSymlinksInPath().standardizedFileURL
        let root = documents.appendingPathComponent("wayfinder/photos", isDirectory: true)
            .resolvingSymlinksInPath().standardizedFileURL.path + "/"
        var isDirectory: ObjCBool = false
        guard url.path.hasPrefix(root),
              FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
              !isDirectory.boolValue else {
            call.reject("The Wayfinder photo is missing from this device.", "PHOTO_FILE_MISSING")
            return
        }

        let takenAt = call.getString("takenAt")
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let wholeSeconds = ISO8601DateFormatter()
        wholeSeconds.formatOptions = [.withInternetDateTime]
        let captureDate = takenAt.flatMap { fractional.date(from: $0) ?? wholeSeconds.date(from: $0) }
        PHPhotoLibrary.shared().performChanges({
            let request = PHAssetCreationRequest.forAsset()
            let options = PHAssetResourceCreationOptions()
            options.shouldMoveFile = false  // keep the app-private Wayfinder original
            request.addResource(with: .photo, fileURL: url, options: options)
            if let captureDate = captureDate { request.creationDate = captureDate }
        }) { success, error in
            DispatchQueue.main.async {
                if success {
                    call.resolve()
                } else {
                    call.reject("Could not save this photo to Photos.", "PHOTO_SAVE_FAILED", error)
                }
            }
        }
    }

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
