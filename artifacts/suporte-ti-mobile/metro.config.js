const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Com pnpm, um pacote pode acabar instalado em mais de uma copia fisica
// dentro do virtual store (um hash por "contexto" de peer dependencies
// diferente). O @tanstack/react-query (e seu @tanstack/query-core interno)
// precisa ser singleton: se o App.tsx (QueryClientProvider) e os hooks
// gerados dentro de @workspace/api-client-react acabarem carregando copias
// fisicas diferentes, o React Context do QueryClient nao bate entre elas e
// cai o erro "No QueryClient set, use QueryClientProvider to set one".
// extraNodeModules nao resolveu (o Metro ignora esse mapa estatico pra
// pacotes com "exports" no package.json, que e o caso do react-query), entao
// forcamos via resolveRequest: toda importacao de @tanstack/react-query e
// resolvida como se partisse da raiz deste proprio app, nao de onde o pacote
// que importou (ex: dentro de @workspace/api-client-react) realmente esta.
// So @tanstack/react-query entra na lista: @tanstack/query-core NAO e
// dependencia direta deste app, so existe aninhado dentro da propria pasta
// privada do react-query (modelo estrito do pnpm). Forcar query-core a
// resolver a partir da raiz do projeto quebra essa resolucao aninhada (ela
// simplesmente nao existe hoisted na raiz) e da "Unable to resolve". Ao
// deixar so o react-query na lista, a MESMA copia (unica, forcada abaixo) e
// quem resolve seu proprio query-core internamente, do jeito normal.
const SINGLETON_MODULES = ["@tanstack/react-query"];
const projectAnchorFile = path.join(projectRoot, "package.json");
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (SINGLETON_MODULES.includes(moduleName)) {
    const resolveFn = defaultResolveRequest || context.resolveRequest;
    return resolveFn(
      { ...context, originModulePath: projectAnchorFile },
      moduleName,
      platform,
    );
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Suporte a monorepo (pnpm): o Metro precisa enxergar a raiz do workspace e
// resolver os symlinks que o pnpm usa para os pacotes @workspace/*
// (api-client-react, api-zod). Sem isso o bundler nao encontra esses pacotes.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// Importante: NAO desativar o lookup hierarquico (disableHierarchicalLookup).
// Com pnpm, varias dependencias ficam aninhadas dentro do node_modules de
// outro pacote (ex: expo-modules-core dentro de node_modules/expo/node_modules),
// e isso nao e coberto pelos caminhos explicitos de nodeModulesPaths abaixo.
// Sem a busca hierarquica o Metro nao encontra esses modulos (ex: falha ao
// resolver "@tanstack/query-core" de dentro de "@tanstack/react-query").
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
