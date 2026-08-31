const test = require("node:test");
const assert = require("node:assert/strict");
const { formatDobForGoogleForm, pickSaleFields, buildGoogleFormBody } = require("../lib/rpm-google-form");

test("formatDobForGoogleForm converts ISO to MM/DD/YYYY", () => {
  assert.equal(formatDobForGoogleForm("1990-01-15"), "01/15/1990");
  assert.equal(formatDobForGoogleForm("1950-08-06"), "08/06/1950");
});

test("formatDobForGoogleForm normalizes slash input", () => {
  assert.equal(formatDobForGoogleForm("8/6/1950"), "08/06/1950");
  assert.equal(formatDobForGoogleForm("08/06/1950"), "08/06/1950");
});

test("formatDobForGoogleForm converts dash MM-DD-YYYY to slashes", () => {
  assert.equal(formatDobForGoogleForm("08-06-1950"), "08/06/1950");
});

test("pickSaleFields uses MM/DD/YYYY dob for Google Form", () => {
  const fields = pickSaleFields({
    client: "RPM1",
    full_name: "Jane Doe",
    phone_number: "5551234567",
    member_id: "1ABC2345678",
    form_data: { dateOfBirth: "1990-05-20", medicalConditions: "None" },
  });
  assert.equal(fields.dob, "05/20/1990");

  const built = buildGoogleFormBody(
    {
      client: "RPM1",
      full_name: "Jane Doe",
      phone_number: "5551234567",
      member_id: "1ABC2345678",
      form_data: { dateOfBirth: "1990-05-20" },
    },
    {
      fullName: "1939177472",
      phone: "71653480",
      dob: "878620617",
      mcn: "1231494228",
      medicalConditions: "2084970582",
      teamCode: "204813255",
    }
  );
  assert.equal(built.ok, true);
  assert.equal(built.body.get("entry.878620617"), "05/20/1990");
});
