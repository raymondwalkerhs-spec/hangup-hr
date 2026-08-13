/**
 * Map RPM quality feedback fields to workflow status.
 */
const REVIEWER_FEEDBACK_DONE = "Done";
const REVIEWER_FEEDBACK_PENDING = "Pending";

const CLIENT_APPROVED = "Approved";
const CLIENT_PENDING = "Pending";
const CLIENT_DENIED = "Denied";
const CLIENT_CALLBACK = "Callback";
const CLIENT_RETRANSFER = "Retransfer";

function normalizeClientFeedback(value) {
  return String(value || CLIENT_PENDING).trim();
}

function normalizeReviewerFeedback(value) {
  return String(value || REVIEWER_FEEDBACK_PENDING).trim();
}

function applyQualityDefaults(formData = {}) {
  const fd = { ...formData };
  if (!fd.reviewerFeedback) fd.reviewerFeedback = REVIEWER_FEEDBACK_PENDING;
  if (!fd.clientFeedback) fd.clientFeedback = CLIENT_PENDING;
  return fd;
}

function deriveStatusFromQuality(formData = {}) {
  const client = normalizeClientFeedback(formData.clientFeedback);
  const reviewer = normalizeReviewerFeedback(formData.reviewerFeedback);

  if (client === CLIENT_DENIED) {
    return { status: "denied", retransfer: false };
  }
  if (client === CLIENT_CALLBACK) {
    return { status: "callback", retransfer: false };
  }
  if (client === CLIENT_RETRANSFER) {
    return { status: "callback", retransfer: true };
  }
  if (client === CLIENT_APPROVED && reviewer === REVIEWER_FEEDBACK_DONE) {
    return { status: "passed", retransfer: false };
  }
  return { status: "pending", retransfer: false };
}

function syncSaleStatusFromQuality(formData = {}) {
  const fd = applyQualityDefaults(formData);
  const { status, retransfer } = deriveStatusFromQuality(fd);
  fd.retransfer = retransfer;
  return { formData: fd, status, retransfer };
}

module.exports = {
  REVIEWER_FEEDBACK_DONE,
  REVIEWER_FEEDBACK_PENDING,
  CLIENT_APPROVED,
  CLIENT_PENDING,
  CLIENT_DENIED,
  CLIENT_CALLBACK,
  CLIENT_RETRANSFER,
  applyQualityDefaults,
  deriveStatusFromQuality,
  syncSaleStatusFromQuality,
};
