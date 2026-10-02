import type { Metadata } from "next";
import LegalDocumentView from "@/components/legal/LegalDocumentView";
import { getLegalContent } from "@/lib/legal";

const legalDocument = getLegalContent("pt").documents.privacy;

export const metadata: Metadata = {
  title: `${legalDocument.title} · WildfireWatch`,
  description: legalDocument.summary,
};

export default function PrivacyPage() {
  return <LegalDocumentView documentId="privacy" />;
}
