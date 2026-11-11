import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketingShell } from "../../../lib/marketing-shell";
import { ProviderDetail } from "../../../lib/vendor-directory";
import { INTEGRATED_PROVIDERS, findProvider } from "../../../lib/vendor-directory-data";

export const dynamicParams = false;

export function generateStaticParams() {
  return INTEGRATED_PROVIDERS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const provider = findProvider((await params).slug);
  if (!provider) return {};
  return {
    title: `${provider.name} on ABI`,
    description: provider.tagline,
  };
}

export default async function ProviderPage({ params }: { params: Promise<{ slug: string }> }) {
  const provider = findProvider((await params).slug);
  if (!provider) notFound();
  return (
    <MarketingShell active="marketplace">
      <div className="market-home vendor-page">
        <ProviderDetail provider={provider} />
      </div>
    </MarketingShell>
  );
}
