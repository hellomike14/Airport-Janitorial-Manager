import { Router, type IRouter, type Request } from "express";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { actorStaffFromRequest } from "../lib/actorSession";

type Actor = NonNullable<Awaited<ReturnType<typeof actorStaffFromRequest>>>;
type RouterDependencies = {
  resolveActor?: typeof actorStaffFromRequest;
  readUniformWorkbook?: () => Promise<Buffer>;
};

const UNIFORM_WORKBOOK_OBJECT_PATH = "/objects/operations-workbooks/uniform-inventory-system.xlsx";
const UNIFORM_WORKBOOK_FILENAME = "Marvol_Uniform_inventory_system.xlsx";
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const objectStorage = new ObjectStorageService();

async function readUniformWorkbook(): Promise<Buffer> {
  const file = await objectStorage.getObjectEntityFile(UNIFORM_WORKBOOK_OBJECT_PATH);
  const [bytes] = await file.download();
  return Buffer.from(bytes);
}

export function createOperationsWorkbooksRouter(dependencies: RouterDependencies = {}): IRouter {
  const router: IRouter = Router();
  const resolveActor = dependencies.resolveActor ?? actorStaffFromRequest;
  const readWorkbook = dependencies.readUniformWorkbook ?? readUniformWorkbook;

  router.get("/operations/workbooks/uniform", async (req: Request, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const actor = await resolveActor(req);
    if (!actor) {
      res.status(401).json({ error: "Login session required" });
      return;
    }
    if (actor.role !== "admin" && actor.role !== "supervisor") {
      res.status(403).json({ error: "Only administrators and supervisors may download this workbook" });
      return;
    }
    try {
      const bytes = await readWorkbook();
      res.setHeader("Content-Type", XLSX_CONTENT_TYPE);
      res.setHeader("Content-Disposition", `attachment; filename="${UNIFORM_WORKBOOK_FILENAME}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.status(200).send(bytes);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Uniform workbook is unavailable" });
        return;
      }
      res.status(500).json({ error: "Unable to download the uniform workbook" });
    }
  });

  return router;
}

export default createOperationsWorkbooksRouter();
