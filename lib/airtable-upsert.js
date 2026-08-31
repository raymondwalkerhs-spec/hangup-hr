/**
 * Upsert one Airtable row by portal UUID. POST only when lookup finds zero rows.
 */
async function keepOneMatch(client, matches, preferredId, portalId, logPrefix) {
  if (!matches.length) return null;
  const keepId =
    preferredId && matches.some((m) => m.id === preferredId) ? preferredId : matches[0].id;
  const dupIds = matches.map((m) => m.id).filter((id) => id !== keepId);
  if (dupIds.length) {
    console.warn(`${logPrefix} removing ${dupIds.length} duplicate row(s) for ${portalId}`);
    await client.deleteRecordsBatch(dupIds);
  }
  return keepId;
}

/**
 * @param {object} client Airtable target
 * @param {{ storedRecordId?: string, portalField: string, portalId: string, fields: object, logPrefix?: string }} opts
 * @returns {Promise<string|null>} Airtable record id
 */
async function upsertByPortalId(client, opts) {
  const portalField = String(opts.portalField || "").trim();
  const portalId = String(opts.portalId || "").trim();
  const fields = opts.fields || {};
  const logPrefix = opts.logPrefix || "[airtable]";
  const storedRecordId = String(opts.storedRecordId || "").trim() || null;

  async function findMatches() {
    if (!portalField || !portalId) return [];
    return client.findAllRecordsByField(portalField, portalId);
  }

  let recordId = storedRecordId;
  if (!recordId) {
    recordId = await keepOneMatch(client, await findMatches(), null, portalId, logPrefix);
  }

  try {
    if (recordId) {
      await client.updateRecord(recordId, fields);
      return recordId;
    }
    const again = await findMatches();
    if (again.length) {
      recordId = await keepOneMatch(client, again, storedRecordId, portalId, logPrefix);
      await client.updateRecord(recordId, fields);
      return recordId;
    }
    return await client.createRecord(fields);
  } catch (err) {
    if (recordId && err.status === 404) {
      const found = await keepOneMatch(client, await findMatches(), null, portalId, logPrefix);
      if (found) {
        await client.updateRecord(found, fields);
        return found;
      }
      const lastLook = await findMatches();
      if (lastLook.length) {
        const keep = await keepOneMatch(client, lastLook, null, portalId, logPrefix);
        await client.updateRecord(keep, fields);
        return keep;
      }
      return client.createRecord(fields);
    }
    throw err;
  }
}

async function resolveRecordId(client, { storedRecordId, portalField, portalId, logPrefix }) {
  if (storedRecordId) return storedRecordId;
  const matches = await client.findAllRecordsByField(portalField, portalId);
  return keepOneMatch(client, matches, null, portalId, logPrefix || "[airtable]");
}

module.exports = {
  upsertByPortalId,
  resolveRecordId,
  keepOneMatch,
};
