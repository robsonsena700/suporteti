import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import ticketsRouter from "./tickets";
import messagesRouter from "./messages";
import ratingsRouter from "./ratings";
import reportsRouter from "./reports";
import chatRouter from "./chat";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(ticketsRouter);
router.use(messagesRouter);
router.use(ratingsRouter);
router.use(reportsRouter);
router.use(chatRouter);

export default router;
