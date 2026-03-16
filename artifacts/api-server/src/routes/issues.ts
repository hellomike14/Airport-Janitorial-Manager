import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { issuesTable, staffTable, areasTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import {
  ListIssuesQueryParams,
  CreateIssueBody,
  ResolveIssueParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  const query = ListIssuesQueryParams.parse({
    date: req.query.date,
    areaId: req.query.areaId,
  });

  const issues = await db
    .select({
      id: issuesTable.id,
      areaId: issuesTable.areaId,
      areaName: areasTable.name,
      reportedById: issuesTable.reportedById,
      reportedByName: staffTable.name,
      issueDate: issuesTable.issueDate,
      description: issuesTable.description,
      severity: issuesTable.severity,
      resolved: issuesTable.resolved,
      resolvedAt: issuesTable.resolvedAt,
      createdAt: issuesTable.createdAt,
    })
    .from(issuesTable)
    .innerJoin(areasTable, eq(issuesTable.areaId, areasTable.id))
    .innerJoin(staffTable, eq(issuesTable.reportedById, staffTable.id))
    .where(
      and(
        query.date ? eq(issuesTable.issueDate, query.date) : undefined,
        query.areaId ? eq(issuesTable.areaId, query.areaId) : undefined
      )
    )
    .orderBy(issuesTable.createdAt);

  res.json(
    issues.map((i) => ({
      ...i,
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
    }))
  );
});

router.post("/", async (req, res) => {
  const body = CreateIssueBody.parse(req.body);
  const today = new Date().toISOString().split("T")[0];

  const [created] = await db
    .insert(issuesTable)
    .values({
      areaId: body.areaId,
      reportedById: body.reportedById,
      issueDate: today,
      description: body.description,
      severity: body.severity,
      resolved: false,
    })
    .returning();

  const [area] = await db
    .select({ name: areasTable.name })
    .from(areasTable)
    .where(eq(areasTable.id, created.areaId));

  const [reporter] = await db
    .select({ name: staffTable.name })
    .from(staffTable)
    .where(eq(staffTable.id, created.reportedById));

  res.status(201).json({
    ...created,
    areaName: area?.name ?? "",
    reportedByName: reporter?.name ?? "",
    resolvedAt: null,
    createdAt: created.createdAt.toISOString(),
  });
});

router.post("/:id/resolve", async (req, res) => {
  const { id } = ResolveIssueParams.parse({ id: req.params.id });

  const [updated] = await db
    .update(issuesTable)
    .set({ resolved: true, resolvedAt: new Date() })
    .where(eq(issuesTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  const [area] = await db
    .select({ name: areasTable.name })
    .from(areasTable)
    .where(eq(areasTable.id, updated.areaId));

  const [reporter] = await db
    .select({ name: staffTable.name })
    .from(staffTable)
    .where(eq(staffTable.id, updated.reportedById));

  res.json({
    ...updated,
    areaName: area?.name ?? "",
    reportedByName: reporter?.name ?? "",
    resolvedAt: updated.resolvedAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
  });
});

export default router;
