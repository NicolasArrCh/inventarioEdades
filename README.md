# 🥚 Gestor de Inventario por Edades — Maqueta

Dashboard interactivo para la **gestión de frescura de huevos** de
**Incubadora Santander (Huevos Kikes)**, con análisis a nivel
**Nacional → Regional (departamento) → CEDI (ciudad)**.

> 📋 El contexto de negocio completo (empresa, CEDIs, plantas, tallas, canales,
> proceso manual y plan de automatización) está en **[`docs/CONTEXTO.md`](docs/CONTEXTO.md)**.

Esta es una **maqueta estática pero maniobrable**: los filtros recalculan toda la
información en tiempo real sobre datos simulados. Está estructurada para
convertirse en un proyecto real conectando backend y base de datos sin reescribir
la capa de presentación.

---

## ▶️ Cómo ejecutar

No requiere instalación ni dependencias. Basta abrir `index.html` en el navegador.

Para evitar restricciones de algunos navegadores al cargar scripts locales,
se recomienda servirlo:

```bash
# Opción 1 — Python
python -m http.server 8000

# Opción 2 — Node
npx serve .
```

Luego abrir <http://localhost:8000>.

---

## 🗂️ Estructura

```
inventarioEdades/
├── index.html              # Estructura del dashboard (sidebar, filtros, vistas)
├── assets/
│   ├── css/
│   │   └── styles.css      # Estilos
│   └── js/
│       ├── data.js         # ⭐ CAPA DE DATOS (mock) — punto de integración backend
│       ├── charts.js       # Mini librería de gráficas SVG (sin dependencias)
│       └── app.js          # Estado de filtros, agregaciones y render de vistas
└── README.md
```

---

## 🧭 Vistas del dashboard

| Vista | Qué muestra |
|-------|-------------|
| **Resumen y edades** (fusionada) | KPIs, distribución por edad, mix por canal, ranking de CEDIs, días por CEDI, detalle por CEDI con mezcla 0–2/3–5/≥6 días, huevo crítico por tipo, alertas y recomendaciones IA |
| **Críticos (rojos)** | Combinaciones CEDI + tipo en zona roja (orden configurable) + recomendaciones IA |
| **Proyección** | Unidades que se pasarán de 5 días si no se actúa + recomendaciones IA |
| **Canales** (submenú) | Una sección con submenú de los 5 canales: **TAT** (ventas a tiendas + cobertura del CEDI), **FS / GS / HD** (cobertura por CEDI) y **Mayoristas** (huevo de edad alta). Cada canal incluye sus recomendaciones IA |
| **Histórico** | Tendencias de los últimos 90 días |

> **Recomendaciones IA:** integradas en **cada vista** con datos de edad (no en una
> pestaña aparte). Cubren días **bajos** (riesgo de quiebre) y **críticos** (riesgo de
> vencimiento); los óptimos no generan recomendación.

### Filtros (multi-selección combinable)

Todos los filtros son **multi-selección** ("todas", "algunas" o marcar específicas)
y se combinan sin conflicto. Afectan a todas las vistas en tiempo real:

- **Región** y **CEDI** → listas con checkboxes y buscador (el CEDI depende de la región).
- **Tipo de huevo** y **Canales** → chips marcables.
- **Más filtros** (avanzados, desplegables):
  - Tipo de ubicación (Plantas / CEDIs / Todas)
  - Estado de reporte (Reportó / Sin reporte / Todos)
  - Zona de cobertura (gris / verde / rojo)
  - Rango de edad promedio (días)
  - Rango de días de inventario
  - Inventario mínimo

El **nivel de análisis** (Nacional / Filtrado / CEDI) se deriva automáticamente de la
selección. La vista **Críticos** añade filtros propios (umbral de edad, mínimo de
unidades críticas, orden) sobre los filtros globales.

---

## 📏 Reglas de negocio implementadas

**Días de inventario** = `inventario ÷ venta diaria` (cobertura):

| Días de inventario | Estado | Color |
|--------------------|--------|-------|
| ≤ 2 (o negativo) | Bajo / sin rotación | ⬜ Gris |
| 3 – 5 | Óptimo | 🟩 Verde |
| ≥ 6 | Exceso / riesgo de vencimiento | 🟥 Rojo |

- **Ventana de frescura:** 5 días máximo exigido por el cliente.
- **Edad crítica del huevo:** ≥ 6 días.
- **Cruce INCUSAN:** alerta cuando la diferencia vs. el inventario automático supera 3%.
- **CEDIs sin reporte:** se marcan como pendientes (ej. Pereira manual, Valledupar / Pasto por lejanía).

Todos estos umbrales son **parametrizables** en `assets/js/data.js` → `PARAMS`.

---

## 🔌 Cómo conectar el backend real

La aplicación **no necesita cambios** en `charts.js` ni `app.js`. Solo se
reemplaza la fuente de datos:

1. En `assets/js/data.js`, sustituir la función `DB.cargar()` por una llamada al API:

   ```js
   cargar: function () {
     return fetch('/api/inventario?fecha=2026-06-25')
       .then(r => r.json())
       .then(json => Object.assign(this, json));
   }
   ```

2. El backend debe devolver la **misma estructura** que el mock:
   `regiones`, `cedis`, `canales`, `items`, `registros`, `tiendasTAT`,
   `historia`, `meta`.

3. El grano de `registros[]` es `(cedi × canal × item)` con
   `inventario`, `ventaDiaria`, `edad {d0_2, d3_5, d6plus}`, `edadPromedio` e `incusan`.

---

## 🤖 Automatización prevista (n8n + IA)

El proceso manual actual (exportar del ERP, depurar pestañas de Excel, consolidar,
cruzar con INCUSAN y enviar por correo) se automatizará con **n8n**:

```
ERP (HU / HC) ──> n8n (extracción + limpieza) ──> Base de datos ──> API ──> Dashboard
                                   │
                                   └──> Agente IA (recomendaciones)
                                   └──> Correo automático (cierre diario)
```

Los puntos de enganche del dashboard ya están preparados:
- `DB.cargar()` → conexión a la base de datos consolidada.
- `app.js → generarRecomendaciones()` → reemplazable por respuestas del agente IA.

---

## 🛠️ Próximos pasos sugeridos

- [ ] Definir el contrato del API (esquema de `registros`, `historia`, `meta`).
- [ ] Construir los flujos de n8n para reemplazar el proceso manual de Excel.
- [ ] Conectar el agente IA para recomendaciones reales.
- [ ] Persistir histórico de ≥ 3 meses en base de datos.
- [ ] Autenticación y roles si se requiere.
