import { Router, type IRouter } from "express";
import { getMunicipalitiesByUf, isValidUf, normalizeUf } from "../lib/ibge";

const router: IRouter = Router();

router.get("/ibge/ufs", (_req, res): void => {
  res.json([
    "AC",
    "AL",
    "AP",
    "AM",
    "BA",
    "CE",
    "DF",
    "ES",
    "GO",
    "MA",
    "MT",
    "MS",
    "MG",
    "PA",
    "PB",
    "PR",
    "PE",
    "PI",
    "RJ",
    "RN",
    "RS",
    "RO",
    "RR",
    "SC",
    "SP",
    "SE",
    "TO",
  ]);
});

router.get("/ibge/ufs/:uf/municipalities", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.uf) ? req.params.uf[0] : req.params.uf;
  const uf = normalizeUf(raw ?? "");

  if (!isValidUf(uf)) {
    res.status(400).json({ error: "UF inválida" });
    return;
  }

  try {
    const municipalities = await getMunicipalitiesByUf(uf);
    res.json(municipalities);
  } catch {
    res.status(503).json({ error: "Serviço do IBGE indisponível no momento" });
  }
});

export default router;

