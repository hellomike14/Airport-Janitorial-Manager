import { Router, type IRouter } from "express";
import healthRouter from "./health";
import staffRouter from "./staff";
import areasRouter from "./areas";
import tasksRouter from "./tasks";
import assignmentsRouter from "./assignments";
import issuesRouter from "./issues";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use("/staff", staffRouter);
router.use("/areas", areasRouter);
router.use("/tasks", tasksRouter);
router.use("/assignments", assignmentsRouter);
router.use("/issues", issuesRouter);

export default router;
