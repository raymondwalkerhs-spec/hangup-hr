const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Mirror of src/lib/queryErrorCopy.ts for node:test (no ts loader).
function classifyQueryError(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  const status = Number(error?.status || 0);
  if (status === 401 || msg.includes("unauthorized")) return "unauthorized";
  if (status === 403 || msg.includes("forbidden") || msg.includes("no permission") || msg.includes("no access")) {
    return "forbidden";
  }
  if (msg.includes("timed out") || msg.includes("timeout") || error?.name === "AbortError") return "timeout";
  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("load failed")) return "offline";
  if (status >= 400 && status < 500) return "validation";
  return "unknown";
}

function queryErrorCopy(error, pageName = "this page") {
  const kind = classifyQueryError(error);
  if (kind === "offline") {
    return { title: `Couldn't load ${pageName}`, reason: "You're offline." };
  }
  if (kind === "timeout") {
    return { title: `Couldn't load ${pageName}`, reason: "Request timed out. Check the connection and try again." };
  }
  if (kind === "unauthorized") return { title: "Session ended", reason: "Sign in again to continue." };
  if (kind === "forbidden") {
    return { title: "You don't have access to this page", reason: "Ask HR or an admin if you need this section." };
  }
  return { title: `Couldn't load ${pageName}`, reason: "Something went wrong." };
}

describe("queryErrorCopy", () => {
  it("maps timeout", () => {
    const c = queryErrorCopy(new Error("Request timed out. Check your connection and try again."), "payroll");
    assert.equal(c.reason.includes("timed out"), true);
  });
  it("maps 403", () => {
    const c = queryErrorCopy(Object.assign(new Error("No permission"), { status: 403 }));
    assert.equal(c.title.includes("don't have access"), true);
  });
  it("maps 401", () => {
    const c = queryErrorCopy(new Error("Unauthorized"));
    assert.equal(c.title, "Session ended");
  });
  it("maps offline fetch", () => {
    const c = queryErrorCopy(new Error("Failed to fetch"), "sales");
    assert.match(c.reason, /offline/i);
  });
});
