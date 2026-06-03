export const SALES_STAGES = [
  'greeting',      // Presentación, identificar necesidad
  'discovery',     // Preguntas, entender qué busca
  'presentation',  // Mostrar productos, precios
  'quotation',     // Cotización formal multimoneda
  'objection',     // Manejo de objeciones
  'closing',       // Cierre: crear pre-orden
  'post_sale',     // Seguimiento, upsell
] as const;

export type SalesStage = (typeof SALES_STAGES)[number];
