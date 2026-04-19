import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { requireAuth, requireActive } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/establishments", requireAuth, requireActive, async (req, res): Promise<void> => {
  const rawQuery = req.query.query;
  const query = (typeof rawQuery === "string" ? rawQuery : "").trim().toLowerCase();

  const rows = await db.select({ establishment: usersTable.establishment }).from(usersTable);
  const items = rows
    .map(r => r.establishment)
    .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
    .map(e => e.trim());

  const unique = Array.from(new Set(items));
  const filtered = query.length > 0
    ? unique.filter(e => e.toLowerCase().includes(query))
    : unique;

  filtered.sort((a, b) => a.localeCompare(b, "pt-BR"));
  res.json(filtered);
});

export default router;

