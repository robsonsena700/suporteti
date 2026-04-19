import { Router, type IRouter } from "express";
import { db, chatMessagesTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, requireActive } from "../middlewares/auth";

const router: IRouter = Router();

const ALLOWED_ROLES = ["ADMIN", "COORDINATOR", "ANALYST"];

function requireChatAccess(req: any, res: any, next: any) {
  const role = req.user?.role;
  if (!ALLOWED_ROLES.includes(role)) {
    res.status(403).json({ error: "Acesso restrito a Administradores, Coordenadores e Analistas." });
    return;
  }
  next();
}

router.get("/chat/participants", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const participants = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    role: usersTable.role,
    uf: usersTable.uf,
    municipality: usersTable.municipality,
  })
  .from(usersTable)
  .where(
    inArray(usersTable.role, ["ADMIN", "COORDINATOR", "ANALYST"] as any[])
  );

  res.json(participants);
});

router.get("/chat/messages", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const rawLimit = req.query.limit as string | undefined;
  const limit = Math.min(parseInt(rawLimit || "100", 10) || 100, 200);

  const messages = await db.query.chatMessagesTable.findMany({
    with: { sender: true },
    orderBy: (m, { asc }) => [asc(m.createdAt)],
    limit,
  });

  res.json(
    messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      message: m.message,
      createdAt: m.createdAt,
      sender: {
        id: m.sender.id,
        name: m.sender.name,
        role: m.sender.role,
      },
    }))
  );
});

router.post("/chat/messages", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const user = req.user!;
  const { message } = req.body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "Mensagem invalida." });
    return;
  }

  if (message.length > 2000) {
    res.status(400).json({ error: "Mensagem muito longa (max 2000 caracteres)." });
    return;
  }

  const [msg] = await db
    .insert(chatMessagesTable)
    .values({ senderId: user.userId, message: message.trim() })
    .returning();

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, user.userId));

  res.status(201).json({
    id: msg.id,
    senderId: msg.senderId,
    message: msg.message,
    createdAt: msg.createdAt,
    sender: {
      id: sender.id,
      name: sender.name,
      role: sender.role,
    },
  });
});

export default router;
