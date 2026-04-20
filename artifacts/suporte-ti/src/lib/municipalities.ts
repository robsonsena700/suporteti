import { customFetch } from "@workspace/api-client-react/custom-fetch";

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

type CachedMunicipalities = {
  municipalities: string[];
  updatedAt: number;
};

const CACHE_KEY = "municipalities_by_uf_v1";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const memoryCache = new Map<string, CachedMunicipalities>();

function readStorageCache(): Record<string, CachedMunicipalities> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CachedMunicipalities>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStorageCache(data: Record<string, CachedMunicipalities>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage failures (private mode/quota).
  }
}

function isFresh(entry: CachedMunicipalities | undefined): entry is CachedMunicipalities {
  if (!entry) return false;
  return Date.now() - entry.updatedAt <= CACHE_TTL_MS;
}

export function getCachedMunicipalities(uf: string): string[] {
  const normalizedUf = uf.trim().toUpperCase();
  const mem = memoryCache.get(normalizedUf);
  if (isFresh(mem)) return mem.municipalities;

  const storage = readStorageCache();
  const fromStorage = storage[normalizedUf];
  if (isFresh(fromStorage)) {
    memoryCache.set(normalizedUf, fromStorage);
    return fromStorage.municipalities;
  }
  return [];
}

export async function fetchMunicipalitiesByUf(uf: string): Promise<string[]> {
  const normalizedUf = uf.trim().toUpperCase();
  const data = await customFetch<string[]>(`/api/ibge/ufs/${encodeURIComponent(normalizedUf)}/municipalities`);
  const municipalities = Array.isArray(data) ? data : [];

  const entry: CachedMunicipalities = {
    municipalities,
    updatedAt: Date.now(),
  };
  memoryCache.set(normalizedUf, entry);
  const storage = readStorageCache();
  storage[normalizedUf] = entry;
  writeStorageCache(storage);
  return municipalities;
}

