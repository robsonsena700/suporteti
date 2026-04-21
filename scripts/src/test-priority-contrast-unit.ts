import assert from "node:assert/strict";

type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const v = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(v)) throw new Error(`hex inválido: ${hex}`);
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function srgbToLinear(x: number): number {
  const v = x / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: RGB): number {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: RGB, b: RGB): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const palette = {
  "priority-low": { bg: "#2BD1AB", fg: "#0b1220" },
  "priority-medium": { bg: "#FCBB36", fg: "#0b1220" },
  "priority-high": { bg: "#FF6C6C", fg: "#0b1220" },
  "priority-critical": { bg: "#1b0a0a", fg: "#f8fafc" },
} as const;

for (const [name, c] of Object.entries(palette)) {
  const ratio = contrastRatio(hexToRgb(c.bg), hexToRgb(c.fg));
  assert.ok(
    ratio >= 4.5,
    `${name} falhou contraste AA: ${ratio.toFixed(2)} (< 4.5)`,
  );
}

console.log("Teste de contraste (WCAG AA) das cores de prioridade concluído com sucesso.");
