export const SEED_STAFF: { name: string; role: "admin" | "inspector" | "supervisor" | "staff"; phone?: string; email?: string }[] = [
  { name: "Michael", role: "admin", email: "michael@massifkroo.com" },
  { name: "MCO Inspector", role: "inspector", phone: "407-555-0099", email: "inspector@marvolenterprises.com" },
  { name: "Priscila Rosero", role: "supervisor", email: "priscilarosero27@gmail.com" },
  { name: "Reynaldo Hernandez Suarez", role: "supervisor", email: "cnuevo986@gmail.com" },

  { name: "Edner Jules", role: "staff" },
  { name: "Ivan Serrano", role: "staff", email: "ivanserrano737@gmail.com" },
  { name: "Jason Delgado", role: "staff" },
  { name: "Jean Gardy Rigueur", role: "staff" },
  { name: "Jose Camargo", role: "staff" },
  { name: "Juan Carlos Zurita Blacio", role: "staff" },
  { name: "Kevin Gonzalez Fernandez", role: "staff", email: "kevingonzalez2015830@gmail.com" },
  { name: "Steeve Alphonse", role: "staff", email: "steevealphonse86@gmail.com" },
  { name: "John Nelson Louis", role: "staff", email: "louiszya3@gmail.com" },
  { name: "Diego Moreno Velez", role: "staff", email: "diegomoreno198419@gmail.com" },
  { name: "Luis Garcia", role: "staff", email: "kikeyuli1112@gmail.com" },
  { name: "Alexis Moron", role: "staff", email: "alexismoron733@gmail.com" },
  { name: "JeanFranco Perez", role: "staff", email: "jeanfranco985@gmail.com" },
];

// These are launch-approved production identities confirmed by operations.
// Startup repairs both their exact email and their ability to sign in; other
// seeded employees can still be deliberately deactivated by an administrator.
export const REQUIRED_PRODUCTION_LOGIN_NAMES = new Set([
  "MCO Inspector",
  "Reynaldo Hernandez Suarez",
  "Ivan Serrano",
  "Kevin Gonzalez Fernandez",
]);

export const REMOVED_STAFF_NAMES = ["Floraima Pinero Valdez", "Ashandre Longmore", "Marie Ingrid Daniel", "Jose Altagracia Maria"];
