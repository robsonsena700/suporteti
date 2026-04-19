import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import ticketsRouter from "./tickets";
import messagesRouter from "./messages";
import ratingsRouter from "./ratings";
import reportsRouter from "./reports";
import chatRouter from "./chat";
import directMessagesRouter from "./direct-messages";
import ticketAttachmentsRouter from "./ticket-attachments";
import ibgeRouter from "./ibge";
import establishmentsRouter from "./establishments";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(ticketsRouter);
router.use(ticketAttachmentsRouter);
router.use(messagesRouter);
router.use(ratingsRouter);
router.use(reportsRouter);
router.use(chatRouter);
router.use(directMessagesRouter);
router.use(ibgeRouter);
router.use(establishmentsRouter);

export default router;
