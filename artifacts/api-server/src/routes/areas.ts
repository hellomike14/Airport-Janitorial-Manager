import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { areasTable } from "@workspace/db/schema";
import { asc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  const areas = await db.select().from(areasTable).orderBy(asc(areasTable.sortOrder));
  res.json(areas);
});

export default router;
