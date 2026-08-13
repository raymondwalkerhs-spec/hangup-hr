#!/usr/bin/env node
require('dotenv').config();
const itRepo = require('../lib/it-requests-repo');

(async () => {
  try {
    const users = await itRepo.readItUsers({});
    console.log('IT_USERS:', JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('ERR', err.message || err);
    process.exit(1);
  }
})();
