export type SeedStaff = { name: string; role: "admin" | "inspector" | "supervisor" | "staff"; phone?: string; email?: string; loginEnabled?: boolean };

/** Login access is opt-in through a seed identity with a real email address. */
export function isSeedLoginEnabled(staff: SeedStaff): boolean {
  return staff.loginEnabled === true || (staff.loginEnabled !== false && Boolean(staff.email?.trim()));
}

export const SEED_STAFF: SeedStaff[] = [
  { name: "Marcell Sutherland", role: "admin", phone: "407-555-0001", email: "msutherland@marvolenterprises.com" },
  { name: "Michael", role: "admin", email: "michael@massifkroo.com" },
  // Dedicated operational identity; do not use a personal inspector address.
  { name: "MCO Inspector", role: "inspector", phone: "407-555-0099", email: "inspector@marvolenterprises.com" },
  { name: "Priscila Rosero", role: "supervisor", email: "Priscilarosero27@gmail.com" },
  { name: "Reynaldo Hernandez", role: "supervisor", email: "cnuevo986@gmail.com" },

  { name: "Jean Gardy Rigueur", role: "staff" },
  { name: "Jose Camargo", role: "staff" },
  { name: "Juan Carlos Zurita Blacio", role: "staff" },
  { name: "Kevin Gonzalez Fernandez", role: "staff" },
  { name: "Steeve Alphonse", role: "staff", email: "steevealphonse86@gmail.com" },
  { name: "John Nelson Louis", role: "staff", email: "louiszya3@gmail.com" },
  { name: "Diego Moreno Velez", role: "staff", email: "diegomoreno198419@gmail.com" },
  { name: "Luis Garcia", role: "staff", email: "kikeyuli1112@gmail.com" },
  { name: "Alexis Moron", role: "staff", email: "alexismoron733@gmail.com" },
  { name: "JeanFranco Perez", role: "staff", email: "jeanfranco985@gmail.com" },
];

export const REMOVED_STAFF_NAMES = [
  "Floraima Pinero Valdez",
  "Ashandre Longmore",
  "Marie Ingrid Daniel",
  "Jose Altagracia Maria",
  "Edner Jules",
  "Jason Delgado",
  "Ivan Serrano",
];
