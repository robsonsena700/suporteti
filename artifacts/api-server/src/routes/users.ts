import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { UpdateUserBody, ApproveUserBody } from "@workspace/api-zod";
import { requireAuth, requireActive, requireRoles } from "../middlewares/auth";
import { signToken } from "../middlewares/auth";
import { isValidCpf, normalizeCpf } from "../lib/cpf";
import { isValidBrazilMobile, normalizePhoneE164Brazil } from "../lib/phone";
import { validateMunicipalityForUf } from "../lib/ibge";

const router: IRouter = Router();

router.get("/users", requireAuth, requireActive, requireRoles("ADMIN", "ANALYST"), async (req, res): Promise<void> => {
  const { status, role } = req.query as { status?: string; role?: string };

  let query = db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    status: usersTable.status,
    cpf: usersTable.cpf,
    establishment: usersTable.establishment,
    contactPhone: usersTable.contactPhone,
    prefersWhatsapp: usersTable.prefersWhatsapp,
    prefersTelegram: usersTable.prefersTelegram,
    termsAccepted: usersTable.termsAccepted,
    termsAcceptedAt: usersTable.termsAcceptedAt,
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
    cpf: usersTable.cpf,
    establishment: usersTable.establishment,
    contactPhone: usersTable.contactPhone,
    prefersWhatsapp: usersTable.prefersWhatsapp,
    prefersTelegram: usersTable.prefersTelegram,
    termsAccepted: usersTable.termsAccepted,
    termsAcceptedAt: usersTable.termsAcceptedAt,
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

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  const isSelfUpdate = currentUser.userId === id;
  const nextCpf = parsed.data.cpf ?? existing.cpf ?? "";
  const nextEstablishment = parsed.data.establishment ?? existing.establishment ?? "";
  const nextContactPhone = parsed.data.contactPhone ?? existing.contactPhone ?? "";
  const nextUf = parsed.data.uf ?? existing.uf;
  const nextMunicipality = parsed.data.municipality ?? existing.municipality;

  if (isSelfUpdate) {
    if (!nextCpf || !isValidCpf(nextCpf)) {
      res.status(400).json({ error: "CPF inválido" });
      return;
    }
    if (!nextEstablishment || nextEstablishment.trim().length < 2) {
      res.status(400).json({ error: "Estabelecimento/Unidade de Saúde é obrigatório" });
      return;
    }
    if (!nextContactPhone || !isValidBrazilMobile(nextContactPhone)) {
      res.status(400).json({ error: "Contato inválido" });
      return;
    }
  } else {
    if (parsed.data.cpf && !isValidCpf(parsed.data.cpf)) {
      res.status(400).json({ error: "CPF inválido" });
      return;
    }
    if (parsed.data.contactPhone && !isValidBrazilMobile(parsed.data.contactPhone)) {
      res.status(400).json({ error: "Contato inválido" });
      return;
    }
  }

  if ((parsed.data.uf || parsed.data.municipality) && nextUf && nextMunicipality) {
    try {
      const ok = await validateMunicipalityForUf(nextUf, nextMunicipality);
      if (!ok) {
        res.status(400).json({ error: "Município não pertence à UF informada" });
        return;
      }
    } catch {
      res.status(503).json({ error: "Serviço do IBGE indisponível no momento" });
      return;
    }
  }

  const patch: Record<string, unknown> = { ...parsed.data };

  if (parsed.data.cpf) {
    const normalizedCpf = normalizeCpf(parsed.data.cpf);
    const [cpfExisting] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.cpf, normalizedCpf));
    if (cpfExisting && cpfExisting.id !== id) {
      res.status(409).json({ error: "CPF já cadastrado" });
      return;
    }
    patch.cpf = normalizedCpf;
  }

  if (parsed.data.contactPhone) {
    patch.contactPhone = normalizePhoneE164Brazil(parsed.data.contactPhone);
  }

  const [user] = await db.update(usersTable)
    .set(patch as any)
    .where(eq(usersTable.id, id))
    .returning({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      cpf: usersTable.cpf,
      establishment: usersTable.establishment,
      contactPhone: usersTable.contactPhone,
      prefersWhatsapp: usersTable.prefersWhatsapp,
      prefersTelegram: usersTable.prefersTelegram,
      termsAccepted: usersTable.termsAccepted,
      termsAcceptedAt: usersTable.termsAcceptedAt,
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
      cpf: usersTable.cpf,
      establishment: usersTable.establishment,
      contactPhone: usersTable.contactPhone,
      prefersWhatsapp: usersTable.prefersWhatsapp,
      prefersTelegram: usersTable.prefersTelegram,
      termsAccepted: usersTable.termsAccepted,
      termsAcceptedAt: usersTable.termsAcceptedAt,
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
