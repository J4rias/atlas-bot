import { Router, type Request, type Response } from 'express';
import * as erp from '../../shared/services/erp.js';

export const catalogRouter = Router();

interface CategoryGroup {
  category: erp.Category;
  products: (erp.Product & {
    prices: Map<number, { packagePrice: number; unitPrice: number }>;
    stock: number;
  })[];
}

catalogRouter.get('/', async (req: Request, res: Response) => {
  try {
    const categoryId = req.query.categoria
      ? Number(req.query.categoria)
      : undefined;

    const [categories, products, priceMap] = await Promise.all([
      erp.getCategories(),
      erp.getProducts(categoryId),
      erp.getPriceMap(),
    ]);

    // Enrich products with prices & stock
    const enriched = products.map((p) => ({
      ...p,
      prices: priceMap,
      stock: erp.totalStock(p),
    }));

    // Group by category
    const groupMap = new Map<number, CategoryGroup>();
    for (const product of enriched) {
      const cat = product.category;
      if (!cat) continue;

      if (!groupMap.has(cat.id)) {
        groupMap.set(cat.id, { category: cat, products: [] });
      }
      groupMap.get(cat.id)!.products.push(product);
    }

    // Sort groups by category name
    const groups = Array.from(groupMap.values()).sort((a, b) =>
      a.category.name.localeCompare(b.category.name),
    );

    res.render('catalog', {
      categories: categories.filter((c) => c.productCount > 0),
      groups,
      selectedCategory: categoryId,
      priceMap,
    });
  } catch (error) {
    console.error('Error loading catalog:', error);
    res.status(500).render('error', {
      message: 'No se pudo cargar el catálogo. Intente nuevamente.',
    });
  }
});
