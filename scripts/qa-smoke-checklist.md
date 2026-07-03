# HRMS v1.3.0 — QA smoke checklist

Run after each release candidate. Mark pass/fail and fix root cause before shipping.

## Auth & session
- [ ] Login / logout / remember username
- [ ] Inactive user blocked; Mark/Raymond activate works
- [ ] Registration PIN + apply (no username; national ID / passport)
- [ ] Version block + GitHub update banner on login
- [ ] Idle logout (~10h) and session revoke

## Navigation
- [ ] Every sidebar page loads without console errors
- [ ] Month picker on attendance/payroll/sales
- [ ] HS-2 company toggle
- [ ] Raymond impersonation banner + exit

## Sales & quality
- [ ] TL/OP add sale: catalog client + device + price required
- [ ] Server rejects free-text client when catalog exists
- [ ] Quality ticket: inline audio, download, share link
- [ ] Sales filters (submission date, unit toggles)

## Settings (RTM/Admin only)
- [ ] Edit/delete clients, devices, price tiers
- [ ] Break schedules
- [ ] Profile photo upload

## HR core
- [ ] Employees: filters, edit, national ID/passport
- [ ] Equipment: agent search toolbar + `?employee=` deep link
- [ ] Users: search by name/ID/email
- [ ] Org: pending registration approve → User ID login

## Updates
- [ ] `npm run verify:update` on release zips
- [ ] In-app update does not corrupt app.asar

## macOS (CI)
- [ ] `build-macos` job produces DMG + zips on tag push
