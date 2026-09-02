import { db } from "@workspace/db";
import {
  issuesTable,
  jobApplicationsTable,
  sharedPhotosTable,
  tasksTable,
} from "@workspace/db/schema";
import { eq, or, sql } from "drizzle-orm";
import type { StaffRow } from "./actorSession";
import type { VerifiedUploadRecord } from "./secureUpload";

export type StoredObjectReference =
  | "application-document"
  | "operational-photo"
  | null;

export function canReadStoredObject(
  actor: Pick<StaffRow, "role">,
  record: VerifiedUploadRecord | null,
  reference: StoredObjectReference,
): boolean {
  // Application association always wins. This prevents a path from being
  // reclassified as team media after it has been attached to sensitive HR
  // paperwork.
  if (reference === "application-document") {
    return actor.role === "admin" || actor.role === "supervisor";
  }
  if (record?.purpose === "application-document") {
    return actor.role === "admin" || actor.role === "supervisor";
  }
  if (record?.purpose === "staff-photo") return true;
  return reference === "operational-photo";
}

/**
 * Legacy uploads predate signed scope metadata. Resolve them only when a
 * current database entity references the exact opaque object path; orphaned
 * private objects stay inaccessible.
 */
export async function findStoredObjectReference(
  objectPath: string,
): Promise<StoredObjectReference> {
  const [application] = await db
    .select({ id: jobApplicationsTable.id })
    .from(jobApplicationsTable)
    .where(
      sql`${jobApplicationsTable.documents} @> ${JSON.stringify([{ path: objectPath }])}::jsonb`,
    )
    .limit(1);
  if (application) return "application-document";

  const [sharedPhoto, taskPhoto, issuePhoto] = await Promise.all([
    db
      .select({ id: sharedPhotosTable.id })
      .from(sharedPhotosTable)
      .where(eq(sharedPhotosTable.imagePath, objectPath))
      .limit(1),
    db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(
        or(
          eq(tasksTable.beforeImagePath, objectPath),
          eq(tasksTable.afterImagePath, objectPath),
        ),
      )
      .limit(1),
    db
      .select({ id: issuesTable.id })
      .from(issuesTable)
      .where(
        or(
          eq(issuesTable.beforeImagePath, objectPath),
          eq(issuesTable.afterImagePath, objectPath),
        ),
      )
      .limit(1),
  ]);
  return sharedPhoto[0] || taskPhoto[0] || issuePhoto[0]
    ? "operational-photo"
    : null;
}
