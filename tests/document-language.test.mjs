import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("the root document remains Portuguese from Portugal", async () => {
  const layoutPath = fileURLToPath(new URL("../src/app/layout.tsx", import.meta.url));
  const layout = await readFile(layoutPath, "utf8");
  assert.match(layout, /<html\s+[\s\S]*\blang=["']pt-PT["']/);
});

// Words that end like a gerund but are nouns or adverbs in European Portuguese.
const GERUND_LOOKALIKES = new Set([
  "brando", "comando", "comandos", "fundo", "fundos", "lindo", "mundo", "quando", "segundo", "segundos",
]);

// Common Brazilian forms and false friends that slip into PT-PT interface copy.
// Lookarounds on \p{L} instead of \b: \b treats accented letters as word breaks.
const BRAZILIAN_FORMS = [
  /(?<!\p{L})(?:vocês?)(?!\p{L})/iu,
  /(?<!\p{L})(?:usuári[oa]s?)(?!\p{L})/iu,
  /(?<!\p{L})(?:telas?)(?!\p{L})/iu,
  /(?<!\p{L})(?:arquivos?)(?!\p{L})/iu,
  /(?<!\p{L})(?:celular(?:es)?)(?!\p{L})/iu,
  /(?<!\p{L})(?:registr(?:o|os|ar|ado|ada))(?!\p{L})/iu,
  /(?<!\p{L})(?:contato)(?!\p{L})/iu,
  /(?<!\p{L})(?:fatos?)(?!\p{L})/iu,
  /(?<!\p{L})(?:equipe)(?!\p{L})/iu,
  /(?<!\p{L})(?:planej\p{L}*)(?!\p{L})/iu,
  /(?<!\p{L})(?:seção)(?!\p{L})/iu,
  /(?<!\p{L})(?:cadastr\p{L}*)(?!\p{L})/iu,
  /(?<!\p{L})(?:econ[ôo]mic\p{L}*)(?!\p{L})/iu,
  /(?<!\p{L})(?:câmera)(?!\p{L})/iu,
  /(?<!\p{L})(?:detalhamento)(?!\p{L})/iu,
];

const PORTUGUESE_COPY_FILES = ["../src/lib/i18n/pt.ts", "../src/lib/legal/pt.ts"];

async function readPortugueseStrings(relativePath) {
  const source = await readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  // Only quoted and template-literal copy is checked: identifiers and comments
  // may stay in English.
  return [...source.matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((match) => match[1] ?? match[2]);
}

test("Portuguese interface and legal copy avoid gerunds", async () => {
  for (const file of PORTUGUESE_COPY_FILES) {
    for (const text of await readPortugueseStrings(file)) {
      if (/^https?:\/\//.test(text)) continue;
      for (const [word] of text.matchAll(/(?<!\p{L})\p{L}+(?:ando|endo|indo)(?!\p{L})/giu)) {
        assert.ok(GERUND_LOOKALIKES.has(word.toLowerCase()), `${file}: gerund "${word}" in "${text}"`);
      }
    }
  }
});

test("Portuguese interface and legal copy avoid Brazilian forms", async () => {
  for (const file of PORTUGUESE_COPY_FILES) {
    for (const text of await readPortugueseStrings(file)) {
      if (/^https?:\/\//.test(text)) continue;
      for (const pattern of BRAZILIAN_FORMS) {
        assert.doesNotMatch(text, pattern, `${file}: Brazilian form in "${text}"`);
      }
    }
  }
});

test("the root document tolerates theme attributes applied before hydration", async () => {
  const layoutPath = fileURLToPath(new URL("../src/app/layout.tsx", import.meta.url));
  const layout = await readFile(layoutPath, "utf8");
  const rootHtmlTag = layout.match(/<html\b[\s\S]*?>/)?.[0];

  assert.ok(rootHtmlTag, "expected the root layout to render an html element");
  assert.match(rootHtmlTag, /\bsuppressHydrationWarning\b/);
});
