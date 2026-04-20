import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { RegisterBody, LoginBody } from "@workspace/api-zod";
import { signToken, requireAuth } from "../middlewares/auth";
import { isValidCpf, normalizeCpf } from "../lib/cpf";
import { isValidBrazilMobile, normalizePhoneE164Brazil } from "../lib/phone";
import { validateMunicipalityForUf } from "../lib/ibge";

const router: IRouter = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    name,
    email,
    password,
    uf,
    municipality,
    cpf,
    establishment,
    contactPhone,
    prefersWhatsapp,
    prefersTelegram,
    termsAccepted,
  } = parsed.data;

  if (!termsAccepted) {
    res.status(400).json({ error: "É necessário concordar com os Termos de Uso e a Política de Privacidade." });
    return;
  }

  if (!isValidCpf(cpf)) {
    res.status(400).json({ error: "CPF inválido" });
    return;
  }

  if (!isValidBrazilMobile(contactPhone)) {
    res.status(400).json({ error: "Contato inválido" });
    return;
  }

  try {
    const ok = await validateMunicipalityForUf(uf, municipality);
    if (!ok) {
      res.status(400).json({ error: "Município não pertence à UF informada" });
      return;
    }
  } catch {
    res.status(503).json({ error: "Serviço do IBGE indisponível no momento" });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "E-mail já cadastrado" });
    return;
  }

  const normalizedCpf = normalizeCpf(cpf);
  const [cpfExisting] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.cpf, normalizedCpf));
  if (cpfExisting) {
    res.status(409).json({ error: "CPF já cadastrado" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const normalizedPhone = normalizePhoneE164Brazil(contactPhone)!;
  const [user] = await db.insert(usersTable).values({
    name,
    email,
    passwordHash,
    cpf: normalizedCpf,
    establishment,
    contactPhone: normalizedPhone,
    prefersWhatsapp: Boolean(prefersWhatsapp),
    prefersTelegram: Boolean(prefersTelegram),
    termsAccepted: true,
    termsAcceptedAt: new Date(),
    uf,
    municipality,
    role: "USER",
    status: "PENDING",
  }).returning();

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    uf: user.uf,
    municipality: user.municipality,
  });

  res.status(201).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      cpf: user.cpf,
      establishment: user.establishment,
      contactPhone: user.contactPhone,
      prefersWhatsapp: user.prefersWhatsapp,
      prefersTelegram: user.prefersTelegram,
      termsAccepted: user.termsAccepted,
      termsAcceptedAt: user.termsAcceptedAt,
      birthDate: user.birthDate,
      uf: user.uf,
      municipality: user.municipality,
      createdAt: user.createdAt,
      mustChangePassword: user.mustChangePassword,
    },
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }

  const now = new Date();
  await db.update(usersTable).set({ lastLoginAt: now }).where(eq(usersTable.id, user.id));

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    uf: user.uf,
    municipality: user.municipality,
  });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      cpf: user.cpf,
      establishment: user.establishment,
      contactPhone: user.contactPhone,
      prefersWhatsapp: user.prefersWhatsapp,
      prefersTelegram: user.prefersTelegram,
      termsAccepted: user.termsAccepted,
      termsAcceptedAt: user.termsAcceptedAt,
      birthDate: user.birthDate,
      uf: user.uf,
      municipality: user.municipality,
      createdAt: user.createdAt,
      lastLoginAt: now,
      mustChangePassword: user.mustChangePassword,
    },
  });
});

router.post("/auth/logout", (_req, res): void => {
  res.json({ message: "Sessão encerrada" });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    cpf: user.cpf,
    establishment: user.establishment,
    contactPhone: user.contactPhone,
    prefersWhatsapp: user.prefersWhatsapp,
    prefersTelegram: user.prefersTelegram,
    termsAccepted: user.termsAccepted,
    termsAcceptedAt: user.termsAcceptedAt,
    birthDate: user.birthDate,
    uf: user.uf,
    municipality: user.municipality,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    mustChangePassword: user.mustChangePassword,
  });
});

router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const body = req.body as { currentPassword?: unknown; newPassword?: unknown } | undefined;
  const currentPassword = body?.currentPassword;
  const newPassword = body?.newPassword;
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    res.status(400).json({ error: "Informe a senha atual" });
    return;
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "A nova senha deve possuir no mínimo 8 caracteres" });
    return;
  }

  const userId = req.user!.userId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Senha atual inválida" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(usersTable)
    .set({ passwordHash, mustChangePassword: false })
    .where(eq(usersTable.id, userId));

  res.json({ message: "Senha atualizada com sucesso" });
});

export default router;
