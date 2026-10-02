"use client";

import { Fragment } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import LanguageToggle from "@/components/ui/LanguageToggle";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { getLegalContent, parseInlineLinks, type LegalBlock } from "@/lib/legal";
import { LEGAL_ROUTES, SITE, type LegalDocumentId } from "@/lib/site";

const LINK_CLASS_NAME =
  "font-medium text-red-700 underline underline-offset-2 transition-colors hover:text-red-800 dark:text-red-300 dark:hover:text-red-200";

function RichText({ text }: { text: string }) {
  return parseInlineLinks(text).map((segment, index) => {
    if (segment.kind === "text") return <Fragment key={index}>{segment.text}</Fragment>;
    // Same-tab navigation for external links: these are reference pages, so
    // leaving them is expected, and no "opens in a new tab" warning is needed.
    return segment.external
      ? <a key={index} href={segment.href} rel="noopener noreferrer" className={LINK_CLASS_NAME}>{segment.text}</a>
      : <Link key={index} href={segment.href} className={LINK_CLASS_NAME}>{segment.text}</Link>;
  });
}

function Block({ block }: { block: LegalBlock }) {
  if (block.type === "paragraph") {
    return <p className="text-sm leading-6 text-foreground/80"><RichText text={block.text} /></p>;
  }

  if (block.type === "list") {
    return (
      <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-foreground/80 marker:text-red-600 dark:marker:text-red-400">
        {block.items.map((item) => <li key={item}><RichText text={item} /></li>)}
      </ul>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="border-b border-border bg-surface-muted px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.06em] text-foreground/70">
          {block.caption}
        </caption>
        <thead>
          <tr>
            {block.head.map((cell) => (
              <th key={cell} scope="col" className="border-b border-border px-3 py-2 font-semibold text-foreground">{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row.join("|")} className="border-b border-border last:border-b-0">
              {row.map((cell, index) => (
                <td key={index} className={`px-3 py-2 align-top text-foreground/80 ${index === 0 ? "break-words font-mono text-xs" : ""}`}>
                  <RichText text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LegalDocumentView({ documentId }: { documentId: LegalDocumentId }) {
  const { locale } = useLocale();
  const { chrome, documents } = getLegalContent(locale);
  const legalDocument = documents[documentId];
  const documentIds = Object.keys(LEGAL_ROUTES) as LegalDocumentId[];

  return (
    // The root layout locks body scrolling for the full-screen map, so the
    // reading page owns its own scroll container.
    <div className="h-dvh overflow-y-auto bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            {chrome.backToMap}
          </Link>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-12 pt-8">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em]">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-red-500" />
          <span>Wildfire<span className="text-red-600 dark:text-red-400">Watch</span></span>
        </p>
        <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">{legalDocument.title}</h1>
        <p className="mt-3 text-base leading-7 text-foreground/80">{legalDocument.summary}</p>
        <p className="mt-3 font-mono text-xs tabular-nums text-foreground/70">
          {chrome.lastUpdated}: <time dateTime={SITE.legalLastUpdatedIso}>{SITE.legalLastUpdated}</time>
        </p>

        <nav aria-label={chrome.onThisPage} className="mt-8 rounded-xl border border-border bg-surface-muted/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground/70">{chrome.onThisPage}</p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {legalDocument.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="inline-flex min-h-6 items-center text-sm text-foreground/80 underline underline-offset-2 hover:text-foreground">
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {legalDocument.sections.map((section) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="mt-10 scroll-mt-24 space-y-4">
            <h2 id={`${section.id}-title`} className="text-lg font-semibold tracking-[-0.015em]">{section.title}</h2>
            {section.blocks.map((block, index) => <Block key={index} block={block} />)}
          </section>
        ))}
      </main>

      <footer className="border-t border-border">
        <nav aria-label={chrome.navLabel} className="mx-auto max-w-3xl px-4 py-6">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {documentIds.map((id) => (
              <li key={id}>
                <Link
                  href={LEGAL_ROUTES[id]}
                  aria-current={id === documentId ? "page" : undefined}
                  className="inline-flex min-h-6 items-center text-foreground/80 underline underline-offset-2 hover:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:no-underline"
                >
                  {chrome.linkLabels[id]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </footer>
    </div>
  );
}
