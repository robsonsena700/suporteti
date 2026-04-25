import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/meta", (_req, res) => {
  res.json({
    name: "@workspace/api-server",
    version: process.env.npm_package_version ?? null,
    node: process.version,
    env: process.env.NODE_ENV ?? null,
    now: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
  });
});

export default router;
