import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { UpdateUserBody, ApproveUserBody } from "@workspace/api-zod";
import { requireAuth, requireActive, requireRoles } from "../middlewares/auth";
import { signToken } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/users", requireAuth, requireActive, requireRoles("ADMIN", "ANALYST"), async (req, res): Promise<void> => {
  const { status, role } = req.query as { status?: string; role?: string };

  let query = db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    status: usersTable.status,
    uf: usersTable.uf,
    municipality: usersTable.municipality,
    createdAt: usersTable.createdAt,
  }).from(usersTable);

  const conditions = [];
  if (status) conditions.push(eq(usersTable.status, status as any));
  if (role) conditions.push(eq(usersTable.role, role as any));

  const users = conditions.length > 0
    ? await query.where(and(...conditions))
    : await query;

  res.json(users);
});

router.get("/users/:id", requireAuth, requireActive, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [user] = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    status: usersTable.status,
    uf: usersTable.uf,
    municipality: usersTable.municipality,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(eq(usersTable.id, id));

  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  res.json(user);
});

router.patch("/users/:id", requireAuth, requireActive, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const currentUser = req.user!;
  if (currentUser.userId !== id && currentUser.role !== "ADMIN") {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.update(usersTable)
    .set(parsed.data)
    .where(eq(usersTable.id, id))
    .returning({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      uf: usersTable.uf,
      municipality: usersTable.municipality,
      createdAt: usersTable.createdAt,
    });

  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  res.json(user);
});

router.post("/users/:id/approve", requireAuth, requireActive, requireRoles("ADMIN"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const parsed = ApproveUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.update(usersTable)
    .set({ role: parsed.data.role as any, status: "ACTIVE" })
    .where(eq(usersTable.id, id))
    .returning({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      uf: usersTable.uf,
      municipality: usersTable.municipality,
      createdAt: usersTable.createdAt,
    });

  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  res.json(user);
});

export default router;
