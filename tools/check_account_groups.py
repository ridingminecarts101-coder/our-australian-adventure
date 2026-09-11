"""Offline contract checks for recoverable accounts and consent-based groups.

These gates never contact Supabase or a store. They catch accidental returns to
the shared credential, anonymous-by-default onboarding, group-owned writes, or
browser purchase simulation before those regressions reach a staged database.
"""
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
CONFIG = (ROOT / "config.js").read_text(encoding="utf-8")
STORE = (ROOT / "store.js").read_text(encoding="utf-8")


def body(name: str, source: str = APP) -> str:
    match = re.search(rf"(?:async\s+)?function\s+{name}\([^)]*\)\s*\{{(.*?)\n\}}", source, re.S)
    if not match:
        raise AssertionError(f"missing function {name}")
    return match.group(1)


def require(label: str, condition: bool, passed: list[str]) -> None:
    if not condition:
        raise AssertionError(label)
    passed.append(label)


def main() -> int:
    passed: list[str] = []
    combined = APP + HTML + CONFIG

    require("shared credential removed", "sharedEmail" not in combined and "passphrase" not in HTML, passed)
    require("new installs require recoverable sign-in", "allowAnonymous: false" in CONFIG, passed)
    require("account screen collects email/password", 'type="email"' in HTML and 'type="password"' in HTML, passed)
    require("email signup is implemented", ".auth.signUp" in APP and "emailRedirectTo" in APP, passed)
    require("email verification is explained", "verification email" in HTML.lower(), passed)
    require("password reset request is implemented", ".auth.resetPasswordForEmail" in APP, passed)
    require("password recovery completion is implemented", "PASSWORD_RECOVERY" in APP and
            ".auth.updateUser({ password })" in APP, passed)

    email_upgrade = body("startAnonymousUpgrade")
    password_upgrade = body("finishAnonymousUpgrade")
    require("anonymous upgrade verifies email before password", ".auth.updateUser({ email: clean }" in email_upgrade and
            ".auth.updateUser({ password })" in password_upgrade and "password" not in email_upgrade, passed)
    require("anonymous upgrade preserves identity", "data.user.id !== before" in email_upgrade and
            "data.user.id !== before" in password_upgrade, passed)
    require("anonymous upgrade persists no credentials", "{ owner_id: ownerId, stage }" in APP and
            "LS.accountUpgrade" in APP, passed)

    require("new records are personal", APP.count("user_id: runOwner, group_id: null") == 3, passed)
    require("group lifecycle uses server RPCs", all(f".rpc('{name}'" in APP for name in
            ("create_group", "join_group_by_code", "leave_group")), passed)
    require("client cannot directly enrol a member", ".from('group_members')\n    .insert" not in APP, passed)
    require("joining asks about past completions", "Share your past and future completion ticks with this group?" in APP, passed)
    require("sharing consent is server-owned", "set_group_completion_sharing" in APP and
            "oaa.groupsharing" not in APP, passed)
    require("group feed contains completion facts only", "group_completion_feed" in APP, passed)
    require("personal and group progress views exist", "My progress" in APP and "Group progress" in APP, passed)
    require("group editing keeps a separate personal cache", "LS.personalProgress" in APP and
            "personalCacheReady" in APP, passed)

    leave = body("leaveGroup")
    require("leave does not mutate source records", all(token not in leave for token in
            (".from('progress')", ".from('photos')", ".from('trips')")), passed)
    require("leave returns to personal view", "setProgressView('personal')" in leave, passed)
    require("queued writes are owner-stamped", APP.count("owner_id:") >= 3 and
            APP.count("item.owner_id !== runOwner") >= 2, passed)

    require("confirmed AUD bundle price", "price: 'AUD $14.99'" in STORE, passed)
    require("confirmed AUD pack price", STORE.count("price: 'AUD $2.99'") == 7, passed)
    require("purchases use stable app identity", "appUserID: runId" in STORE and
            "Billing.init(userId)" in APP, passed)
    require("purchase cache is account-scoped", "`${LS_ENTITLEMENTS}.${ownerId}`" in STORE and
            "entitlementOwner" in STORE, passed)
    require("preview is local-development only", "localhost|127" in STORE and
            "if (!previewAvailable())" in STORE, passed)
    require("native blank-key build cannot simulate purchases", "if (onNativePlatform())" in STORE and
            "the shop is not available in this build" in STORE, passed)

    print(f"PASS: {len(passed)} account/group/billing client invariants")
    for item in passed:
        print(f"  - {item}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
