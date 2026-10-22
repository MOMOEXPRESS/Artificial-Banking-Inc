import {
  DEFAULT_DESCRIPTION,
  SITE_NAME,
  SITE_SHORT_NAME,
  absoluteUrl,
  getSiteUrl,
} from "./site";

/** Organization / SoftwareApplication / WebSite JSON-LD for public pages. */
export function SiteJsonLd() {
  const url = getSiteUrl();
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${url}/#organization`,
        name: SITE_NAME,
        alternateName: SITE_SHORT_NAME,
        url,
        description: DEFAULT_DESCRIPTION,
        logo: absoluteUrl("/icon-512.png"),
        sameAs: ["https://github.com/MOMOEXPRESS/Artificial-Banking-Inc"],
      },
      {
        "@type": "WebSite",
        "@id": `${url}/#website`,
        name: SITE_NAME,
        url,
        description: DEFAULT_DESCRIPTION,
        publisher: { "@id": `${url}/#organization` },
        inLanguage: "en-US",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${url}/#software`,
        name: SITE_NAME,
        alternateName: SITE_SHORT_NAME,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: DEFAULT_DESCRIPTION,
        url,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          description: "Developer / sandbox access while the product is in pre-beta",
        },
        publisher: { "@id": `${url}/#organization` },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // JSON-LD is a trusted static graph built from our constants only.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
