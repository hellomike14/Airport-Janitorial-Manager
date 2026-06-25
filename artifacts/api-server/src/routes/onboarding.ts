import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { onboardingHiresTable, onboardingItemsTable } from "@workspace/db/schema";
import {
  CreateOnboardingHireBody,
  CreateOnboardingItemBody,
  UpdateOnboardingItemBody,
} from "@workspace/api-zod";
import { eq, asc, desc } from "drizzle-orm";

const router: IRouter = Router();

type DefaultItem = {
  category: "step" | "document" | "training" | "walkthrough";
  title: string;
};

// Default onboarding checklist seeded for every new hire.
const DEFAULT_ITEMS: DefaultItem[] = [
  { category: "step", title: "Collect signed offer letter" },
  { category: "step", title: "Verify I-9 documents in person" },
  { category: "step", title: "Set up payroll / direct deposit" },
  { category: "document", title: "Sign employee handbook acknowledgement" },
  { category: "document", title: "Sign confidentiality agreement" },
  { category: "document", title: "Complete W-4 tax form" },
  { category: "training", title: "Safety & PPE training" },
  { category: "training", title: "Equipment & chemical handling training" },
  { category: "training", title: "Facility access & badge issuance" },
  { category: "walkthrough", title: "In-app walkthrough: My Tasks & schedule" },
  { category: "walkthrough", title: "In-app walkthrough: reporting issues & photos" },
];

async function loadHireWithItems(id: number) {
  const [hire] = await db
    .select()
    .from(onboardingHiresTable)
    .where(eq(onboardingHiresTable.id, id))
    .limit(1);
  if (!hire) return null;
  const items = await db
    .select()
    .from(onboardingItemsTable)
    .where(eq(onboardingItemsTable.hireId, id))
    .orderBy(asc(onboardingItemsTable.sortOrder), asc(onboardingItemsTable.id));
  const completedItems = items.filter((i) => i.completed).length;
  return { ...hire, items, totalItems: items.length, completedItems };
}

/**
 * GET /onboarding — list hires with progress counts.
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const hires = await db
      .select()
      .from(onboardingHiresTable)
      .orderBy(desc(onboardingHiresTable.createdAt));
    const items = await db.select().from(onboardingItemsTable);
    const byHire = new Map<number, { total: number; completed: number }>();
    for (const it of items) {
      const acc = byHire.get(it.hireId) ?? { total: 0, completed: 0 };
      acc.total += 1;
      if (it.completed) acc.completed += 1;
      byHire.set(it.hireId, acc);
    }
    res.json(
      hires.map((h) => ({
        ...h,
        totalItems: byHire.get(h.id)?.total ?? 0,
        completedItems: byHire.get(h.id)?.completed ?? 0,
      })),
    );
  } catch (err) {
    console.error("Error listing onboarding hires:", err);
    res.status(500).json({ error: "Failed to list onboarding hires" });
  }
});

/**
 * POST /onboarding — create a hire and seed the default checklist.
 */
router.post("/", async (req: Request, res: Response) => {
  const parsed = CreateOnboardingHireBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  try {
    const [hire] = await db
      .insert(onboardingHiresTable)
      .values({
        name: parsed.data.name,
        position: parsed.data.position ?? null,
        applicationId: parsed.data.applicationId ?? null,
      })
      .returning();

    await db.insert(onboardingItemsTable).values(
      DEFAULT_ITEMS.map((item, idx) => ({
        hireId: hire.id,
        category: item.category,
        title: item.title,
        sortOrder: idx,
      })),
    );

    const full = await loadHireWithItems(hire.id);
    res.status(201).json(full);
  } catch (err) {
    console.error("Error creating onboarding hire:", err);
    res.status(500).json({ error: "Failed to create onboarding hire" });
  }
});

/**
 * GET /onboarding/:id — hire with checklist items.
 */
router.get("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const full = await loadHireWithItems(id);
    if (!full) {
      res.status(404).json({ error: "Hire not found" });
      return;
    }
    res.json(full);
  } catch (err) {
    console.error("Error fetching onboarding hire:", err);
    res.status(500).json({ error: "Failed to fetch onboarding hire" });
  }
});

/**
 * DELETE /onboarding/:id — remove a hire (items cascade).
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [deleted] = await db
      .delete(onboardingHiresTable)
      .where(eq(onboardingHiresTable.id, id))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Hire not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting onboarding hire:", err);
    res.status(500).json({ error: "Failed to delete onboarding hire" });
  }
});

/**
 * POST /onboarding/:id/items — add a checklist item.
 */
router.post("/:id/items", async (req: Request, res: Response) => {
  const hireId = Number(req.params.id);
  if (Number.isNaN(hireId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = CreateOnboardingItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  try {
    const [item] = await db
      .insert(onboardingItemsTable)
      .values({
        hireId,
        category: parsed.data.category ?? "step",
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        sortOrder: parsed.data.sortOrder ?? 999,
      })
      .returning();
    res.status(201).json(item);
  } catch (err) {
    console.error("Error creating onboarding item:", err);
    res.status(500).json({ error: "Failed to create onboarding item" });
  }
});

/**
 * PATCH /onboarding/items/:itemId — toggle completion or edit content.
 */
router.patch("/items/:itemId", async (req: Request, res: Response) => {
  const itemId = Number(req.params.itemId);
  if (Number.isNaN(itemId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateOnboardingItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  try {
    const updates: Record<string, unknown> = {};
    if (parsed.data.completed !== undefined) {
      updates.completed = parsed.data.completed;
      updates.completedAt = parsed.data.completed ? new Date() : null;
    }
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;

    const [updated] = await db
      .update(onboardingItemsTable)
      .set(updates)
      .where(eq(onboardingItemsTable.id, itemId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    console.error("Error updating onboarding item:", err);
    res.status(500).json({ error: "Failed to update onboarding item" });
  }
});

/**
 * DELETE /onboarding/items/:itemId — remove a checklist item.
 */
router.delete("/items/:itemId", async (req: Request, res: Response) => {
  const itemId = Number(req.params.itemId);
  if (Number.isNaN(itemId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [deleted] = await db
      .delete(onboardingItemsTable)
      .where(eq(onboardingItemsTable.id, itemId))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting onboarding item:", err);
    res.status(500).json({ error: "Failed to delete onboarding item" });
  }
});

export default router;
