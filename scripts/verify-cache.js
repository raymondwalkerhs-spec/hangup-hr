try {
  require("../lib/cache").getDb();
  console.log("cache-ok");
} catch (e) {
  console.error("cache-failed:", e.message);
  process.exit(1);
}
