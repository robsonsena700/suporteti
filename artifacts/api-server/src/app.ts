import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Em producao a aplicacao fica atras de um reverse proxy (que e quem fala
// HTTPS com o mundo e manda x-forwarded-proto/x-forwarded-for pra ca). Sem
// "trust proxy", o Express ignora esses cabecalhos e req.ip sempre retorna o
// IP do proxy (o mesmo para todo mundo) em vez do IP real de quem fez a
// requisicao - o que quebraria o rate limiting por IP (todo mundo cairia no
// mesmo "balde") e deixaria os logs de auditoria (security_audit_logs) com o
// IP errado. "1" confia em exatamente um salto (o proxy imediato), que e o
// cenario aqui - nunca usar `true` (confia em qualquer proxy, permitindo que
// o proprio cliente falsifique o IP via X-Forwarded-For).
app.set("trust proxy", 1);

// Cabecalhos de seguranca HTTP (CSP, HSTS, X-Content-Type-Options, remove
// X-Powered-By, etc). A CSP abaixo foi calibrada para esta SPA: ela nao usa
// <script> inline (o build do Vite carrega so modulos externos), mas usa
// estilos inline via `style={{...}}` do React, por isso 'unsafe-inline' fica
// liberado apenas em styleSrc, nunca em scriptSrc. cdn.jsdelivr.net e
// liberado em scriptSrc so porque a ferramenta de depuracao mobile (eruda,
// ativada manualmente com ?debug=1) carrega de la.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        // fonts.googleapis.com serve o CSS @font-face (src/index.css importa a
        // fonte Poppins de la); fonts.gstatic.com e quem serve o arquivo da
        // fonte em si, referenciado de dentro desse CSS - por isso precisa
        // tambem estar liberado em fontSrc, nao soh em styleSrc.
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        // api.qrserver.com gera o QR code exibido/impresso em ticket-receipt.tsx
        // (comprovante do chamado) - sem isso essa imagem some nessa tela.
        imgSrc: ["'self'", "data:", "blob:", "https://api.qrserver.com"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  }),
);

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
// CORS restrito a APP_PUBLIC_URL (mesma origem usada por requireSameOriginInProduction
// em middlewares/security.ts) em vez de refletir qualquer origem (cors() sem opcoes
// libera geral). credentials fica false de proposito: a autenticacao usa Bearer token
// no header Authorization, nao cookies, entao nao ha necessidade de liberar
// Access-Control-Allow-Credentials. Se APP_PUBLIC_URL nao estiver configurada ou for
// invalida, o CORS fica fechado (origin: false) em vez de abrir geral por omissao.
function resolveAllowedOrigin(): string | false {
  const raw = String(process.env.APP_PUBLIC_URL || "").trim();
  if (!raw) return false;
  try {
    return new URL(raw).origin;
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin: resolveAllowedOrigin(),
    credentials: false,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../../suporte-ti/dist/public");
app.use(express.static(publicDir, { index: false }));
app.get(/^(?!\/api).*/, (_req, res, next) => {
  res.sendFile(path.join(publicDir, "index.html"), (err) => {
    if (err) next(err);
  });
});

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
