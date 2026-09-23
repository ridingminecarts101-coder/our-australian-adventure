import XCTest

@MainActor
final class WayfinderStoreScreenshots: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
    }

    func testStartupDiagnostic() {
        // No fixture or purchase key is available to this test. Observe the
        // installed app before any login and keep evidence even if it fails.
        let webView = app.webViews.firstMatch
        let webViewFound = webView.waitForExistence(timeout: 45)
        let signInFound = app.buttons["Sign in"].waitForExistence(timeout: 30)
        let retryFound = app.buttons["Try again"].exists

        attachStartupEvidence()

        XCTAssertTrue(webViewFound, "The native WebView did not become available")
        XCTAssertFalse(retryFound, "Wayfinder reached the recoverable startup-error screen")
        XCTAssertTrue(signInFound, "A fresh native install must show the required account gate")
    }

    func testCaptureStoreSubmissionScreens() throws {
        try signInIfRequired()
        let adventures = button(containing: "Adventures")
        XCTAssertTrue(adventures.waitForExistence(timeout: 45), "The signed-in app did not become available")
        XCTAssertTrue(button(containing: "Oceania").waitForExistence(timeout: 15),
                      "The World continent list did not render after sign-in")

        capture("01-adventures-world")
        tapTab("Passport", captureAs: "02-passport")
        tapTab("Memories", captureAs: "03-memories")
        tapTab("Community", captureAs: "04-community")
        tapTab("Me", captureAs: "05-trips-achievements")

        let paidCollections = app.staticTexts["Paid collections"]
        XCTAssertTrue(scrollTo(paidCollections), "Paid collections were not reachable")

        let products = [
            ("All continents", "all"), ("Oceania gems", "oceania"),
            ("Europe gems", "europe"), ("North America gems", "north-america"),
            ("Asia gems", "asia"), ("Middle East gems", "middle-east"),
            ("South America gems", "south-america"), ("Africa gems", "africa"),
        ]
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", "Mobile app")).count, 0,
                       "The native purchase rows are unavailable; do not submit a store screenshot")
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", "Unlocked")).count, 0,
                       "The private screenshot account must not already own the eight packs")
        capture("06-paid-collections")
        for (index, product) in products.enumerated() {
            let (name, slug) = product
            if index == 1 {
                let regionalCollections = button(containing: "Continent-specific collections")
                XCTAssertTrue(scrollTo(regionalCollections), "The regional collection picker was not reachable")
                regionalCollections.tap()
                XCTAssertTrue(app.staticTexts["Continent-specific collections"].waitForExistence(timeout: 10),
                              "The regional collection dialog did not open")
                XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", "Mobile app")).count, 0,
                               "The native regional purchase rows are unavailable; do not submit a store screenshot")
                XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", "Unlocked")).count, 0,
                               "The private screenshot account must not already own the regional packs")
            }
            let label = app.staticTexts[name]
            XCTAssertTrue(scrollTo(label), "Missing visible IAP row: \(name)")
            capture("iap-\(slug)")
        }
        let closeCollections = button(containing: "Close continent collections")
        XCTAssertTrue(scrollTo(closeCollections, swipeUp: false), "The regional collection dialog could not be closed")
        closeCollections.tap()
        adventures.tap()
        let oceania = button(containing: "Oceania")
        XCTAssertTrue(oceania.waitForExistence(timeout: 15))
        oceania.tap()
        capture("07-oceania")
        let australia = button(containing: "Australia")
        XCTAssertTrue(australia.waitForExistence(timeout: 15))
        australia.tap()
        capture("08-australia")
        let allAustralia = button(containing: "Everything in Australia")
        XCTAssertTrue(allAustralia.waitForExistence(timeout: 15), "The Australia catalogue route was unavailable")
        allAustralia.tap()
        let detail = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH[c] %@", "Open details for "
        )).firstMatch
        XCTAssertTrue(detail.waitForExistence(timeout: 15), "No Australia adventure detail was reachable")
        capture("09-australia-adventures")
        detail.tap()
        let detailDialog = app.descendants(matching: .any).matching(NSPredicate(
            format: "label BEGINSWITH[c] %@", "Adventure detail"
        )).firstMatch
        XCTAssertTrue(detailDialog.waitForExistence(timeout: 10),
                      "The selected adventure detail did not open")
        capture("10-adventure-detail")
    }

    private func signInIfRequired() throws {
        let signIn = app.buttons["Sign in"]
        let accountGateFound = signIn.waitForExistence(timeout: 45)
        if !accountGateFound { attachStartupEvidence() }
        XCTAssertTrue(accountGateFound,
                      "A fresh native install must show the required account gate")
        let env = ProcessInfo.processInfo.environment
        let reviewEmail = env["WAYFINDER_REVIEW_EMAIL"]
        let reviewPassword = env["WAYFINDER_REVIEW_PASSWORD"]
        guard let email = reviewEmail, !email.isEmpty,
              let password = reviewPassword, !password.isEmpty else {
            throw XCTSkip("A private, verified review account is required for genuine app screenshots")
        }
        let emailField = app.textFields["Email"]
        let passwordField = app.secureTextFields["Password"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 5))
        XCTAssertTrue(passwordField.exists)
        emailField.tap(); emailField.typeText(email)
        passwordField.tap(); passwordField.typeText(password)
        signIn.tap()
    }

    private func button(containing text: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
    }

    private func tapTab(_ name: String, captureAs file: String) {
        // Match the bottom navigation label, including its icon. A substring
        // match for "Me" also matches "Recommend a place" in Community.
        let tab = app.buttons.matching(NSPredicate(
            format: "label ==[c] %@ OR label ENDSWITH[c] %@", name, " " + name
        )).firstMatch
        XCTAssertTrue(tab.waitForExistence(timeout: 10), "Missing tab: \(name)")
        XCTAssertTrue(tab.isHittable, "The tab is present but cannot be tapped: \(name)")
        tab.tap()
        let heading = ["Passport": "Stamps", "Memories": "Your memories",
                       "Community": "Traveller recommendations", "Me": "Trips"][name] ?? name
        XCTAssertTrue(app.staticTexts[heading].waitForExistence(timeout: 10),
                      "The \(name) panel did not render after tapping its tab")
        capture(file)
    }

    private func scrollTo(_ element: XCUIElement, swipeUp: Bool = true) -> Bool {
        for _ in 0..<10 {
            if element.exists && element.isHittable { return true }
            if swipeUp { app.swipeUp() } else { app.swipeDown() }
        }
        return element.exists && element.isHittable
    }

    private func capture(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func attachStartupEvidence() {
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "startup-actual-screen"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        let accessibility = app.debugDescription
        let emailPattern = try! NSRegularExpression(
            pattern: "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}",
            options: [.caseInsensitive]
        )
        let redacted = emailPattern.stringByReplacingMatches(
            in: accessibility, range: NSRange(accessibility.startIndex..., in: accessibility),
            withTemplate: "[redacted-email]"
        )
        let tree = XCTAttachment(string: redacted)
        tree.name = "startup-accessibility-tree"
        tree.lifetime = .keepAlways
        add(tree)
    }
}
