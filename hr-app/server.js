const { loadEnvironment, ensureCacheDirectory } = require("./lib/app-bootstrap");

loadEnvironment();
ensureCacheDirectory();

const { createApp } = require("./app");

const PORT = process.env.PORT || 3847;
createApp().listen(PORT, () => {
  console.log(`Hangup HR → http://localhost:${PORT}`);
});
