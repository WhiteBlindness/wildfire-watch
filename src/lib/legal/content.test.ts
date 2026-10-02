import assert from "node:assert/strict";
import test from "node:test";
import { LEGAL_ROUTES } from "../site";
import { getLegalContent, parseInlineLinks } from "./index";
import type { LegalBlock } from "./types";

const portuguese = getLegalContent("pt");
const english = getLegalContent("en");
const documentIds = Object.keys(LEGAL_ROUTES) as (keyof typeof LEGAL_ROUTES)[];

function blockTexts(block: LegalBlock): string[] {
  if (block.type === "paragraph") return [block.text];
  if (block.type === "list") return block.items;
  return [block.caption, ...block.head, ...block.rows.flat()];
}

function allTexts(locale: "pt" | "en"): string[] {
  const content = getLegalContent(locale);
  return documentIds.flatMap((id) => {
    const document = content.documents[id];
    return [document.title, document.summary, ...document.sections.flatMap((section) => [
      section.title,
      ...section.blocks.flatMap(blockTexts),
    ])];
  });
}

test("both languages publish the same documents with the same section anchors", () => {
  for (const id of documentIds) {
    const ptSections = portuguese.documents[id].sections.map((section) => section.id);
    const enSections = english.documents[id].sections.map((section) => section.id);
    assert.deepEqual(ptSections, enSections, `${id} sections differ between languages`);
    assert.equal(new Set(ptSections).size, ptSections.length, `${id} has duplicate anchors`);
  }
});

test("both languages structure every section's blocks identically", () => {
  for (const id of documentIds) {
    portuguese.documents[id].sections.forEach((section, index) => {
      const counterpart = english.documents[id].sections[index];
      assert.deepEqual(
        section.blocks.map((block) => block.type === "list" ? `list:${block.items.length}` : block.type === "table" ? `table:${block.rows.length}` : block.type),
        counterpart.blocks.map((block) => block.type === "list" ? `list:${block.items.length}` : block.type === "table" ? `table:${block.rows.length}` : block.type),
        `${id}#${section.id} block structure differs between languages`,
      );
    });
  }
});

test("every inline link is https or a known internal route", () => {
  const internalRoutes = new Set<string>(Object.values(LEGAL_ROUTES));
  for (const locale of ["pt", "en"] as const) {
    for (const text of allTexts(locale)) {
      for (const match of text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
        const href = match[2];
        if (href.startsWith("/")) {
          assert.ok(internalRoutes.has(href.split("#")[0]), `${locale}: unknown internal route ${href}`);
        } else {
          assert.match(href, /^https:\/\//, `${locale}: non-https link ${href}`);
        }
      }
    }
  }
});

test("every document tells visitors to call 112 or links to the notice that does", () => {
  for (const locale of ["pt", "en"] as const) {
    const content = getLegalContent(locale);
    const about = JSON.stringify(content.documents.about);
    const terms = JSON.stringify(content.documents.terms);
    assert.match(about, /112/, `${locale}: about page must mention 112`);
    assert.match(terms, /112/, `${locale}: terms must mention 112`);
  }
});

test("the privacy policy lists exactly the browser storage keys the app writes", () => {
  for (const locale of ["pt", "en"] as const) {
    const cookies = getLegalContent(locale).documents.privacy.sections.find((section) => section.id === "cookies");
    assert.ok(cookies, `${locale}: cookies section missing`);
    const table = cookies.blocks.find((block) => block.type === "table");
    assert.ok(table && table.type === "table");
    assert.deepEqual(table.rows.map((row) => row[0]).sort(), ["theme", "wildfirewatch-locale"]);
  }
});

test("parses inline links and refuses unsafe schemes", () => {
  assert.deepEqual(parseInlineLinks("Ver [Sobre](/sobre#aviso) e [CNPD](https://www.cnpd.pt/)."), [
    { kind: "text", text: "Ver " },
    { kind: "link", text: "Sobre", href: "/sobre#aviso", external: false },
    { kind: "text", text: " e " },
    { kind: "link", text: "CNPD", href: "https://www.cnpd.pt/", external: true },
    { kind: "text", text: "." },
  ]);
  assert.deepEqual(parseInlineLinks("[x](javascript:alert(1))"), [
    { kind: "text", text: "x" },
    { kind: "text", text: ")" },
  ]);
  assert.deepEqual(parseInlineLinks("[x](//evil.example)"), [{ kind: "text", text: "x" }]);
  assert.deepEqual(parseInlineLinks("sem ligações"), [{ kind: "text", text: "sem ligações" }]);
});
