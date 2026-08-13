const express = require("express");
const registration = require("../lib/registration");
const registrationCodes = require("../lib/registration-codes");
const { createRegistrationToken, verifyRegistrationToken } = require("../lib/registration-token");
const rateLimiter = require("../lib/rate-limiter");

const router = express.Router();

router.post("/verify-pin", async (req, res) => {
  try {
    const rateLimit = rateLimiter.checkVerifyPin(req);
    if (rateLimit.limited) {
      return res.status(429).json({ error: "Too many attempts. Try again later.", limited: true });
    }
    res.set("X-RateLimit-Remaining", String(rateLimit.remaining));
    const code = req.body?.code || req.body?.pin;
    if (!code) return res.status(400).json({ error: "Registration code is required" });
    const resolved = await registrationCodes.resolveRegistrationCredential(code);
    if (!resolved) return res.status(403).json({ error: "Invalid or expired registration code" });
    const registrationToken = createRegistrationToken(resolved.company);
    res.json({ ok: true, registrationToken });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/apply", async (req, res) => {
  try {
    const {
      registrationToken,
      code,
      pin,
      fullName,
      americanName,
      email,
      nationality,
      nationalId,
      passportNumber,
      phone,
      unit,
      team,
      password,
      passwordConfirm,
    } = req.body || {};

    let regCompany = verifyRegistrationToken(registrationToken);
    if (!regCompany) {
      const credential = code || pin;
      if (!credential) {
        return res.status(403).json({ error: "Registration session expired. Re-enter today's code." });
      }
      const resolved = await registrationCodes.resolveRegistrationCredential(credential);
      if (!resolved) return res.status(403).json({ error: "Invalid or expired registration code" });
      regCompany = resolved.company;
    }

    const legalName = String(fullName || "").trim();
    const legalWords = legalName.split(/\s+/).filter(Boolean);
    if (legalWords.length < 3) return res.status(400).json({ error: "Legal name must match your ID and contain at least 3 words." });
    const americanWords = String(americanName || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
    if (americanWords.length !== 2) return res.status(400).json({ error: "American name must be exactly 2 words (First and Last name)." });
    if (!email || !String(email).includes("@")) return res.status(400).json({ error: "A valid email is required." });
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: "Choose a password of at least 8 characters." });
    }
    if (String(password) !== String(passwordConfirm || "")) {
      return res.status(400).json({ error: "Password confirmation does not match." });
    }

    const row = await registration.createRegistrationRequest({
      americanName,
      fullName: legalName,
      email,
      nationality,
      nationalId,
      passportNumber,
      phone,
      unit: regCompany === "hs2" ? undefined : unit,
      team,
      company: regCompany,
      password,
      passwordConfirm,
    });
    res.status(201).json({
      ok: true,
      message:
        "Registration submitted. After Admin/HR approve, sign in with your User ID and the password you chose.",
      request: {
        id: row.id,
        americanName: row.americanName,
        status: row.status,
        createdAt: row.createdAt,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
