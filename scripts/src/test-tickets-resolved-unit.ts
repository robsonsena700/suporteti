import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiPath = path.resolve(__dirname, "../../lib/api-client-react/src/generated/api.ts");
const mod = await import(pathToFileURL(apiPath).href);

const { getListTicketsUrl, getListResolvedTicketsUrl } = mod as {
  getListTicketsUrl: (params?: any) => string;
  getListResolvedTicketsUrl: (params?: any) => string;
};

assert.equal(getListTicketsUrl({}), "/api/tickets");
assert.equal(getListTicketsUrl({ mine: true }), "/api/tickets?mine=true");
assert.equal(getListResolvedTicketsUrl({}), "/api/tickets/resolved");
assert.equal(getListResolvedTicketsUrl({ mine: true }), "/api/tickets/resolved?mine=true");

console.log("Teste unitário de URLs dos endpoints de chamados resolvidos concluído com sucesso.");
