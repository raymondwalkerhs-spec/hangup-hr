const https = require("https");
const http = require("http");

function fetchUrl(url, { timeoutMs = 60000, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const lib = String(url).startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        res.resume();
        return resolve(fetchUrl(res.headers.location, { timeoutMs, maxRedirects: maxRedirects - 1 }));
      }
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url.slice(0, 80)}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers["content-type"] || "";
        resolve({ buffer, contentType, statusCode: res.statusCode });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url.slice(0, 80)}`));
    });
  });
}

module.exports = { fetchUrl };
