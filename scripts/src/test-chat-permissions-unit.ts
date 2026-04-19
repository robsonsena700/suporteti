import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const permissionsPath = path.resolve(__dirname, "../../artifacts/api-server/src/lib/chat-permissions.ts");
const permissions = await import(pathToFileURL(permissionsPath).href);

const { hasChatModuleAccess, hasFullChatAccess, canCoordinatorAccessTargetRole } = permissions as {
  hasChatModuleAccess: (role: string) => boolean;
  hasFullChatAccess: (role: string) => boolean;
  canCoordinatorAccessTargetRole: (role: string) => boolean;
};

assert.equal(hasChatModuleAccess("ADMIN"), true, "ADMIN deve acessar o módulo de chat");
assert.equal(hasChatModuleAccess("ANALYST"), true, "ANALYST deve acessar o módulo de chat");
assert.equal(hasChatModuleAccess("COORDINATOR"), true, "COORDINATOR deve acessar o módulo de chat");
assert.equal(hasChatModuleAccess("USER"), false, "USER não deve acessar o módulo de chat");

assert.equal(hasFullChatAccess("ADMIN"), true, "ADMIN deve ter acesso total ao chat");
assert.equal(hasFullChatAccess("ANALYST"), true, "ANALYST deve ter acesso total ao chat");
assert.equal(hasFullChatAccess("COORDINATOR"), false, "COORDINATOR não deve ter acesso total ao chat");

assert.equal(canCoordinatorAccessTargetRole("ANALYST"), true, "Coordenador deve acessar ANALYST");
assert.equal(canCoordinatorAccessTargetRole("ADMIN"), true, "Coordenador deve acessar ADMIN");
assert.equal(canCoordinatorAccessTargetRole("COORDINATOR"), false, "Coordenador não deve acessar COORDINATOR");
assert.equal(canCoordinatorAccessTargetRole("USER"), false, "Coordenador não deve acessar USER");

console.log("Teste unitário de permissões do chat concluído com sucesso.");
