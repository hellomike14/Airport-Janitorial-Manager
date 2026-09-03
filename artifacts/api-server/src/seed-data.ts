export const SEED_STAFF: { name: string; role: "admin" | "inspector" | "supervisor" | "staff"; phone?: string; email?: string }[] = [
  { name: "Michael", role: "admin", email: "michael@massifkroo.com" },
  { name: "MCO Inspector", role: "inspector", phone: "407-555-0099", email: "inspector@marvolenterprises.com" },
  { name: "Priscila Rosero", role: "supervisor", email: "priscilarosero27@gmail.com" },
  { name: "Reynaldo Hernandez Suarez", role: "supervisor", email: "cnuevo986@gmail.com" },

  { name: "Ivan Serrano", role: "staff", email: "ivanserrano737@gmail.com" },
  { name: "Jean Gardy Rigueur", role: "staff", email: "jeangardyrigueur@gmail.com" },
  { name: "Jose Camargo", role: "staff" },
  { name: "Juan Carlos Zurita Blacio", role: "staff", email: "jczb110371@gmail.com" },
  { name: "Kevin Gonzalez Fernandez", role: "staff", email: "kevingonzalez2015830@gmail.com" },
  { name: "Steeve Alphonse", role: "staff", email: "steevealphonse86@gmail.com" },
  { name: "John Nelson Louis", role: "staff", email: "louiszya3@gmail.com" },
  { name: "Diego Moreno Velez", role: "staff", email: "diegomoreno198419@gmail.com" },
  { name: "Luis Garcia", role: "staff", email: "kikeyuli1112@gmail.com" },
  { name: "Alexis Moron", role: "staff", email: "alexismoron733@gmail.com" },
  { name: "JeanFranco Perez", role: "staff", email: "jeanfranco985@gmail.com" },
];

// Operations requires every current roster member with a known email to have
// app access. Startup repairs their exact email and restores both active/login
// flags. Email-less rows remain unavailable until an administrator supplies a
// verified address; guessing an identity would risk granting the wrong person
// access. The notification-only recipient is intentionally not in SEED_STAFF.
export const REQUIRED_PRODUCTION_LOGIN_NAMES = new Set(
  SEED_STAFF.filter((staff) => Boolean(staff.email)).map((staff) => staff.name),
);

export const REMOVED_STAFF_NAMES = ["Floraima Pinero Valdez", "Ashandre Longmore", "Marie Ingrid Daniel", "Jose Altagracia Maria", "Edner Jules", "Jason Delgado"];
