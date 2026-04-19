import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction): void => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const code = (err as any)?.code;
  let message = "Erro interno do servidor";

  if (code === "42703" || code === "42P01") {
    message = "Banco desatualizado. Rode: pnpm --filter @workspace/db run push";
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: message });
});

export default app;
