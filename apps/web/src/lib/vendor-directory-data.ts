/**
 * Integrated vendors shown in the ABI marketplace (public homepage, /directory,
 * /providers/[slug] and the logged-in Marketplace all read this one list).
 *
 * Every number here was read from the vendor's own public page on
 * VERIFIED_ON. They are the vendor's prices to ABI, not ABI's prices to an
 * agent: ABI's retail pricing for these vendors is not set yet, so the UI
 * labels them as vendor costs and purchases stay closed until it is.
 */
export const VERIFIED_ON = "2026-11-11";

export type ProviderKind = "service" | "physical";

export type ProviderAction = {
  id: string;
  name: string;
  description: string;
  /** What an agent calls or orders: an API endpoint or a SKU prefix. */
  reference: string;
  /** The headline price, e.g. "From €3.00" or "10 credits". */
  price: string;
  /** What the price means, e.g. "Before tax and shipping". */
  priceDetail: string;
  facts: string[];
  examples?: string[];
};

export type ProviderSource = { label: string; url: string };

export type IntegratedProvider = {
  slug: string;
  name: string;
  monogram: string;
  website: string;
  kind: ProviderKind;
  kindLabel: string;
  categories: string[];
  tagline: string;
  description: string;
  actionNoun: string;
  pricingSummary: string;
  pricingNote: string;
  status: {
    label: string;
    detail: string;
  };
  actions: ProviderAction[];
  sources: ProviderSource[];
};

/** ScrapingAnt plans, from scrapingant.com (monthly price in USD, credits/month). */
export const SCRAPINGANT_PLANS = [
  { name: "Enthusiast", usdPerMonth: 19, credits: 100_000 },
  { name: "Startup", usdPerMonth: 49, credits: 500_000 },
  { name: "Business", usdPerMonth: 249, credits: 3_000_000 },
  { name: "Business Pro", usdPerMonth: 599, credits: 8_000_000 },
] as const;

/** Estimated vendor cost of `credits` on a plan, in USD. Not an ABI price. */
export function creditCostUsd(credits: number, plan: (typeof SCRAPINGANT_PLANS)[number]) {
  return (credits * plan.usdPerMonth) / plan.credits;
}

export function formatUsd(value: number) {
  if (value >= 1) return `$${value.toFixed(2)}`;
  // Two significant figures keeps fractions of a cent readable.
  return `$${Number(value.toPrecision(2)).toString()}`;
}

function creditEstimate(credits: number) {
  const low = SCRAPINGANT_PLANS[0];
  const high = SCRAPINGANT_PLANS[SCRAPINGANT_PLANS.length - 1];
  return `Estimated vendor cost ${formatUsd(creditCostUsd(credits, low))} per request on ${low.name} ($${low.usdPerMonth} for ${low.credits.toLocaleString("en-US")} credits), ${formatUsd(creditCostUsd(credits, high))} on ${high.name}. Not an ABI price.`;
}

export const INTEGRATED_PROVIDERS: IntegratedProvider[] = [
  {
    slug: "prodigi",
    name: "Prodigi",
    monogram: "P",
    website: "https://www.prodigi.com",
    kind: "physical",
    kindLabel: "Physical goods",
    categories: ["Print on demand", "Wall art"],
    tagline: "Print-on-demand art prints, posters and canvas, made and shipped worldwide.",
    description:
      "Agents can find a print product, get an exact quote for a delivery address, and hand over artwork. Prodigi prints it in the lab nearest the customer and ships it.",
    actionNoun: "products",
    pricingSummary: "Prints from €3.00",
    pricingNote:
      "Prodigi's wholesale “from” prices, before tax and shipping, in the currency Prodigi lists. The exact price depends on size, options and the delivery address, so every order is quoted first.",
    status: {
      label: "Browse only",
      detail:
        "Ordering through ABI opens once a Prodigi account key is connected and ABI's prices for prints are set.",
    },
    actions: [
      {
        id: "enhanced-matte-art",
        name: "Enhanced matte art print",
        description:
          "Prodigi's bestselling fine art paper, delivered rolled or flat, ready to frame.",
        reference: "SKU prefix GLOBAL-FAP · code EMA",
        price: "From €3.00",
        priceDetail: "Before tax and shipping. Other currencies are approximate.",
        facts: [
          "200gsm paper, Giclée printing",
          'Sizes 4x6" to 100x50"',
          "Made in 24 to 72 hours",
          "Printed in the UK, EU, US, Canada or Australia",
        ],
        examples: [
          "GLOBAL-FAP-11X14",
          "GLOBAL-FAP-12X16",
          "GLOBAL-FAP-16X24",
          "GLOBAL-FAP-20X28",
          "GLOBAL-FAP-24X36",
        ],
      },
      {
        id: "budget-poster",
        name: "Budget poster",
        description: "A bright white, affordable poster paper, delivered rolled or flat.",
        reference: "SKU prefix GLOBAL-BLP · code BLP",
        price: "From £3.00",
        priceDetail: "Before tax and shipping. Other currencies are approximate.",
        facts: [
          "170gsm paper, UVgel printing",
          'Sizes 4x6" to 40x60"',
          "Made in 72 hours",
          "Printed in the UK, EU, US, Canada, Australia or Sweden",
        ],
        examples: [
          "GLOBAL-BLP-5X7",
          "GLOBAL-BLP-11X14",
          "GLOBAL-BLP-18X24",
          "GLOBAL-BLP-21X28",
          "GLOBAL-BLP-24X24",
        ],
      },
      {
        id: "stretched-canvas",
        name: "Stretched canvas",
        description: "400gsm artist-grade canvas, tensioned over a 38mm kiln-dried pine frame.",
        reference: "SKU prefix GLOBAL-CAN",
        price: "From £14.00",
        priceDetail: "Before tax and shipping. Other currencies are approximate.",
        facts: [
          "Latex or UVgel inks",
          'Sizes 3x16" to 119x56"',
          "Made in 48 to 120 hours",
          "Printed in the UK, EU, US or Australia",
        ],
        examples: [
          "GLOBAL-CAN-12X16",
          "GLOBAL-CAN-16X20",
          "GLOBAL-CAN-24X32",
          "GLOBAL-CAN-28X40",
          "GLOBAL-CAN-30X40",
        ],
      },
      {
        id: "quote-order",
        name: "Quote an order",
        description:
          "Exact items, shipping, tax and total for one delivery address, before anything is ordered.",
        reference: "POST /v5/quotes/order",
        price: "Quoted per order",
        priceDetail: "Prodigi returns the amounts and currency for that address.",
        facts: ["Needs the catalogue variant, quantity, product options and a shipping address"],
      },
    ],
    sources: [
      {
        label: "Enhanced matte art paper",
        url: "https://www.prodigi.com/products/prints-and-posters/art-prints/enhanced-matte-art/",
      },
      {
        label: "Budget poster",
        url: "https://www.prodigi.com/products/prints-and-posters/posters/budget-poster/",
      },
      {
        label: "Stretched canvas",
        url: "https://www.prodigi.com/products/wall-art/canvas/stretched-canvas/stretched-canvas/",
      },
      {
        label: "Prodigi API v5 reference",
        url: "https://www.prodigi.com/print-api/docs/reference/",
      },
    ],
  },
  {
    slug: "scrapingant",
    name: "ScrapingAnt",
    monogram: "SA",
    website: "https://scrapingant.com",
    kind: "service",
    kindLabel: "Tools & APIs",
    categories: ["Web scraping", "Lead research"],
    tagline:
      "Web scraping API with headless Chrome and rotating proxies, for agent research and lead lists.",
    description:
      "Agents fetch any public page as HTML or Markdown, or pull structured fields such as company name, contact details or price with AI extraction. Each call is billed in ScrapingAnt credits.",
    actionNoun: "tools",
    pricingSummary: "1 to 125 credits a call",
    pricingNote:
      "ScrapingAnt bills in credits per request, set by the browser and proxy used. Dollar figures are estimated vendor costs on ScrapingAnt's monthly plans, not ABI prices. Failed requests are not charged credits.",
    status: {
      label: "Browse only",
      detail:
        "Paid calls through ABI open once a ScrapingAnt API key is connected and ABI's price per call is set.",
    },
    actions: [
      {
        id: "fetch-page",
        name: "Fetch a page",
        description: "Raw HTML from a plain request, with no browser.",
        reference: "GET /v2/general · browser=false",
        price: "1 credit",
        priceDetail: creditEstimate(1),
        facts: ["Datacenter proxy", "25 credits on a residential proxy"],
      },
      {
        id: "fetch-page-source",
        name: "Fetch page source in a browser",
        description: "Headless browser without JavaScript rendering.",
        reference: "GET /v2/general · return_page_source=true",
        price: "2 credits",
        priceDetail: creditEstimate(2),
        facts: ["Datacenter proxy", "50 credits on a residential proxy"],
      },
      {
        id: "render-page",
        name: "Render a page with JavaScript",
        description: "Headless Chrome with JavaScript, ScrapingAnt's default mode.",
        reference: "GET /v2/general",
        price: "10 credits",
        priceDetail: creditEstimate(10),
        facts: ["Datacenter proxy", "125 credits on a residential proxy"],
      },
      {
        id: "page-markdown",
        name: "Page as Markdown",
        description: "The page converted to Markdown, ready for an LLM.",
        reference: "GET /v2/markdown",
        price: "By settings",
        priceDetail:
          "Takes the same browser and proxy settings as a page fetch. ScrapingAnt reports the exact credits on each response.",
        facts: ["Returns JSON with the url and the markdown"],
      },
      {
        id: "ai-extract",
        name: "Extract fields with AI",
        description:
          "Structured data from a page from a plain list such as “company name, email, phone”.",
        reference: "GET /v2/extract · extract_properties",
        price: "Varies by page",
        priceDetail:
          "1 credit per 30 characters of page Markdown and output, plus the request's own cost.",
        facts: ["Good for pulling contact and company details for outreach"],
      },
      {
        id: "google-search",
        name: "Google results page",
        description: "Any request to a Google domain.",
        reference: "GET /v2/general · google.com",
        price: "10 credits",
        priceDetail: creditEstimate(10),
        facts: ["Datacenter proxy"],
      },
    ],
    sources: [
      { label: "ScrapingAnt plans", url: "https://scrapingant.com/" },
      { label: "API credit costs", url: "https://docs.scrapingant.com/credits-cost" },
      { label: "API basics", url: "https://docs.scrapingant.com/api-basics" },
      {
        label: "AI extractor",
        url: "https://docs.scrapingant.com/ai-data-extraction/ai-extractor",
      },
    ],
  },
];

export function findProvider(slug: string) {
  return INTEGRATED_PROVIDERS.find((p) => p.slug === slug);
}

/** Filters providers by the catalog's search text and kind tab. */
export function matchProviders(query: string, kind: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return INTEGRATED_PROVIDERS.filter((p) => {
    if (kind && p.kind !== kind) return false;
    if (words.length === 0) return true;
    const haystack = [
      p.name,
      p.tagline,
      p.description,
      p.kindLabel,
      ...p.categories,
      ...p.actions.flatMap((a) => [a.name, a.description, a.reference]),
    ]
      .join(" ")
      .toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}
