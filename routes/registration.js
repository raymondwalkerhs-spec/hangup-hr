const express = require("express");
const registration = require("../lib/registration");

const router = express.Router();

router.post("/apply", async (req, res) => {
  try {
    const { pin, americanName, fullName, arabicName, phone, email, unit, team, nationality, nationalId, passportNumber } =
      req.body || {};
    if (!pin) return res.status(400).json({ error: "Today's registration PIN is required" });
    const ok = await registration.verifyDailyPin(pin);
    if (!ok) return res.status(403).json({ error: "Invalid or expired registration PIN" });
    const row = await registration.createRegistrationRequest({
      americanName,
      fullName: fullName || arabicName,
      arabicName,
      phone,
      email,
      unit,
      team,
      nationality,
      nationalId,
      passportNumber,
    });
    res.status(201).json({
      ok: true,
      message:
        "Registration submitted. After OP/Admin approval you will receive your User ID (login).",
      request: row,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
