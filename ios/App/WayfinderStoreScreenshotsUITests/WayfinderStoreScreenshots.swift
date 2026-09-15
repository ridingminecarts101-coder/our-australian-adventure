import XCTest

@MainActor
final class WayfinderStoreScreenshots: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
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
        for (name, slug) in products {
            let label = app.staticTexts[name]
            XCTAssertTrue(scrollTo(label), "Missing visible IAP row: \(name)")
            capture("iap-\(slug)")
        }
        adventures.tap()
        let oceania = button(containing: "Oceania")
        XCTAssertTrue(oceania.waitForExistence(timeout: 15))
        oceania.tap()
        capture("07-oceania")
        let australia = button(containing: "Australia")
        XCTAssertTrue(australia.waitForExistence(timeout: 15))
        australia.tap()
        capture("08-australia")
    }

    private func signInIfRequired() throws {
        let signIn = app.buttons["Sign in"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 12),
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
        let tab = button(containing: name)
        XCTAssertTrue(tab.waitForExistence(timeout: 10), "Missing tab: \(name)")
        XCTAssertTrue(tab.isHittable, "The tab is present but cannot be tapped: \(name)")
        tab.tap()
        let heading = ["Passport": "Stamps", "Memories": "Your memories",
                       "Community": "Traveller recommendations", "Me": "Trips"][name] ?? name
        XCTAssertTrue(app.staticTexts[heading].waitForExistence(timeout: 10),
                      "The \(name) panel did not render after tapping its tab")
        capture(file)
    }

    private func scrollTo(_ element: XCUIElement) -> Bool {
        for _ in 0..<10 {
            if element.exists && element.isHittable { return true }
            app.swipeUp()
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
}
