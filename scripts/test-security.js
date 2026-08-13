const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { sanitizePostgrestFilterValue } = require("../lib/postgrest-filter");
const { resolveSafeZipDest } = require("../lib/zip-extract");
const { isPathUnderRoot } = require("../lib/path-guard");
const {
  createSession,
  destroySessionsForUser,
  isPasswordSnapshotValid,
} = require("../lib/session-store");

function testPostgrestSanitize() {
  assert.strictEqual(sanitizePostgrestFilterValue("raymond"), "raymond");
  assert.strictEqual(sanitizePostgrestFilterValue("user.name_1"), "user.name_1");
  assert.throws(() => sanitizePostgrestFilterValue("bad,user"), /Invalid filter value/);
  assert.throws(() => sanitizePostgrestFilterValue("a)or(b.eq.1"), /Invalid filter value/);
  console.log("postgrest filter sanitization OK");
}

function testSessionStoreNoPassword() {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "session-store.js"), "utf8");
  assert(!/password:\s*password/.test(src), "session-store must not store plaintext password");
  assert(src.includes("passwordChangedAtSnapshot"), "session-store should track passwordChangedAtSnapshot");
  console.log("session-store password removal OK");
}

function testLegacyNullPasswordSnapshot() {
  assert.strictEqual(isPasswordSnapshotValid(null, null), true);
  assert.strictEqual(isPasswordSnapshotValid(undefined, null), true);
  assert.strictEqual(isPasswordSnapshotValid(null, undefined), true);
  assert.strictEqual(isPasswordSnapshotValid("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"), true);
  assert.strictEqual(isPasswordSnapshotValid("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"), false);
  console.log("legacy null password snapshot OK");
}

function testSessionRevokeOnPasswordChange() {
  const a = createSession("raymond", "admin", { passwordChangedAtSnapshot: "2026-01-01T00:00:00.000Z" });
  const b = createSession("raymond", "admin", { passwordChangedAtSnapshot: "2026-02-01T00:00:00.000Z" });
  assert.strictEqual(destroySessionsForUser("raymond", a.id), 1);
  assert.strictEqual(isPasswordSnapshotValid(a.passwordChangedAtSnapshot, "2026-02-01T00:00:00.000Z"), false);
  console.log("session revoke helper OK");
}

function testZipSlipRejectsTraversal() {
  const root = path.join(os.tmpdir(), "hr-zip-safe");
  assert.throws(() => resolveSafeZipDest(root, "../escape.txt"), /Zip slip rejected/);
  assert.throws(() => resolveSafeZipDest(root, "foo/../../outside.txt"), /Zip slip rejected/);
  const ok = resolveSafeZipDest(root, "subdir/file.txt");
  assert(ok.includes("subdir"));
  console.log("zip-slip rejection OK");
}

function testWritePathUnderRoot() {
  const root = path.resolve("C:\\exports\\payslips");
  assert(isPathUnderRoot(path.join(root, "a.pdf"), root));
  assert(!isPathUnderRoot("C:\\exports\\other\\a.pdf", root));
  assert(!isPathUnderRoot(path.join(root, "..", "escape.pdf"), root));
  console.log("write-path-under-root OK");
}

function testPackageNoBundledSecrets() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const extra = pkg.build?.extraResources || [];
  const serialized = JSON.stringify(extra);
  assert(!/"to":\s*"\.env"/.test(serialized), "extraResources must not bundle .env");
  assert(!extra.some((r) => r && String(r.to || "").replace(/\\/g, "/") === ".env"), "extraResources must not bundle .env");
  assert(!serialized.includes("credentials"), "extraResources must not bundle credentials/");
  console.log("package secrets packaging OK");
}

function testLucideVendored() {
  const p = path.join(__dirname, "..", "public", "vendor", "lucide.min.js");
  assert(fs.existsSync(p), "public/vendor/lucide.min.js must exist");
  const legacyIndex = path.join(__dirname, "..", "public", "index.legacy.html");
  const reactIndex = path.join(__dirname, "..", "public", "dist", "index.html");
  const indexPath = fs.existsSync(reactIndex) ? reactIndex : legacyIndex;
  assert(fs.existsSync(indexPath), "index.html or public/dist/index.html must exist");
  const index = fs.readFileSync(indexPath, "utf8");
  assert(!index.includes("unpkg.com/lucide"), "index must not load remote Lucide");
  console.log("lucide vendor OK");
}

function testLoginNoSavedPassword() {
  const loginPage = path.join(__dirname, "..", "src", "pages", "auth", "LoginPage.tsx");
  if (fs.existsSync(loginPage)) {
    const src = fs.readFileSync(loginPage, "utf8");
    assert(!src.includes("SAVED_PASSWORD_KEY"), "React login must not store saved passwords");
    assert(!src.includes("remember-password"), "React login must not offer save-password");
    console.log("login saved-password removal OK");
    return;
  }
  const loginPaths = [
    path.join(__dirname, "..", "public", "login.legacy.html"),
    path.join(__dirname, "..", "public", "login.html"),
  ];
  const loginPath = loginPaths.find((p) => fs.existsSync(p));
  assert(loginPath, "login page must exist");
  const login = fs.readFileSync(loginPath, "utf8");
  assert(!login.includes("remember-password"), "login.html must not offer save-password");
  assert(!login.includes("SAVED_PASSWORD_KEY"), "login.html must not store saved passwords");
  console.log("login saved-password removal OK");
}

function testElectronSandboxFlags() {
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
  assert(main.includes("sandbox: true"), "electron main should enable sandbox");
  assert(main.includes("webSecurity: true"), "electron main should enable webSecurity");
  console.log("electron sandbox flags OK");
}

testPostgrestSanitize();
testSessionStoreNoPassword();
testLegacyNullPasswordSnapshot();
testSessionRevokeOnPasswordChange();
testZipSlipRejectsTraversal();
testWritePathUnderRoot();
testPackageNoBundledSecrets();
testLucideVendored();
testLoginNoSavedPassword();
testElectronSandboxFlags();
console.log("\nAll security checks passed.");
