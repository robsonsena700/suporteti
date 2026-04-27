import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const receiptPath = path.resolve(__dirname, "../../artifacts/suporte-ti/src/pages/ticket-receipt.tsx");
const mod = await import(pathToFileURL(receiptPath).href);

const { labelStatus, labelPriority, labelType } = mod as {
  labelStatus: (s: any) => string;
  labelPriority: (p: any) => string;
  labelType: (t: any, hardwareSubtype?: string | null) => string;
};

assert.equal(labelStatus("OPEN"), "Aberto");
assert.equal(labelStatus("IN_PROGRESS"), "Em Andamento");
assert.equal(labelStatus("AWAITING_CUSTOMER"), "Aguardando Cliente");
assert.equal(labelStatus("RESOLVED"), "Resolvido");
assert.equal(labelStatus("CLOSED"), "Cancelado");

assert.equal(labelPriority("LOW"), "Baixa");
assert.equal(labelPriority("MEDIUM"), "Média");
assert.equal(labelPriority("HIGH"), "Alta");

assert.equal(labelType("SOFTWARE"), "Software");
assert.equal(labelType("HARDWARE", null), "Hardware");
assert.equal(labelType("HARDWARE", "Impressora"), "Hardware • Impressora");

console.log("Teste unitário do comprovante de chamado concluído com sucesso.");
