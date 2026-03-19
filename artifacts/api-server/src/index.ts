import app from "./app";
import { db } from "@workspace/db";
import { staffTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function seedAdmin() {
  const existing = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.role, "admin"));

  if (existing.length === 0) {
    await db.insert(staffTable).values({
      name: "System Administrator",
      role: "admin",
      phone: "407-555-0001",
      email: "admin@marvolfacility.com",
      active: true,
    });
    console.log("Seeded admin user");
  }
}

app.listen(port, async () => {
  console.log(`Server listening on port ${port}`);
  await seedAdmin().catch((err) => console.error("Seed error:", err));
});
