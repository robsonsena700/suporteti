// scripts/validar-secrets-tarefas-do-dia.mjs
//
// Verifica 7 variáveis do painel de secrets (SUPORTETI_*):
//   T1 Conexão PostgreSQL, T2 JWT round-trip, T3 SMTP handshake,
//   T5 bcrypt compat. (T4 envio email é opcional via flag --send)
//
// NÃO LOGA VALORES SENSÍVEIS — só valida formato/funcionamento.
//
// USO:
//   SUPORTETI_DATABASE_URL=... SUPORTETI_SESSION_SECRET=... \
//   SUPORTETI_SMTP_HOST=... SUPORTETI_SMTP_PORT=587 \
//   SUPORTETI_SMTP_USER=... SUPORTETI_SMTP_PASS=... \
//   SUPORTETI_SMTP_FROM="Tarefas <n@d.com>" \
//   node ./scripts/validar-secrets-tarefas-do-dia.mjs [--send]

import { Pool } from "pg";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import bcrypt from "bcryptjs";

const REQ = [
  "SUPORTETI_DATABASE_URL",
  "SUPORTETI_SESSION_SECRET",
  "SUPORTETI_SMTP_HOST",
  "SUPORTETI_SMTP_PORT",
  "SUPORTETI_SMTP_USER",
  "SUPORTETI_SMTP_PASS",
  "SUPORTETI_SMTP_FROM",
];

const results = new Map();
const startedAt = new Date();

function mark(name, ok, detail = "") {
  results.set(name, { ok: ok ? "PASS" : "FAIL", detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}: ${ok ? "PASS" : "FAIL"}${detail ? `  (${detail})` : ""}`);
}

function hasAllEnv() {
  const missing = REQ.filter((v) => !process.env[v]);
  if (missing.length) {
    console.error("Variáveis obrigatórias ausentes:", missing.join(", "));
    process.exit(2);
  }
}

// ── Validações de formato (A.3) + checks específicos Sotech ──────────────────
function validarFormatos() {
  console.log("\n📋 VALIDAÇÃO DE FORMATO (A.3)\n");
  // ▬▬▬ CHECKS ESPECÍFICOS DO AMBIENTE SOTECHSAUDE (produção) ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
  // 1. SMTP_HOST: deve ser smtp.sotechsaude.com.br (COM .br)
  const host = process.env.SUPORTETI_SMTP_HOST;
  if (host === "smtp.sotechsaude.com") {
    mark("CHK_SMTP_DOMINIO_BR", false, "domínio incorreto: faltou '.br' no final → usar smtp.sotechsaude.com.br");
  } else if (!host.endsWith(".com.br")) {
    mark("CHK_SMTP_DOMINIO_BR", false, `SMTP_HOST '${host}' não termina com .com.br — esperado smtp.sotechsaude.com.br`);
  } else {
    mark("CHK_SMTP_DOMINIO_BR", true);
  }

  // 2. SMTP_USER: deve ser @sotechsaude.com.br
  const smtpUser = process.env.SUPORTETI_SMTP_USER;
  if (!smtpUser.endsWith("@sotechsaude.com.br")) {
    mark("CHK_SMTP_USUARIO_DOMINIO", false, "SMTP_USER não é caixa @sotechsaude.com.br");
  } else {
    mark("CHK_SMTP_USUARIO_DOMINIO", true);
  }

  // 3. DATABASE_URL: usuário = suporte_app, porta = 5446
  let pgUser = "";
  let pgPort = "";
  try {
    const u = new URL(process.env.SUPORTETI_DATABASE_URL);
    pgUser = u.username;
    pgPort = u.port;
    if (pgUser === "postgres") {
      mark("CHK_PG_USUARIO_SUPORTE_APP", false, "PG user='postgres' — trocar por 'suporte_app' (owner real do banco suporteti)");
    } else if (pgUser === "suporte_app") {
      mark("CHK_PG_USUARIO_SUPORTE_APP", true);
    } else {
      mark("CHK_PG_USUARIO_SUPORTE_APP", true, `usuário PG '${pgUser}' (não padrão — confirmar se tem grants)`);
    }

    if (pgPort !== "5446") {
      mark("CHK_PG_PORTA_5446", false, `PG porta='${pgPort || "(vazia)"}' — esperado 5446 (VPS Sotech)`);
    } else {
      mark("CHK_PG_PORTA_5446", true);
    }

    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      mark("CHK_PG_HOST_PUBLICO", false, "host=localhost — usar IP/hostname público do VPS em PRODUÇÃO");
    } else {
      mark("CHK_PG_HOST_PUBLICO", true);
    }
  } catch {
    mark("CHK_PG_USUARIO_SUPORTE_APP", false, "URL PostgreSQL inválida");
    mark("CHK_PG_PORTA_5446", false, "URL PostgreSQL inválida");
    mark("CHK_PG_HOST_PUBLICO", false, "URL PostgreSQL inválida");
  }

  // 4. Session secret: NÃO usar valores fracos conhecidos
  const s = process.env.SUPORTETI_SESSION_SECRET;
  const fracos = new Set([
    "change-me", "change-me-123", "segredo", "supersecret",
    "secret", "teste", "senha123", "abc123", "123456789",
  ]);
  if (fracos.has(s.toLowerCase()) || fracos.has(s)) {
    mark("CHK_JWT_SEGREDO_FORTE", false, "SESSION_SECRET fraco conhecido — usar o mesmo do SuporteTI existente");
  } else if (s.length < 32) {
    mark("CHK_JWT_SEGREDO_FORTE", true, `curto (${s.length} chars < 32 recomendado) — usar o do SuporteTI`);
  } else {
    mark("CHK_JWT_SEGREDO_FORTE", true);
  }

  // ▬▬▬ VALIDAÇÕES GENÉRICAS DE FORMATO ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
  // Database URL
  try {
    const u = new URL(process.env.SUPORTETI_DATABASE_URL);
    const ok = u.protocol === "postgresql:" || u.protocol === "postgres:";
    mark("FORMATO_DATABASE_URL", ok);
  } catch {
    mark("FORMATO_DATABASE_URL", false, "URL inválida");
  }
  // Session secret
  mark("FORMATO_SESSION_SECRET", s.length >= 16 && s !== "change-me",
    s.length < 16 ? `len=${s.length} < 16` : "");
  // SMTP host
  const hostOk = /^(?=.{1,253}$)(^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$)$/.test(host);
  mark("FORMATO_SMTP_HOST", hostOk, hostOk ? "" : "hostname DNS inválido");
  // SMTP port
  const port = Number(process.env.SUPORTETI_SMTP_PORT);
  mark("FORMATO_SMTP_PORT", Number.isInteger(port) && port > 0 && port < 65536,
    !Number.isInteger(port) ? `não inteiro` : "");
  // SMTP user
  mark("FORMATO_SMTP_USER", smtpUser.length >= 3 && smtpUser.length <= 64);
  // SMTP pass
  const pass = process.env.SUPORTETI_SMTP_PASS;
  mark("FORMATO_SMTP_PASS", pass.length >= 8, pass.length < 8 ? `len=${pass.length} < 8` : "");
  // SMTP from
  const from = process.env.SUPORTETI_SMTP_FROM;
  mark("FORMATO_SMTP_FROM", /.+@.+\..+/.test(from), "sem email válido em FROM");
}

// ── T1. Conexão PostgreSQL ──────────────────────────────────────────────────
async function t1ConexaoPG() {
  console.log("\n🔌 T1. CONEXÃO POSTGRESQL");
  const pool = new Pool({
    connectionString: process.env.SUPORTETI_DATABASE_URL,
    connectionTimeoutMillis: 8000,
  });
  try {
    const r1 = await pool.query("SELECT 1 AS ok");
    const r2 = await pool.query("SELECT count(*)::int AS n FROM users");
    const n = Number(r2.rows[0].n);
    mark("T1_CONEXAO_PG", r1.rows[0].ok === 1 && Number.isFinite(n), `users_count=${n}`);
  } catch (e) {
    mark("T1_CONEXAO_PG", false, e.code || String(e.message).slice(0, 80));
  } finally {
    await pool.end().catch(() => {});
  }
}

// ── T2. JWT round-trip ─────────────────────────────────────────────────────
async function t2Jwt() {
  console.log("\n🔐 T2. JWT ROUND-TRIP");
  try {
    const payload = {
      userId: 1,
      email: "teste@local",
      role: "USER",
      status: "ACTIVE",
      uf: "DF",
      municipality: "Brasilia",
    };
    const token = jwt.sign(payload, process.env.SUPORTETI_SESSION_SECRET, { expiresIn: "1h" });
    const decoded = jwt.verify(token, process.env.SUPORTETI_SESSION_SECRET);
    const ok = decoded.userId === payload.userId && decoded.email === payload.email;
    mark("T2_JWT", ok);
  } catch (e) {
    mark("T2_JWT", false, e.message?.slice(0, 80) || "");
  }
}

// ── T3. SMTP handshake ─────────────────────────────────────────────────────
async function t3SmtpHandshake() {
  console.log("\n✉️  T3. SMTP HANDSHAKE");
  const host = process.env.SUPORTETI_SMTP_HOST;
  const port = Number(process.env.SUPORTETI_SMTP_PORT);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SUPORTETI_SMTP_USER,
      pass: process.env.SUPORTETI_SMTP_PASS,
    },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
  });
  try {
    const ok = await transporter.verify();
    mark("T3_SMTP_HANDSHAKE", ok === true);
  } catch (e) {
    mark("T3_SMTP_HANDSHAKE", false, e.message?.slice(0, 100) || String(e).slice(0, 100));
  } finally {
    transporter.close?.();
  }
}

// ── T4. Envio de e-mail (opcional: --send) ─────────────────────────────────
async function t4EnvioEmail(destinatario) {
  if (!destinatario) return;
  console.log("\n📮 T4. ENVIO DE E-MAIL (opcional)");
  const host = process.env.SUPORTETI_SMTP_HOST;
  const port = Number(process.env.SUPORTETI_SMTP_PORT);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SUPORTETI_SMTP_USER,
      pass: process.env.SUPORTETI_SMTP_PASS,
    },
  });
  try {
    const info = await transporter.sendMail({
      from: process.env.SUPORTETI_SMTP_FROM,
      to: destinatario,
      subject: "[Teste] Tarefas do Dia — Verificação SMTP",
      text: `E-mail de validação do sistema Tarefas do Dia.\nEnvio: ${new Date().toISOString()}`,
    });
    mark("T4_SMTP_ENVIO", Boolean(info.messageId), `msgId=${String(info.messageId).slice(0, 40)}`);
  } catch (e) {
    mark("T4_SMTP_ENVIO", false, e.message?.slice(0, 100) || "");
  } finally {
    transporter.close?.();
  }
}

// ── T5. bcrypt compatibilidade ─────────────────────────────────────────────
async function t5BcryptCompat() {
  console.log("\n🧂 T5. BCRYPT COMPATIBILIDADE");
  try {
    const hashAtual = await bcrypt.hash("senha_teste_valida", 10);
    if (!hashAtual.startsWith("$2a$") && !hashAtual.startsWith("$2b$")) {
      mark("T5_BCRYPT", false, "prefixo do hash não bcrypt");
      return;
    }
    const comparaOk = await bcrypt.compare("senha_teste_valida", hashAtual);
    const comparaFalha = await bcrypt.compare("errada", hashAtual);
    mark("T5_BCRYPT", comparaOk === true && comparaFalha === false);
  } catch (e) {
    mark("T5_BCRYPT", false, e.message?.slice(0, 80) || "");
  }
}

// ── Relatório final ────────────────────────────────────────────────────────
function relatorio() {
  const totalKeys = Array.from(results.keys());
  const pass = totalKeys.filter((k) => results.get(k).ok === "PASS").length;
  const fail = totalKeys.filter((k) => results.get(k).ok === "FAIL").length;
  const geral = fail === 0 ? "APROVADO ✅" : "REPROVADO ❌";
  const dur = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);

  console.log("\n" + "─".repeat(50));
  console.log("┌───────────────────────────────────────────────┐");
  console.log("│       RELATÓRIO DE VALIDAÇÃO — D+0            │");
  console.log("├───────────────────────────────────────────────┤");
  for (const k of totalKeys) {
    const r = results.get(k);
    const icon = r.ok === "PASS" ? "✅" : "❌";
    const label = k.padEnd(22, " ");
    console.log(`│ ${icon} ${label}  ${r.ok.padStart(6)}   │`);
    if (r.detail) {
      console.log(`│      ↳ ${String(r.detail).slice(0, 40).padEnd(40)} │`);
    }
  }
  console.log("├───────────────────────────────────────────────┤");
  console.log(`│ PASS: ${String(pass).padStart(2)}   FAIL: ${String(fail).padStart(2)}   Tempo: ${dur}s        │`);
  console.log("├───────────────────────────────────────────────┤");
  console.log(`│ STATUS GERAL:  ${geral.padEnd(32)} │`);
  console.log("└───────────────────────────────────────────────┘\n");
  process.exit(fail === 0 ? 0 : 1);
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  hasAllEnv();
  const sendIdx = process.argv.indexOf("--send");
  const sendTo = sendIdx >= 0 ? process.argv[sendIdx + 1] : null;
  const bcryptIdx = process.argv.indexOf("--bcrypt-db");
  const bcryptRowId = bcryptIdx >= 0 ? Number(process.argv[bcryptIdx + 1]) : null;

  validarFormatos();
  await t1ConexaoPG();
  await t2Jwt();
  await t3SmtpHandshake();
  await t4EnvioEmail(sendTo);
  await t5BcryptCompat();

  // T5 extra: rodar bcrypt.compare com um hash REAL do banco (se rowid fornecido)
  if (bcryptRowId) {
    console.log("\n🧂 T5b. BCRYPT HASH REAL DO BANCO (usuário id=" + bcryptRowId + ")");
    const pool = new Pool({
      connectionString: process.env.SUPORTETI_DATABASE_URL,
      connectionTimeoutMillis: 8000,
    });
    try {
      const r = await pool.query(
        "SELECT password_hash FROM users WHERE id = $1 LIMIT 1",
        [bcryptRowId],
      );
      if (r.rows.length === 0) {
        mark("T5b_BCRYPT_DB", false, "usuário não encontrado");
      } else {
        const hash = r.rows[0].password_hash;
        // valida apenas o formato (não temos senha real para testar)
        const pareceBcrypt = typeof hash === "string" &&
          (hash.startsWith("$2a$10$") || hash.startsWith("$2b$10$") ||
            hash.startsWith("$2y$10$"));
        if (pareceBcrypt) {
          // teste semântico: comparação NÃO deve lançar
          await bcrypt.compare("xxxxx", hash);
          mark("T5b_BCRYPT_DB", true, "formato bcrypt rounds=10");
        } else {
          mark("T5b_BCRYPT_DB", false, "hash não é bcrypt 10");
        }
      }
    } catch (e) {
      mark("T5b_BCRYPT_DB", false, e.message?.slice(0, 80) || "");
    } finally {
      await pool.end().catch(() => {});
    }
  }

  relatorio();
}

main().catch((e) => {
  console.error("FALHA FATAL:", e);
  process.exit(99);
});
