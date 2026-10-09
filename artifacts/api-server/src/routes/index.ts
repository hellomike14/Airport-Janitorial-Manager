import { Router, type IRouter } from "express";
import healthRouter from "./health";
import staffRouter from "./staff";
import areasRouter from "./areas";
import tasksRouter from "./tasks";
import assignmentsRouter from "./assignments";
import issuesRouter from "./issues";
import notificationsRouter from "./notifications";
import messagesRouter from "./messages";
import inspectorAssignmentsRouter from "./inspectorAssignments";
import operationsWorkbooksRouter from "./operationsWorkbooks";
import taskTypesRouter from "./taskTypes";
import dashboardRouter from "./dashboard";
import storageRouter from "./storage";
import locationsRouter from "./locations";
import schedulesRouter from "./schedules";
import sharedPhotosRouter from "./sharedPhotos";
import weeklyReportRouter from "./weeklyReport";
import applicationsRouter from "./applications";
import employmentFormSubmissionsRouter from "./employmentFormSubmissions";
import onboardingRouter, { ONBOARDING_ACCESS_ROLES } from "./onboarding";
import newHireRouter from "./newHire";
import quickbooksRouter from "./quickbooks";
import authDiagnosticsRouter from "./authDiagnostics";
import operationsRouter from "./operations";
import operationsDigitalRouter from "./operationsDigital";
import pettyCashReceiptsRouter from "./pettyCashReceipts";
import employeeTrainingRouter from "./employeeTraining";
import employmentFormsRouter from "./employmentForms";
import onboardingProtocolRouter from "./onboardingProtocol";
import identityDocumentsRouter from "./identityDocuments";
import { requireStaffSession } from "../middlewares/requireStaffSession";
import { requireStaffRole } from "../middlewares/requireStaffRole";
import confidentialAccessRouter from "./confidentialAccess";
import { confidentialAreas } from "../middlewares/confidentialAreas";

const router: IRouter = Router();
export const ONBOARDING_MOUNT_ROLES = ONBOARDING_ACCESS_ROLES;

export function mountOnboardingRouter(
  target: IRouter,
  child: IRouter = onboardingRouter,
  roleGate: typeof requireStaffRole = requireStaffRole,
) {
  target.use("/onboarding", roleGate(...ONBOARDING_MOUNT_ROLES), child);
}

router.use(requireStaffSession);
router.use(confidentialAccessRouter);
router.use(confidentialAreas);
router.use(healthRouter);
router.use(dashboardRouter);
router.use("/staff", staffRouter);
router.use("/auth-diagnostics", authDiagnosticsRouter);
router.use("/areas", areasRouter);
router.use("/tasks", tasksRouter);
router.use("/assignments", assignmentsRouter);
router.use("/issues", issuesRouter);
router.use(notificationsRouter);
router.use(inspectorAssignmentsRouter);
router.use(operationsWorkbooksRouter);
router.use(messagesRouter);
router.use(taskTypesRouter);
router.use(storageRouter);
router.use(locationsRouter);
router.use("/schedules", schedulesRouter);
router.use("/operations", operationsRouter);
router.use("/operations", pettyCashReceiptsRouter);
router.use("/operations", operationsDigitalRouter);
router.use(employeeTrainingRouter);
router.use(newHireRouter);
router.use(employmentFormsRouter);
router.use(onboardingProtocolRouter);
router.use(identityDocumentsRouter);
router.use("/shared-photos", sharedPhotosRouter);
router.use("/weekly-report", requireStaffRole("admin"), weeklyReportRouter);
router.use("/applications", applicationsRouter);
router.use("/employment-form-submissions", employmentFormSubmissionsRouter);
mountOnboardingRouter(router);
router.use("/quickbooks", requireStaffRole("admin"), quickbooksRouter);

export default router;
