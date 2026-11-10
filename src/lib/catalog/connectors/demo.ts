import "server-only";
import { CatalogError, type CatalogConnector, type CatalogProduct, type ConnectorDefinition } from "../types";

export const demoDefinition: ConnectorDefinition = {
  type: "demo",
  fields: [],
  // Sample data for local work; never offered unless explicitly enabled.
  available: process.env.IMAGINE_DEMO === "1",
  canPublish: true,
};

const products: CatalogProduct[] = [
  {
    externalId: "demo-1",
    sku: "SOFA-12345",
    name: "Grey Fabric 3-Seater Sofa",
    nameAr: "كنبة قماش رمادية بثلاثة مقاعد",
    category: "Living Room > Sofas",
    images: ["/demo/sofa-grey-base.png"],
  },
  {
    externalId: "demo-2",
    sku: "CHAIR-BOUCLE-01",
    name: "Bouclé Accent Armchair",
    nameAr: "كرسي بذراعين من قماش البوكليه",
    category: "Living Room > Armchairs",
    images: ["/demo/sofa-source.png"],
  },
  {
    externalId: "demo-3",
    sku: "CHAIR-OAK-99",
    name: "Oak Frame Lounge Chair",
    nameAr: "كرسي استرخاء بإطار من خشب البلوط",
    category: "Living Room > Armchairs",
    images: ["/demo/source-chair.png", "/demo/sofa-source.png"],
  },
];

export function createDemoConnector(): CatalogConnector {
  return {
    async search(query, limit) {
      const q = query.trim().toLowerCase();
      return products
        .filter((p) => !q || [p.sku, p.name, p.nameAr ?? "", p.category ?? ""].some((v) => v.toLowerCase().includes(q)))
        .slice(0, limit);
    },
    async findBySku(sku) {
      return products.find((p) => p.sku.toLowerCase() === sku.toLowerCase()) ?? null;
    },
    // Simulated store upload so the publish flow can be exercised locally.
    async publishImage(sku) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (!products.some((p) => p.sku.toLowerCase() === sku.toLowerCase())) throw new CatalogError("not_found");
      return { ref: `demo-media-${Date.now()}` };
    },
  };
}
