type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 12;

const municipalitiesCache = new Map<string, CacheEntry<string[]>>();

export function normalizeUf(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidUf(value: string): boolean {
  return /^[A-Z]{2}$/.test(normalizeUf(value));
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`IBGE request failed: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export async function getMunicipalitiesByUf(
  uf: string,
  ttlMs = DEFAULT_TTL_MS,
): Promise<string[]> {
  const normalizedUf = normalizeUf(uf);
  const now = Date.now();

  const cached = municipalitiesCache.get(normalizedUf);
  if (cached && cached.expiresAt > now) return cached.value;

  const url = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(normalizedUf)}/municipios`;
  try {
    const data = await fetchJson<Array<{ nome: string }>>(url);
    const names = data
      .map((m) => m.nome)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "pt-BR"));

    municipalitiesCache.set(normalizedUf, { value: names, expiresAt: now + ttlMs });
    return names;
  } catch {
    if (cached?.value?.length) return cached.value;
    throw new Error("IBGE request failed");
  }
}

export async function validateMunicipalityForUf(
  uf: string,
  municipality: string,
): Promise<boolean> {
  const normalizedUf = normalizeUf(uf);
  const muni = municipality.trim();
  if (!isValidUf(normalizedUf) || muni.length < 2) return false;

  const municipalities = await getMunicipalitiesByUf(normalizedUf);
  return municipalities.includes(muni);
}
