import { useEffect, useState } from "react";
import { Dialog } from "@/ui/Dialog";
import { FormField, FormGrid, FormSection } from "@/ui/FormGrid";
import { Select } from "@/ui/Select";
import { type StaffOption, staffOptionLabel, staffOptionsWithCurrent } from "./interviewStaffOptions";
import styles from "./InterviewEditDialog.module.css";

const STATUS_OPTIONS = ["pending", "on hold", "accepted", "rejected"];
const TRAINING_OPTIONS = ["pending", "in training", "completed", "dropped"];
const GRADUATION_OPTIONS = ["Graduated", "Student", "Dropout"];
const DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

type FieldSpec = {
  key: string;
  label: string;
  type?: string;
  options?: string[];
  staffPool?: "interviewer" | "trainer";
};

const CANDIDATE_FIELDS: FieldSpec[] = [
  { key: "timestamp", label: "Timestamp", type: "datetime-local" },
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "dateOfBirth", label: "Date of birth", type: "date" },
  { key: "address", label: "Address", type: "textarea" },
  { key: "graduationStatus", label: "Graduation status", type: "select", options: GRADUATION_OPTIONS },
  { key: "facultyName", label: "Faculty" },
  { key: "universityName", label: "University" },
  { key: "nationalId", label: "National ID / Passport" },
  { key: "previousExperiences", label: "Previous experiences", type: "textarea" },
  { key: "gender", label: "Gender" },
  { key: "englishSpeaking", label: "English speaking (1-10)" },
  { key: "englishWriting", label: "English writing (1-10)" },
  { key: "englishListening", label: "English listening (1-10)" },
  { key: "fastPacedRating", label: "Fast-paced rating (1-5)" },
  { key: "currentlyEmployed", label: "Currently employed" },
  { key: "preferredWorkingMode", label: "Preferred working mode" },
  { key: "howHeard", label: "How did you hear about us?" },
  { key: "companyIfYes", label: "Company name if yes" },
];

const FIRST_FIELDS: FieldSpec[] = [
  { key: "firstInterviewStatus", label: "1st interview status", type: "select", options: STATUS_OPTIONS },
  { key: "firstInterviewFeedback", label: "1st interview feedback", type: "textarea" },
  { key: "interviewDate", label: "1st interview date", type: "date" },
  { key: "interviewer", label: "Interviewer", staffPool: "interviewer" },
];

const SECOND_FIELDS: FieldSpec[] = [
  { key: "secondInterviewDate", label: "2nd interview date", type: "date" },
  { key: "secondInterviewFeedback", label: "2nd interview feedback", type: "textarea" },
  { key: "secondInterviewStatus", label: "2nd interview status", type: "select", options: STATUS_OPTIONS },
  { key: "secondInterviewer", label: "2nd interviewer", staffPool: "interviewer" },
];

const TRAINING_FIELDS: FieldSpec[] = [
  { key: "trainingStatus", label: "Training status", type: "select", options: TRAINING_OPTIONS },
  { key: "trainingStartDate", label: "Training start", type: "date" },
  { key: "trainer", label: "Trainer", staffPool: "trainer" },
];

function renderField(
  spec: FieldSpec,
  form: Record<string, string>,
  set: (k: string, v: string) => void,
  interviewerOptions: StaffOption[],
  trainerOptions: StaffOption[],
) {
  const val = form[spec.key] || "";

  if (spec.staffPool) {
    const pool = spec.staffPool === "trainer" ? trainerOptions : interviewerOptions;
    const options = staffOptionsWithCurrent(pool, val);
    return (
      <FormField key={spec.key} label={spec.label}>
        <Select
          value={val}
          onChange={(v) => set(spec.key, v)}
          options={[
            { value: "", label: "— Select —" },
            ...options.map((o) => ({ value: o.username, label: staffOptionLabel(o) })),
          ]}
        />
      </FormField>
    );
  }

  if (spec.type === "textarea") {
    return (
      <FormField key={spec.key} label={spec.label} span="full">
        <textarea rows={4} value={val} onChange={(e) => set(spec.key, e.target.value)} />
      </FormField>
    );
  }
  if (spec.type === "select" && spec.options) {
    return (
      <FormField key={spec.key} label={spec.label}>
        <Select
          value={val}
          onChange={(v) => set(spec.key, v)}
          options={[{ value: "", label: "—" }, ...spec.options.map((o) => ({ value: o, label: o }))]}
        />
      </FormField>
    );
  }
  return (
    <FormField key={spec.key} label={spec.label}>
      <input type={spec.type || "text"} value={val} onChange={(e) => set(spec.key, e.target.value)} />
    </FormField>
  );
}

export function InterviewEditDialog({
  row,
  open,
  onOpenChange,
  onSave,
  saving,
  interviewerOptions = [],
  trainerOptions = [],
}: {
  row: Record<string, unknown> | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (body: Record<string, string>) => void;
  saving?: boolean;
  interviewerOptions?: StaffOption[];
  trainerOptions?: StaffOption[];
}) {
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !row) return;
    const allKeys = [
      ...CANDIDATE_FIELDS.map((f) => f.key),
      ...FIRST_FIELDS.map((f) => f.key),
      ...SECOND_FIELDS.map((f) => f.key),
      ...TRAINING_FIELDS.map((f) => f.key),
      "availableDays",
    ];
    const init: Record<string, string> = {};
    allKeys.forEach((k) => { init[k] = String(row[k] ?? ""); });
    setForm(init);
  }, [open, row]);

  if (!row) return null;

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const showSecond = String(form.firstInterviewStatus || "").toLowerCase() === "accepted";
  const showTraining = String(form.secondInterviewStatus || "").toLowerCase() === "accepted";

  const selectedDays = (form.availableDays || "").split(/[,;]+/).map((s) => s.trim()).filter(Boolean);

  const toggleDay = (day: string) => {
    const setDays = new Set(selectedDays);
    if (setDays.has(day)) setDays.delete(day);
    else setDays.add(day);
    set("availableDays", [...setDays].join(", "));
  };

  const render = (spec: FieldSpec) => renderField(spec, form, set, interviewerOptions, trainerOptions);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit interview — ${String(row.name || row.id)}`}
      size="wide"
      scrollBody
      footer={
        <>
          <button type="button" className={styles.cancelBtn} onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="button" className={styles.saveBtn} onClick={() => onSave(form)} disabled={saving}>Save</button>
        </>
      }
    >
      <FormSection title="Candidate information">
        <FormGrid wide>
          {CANDIDATE_FIELDS.map(render)}
          <div className={styles.full}>
            <span className="muted">Available days</span>
            <div className={styles.dayGrid}>
              {DAYS.map((d) => (
                <label key={d}>
                  <input type="checkbox" checked={selectedDays.includes(d)} onChange={() => toggleDay(d)} />
                  {d.slice(0, 3)}
                </label>
              ))}
            </div>
          </div>
        </FormGrid>
      </FormSection>

      <FormSection title="First interview">
        <FormGrid wide>{FIRST_FIELDS.map(render)}</FormGrid>
      </FormSection>

      {showSecond && (
        <FormSection title="Second interview">
          <FormGrid wide>{SECOND_FIELDS.map(render)}</FormGrid>
        </FormSection>
      )}

      {showTraining && (
        <FormSection title="Training">
          <FormGrid wide>{TRAINING_FIELDS.map(render)}</FormGrid>
        </FormSection>
      )}
    </Dialog>
  );
}
