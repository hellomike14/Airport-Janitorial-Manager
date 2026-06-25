export type FieldGroup =
  | "application"
  | "i9Employee"
  | "w4Employee"
  | "i9Employer"
  | "w4Employer";

export type FieldType =
  | "text"
  | "email"
  | "tel"
  | "date"
  | "number"
  | "textarea"
  | "select"
  | "checkbox"
  | "ssn";

export interface FieldDef {
  key: string;
  type: FieldType;
  options?: string[];
  half?: boolean;
}

export interface SectionDef {
  id: string;
  group: FieldGroup;
  fields: FieldDef[];
}

// Marvol Job Application — applicant-provided fields (jsonb: application)
export const APPLICATION_FIELDS: FieldDef[] = [
  { key: "address", type: "text" },
  { key: "city", type: "text", half: true },
  { key: "state", type: "text", half: true },
  { key: "zip", type: "text", half: true },
  { key: "desiredPay", type: "text", half: true },
  { key: "employmentType", type: "select", options: ["fullTime", "partTime", "temporary"], half: true },
  { key: "availableStartDate", type: "date", half: true },
  { key: "shiftPreference", type: "select", options: ["day", "evening", "night", "any"], half: true },
  { key: "legallyAuthorized", type: "checkbox" },
  { key: "over18", type: "checkbox" },
  { key: "emergencyContactName", type: "text", half: true },
  { key: "emergencyContactPhone", type: "tel", half: true },
  { key: "previousEmployer", type: "text" },
  { key: "previousJobTitle", type: "text", half: true },
  { key: "previousDuration", type: "text", half: true },
  { key: "reasonForLeaving", type: "textarea" },
  { key: "education", type: "text" },
  { key: "skills", type: "textarea" },
  { key: "references", type: "textarea" },
  { key: "convictedFelony", type: "checkbox" },
  { key: "felonyExplanation", type: "textarea" },
  { key: "howHeard", type: "text" },
];

// Form I-9 Section 1 — Employee Information and Attestation (jsonb: i9Employee)
export const I9_EMPLOYEE_FIELDS: FieldDef[] = [
  { key: "lastName", type: "text", half: true },
  { key: "firstName", type: "text", half: true },
  { key: "middleInitial", type: "text", half: true },
  { key: "otherNames", type: "text", half: true },
  { key: "address", type: "text" },
  { key: "aptNumber", type: "text", half: true },
  { key: "city", type: "text", half: true },
  { key: "state", type: "text", half: true },
  { key: "zip", type: "text", half: true },
  { key: "dateOfBirth", type: "date", half: true },
  { key: "ssn", type: "ssn", half: true },
  { key: "email", type: "email", half: true },
  { key: "phone", type: "tel", half: true },
  {
    key: "citizenshipStatus",
    type: "select",
    options: ["citizen", "noncitizenNational", "permanentResident", "authorizedAlien"],
  },
  { key: "uscisNumber", type: "text", half: true },
  { key: "i94Number", type: "text", half: true },
  { key: "passportNumber", type: "text", half: true },
  { key: "countryOfIssuance", type: "text", half: true },
  { key: "workAuthExpiration", type: "date", half: true },
  { key: "signatureName", type: "text", half: true },
  { key: "signatureDate", type: "date", half: true },
];

// Form W-4 — Employee's Withholding Certificate (jsonb: w4Employee)
export const W4_EMPLOYEE_FIELDS: FieldDef[] = [
  { key: "firstName", type: "text", half: true },
  { key: "middleInitial", type: "text", half: true },
  { key: "lastName", type: "text", half: true },
  { key: "ssn", type: "ssn", half: true },
  { key: "address", type: "text" },
  { key: "city", type: "text", half: true },
  { key: "state", type: "text", half: true },
  { key: "zip", type: "text", half: true },
  { key: "filingStatus", type: "select", options: ["single", "married", "headOfHousehold"] },
  { key: "multipleJobs", type: "checkbox" },
  { key: "claimDependentsAmount", type: "number", half: true },
  { key: "otherDependentsAmount", type: "number", half: true },
  { key: "otherIncome", type: "number", half: true },
  { key: "deductions", type: "number", half: true },
  { key: "extraWithholding", type: "number", half: true },
  { key: "exempt", type: "checkbox" },
  { key: "signatureName", type: "text", half: true },
  { key: "signatureDate", type: "date", half: true },
];

// Form I-9 Section 2 — Employer review and verification (jsonb: i9Employer)
export const I9_EMPLOYER_FIELDS: FieldDef[] = [
  { key: "documentTitle", type: "text", half: true },
  { key: "issuingAuthority", type: "text", half: true },
  { key: "documentNumber", type: "text", half: true },
  { key: "expirationDate", type: "date", half: true },
  { key: "firstDayEmployment", type: "date", half: true },
  { key: "employerName", type: "text", half: true },
  { key: "employerTitle", type: "text", half: true },
  { key: "businessName", type: "text" },
  { key: "businessAddress", type: "text" },
  { key: "certificationDate", type: "date", half: true },
];

// Form W-4 — Employer-only section (jsonb: w4Employer)
export const W4_EMPLOYER_FIELDS: FieldDef[] = [
  { key: "employerName", type: "text" },
  { key: "employerAddress", type: "text" },
  { key: "ein", type: "text", half: true },
  { key: "firstDateEmployment", type: "date", half: true },
];

// Public application portal — sections shown to the applicant.
export const PUBLIC_SECTIONS: SectionDef[] = [
  { id: "application", group: "application", fields: APPLICATION_FIELDS },
  { id: "i9Employee", group: "i9Employee", fields: I9_EMPLOYEE_FIELDS },
  { id: "w4Employee", group: "w4Employee", fields: W4_EMPLOYEE_FIELDS },
];

// Employer-editable sections shown in the internal review detail.
export const EMPLOYER_SECTIONS: SectionDef[] = [
  { id: "i9Employer", group: "i9Employer", fields: I9_EMPLOYER_FIELDS },
  { id: "w4Employer", group: "w4Employer", fields: W4_EMPLOYER_FIELDS },
];

export type FormValues = Record<string, Record<string, unknown>>;
