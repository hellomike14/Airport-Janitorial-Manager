export const onboardingForms = [
  { id: "onboarding-cover", title: "Employee Onboarding Cover Sheet", owner: "HR / Operations", pages: 2, fieldCount: 13, restricted: false },
  { id: "administrative-checklist", title: "Administrative Onboarding Checklist", owner: "HR / Administrator", pages: 2, fieldCount: 19, restricted: false },
  { id: "conditional-offer", title: "Conditional Offer of Employment", owner: "HR / Hiring approver", pages: 2, fieldCount: 18, restricted: false },
  { id: "offer-acceptance", title: "Candidate Offer Acceptance", owner: "Candidate / HR", pages: 1, fieldCount: 8, restricted: false },
  { id: "acceptance-receipt", title: "HR Acceptance Receipt and Welcome", owner: "HR", pages: 2, fieldCount: 13, restricted: false },
  { id: "start-confirmation", title: "Final Start-Confirmation Letter", owner: "Authorized HR signatory", pages: 2, fieldCount: 13, restricted: false },
  { id: "offer-tracking", title: "Offer Approval and Tracking Record", owner: "HR", pages: 2, fieldCount: 15, restricted: true },
  { id: "emergency-contact", title: "Employee Emergency Contact Information", owner: "Employee / HR", pages: 1, fieldCount: 10, restricted: false },
  { id: "payroll-setup", title: "Payroll Setup and Training-Time Checklist", owner: "HR / Payroll", pages: 2, fieldCount: 15, restricted: false },
  { id: "language-accessibility", title: "Training Language and Accessibility Plan", owner: "Employee / HR / Trainer", pages: 2, fieldCount: 12, restricted: false },
  { id: "uniform-equipment-issue", title: "Uniform, PPE and Equipment Issue Record", owner: "Supervisor", pages: 2, fieldCount: 14, restricted: false },
  { id: "site-orientation", title: "Site Orientation and GOAA Clock-In Checklist", owner: "Supervisor", pages: 2, fieldCount: 18, restricted: false },
  { id: "orientation-acknowledgment", title: "Company Orientation and Policy Acknowledgment", owner: "Employee / Supervisor", pages: 2, fieldCount: 14, restricted: false },
  { id: "training-attendance", title: "Paid Orientation and Training Attendance", owner: "Trainer / Payroll", pages: 2, fieldCount: 13, restricted: false },
  { id: "video-attestation", title: "Training Video Employee Attestation", owner: "Employee", pages: 2, fieldCount: 10, restricted: false },
  { id: "knowledge-check", title: "Onboarding Knowledge Check", owner: "Employee / Assessor", pages: 4, fieldCount: 30, restricted: false },
  { id: "knowledge-check-guide", title: "Knowledge Check Assessor Guide", owner: "Supervisor / Trainer", pages: 2, fieldCount: 3, restricted: true },
  { id: "practical-assessment", title: "Practical Cleaning Competence Assessment", owner: "Supervisor", pages: 4, fieldCount: 39, restricted: false },
  { id: "buddy-shift", title: "Supervised Buddy Shift Record", owner: "Buddy / Supervisor", pages: 2, fieldCount: 23, restricted: false },
  { id: "independent-work-release", title: "Independent-Work Readiness and Release", owner: "Supervisor / Operations Manager", pages: 2, fieldCount: 17, restricted: true },
  { id: "day-7-review", title: "Day 7 Onboarding Follow-Up Review", owner: "Supervisor / Employee", pages: 2, fieldCount: 17, restricted: false },
  { id: "day-30-review", title: "Day 30 Onboarding Follow-Up Review", owner: "Supervisor / Employee", pages: 2, fieldCount: 17, restricted: false },
  { id: "day-60-review", title: "Day 60 Onboarding Follow-Up Review", owner: "Supervisor / Employee", pages: 2, fieldCount: 17, restricted: false },
  { id: "day-90-review", title: "Day 90 Onboarding Follow-Up Review", owner: "Supervisor / Employee", pages: 2, fieldCount: 17, restricted: false },
  { id: "exception-correction", title: "Onboarding Exception, Escalation and Retraining", owner: "HR / Supervisor / Operations", pages: 2, fieldCount: 15, restricted: true },
  { id: "badging-checklist", title: "Airport Badging Coordination Checklist", owner: "Airport-authorized sponsor", pages: 2, fieldCount: 21, restricted: true },
  { id: "badge-rules-acknowledgment", title: "Airport Badge Rules Employee Acknowledgment", owner: "Employee / Sponsor", pages: 2, fieldCount: 14, restricted: false },
  { id: "badge-control", title: "Badge Issue, Renewal, Loss and Return Control", owner: "Authorized sponsor / HR", pages: 2, fieldCount: 17, restricted: true },
  { id: "i9-everify-tracker", title: "Employment Verification and E-Verify Control Record", owner: "Authorized HR verifier", pages: 2, fieldCount: 18, restricted: true },
  { id: "training-matrix", title: "Required Training Module Completion Matrix", owner: "Trainer / Supervisor", pages: 5, fieldCount: 53, restricted: false },
] as const;

export const onboardingIndex = {
  id: "onboarding-index",
  title: "Onboarding Forms Packet - Index",
  pages: 3,
} as const;

export type OnboardingFormId = (typeof onboardingForms)[number]["id"];
export type EmploymentFormId = "job-application" | "i-9" | "w-4" | OnboardingFormId;
export type EmploymentTemplateId = EmploymentFormId | typeof onboardingIndex.id;

export function getOnboardingForm(id: string) {
  return onboardingForms.find(form => form.id === id);
}
