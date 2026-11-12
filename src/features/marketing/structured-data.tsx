// schema.org data for the public pages (rendered as JSON-LD), so search engines read the brand, the product, the
// page trail and the pricing FAQ. Only facts the pages already state; no ratings or reviews.

type Thing = Record<string, unknown>;

export function organization(base: string, brand: string, email?: string | null): Thing {
  return { "@type": "Organization", "@id": `${base}/#org`, name: brand, url: base, ...(email ? { email } : {}) };
}

/** Home: who makes it, the site, and the app itself with its free plan. */
export function homeGraph({ base, locale, brand, description, email }: { base: string; locale: string; brand: string; description: string; email?: string | null }): Thing {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization(base, brand, email),
      { "@type": "WebSite", "@id": `${base}/#site`, url: `${base}/${locale}`, name: brand, inLanguage: locale, publisher: { "@id": `${base}/#org` } },
      {
        "@type": "SoftwareApplication",
        name: brand,
        description,
        url: `${base}/${locale}`,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        inLanguage: ["en", "ar"],
        image: `${base}/demo/lifestyle-living-room.png`,
        publisher: { "@id": `${base}/#org` },
        offers: { "@type": "Offer", price: "0", priceCurrency: "AED", name: "Free" },
      },
    ],
  };
}

/** The trail from the home page to this one. */
export function breadcrumbs(base: string, trail: { name: string; path: string }[]): Thing {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map(({ name, path }, i) => ({ "@type": "ListItem", position: i + 1, name, item: `${base}${path}` })),
  };
}

export function faqPage(items: { q: string; a: string }[]): Thing {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
}

/** Serialised for a <script> tag; "<" is escaped so no text can close the tag early. */
export const jsonLdString = (data: Thing | Thing[]) => JSON.stringify(data).replace(/</g, "\\u003c");

export function JsonLd({ data }: { data: Thing | Thing[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
