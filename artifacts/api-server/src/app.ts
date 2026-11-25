import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";
import { requireHttpsInProduction } from "./middlewares/security";

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

// Antes essa checagem so existia numa rota especifica (admin trocar e-mail de
// usuario) - aplicada aqui pra toda a API, logo no inicio da cadeia. Em
// desenvolvimento (NODE_ENV != production) ela nao faz nada (ver middlewares/
// security.ts), entao nao atrapalha o dev local sem HTTPS.
//
// Exceto /api/healthz e /api/meta: esses dois sao batidos via HTTP puro,
// direto no loopback (http://127.0.0.1:3001/...), por start_prod.sh e pelo
// proprio deploy_prod.ps1, sem passar pelo reverse proxy (que e quem fala
// HTTPS com o mundo e manda x-forwarded-proto). Sem essa excecao, o
// healthcheck do deploy sempre recebia 403 (nunca "API_OK"), o script
// reiniciava a aplicacao repetidamente e o deploy acabava falhando mesmo com
// a aplicacao de pe e servindo trafego real normalmente.
app.use((req, res, next) => {
  if (req.path === "/api/healthz" || req.path === "/api/meta") {
    next();
    return;
  }
  requireHttpsInProduction(req, res, next);
});

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

// O Permissions-Policy nao e coberto pelo Helmet 8 (o middleware foi removido
// da biblioteca), por isso o cabecalho e setado aqui na mao. A aplicacao nao
// usa camera, microfone, geolocalizacao, MIDI, USB, pagamento, sensores de
// movimento nem captura de tela, entao essas diretivas sao negadas. Duas
// excecoes deliberadas:
// - clipboard-write=(self) e obrigatorio: o botao "copiar" (App.tsx) usa
//   navigator.clipboard.writeText e pararia de funcionar se fosse negado.
// - autoplay e fullscreen ficam de fora da lista para herdar o padrao do
//   navegador, evitando bloquear comportamentos legitimos do proprio site.
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    [
      "accelerometer=()",
      "camera=()",
      "display-capture=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "usb=()",
      "xr-spatial-tracking=()",
      "clipboard-write=(self)",
    ].join(", "),
  );
  next();
});

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

  // A mensagem que volta pro cliente e sempre generica, mesmo quando o erro e
  // um problema de esquema do banco desatualizado - isso e um detalhe interno
  // de infraestrutura (comando de deploy, nome de tabela/coluna) que nao deve
  // vazar pra quem esta do outro lado da API, autenticado ou nao. O diagnostico
  // (code 42703/42P01 = coluna/tabela inexistente) continua so no log do
  // servidor, que e onde isso realmente ajuda.
  const code = (err as any)?.code;
  if (code === "42703" || code === "42P01") {
    logger.error({ err }, "Unhandled error: banco de dados desatualizado (aplique as migrations em lib/db/migrations - local: node lib/db/scripts/apply_sql_file.cjs <arquivo.sql>, producao: scripts/remote/apply_sql_migrations.sh)");
  } else {
    logger.error({ err }, "Unhandled error");
  }
  res.status(500).json({ error: "Erro interno do servidor" });
});

export default app;
