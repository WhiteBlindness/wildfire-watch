import type { Metadata } from "next";
import LegalDocumentView from "@/components/legal/LegalDocumentView";
import { getLegalContent } from "@/lib/legal";

const legalDocument = getLegalContent("pt").documents.about;

export const metadata: Metadata = {
  // The document title already names the site.
  title: legalDocument.title,
  description: legalDocument.summary,
};

export default function AboutPage() {
  return <LegalDocumentView documentId="about" />;
}
