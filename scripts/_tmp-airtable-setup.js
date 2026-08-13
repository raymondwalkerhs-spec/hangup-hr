#!/usr/bin/env node
require("dotenv").config();
const key = process.env.AIRTABLE_API_KEY;
const wsp = process.env.AIRTABLE_WORKSPACE_ID;

async function test() {
  const basesRes = await fetch("https://api.airtable.com/v0/meta/bases", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const bases = await basesRes.json();
  console.log("LIST BASES:", basesRes.status);
  console.log(JSON.stringify(bases, null, 2));

  const wspRes = await fetch(`https://api.airtable.com/v0/meta/workspaces/${wsp}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const wspData = await wspRes.json();
  console.log("WORKSPACE:", wspRes.status);
  console.log(JSON.stringify(wspData, null, 2));

  const createRes = await fetch("https://api.airtable.com/v0/meta/bases", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Hangup Portal Sales",
      workspaceId: wsp,
      tables: [
        {
          name: "Portal Sales",
          fields: [
            { name: "Portal Sale ID", type: "singleLineText" },
            { name: "Client", type: "singleLineText" },
          ],
        },
      ],
    }),
  });
  const createData = await createRes.json();
  console.log("CREATE BASE:", createRes.status);
  console.log(JSON.stringify(createData, null, 2));
}

test().catch((e) => {
  console.error(e);
  process.exit(1);
});
