/**
 * Route an rpm_checks row to Q Feedback or NQ Checks (never both).
 */
const { isRpmConfigured } = require("./airtable-rpm-targets");
const { isCompletedFeedback } = require("./airtable-rpm-qfeedback-field-map");
const { isNqFamilyCheck } = require("./rpm-check-status");

async function syncRpmCheckById(checkId) {
  if (!checkId || !isRpmConfigured()) return;
  const rpmChecksRepo = require("./rpm-checks-repo");
  const qSync = require("./airtable-rpm-qfeedback-sync");
  const nqSync = require("./airtable-rpm-nq-sync");

  const { check } = await rpmChecksRepo.getCheckById(checkId);
  if (!check || check.deletedAt) {
    if (check) {
      await qSync.deleteQFeedbackFromAirtable(check).catch(() => {});
      await nqSync.deleteNqCheckFromAirtable(check).catch(() => {});
    }
    return;
  }

  if (isNqFamilyCheck(check.checkStatus)) {
    await qSync.deleteQFeedbackFromAirtable(check).catch((err) => {
      console.warn(`[airtable-rpm] remove Q row for NQ ${checkId}:`, err.message);
    });
    await nqSync.syncNqCheckById(checkId);
    return;
  }

  if (check.checkStatus === "q" && isCompletedFeedback(check.feedbackStatus)) {
    await nqSync.deleteNqCheckFromAirtable(check).catch((err) => {
      console.warn(`[airtable-rpm] remove NQ row for Q ${checkId}:`, err.message);
    });
    await qSync.syncQFeedbackById(checkId);
    return;
  }

  await qSync.deleteQFeedbackFromAirtable(check).catch(() => {});
  await nqSync.deleteNqCheckFromAirtable(check).catch(() => {});
}

async function deleteRpmCheckFromAirtable(check) {
  if (!check?.id || !isRpmConfigured()) return;
  const qSync = require("./airtable-rpm-qfeedback-sync");
  const nqSync = require("./airtable-rpm-nq-sync");
  await qSync.deleteQFeedbackFromAirtable(check).catch((err) => {
    console.warn("[airtable-rpm] delete Q Feedback:", err.message);
  });
  await nqSync.deleteNqCheckFromAirtable(check).catch((err) => {
    console.warn("[airtable-rpm] delete NQ Checks:", err.message);
  });
}

module.exports = {
  syncRpmCheckById,
  deleteRpmCheckFromAirtable,
};
