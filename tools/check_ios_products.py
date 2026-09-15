"""Validate the permanent Wayfinder Apple/RevenueCat product contract."""
import json
import pathlib
import plistlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / "tools/ios-products.json").read_text(encoding="utf-8"))
STORE = (ROOT / "store.js").read_text(encoding="utf-8")
PROJECT = (ROOT / "ios/App/App.xcodeproj/project.pbxproj").read_text(encoding="utf-8")
PACKAGE = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))

expected_slugs = ["all", "oceania", "europe", "north-america", "asia",
                  "middle-east", "south-america", "africa"]
products = CATALOG["products"]
assert CATALOG["schema_version"] == 1
assert CATALOG["platform"] == "ios"
assert CATALOG["bundle_id"] == "app.wayfinder.mobile"
assert CATALOG["product_type"] == "NON_CONSUMABLE"
assert CATALOG["catalog_status"].startswith("planned;")
assert CATALOG["family_sharing"] is False
assert CATALOG["currency"] == "AUD"
assert CATALOG["revenuecat"]["restore_behavior_required"] == "Keep with original App User ID"
assert CATALOG["revenuecat"]["offering_required_by_client"] is False
assert [row["slug"] for row in products] == expected_slugs
assert len({row["product_id"] for row in products}) == 8
assert len({row["entitlement_id"] for row in products}) == 8
assert all(row["entitlement_id"] == row["slug"] for row in products)
assert products[0]["aud_price"] == "14.99"
assert all(row["aud_price"] == "2.99" for row in products[1:])
assert all(row["product_id"] == "app.wayfinder.mobile.gems."
           + row["slug"].replace("-", "_") for row in products)

runtime = re.findall(
    r"slug:\s*'([^']+)'[\s\S]*?name:\s*'([^']+)'[\s\S]*?price:\s*'AUD \$([0-9.]+)'",
    STORE[STORE.index("const PACKS = ["):STORE.index("];", STORE.index("const PACKS = ["))])
assert [(slug, price) for slug, _, price in runtime] == [
    (row["slug"], row["aud_price"]) for row in products]
assert "const STORE_PREFIX = 'app.wayfinder.mobile.gems.'" in STORE
assert "info.entitlements && info.entitlements.active" in STORE
assert "allPurchasedProductIdentifiers" not in STORE
assert STORE.count("type: 'NON_SUBSCRIPTION'") == 2
assert "productCategory:" not in STORE
assert "appUserID: runId" in STORE
assert "await P.logOut()" not in STORE
assert "alreadyConfigured && P.logIn" in STORE
assert PROJECT.count("PRODUCT_BUNDLE_IDENTIFIER = app.wayfinder.mobile;") == 2
assert PACKAGE["dependencies"]["@revenuecat/purchases-capacitor"].startswith("^13.")

with (ROOT / "ios/App/App/Info.plist").open("rb") as handle:
    info = plistlib.load(handle)
assert info["CFBundleIdentifier"] == "$(PRODUCT_BUNDLE_IDENTIFIER)"
assert info["CFBundleVersion"] == "$(CURRENT_PROJECT_VERSION)"
assert info["CFBundleShortVersionString"] == "$(MARKETING_VERSION)"

print("  iOS products: 8 permanent non-consumables and matching entitlements passed")
