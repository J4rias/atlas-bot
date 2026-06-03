# Atlas Bot — Documento de Requisitos

> **Estado:** Borrador v0.1 — Pendiente revisión
> **Fecha:** 2026-05-11
> **Proyecto:** Clon de Ventas Estratégico y Operador Financiero

---

## 1. Visión General

Middleware de IA para Inversiones Atlas (negocio de distribución de víveres) capaz de gestionar ventas, perfilar clientes y optimizar el arbitraje de divisas a través de canales de mensajería. El sistema actúa como un consultor de ventas autónomo que consume la API del ERP existente.

---

## 2. Decisiones Arquitectónicas Confirmadas

| Decisión | Elección | Justificación |
|---|---|---|
| Stack | Node.js / TypeScript | Consistencia con el ERP existente |
| Motor IA (inicial) | Claude Sonnet 4.6 | Mejor balance costo/calidad para tool use y español regional |
| Estrategia IA (futuro) | Híbrida Haiku + Sonnet | Haiku para flujos simples, Sonnet para razonamiento complejo |
| Canal primario | Facebook Messenger | Canal principal de comunicación con clientes |
| Canal secundario | WhatsApp (fase posterior) | Segundo canal, diseñar abstracción multi-canal desde el inicio |
| Base de datos vectorial | pgvector (PostgreSQL) | Reutiliza infraestructura existente, sin costos adicionales |
| Panel administrativo | Integrado en frontend ERP | Reutiliza auth, componentes UI y deploy existente |
| Deploy | Docker container en mismo servidor del ERP | Simplifica networking y acceso a la DB |
| Comunicación con ERP | Solo API REST | No accede directo a la DB del ERP, solo lectura |

---

## 3. Módulos y Requisitos Funcionales

### 3.1 Núcleo de IA (RAG + LLM)

- [ ] Capa de abstracción para el motor de IA (intercambiable sin afectar lógica de negocio)
- [ ] Pipeline RAG con pgvector para contexto corporativo
- [ ] **Documentos a vectorizar:**
  - Cultura corporativa de Inversiones Atlas
  - Manual de manejo de objeciones
  - Visión estratégica 2030
  - Catálogo de productos y descripciones
  - *(Formato de los documentos fuente: POR DEFINIR)*
- [ ] Principio fail-safe: ante ambigüedad, solicitar aclaración antes de procesar
- [ ] Restricción estricta: no alucinar stock ni precios — todo dato viene del ERP

### 3.2 Inteligencia Financiera (Arbitraje Dinámico)

- [ ] **Ecosistema multimoneda:** USD, COP, BS (VES), USDT, Bancolombia
- [ ] **"Tasa Atlas":** Tasas de cambio propias del negocio (no tasas de mercado)
- [ ] Actualización de tasas: manual desde panel admin o vía API
- [ ] **Snapshot de tasa:** Cada cotización lleva timestamp y vencimiento (10-15 min configurable)
- [ ] Cotizaciones vencidas deben recalcularse automáticamente
- [ ] **Lógica de incentivo:** Márgenes de seguridad o descuentos automáticos según moneda de pago
  - Ejemplo: pago en USDT → descuento X%; pago en BS → margen de protección Y%
- [ ] Todas las reglas de margen/descuento editables desde panel admin (cero hardcoding)

### 3.3 Gestión de Inventario y Ventas

- [ ] Consulta de catálogo en tiempo real vía API del ERP
- [ ] **Jerarquía de productos por margen:**
  - Tier 1 (Margen Alto): Productos de empuje prioritario
  - Tier 2 (Rotación): Productos de gancho / volumen
- [ ] Clasificación de tier configurable desde panel admin
- [ ] **Up-selling algorítmico obligatorio:** Si el cliente pide un producto Tier 2, el bot DEBE sugerir un producto Tier 1 compatible antes de cerrar
- [ ] Consulta de disponibilidad de stock por bodega
- [ ] Precios según lista de precios activa del ERP (precios congelados)
- [ ] Soporte para venta por paquete y unidad suelta (recargo 7% en unidades < medio paquete)
- [ ] **Creación de pre-órdenes:** El bot genera una pre-orden en el ERP al cerrar la venta
  - La pre-orden incluye: productos, cantidades, precios, moneda, tasa usada (snapshot), datos del cliente
  - Estado inicial: `pendiente` — requiere aprobación de operador humano
  - El operador revisa y confirma con un clic → se convierte en venta real
  - Si la tasa venció antes de aprobación, el sistema alerta al operador
  - **Endpoint nuevo requerido en ERP:** `POST /api/pre-orders`
  - **Vista nueva en panel ERP:** Cola de pre-órdenes pendientes con aprobar/rechazar

### 3.4 Perfilado de Clientes (Lead Filtering)

- [ ] **Clasificación automática del cliente durante la conversación:**
  - **Mayorista:** Volumen alto, compra recurrente, negocia precios
  - **Minorista:** Cantidades pequeñas, compra puntual
  - **Indeciso:** Consulta sin intención clara de compra
- [ ] Adaptar tono y estrategia de venta según clasificación
- [ ] Consulta de historial de cliente registrado vía API del ERP
- [ ] Consulta de estado de crédito del cliente

### 3.5 Pipeline de Datos y Auditoría

- [ ] **Registro obligatorio de cada interacción:**
  - Ventas concretadas
  - Ventas no concretadas con motivo categorizado:
    - Precio
    - Stock
    - Logística
    - Competencia
- [ ] Dashboard de insights en panel admin
- [ ] **Hand-off humano automático** cuando se detecte:
  - Intención de compra de alto volumen (umbral configurable)
  - Consulta que exceda el umbral de confianza de la IA
  - Transferencia a operadores: **Cristian** o **Leonardo**
- [ ] Notificación al operador humano (¿vía qué canal? POR DEFINIR)

### 3.6 Personalidad del Bot (System Prompt)

- [ ] **Perfil:** Consultor de Negocios Culto
- [ ] **Tono:** Profesional, regionalizado (San Cristóbal), analítico
- [ ] **Visión:** Proyectado a la excelencia — Visión 2030
- [ ] No tutear ni ser informal en exceso, pero tampoco distante
- [ ] Conocimiento contextual del negocio vía RAG

---

## 4. Requisitos No Funcionales

### 4.1 Seguridad
- [ ] Token JWT o API key dedicada para el bot (lectura + creación de pre-órdenes)
- [ ] Rate limiting en endpoints consumidos por el bot
- [ ] Encriptación de datos transaccionales y de identidad de clientes
- [ ] Endpoints de mutación limitados exclusivamente a pre-órdenes (no ventas directas, no ajustes)
- [ ] Validación de webhook signatures (Meta/WhatsApp)

### 4.2 Modularidad
- [ ] Motor de IA intercambiable sin tocar lógica financiera
- [ ] Capa de canal (Messenger/WhatsApp) abstraída del core
- [ ] Reglas de negocio y tasas editables desde panel, no en código

### 4.3 Rendimiento
- [ ] Latencia de respuesta < 3 segundos para consultas simples
- [ ] Manejo de conversaciones concurrentes (múltiples clientes simultáneos)
- [ ] Snapshot de tasas cacheado para evitar recalcular en cada mensaje

### 4.4 Observabilidad
- [ ] Logging estructurado de cada conversación
- [ ] Métricas de conversión (consultas → ventas)
- [ ] Alertas cuando el bot no puede resolver y no hay operador disponible

---

## 5. Integraciones

| Sistema | Tipo | Propósito |
|---|---|---|
| ERP (Emprendimiento-Lobo) | API REST (lectura + pre-órdenes) | Catálogo, precios, stock, clientes, tasas, crédito, crear pre-órdenes |
| Facebook Messenger API | Webhook bidireccional | Canal de comunicación primario |
| WhatsApp Business API | Webhook bidireccional | Canal secundario (fase 2) |
| Anthropic API | HTTP | Motor de IA (Claude Sonnet / Haiku) |
| PostgreSQL + pgvector | Directa | RAG, logs de conversación, auditoría |

---

## 6. Endpoints del ERP Disponibles

> Referencia de la API existente que el bot consumirá.

**Catálogo y precios:**
- `GET /api/products` — Búsqueda, filtros, precios por lista
- `GET /api/products/barcode/:barcode` — Lookup por código de barras
- `GET /api/price-lists/active` — Listas de precios activas
- `GET /api/price-lists/:id` — Precios por producto/presentación
- `GET /api/exchange-rates/latest` — Tasas de cambio del día

**Stock:**
- `GET /api/inventory/warehouse/:id` — Disponibilidad por bodega

**Clientes:**
- `GET /api/customers/active` — Clientes registrados
- `GET /api/customers/:id/credit-summary` — Estado de crédito

**Público:**
- `GET /api/company` — Datos de la empresa (sin auth)

**Pre-órdenes (NUEVO — requiere implementar en ERP):**
- `POST /api/pre-orders` — Crear pre-orden desde el bot
- `GET /api/pre-orders?status=pending` — Cola de pendientes (panel admin)
- `PATCH /api/pre-orders/:id/approve` — Aprobar → convertir en venta
- `PATCH /api/pre-orders/:id/reject` — Rechazar con motivo

---

## 7. Puntos Abiertos (POR DEFINIR)

1. ~~**Formato de documentos RAG**~~ — ✅ Notas sueltas. Requiere proceso de curación y estructuración antes de vectorizar.
2. ~~**Canal de notificación para hand-off humano**~~ — ✅ Notificación en panel ERP.
3. ~~**Umbral de alto volumen**~~ — ✅ Configurable desde panel admin (monto/cantidad definido por operador).
4. ~~**Umbral de confianza IA**~~ — ✅ Escalar a humano cuando la consulta esté fuera de dominio (preguntas que el bot no puede responder).
5. ~~**Creación de pedidos**~~ — ✅ Bot crea pre-órdenes, operador aprueba en panel ERP.
6. ~~**Identificación del cliente**~~ — ✅ El bot no vincula al cliente con el ERP. Al aprobar la pre-orden, el operador humano registra o asocia al cliente manualmente.
7. ~~**Horario de operación**~~ — ✅ 24/7. Fuera de horario comercial avisa que la pre-orden se procesa al siguiente día hábil.
8. ~~**Monedas USDT y Bancolombia**~~ — ✅ Bancolombia es un método de pago (COP vía transferencia Bancolombia), puede tener tasa diferente al COP efectivo.

---

## 8. Fases de Implementación (Propuesta Preliminar)

### Fase 1 — MVP: Bot conversacional + Catálogo
- Webhook de Messenger funcionando
- Integración con Claude Sonnet
- Consulta de productos, precios y stock vía ERP
- System prompt con personalidad configurada
- Fail-safe ante ambigüedad

### Fase 2 — Inteligencia Financiera
- Módulo de Tasa Atlas con snapshots
- Cotización multimoneda con vencimiento
- Lógica de incentivo por moneda
- Panel admin: gestión de tasas

### Fase 3 — Ventas Inteligentes
- Clasificación de productos por tier
- Up-selling algorítmico
- Perfilado de clientes (Mayorista/Minorista/Indeciso)
- RAG con documentos corporativos

### Fase 4 — Auditoría y Operaciones
- Logging de incidencias y motivos de no-venta
- Hand-off humano con notificaciones
- Dashboard de insights en panel admin
- Métricas de conversión

### Fase 5 — Expansión
- Canal WhatsApp
- Estrategia híbrida Haiku/Sonnet
- Optimización de costos por volumen
