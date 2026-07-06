/**
 * Browser mirror of lib/sales-submit-required.js
 */
(function (root) {
  const REQUIRED_ON_SUBMIT = [
    "phoneNumber",
    "firstName",
    "lastName",
    "dateOfBirth",
    "streetAddress",
    "cityName",
    "state",
    "zipCode",
    "emergencyFirstName",
    "emergencyLastName",
    "emergencyPhone",
    "emergencyRelation",
    "firstTimeDevice",
    "medicalConditions",
    "payerName",
    "paymentMethod",
  ];

  const TOP_LEVEL_REQUIRED = ["agentId", "unit", "team", "device", "client"];

  const LABELS = {
    phoneNumber: "Phone number",
    firstName: "First name",
    lastName: "Last name",
    dateOfBirth: "Date of birth",
    streetAddress: "Street address",
    cityName: "City",
    state: "State",
    zipCode: "Zip code",
    emergencyFirstName: "Emergency first name",
    emergencyLastName: "Emergency last name",
    emergencyPhone: "Emergency phone",
    emergencyRelation: "Emergency relation",
    firstTimeDevice: "First time device",
    serviceActiveInfo: "Service active / company name",
    medicalConditions: "Medical conditions",
    payerName: "Payer name",
    paymentMethod: "Payment method",
    cardNumber: "Card number",
    cardExpDate: "Card expiration",
    cvv: "CVV",
    routingNumber: "Routing number",
    bankName: "Bank name",
    bankAccountNumber: "Bank account number",
    agentId: "Agent",
    closerId: "Closer",
    unit: "Unit",
    team: "Team",
    device: "Device",
    client: "Client",
    price: "Price",
    recording: "Recordings",
  };

  function labelFor(key) {
    return LABELS[key] || key;
  }

  function str(val) {
    return String(val ?? "").trim();
  }

  function normalizePaymentMethod(method) {
    const m = str(method).toLowerCase();
    if (m === "card") return "Card";
    if (m === "bank account" || m === "bank") return "Bank account";
    return str(method);
  }

  function collectFormData(body) {
    const fd = { ...(body?.formData || {}) };
    if (body?.phoneNumber) fd.phoneNumber = body.phoneNumber;
    if (body?.fullName && !fd.firstName) {
      const parts = str(body.fullName).split(/\s+/);
      fd.firstName = parts[0] || "";
      fd.lastName = parts.slice(1).join(" ");
    }
    return fd;
  }

  function validateSaleSubmitPayload(body, opts = {}) {
    const errors = [];
    const fd = collectFormData(body);
    const hasCatalog = opts.hasCatalog !== false;

    for (const key of TOP_LEVEL_REQUIRED) {
      if (key === "client" && !hasCatalog) continue;
      if (key === "device" && hasCatalog && body?.device) continue;
      const val = key === "device" ? body?.device || fd.deviceType : body?.[key];
      if (!str(val)) {
        errors.push({ key, label: labelFor(key), message: `${labelFor(key)} is required` });
      }
    }

    if (hasCatalog) {
      if (!str(body?.salesClientId || fd.salesClientId)) {
        errors.push({ key: "salesClientId", label: "Client", message: "Select client from catalog" });
      }
      if (!str(body?.salesProductId || fd.salesProductId)) {
        errors.push({ key: "salesProductId", label: "Device", message: "Select device from catalog" });
      }
      if (!str(body?.salesPriceId || fd.salesPriceId)) {
        errors.push({ key: "salesPriceId", label: "Price", message: "Select price from catalog" });
      }
    }

    if (!str(body?.closerId)) {
      errors.push({ key: "closerId", label: "Closer", message: "Closer is required" });
    }

    for (const key of REQUIRED_ON_SUBMIT) {
      if (!str(fd[key])) {
        errors.push({ key, label: labelFor(key), message: `${labelFor(key)} is required` });
      }
    }

    if (str(fd.firstTimeDevice).toLowerCase() === "no" && !str(fd.serviceActiveInfo)) {
      errors.push({
        key: "serviceActiveInfo",
        label: labelFor("serviceActiveInfo"),
        message: "Service active / company name is required when not first-time device",
      });
    }

    const method = normalizePaymentMethod(fd.paymentMethod);
    if (method === "Card") {
      for (const key of ["cardNumber", "cardExpDate", "cvv"]) {
        if (!str(fd[key])) {
          errors.push({ key, label: labelFor(key), message: `${labelFor(key)} is required for Card payment` });
        }
      }
    }
    if (method === "Bank account") {
      for (const key of ["routingNumber", "bankName", "bankAccountNumber"]) {
        if (!str(fd[key])) {
          errors.push({ key, label: labelFor(key), message: `${labelFor(key)} is required for Bank account payment` });
        }
      }
    }

    if (!opts.skipRecording) {
      const kinds = opts.attachmentKinds || [];
      const hasPendingRecording =
        opts.pendingRecording === true || (Array.isArray(kinds) && kinds.includes("recording"));
      if (!hasPendingRecording) {
        errors.push({
          key: "recording",
          label: "Recordings",
          message: "At least one recording attachment is required before submit",
        });
      }
    }

    return { ok: errors.length === 0, errors };
  }

  root.HRSaleSubmitRequired = {
    validateSaleSubmitPayload,
    labelFor,
  };
})(typeof window !== "undefined" ? window : globalThis);
