import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  staffTable,
  uniformStockItemsTable,
  uniformStockTransactionsTable,
} from "@workspace/db/schema";
import { csvCell, isEligibleOperationsEmployee } from "./operationsPolicy";
import { DigitalOperationsError } from "./digitalOperationsErrors";

type DigitalDb = typeof db;
type ItemInput = {
  itemCode?: string | null;
  itemName: string;
  description?: string | null;
  size: string;
  openingQuantity: number;
  openingReason: string;
  reorderLevel: number;
  lastOrderDate?: string | null;
};
type ItemUpdate = {
  expectedVersion: number;
  itemCode?: string | null;
  itemName: string;
  description?: string | null;
  size: string;
  reorderLevel: number;
  lastOrderDate?: string | null;
  active: boolean;
};
type TransactionInput = {
  type: "receipt" | "issue" | "return" | "adjustment";
  itemId?: number;
  staffId?: number;
  quantity: number;
  adjustmentDirection?: "increase" | "decrease";
  relatedIssueId?: number;
  conditionReturned?: "serviceable" | "damaged";
  replacementIssued?: boolean;
  reason: string;
};

function uniqueConstraintError(error: unknown) {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505";
}

function requiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new DigitalOperationsError(400, "REQUIRED_FIELD", `${label} is required.`);
  }
  return normalized;
}

function assertCount(value: number, label: string, allowZero = false) {
  if (
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1)
  ) {
    throw new DigitalOperationsError(400, "INVALID_QUANTITY", `${label} is invalid.`);
  }
}

export function createUniformStockService(database: DigitalDb = db) {
  async function listItems(conn: DigitalDb = database) {
    const items = await conn
      .select()
      .from(uniformStockItemsTable)
      .orderBy(uniformStockItemsTable.active, uniformStockItemsTable.itemName, uniformStockItemsTable.size);
    if (!items.length) return [];
    const itemIds = items.map((item) => item.id);
    const transactions = await conn
      .select({
        itemId: uniformStockTransactionsTable.itemId,
        type: uniformStockTransactionsTable.type,
        quantity: uniformStockTransactionsTable.quantity,
      })
      .from(uniformStockTransactionsTable)
      .where(inArray(uniformStockTransactionsTable.itemId, itemIds));
    const issuedByItem = new Map<number, number>();
    for (const transaction of transactions) {
      if (transaction.type === "issue") {
        issuedByItem.set(
          transaction.itemId,
          (issuedByItem.get(transaction.itemId) ?? 0) + transaction.quantity,
        );
      } else if (transaction.type === "return") {
        issuedByItem.set(
          transaction.itemId,
          (issuedByItem.get(transaction.itemId) ?? 0) - transaction.quantity,
        );
      }
    }
    return items.map((item) => ({
      id: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      description: item.description,
      size: item.size,
      currentQuantity: item.currentQuantity,
      outstandingIssued: Math.max(0, issuedByItem.get(item.id) ?? 0),
      reorderLevel: item.reorderLevel,
      lastOrderDate: item.lastOrderDate,
      active: item.active,
      lowStock: item.active && item.currentQuantity <= item.reorderLevel,
      version: item.version,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }

  async function listTransactions(conn: DigitalDb = database) {
    const rows = await conn
      .select()
      .from(uniformStockTransactionsTable)
      .orderBy(desc(uniformStockTransactionsTable.occurredAt), desc(uniformStockTransactionsTable.id));
    if (!rows.length) return [];
    const itemIds = [...new Set(rows.map((row) => row.itemId))];
    const personIds = [...new Set(rows.flatMap((row) => [
      row.staffId,
      row.actorId,
    ]).filter((id): id is number => id != null))];
    const [items, people, returns] = await Promise.all([
      conn
        .select({
          id: uniformStockItemsTable.id,
          itemName: uniformStockItemsTable.itemName,
          size: uniformStockItemsTable.size,
        })
        .from(uniformStockItemsTable)
        .where(inArray(uniformStockItemsTable.id, itemIds)),
      conn
        .select({ id: staffTable.id, name: staffTable.name })
        .from(staffTable)
        .where(inArray(staffTable.id, personIds)),
      conn
        .select({
          relatedIssueId: uniformStockTransactionsTable.relatedIssueId,
          quantity: sql<number>`coalesce(sum(${uniformStockTransactionsTable.quantity}), 0)::int`,
        })
        .from(uniformStockTransactionsTable)
        .where(eq(uniformStockTransactionsTable.type, "return"))
        .groupBy(uniformStockTransactionsTable.relatedIssueId),
    ]);
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const peopleMap = new Map(people.map((person) => [person.id, person.name]));
    const returnCounts = new Map(
      returns
        .filter((row) => row.relatedIssueId != null)
        .map((row) => [row.relatedIssueId!, Number(row.quantity)]),
    );
    return rows.map((row) => {
      const item = itemMap.get(row.itemId);
      return {
        id: row.id,
        itemId: row.itemId,
        itemName: item?.itemName ?? "Archived item",
        size: item?.size ?? "",
        staffId: row.staffId,
        staffName: row.staffId == null ? null : peopleMap.get(row.staffId) ?? "Former staff record",
        actorId: row.actorId,
        actorName: peopleMap.get(row.actorId) ?? "Unknown manager",
        type: row.type,
        quantity: row.quantity,
        stockDelta: row.stockDelta,
        relatedIssueId: row.relatedIssueId,
        conditionReturned: row.conditionReturned,
        replacementIssued: row.replacementIssued,
        reason: row.reason,
        occurredAt: row.occurredAt,
        remainingReturnQuantity: row.type === "issue"
          ? Math.max(0, row.quantity - (returnCounts.get(row.id) ?? 0))
          : 0,
      };
    });
  }

  return {
    async listItems() {
      return listItems();
    },

    async createItem(input: ItemInput, actorId: number) {
      assertCount(input.openingQuantity, "Opening quantity", true);
      assertCount(input.reorderLevel, "Reorder level", true);
      let itemId: number;
      try {
        itemId = await database.transaction(async (tx) => {
          const now = new Date();
          const [item] = await tx
            .insert(uniformStockItemsTable)
            .values({
              itemCode: input.itemCode?.trim() || null,
              itemName: requiredText(input.itemName, "Item name"),
              description: input.description?.trim() || null,
              size: requiredText(input.size, "Size"),
              currentQuantity: input.openingQuantity,
              reorderLevel: input.reorderLevel,
              lastOrderDate: input.lastOrderDate ?? null,
              active: true,
              version: 1,
              createdById: actorId,
              updatedById: actorId,
              createdAt: now,
              updatedAt: now,
            })
            .returning({ id: uniformStockItemsTable.id });
          await tx.insert(uniformStockTransactionsTable).values({
            itemId: item.id,
            staffId: null,
            actorId,
            type: "opening_balance",
            quantity: input.openingQuantity,
            stockDelta: input.openingQuantity,
            relatedIssueId: null,
            conditionReturned: null,
            replacementIssued: false,
            reason: requiredText(input.openingReason, "Opening balance reason"),
            occurredAt: now,
          });
          return item.id;
        });
      } catch (error) {
        if (uniqueConstraintError(error)) {
          throw new DigitalOperationsError(
            409,
            "UNIFORM_ITEM_EXISTS",
            "An active item with this name and size already exists.",
          );
        }
        throw error;
      }
      return (await listItems()).find((item) => item.id === itemId)!;
    },

    async updateItem(itemId: number, input: ItemUpdate, actorId: number) {
      try {
        await database.transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(uniformStockItemsTable)
            .where(eq(uniformStockItemsTable.id, itemId))
            .for("update")
            .limit(1);
          if (!current) {
            throw new DigitalOperationsError(
              404,
              "UNIFORM_ITEM_NOT_FOUND",
              "Uniform Stock item not found.",
            );
          }
          if (current.version !== input.expectedVersion) {
            throw new DigitalOperationsError(
              409,
              "UNIFORM_ITEM_VERSION_CONFLICT",
              "This item changed. Reload it before saving.",
            );
          }
          const now = new Date();
          await tx
            .update(uniformStockItemsTable)
            .set({
              itemCode: input.itemCode?.trim() || null,
              itemName: requiredText(input.itemName, "Item name"),
              description: input.description?.trim() || null,
              size: requiredText(input.size, "Size"),
              reorderLevel: input.reorderLevel,
              lastOrderDate: input.lastOrderDate ?? null,
              active: input.active,
              version: current.version + 1,
              updatedById: actorId,
              updatedAt: now,
            })
            .where(eq(uniformStockItemsTable.id, itemId));
        });
      } catch (error) {
        if (uniqueConstraintError(error)) {
          throw new DigitalOperationsError(
            409,
            "UNIFORM_ITEM_EXISTS",
            "An active item with this name and size already exists.",
          );
        }
        throw error;
      }
      return (await listItems()).find((item) => item.id === itemId)!;
    },

    async transactions() {
      return listTransactions();
    },

    async createTransaction(input: TransactionInput, actorId: number) {
      assertCount(input.quantity, "Quantity");
      const id = await database.transaction(async (tx) => {
        let itemId = input.itemId;
        let staffId: number | null = null;
        let relatedIssueId: number | null = null;
        let conditionReturned: "serviceable" | "damaged" | null = null;
        let stockDelta: number;
        let item: typeof uniformStockItemsTable.$inferSelect | undefined;
        let transactionReason = requiredText(input.reason, "Reason");

        if (input.type === "return") {
          if (!input.relatedIssueId) {
            throw new DigitalOperationsError(
              400,
              "ORIGINAL_ISSUE_REQUIRED",
              "Choose the original issue to return.",
            );
          }
          if (!input.conditionReturned) {
            throw new DigitalOperationsError(
              400,
              "RETURN_CONDITION_REQUIRED",
              "Choose whether the returned item is serviceable or damaged.",
            );
          }
          const [issue] = await tx
            .select()
            .from(uniformStockTransactionsTable)
            .where(eq(uniformStockTransactionsTable.id, input.relatedIssueId))
            .for("update")
            .limit(1);
          if (!issue || issue.type !== "issue" || issue.staffId == null) {
            throw new DigitalOperationsError(
              404,
              "ORIGINAL_ISSUE_NOT_FOUND",
              "The selected historical issue cannot be returned.",
            );
          }
          itemId = issue.itemId;
          staffId = issue.staffId;
          relatedIssueId = issue.id;
          conditionReturned = input.conditionReturned;
          transactionReason = requiredText(input.reason, "Reason");
          const [priorReturns] = await tx
            .select({
              quantity: sql<number>`coalesce(sum(${uniformStockTransactionsTable.quantity}), 0)::int`,
            })
            .from(uniformStockTransactionsTable)
            .where(eq(uniformStockTransactionsTable.relatedIssueId, issue.id));
          if (Number(priorReturns?.quantity ?? 0) + input.quantity > issue.quantity) {
            throw new DigitalOperationsError(
              409,
              "RETURN_EXCEEDS_ISSUE",
              "The return quantity exceeds the amount still assigned on the original issue.",
            );
          }
          [item] = await tx
            .select()
            .from(uniformStockItemsTable)
            .where(eq(uniformStockItemsTable.id, issue.itemId))
            .for("update")
            .limit(1);
          if (!item) {
            throw new DigitalOperationsError(
              404,
              "UNIFORM_ITEM_NOT_FOUND",
              "The original item's stock record is unavailable.",
            );
          }
          stockDelta = conditionReturned === "serviceable" ? input.quantity : 0;
        } else {
          if (!itemId) {
            throw new DigitalOperationsError(
              400,
              "UNIFORM_ITEM_REQUIRED",
              "Choose a Uniform Stock item.",
            );
          }
          [item] = await tx
            .select()
            .from(uniformStockItemsTable)
            .where(eq(uniformStockItemsTable.id, itemId))
            .for("update")
            .limit(1);
          if (!item) {
            throw new DigitalOperationsError(
              404,
              "UNIFORM_ITEM_NOT_FOUND",
              "Uniform Stock item not found.",
            );
          }
          if (!item.active) {
            throw new DigitalOperationsError(
              409,
              "UNIFORM_ITEM_ARCHIVED",
              "New transactions are disabled for this archived item.",
            );
          }
          if (input.type === "issue") {
            if (!input.staffId) {
              throw new DigitalOperationsError(
                400,
                "STAFF_REQUIRED",
                "Choose an employee for the uniform issue.",
              );
            }
            const [staff] = await tx
              .select({
                id: staffTable.id,
                active: staffTable.active,
                formerEmployee: staffTable.formerEmployee,
                role: staffTable.role,
              })
              .from(staffTable)
              .where(eq(staffTable.id, input.staffId))
              .for("share")
              .limit(1);
            if (!staff || !isEligibleOperationsEmployee(staff)) {
              throw new DigitalOperationsError(
                400,
                "STAFF_NOT_ELIGIBLE",
                "New uniform issues require an active, non-former staff member, supervisor or administrator.",
              );
            }
            staffId = staff.id;
            stockDelta = -input.quantity;
            if (input.quantity > item.currentQuantity) {
              throw new DigitalOperationsError(
                409,
                "UNIFORM_STOCK_INSUFFICIENT",
                "There is not enough stock available for this issue.",
              );
            }
          } else if (input.type === "receipt") {
            stockDelta = input.quantity;
          } else {
            if (!input.adjustmentDirection) {
              throw new DigitalOperationsError(
                400,
                "ADJUSTMENT_DIRECTION_REQUIRED",
                "Choose whether the adjustment increases or decreases stock.",
              );
            }
            stockDelta =
              input.adjustmentDirection === "increase"
                ? input.quantity
                : -input.quantity;
          }
        }

        const updatedQuantity = item.currentQuantity + stockDelta;
        if (!Number.isSafeInteger(updatedQuantity) || updatedQuantity < 0) {
          throw new DigitalOperationsError(
            409,
            "UNIFORM_STOCK_NEGATIVE",
            "The transaction cannot reduce stock below zero.",
          );
        }
        const now = new Date();
        await tx
          .update(uniformStockItemsTable)
          .set({
            currentQuantity: updatedQuantity,
            version: item.version + 1,
            updatedById: actorId,
            updatedAt: now,
          })
          .where(eq(uniformStockItemsTable.id, item.id));
        const [created] = await tx
          .insert(uniformStockTransactionsTable)
          .values({
            itemId: item.id,
            staffId,
            actorId,
            type: input.type,
            quantity: input.quantity,
            stockDelta,
            relatedIssueId,
            conditionReturned,
            replacementIssued: input.type === "return" && input.replacementIssued === true,
            reason: transactionReason,
            occurredAt: now,
          })
          .returning({ id: uniformStockTransactionsTable.id });
        return created.id;
      });
      return (await listTransactions()).find((transaction) => transaction.id === id)!;
    },

    async exportCsv(view: "stock" | "history") {
      const rows: unknown[][] = [];
      if (view === "stock") {
        rows.push([
          "Item code",
          "Item",
          "Description",
          "Size",
          "Quantity on hand",
          "Outstanding with staff",
          "Reorder level",
          "Last order date",
          "Low stock",
          "Status",
        ]);
        for (const item of await listItems()) {
          rows.push([
            item.itemCode ?? "",
            item.itemName,
            item.description ?? "",
            item.size,
            item.currentQuantity,
            item.outstandingIssued,
            item.reorderLevel,
            item.lastOrderDate ?? "",
            item.lowStock ? "Yes" : "No",
            item.active ? "Active" : "Archived",
          ]);
        }
      } else {
        rows.push([
          "Date",
          "Type",
          "Item",
          "Size",
          "Staff",
          "Quantity",
          "Stock change",
          "Return condition",
          "Replacement issued",
          "Reason",
          "Recorded by",
        ]);
        for (const entry of await listTransactions()) {
          rows.push([
            entry.occurredAt.toISOString(),
            entry.type,
            entry.itemName,
            entry.size,
            entry.staffName ?? "",
            entry.quantity,
            entry.stockDelta,
            entry.conditionReturned ?? "",
            entry.replacementIssued ? "Yes" : "No",
            entry.reason,
            entry.actorName,
          ]);
        }
      }
      return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
    },
  };
}

export const uniformStockService = createUniformStockService();
