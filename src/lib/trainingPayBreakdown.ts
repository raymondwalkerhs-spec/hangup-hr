export type TrainingPayDayLine = {
  date: string;
  status: string;
};

export type TrainingPayMonthLine = {
  ym: string;
  label: string;
  units: number;
  basic: number;
  transport?: number;
  transportDays?: number;
  net?: number;
  phase1Exception?: boolean;
  days?: TrainingPayDayLine[];
};

export type TrainingPayBreakdown = {
  months: TrainingPayMonthLine[];
  deductions?: { id: string; label: string; units?: number; amount: number }[];
  phase1ExceptionApplied?: boolean;
  totals?: { basic: number; transport: number; deductions: number; net: number; units: number };
};

export function getTrainingPayBreakdown(row: Record<string, unknown>): TrainingPayBreakdown | null {
  const direct = row.trainingPayBreakdown as TrainingPayBreakdown | undefined;
  if (direct?.months?.length) return direct;
  const training = row.training as Record<string, unknown> | undefined;
  const nested = training?.trainingPayBreakdown as TrainingPayBreakdown | undefined;
  if (nested?.months?.length) return nested;
  return direct?.months ? direct : nested?.months ? nested : null;
}
