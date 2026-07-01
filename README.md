# 🥚 Gestor de Inventario por Edades — Maqueta

Dashboard interactivo para la **gestión de frescura de huevos** de
**Incubadora Santander (Huevos Kikes)**, con análisis a nivel
**Nacional → Regional (departamento) → CEDI (ciudad)**.

> 📋 El contexto de negocio completo (empresa, CEDIs, plantas, tallas, canales,
> proceso manual y plan de automatización) está en **[`docs/CONTEXTO.md`](docs/CONTEXTO.md)**.

Esta es una **maqueta estática pero maniobrable**: los filtros recalculan la vista en
tiempo real. Desde el 2026-07-01, los indicadores de compañía, el Detalle por Talla, la
Regional TAT y las tiendas TAT de Alerta 1/Alerta 2 (con su PEPS por referencia) son
**datos reales**, tomados literalmente de `Informe_Dias_Inventario_30062026_19.pdf` y
`ventas-1.xlsx` (archivos del cliente, no versionados en este repo) — no simulados. Lo
que todavía no tiene fuente real (desglose de edad por día/CEDI, canales FS/GS/HD/Mayoristas,
histórico de 90 días) se muestra como tal, sin inventar números — ver el detalle completo en
[`docs/CONTEXTO.md`](docs/CONTEXTO.md) sección 11.1. Está estructurada para convertirse en un
proyecto real conectando backend y base de datos sin reescribir la capa de presentación.

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
│       ├── data.js         # ⭐ CAPA DE DATOS (real, del informe) — punto de integración backend
│       ├── charts.js       # Mini librería de gráficas SVG (sin dependencias)
│       └── app.js          # Estado de filtros, orden y render de vistas
├── docs/
│   └── CONTEXTO.md         # Contexto de negocio completo (empresa, CEDIs, reglas, pendientes)
├── pipeline/                # Código de referencia del informe TAT real (Python, no HTML)
│   ├── tat_pipeline.py     # Lógica de negocio: lee 3 xlsx (inventario/ventas) → JSON
│   ├── tat_report.py       # Maquetación del informe: JSON → HTML → PDF
│   ├── PROYECTO_TAT_MEMORIA.md  # Reglas de negocio confirmadas contra datos reales
│   └── README.md           # Cómo correr el pipeline
└── README.md
```

> `pipeline/` es un proyecto hermano (informe TAT en PDF), no parte del dashboard. Se guarda
> aquí como referencia porque documenta, validado contra datos reales, varias reglas de negocio
> (semáforo vs. umbral de alertas, venta diaria sin domingo, PEPS, etc.) que también aplican a
> este dashboard — ver el resumen en [`docs/CONTEXTO.md`](docs/CONTEXTO.md) sección 11.

---

## 🧭 Vistas del dashboard

| Vista | Qué muestra | Fuente |
|-------|-------------|--------|
| **Resumen y edades** | Indicadores de compañía, Detalle por Talla, gráfica de días de inventario por talla, alertas y recomendaciones IA | Real (informe pág. 1) |
| **Alerta 1** (sobre-inventario) | Tiendas TAT reales con cobertura ≥ umbral (5 días por defecto), filtro de Regional TAT, orden configurable + recomendaciones IA | Real (informe pág. 3) |
| **Alerta 2** (frescura PEPS) | Tiendas TAT con cobertura < 5 días: unidades a gestionar (PEPS), días a vender, y detalle de referencias en riesgo agrupado por tienda + recomendaciones IA | Real (informe págs. 3-5) |
| **Canales** (submenú) | **TAT**: Días de Inventario TAT por Regional + tiendas. **FS / GS / HD / Mayoristas**: sin fuente real todavía, muestran estado vacío explícito | TAT real; resto pendiente |
| **Histórico** | Tendencias de los últimos 90 días | Demostrativa (sin fuente real, un solo corte disponible) |

> Las vistas **Alerta 1** y **Alerta 2** replican la estructura del informe real "Días de
> Inventario" (ver `docs/CONTEXTO.md` sección 11.1): cobertura ≥5 días = sobre-inventario,
> cobertura <5 días = riesgo de frescura gestionado con PEPS. Es una regla distinta del semáforo
> visual (gris/verde/rojo, corte en 6 días).

> **Recomendaciones IA:** integradas en **cada vista** con datos de edad (no en una
> pestaña aparte). Cubren días **bajos** (riesgo de quiebre) y **críticos** (riesgo de
> vencimiento); los óptimos no generan recomendación.

### Filtros (multi-selección combinable)

Todos los filtros son **multi-selección** ("todas", "algunas" o marcar específicas)
y se combinan sin conflicto. Afectan a todas las vistas en tiempo real:

- **Regional** y **CEDI** → listas con checkboxes y buscador (el CEDI depende de la regional).
  "Regional" es la agrupación comercial real (Occidente / Costa Oriente / Centro, tal como aparece
  en el informe y en `ventas-1.xlsx`), no un departamento — reemplaza al filtro anterior. Caloto y
  Pereira quedan en "Sin regional TAT confirmada" en vez de asignarles una regional adivinada (ver
  `docs/CONTEXTO.md` sección 11.2, incluye la investigación web sobre cómo Huevos Kikes distribuye
  sus CEDIs).
- **Talla / categoría** → chips marcables; en Alerta 2 filtran el detalle de referencias en riesgo.
- **Más filtros** (avanzados, desplegables):
  - Tipo de ubicación (Plantas / CEDIs / Todas)
  - Estado de reporte (Reportó / Sin reporte / Todos)
  - Inventario mínimo (sobre el inventario total de la tienda TAT)

El **nivel de análisis** (Nacional / Filtrado / CEDI) se deriva automáticamente de la selección.
Las vistas **Alerta 1** y **Alerta 2** añaden filtros propios (umbral de cobertura o de días a
vender, orden) sobre los filtros globales — ya no tienen un filtro de regional aparte, porque el
filtro global "Regional" es ahora la misma Regional TAT real.

---

## 📏 Reglas de negocio implementadas

**Días de inventario** = `inventario ÷ venta diaria` (cobertura):

| Días de inventario | Estado | Color |
|--------------------|--------|-------|
| ≤ 2 (o negativo) | Bajo / sin rotación | ⬜ Gris |
| 3 – 5 | Óptimo | 🟩 Verde |
| ≥ 6 | Exceso / riesgo de vencimiento | 🟥 Rojo |

- **Ventana de frescura:** 5 días máximo exigido por el cliente.
- **Edad crítica del huevo:** ≥ 6 días (semáforo visual).
- **Umbral de alertas de sobre-inventario:** ≥ 5 días de cobertura — regla independiente del
  semáforo visual, confirmada contra datos reales del informe TAT (`PARAMS.umbralAlertaCoberturaDias`).
- **Cruce INCUSAN:** alerta cuando la diferencia vs. el inventario automático supera 3%.
- **CEDIs sin reporte:** se marcan como pendientes (ej. Pereira manual, Valledupar / Pasto por lejanía).

Todos estos umbrales son **parametrizables** en `assets/js/data.js` → `PARAMS`. Detalle completo
de reglas de negocio (incluye hallazgos abiertos del informe TAT real) en
[`docs/CONTEXTO.md`](docs/CONTEXTO.md).

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

2. El backend debe devolver la **misma estructura** que hoy es literal en `data.js`:
   `regiones`, `cedis`, `canales`, `items` (Detalle por Talla), `regionalesTAT`, `regionalTAT`,
   `tiendasTAT` (con Alerta 1/2 y `referencias[]` para el PEPS), `alerta2Resumen`, `historia`, `meta`.

3. El grano de `tiendasTAT[]` es una tienda TAT con `alerta` (1 ó 2), `invConEdad`, `ventaDia`,
   `aGestionar`, `invTotal`, y — solo si aplica — `cobertura` (Alerta 1) o `diasAVender` +
   `referencias[]` (Alerta 2, cada una con `invActual`, `ventaDia`, `enRiesgo`, `diasAVender`).

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
- `app.js → generarRecomendacionesTAT()` → reemplazable por respuestas del agente IA.

---

## 🛠️ Próximos pasos sugeridos

- [ ] Definir el contrato del API (esquema de `tiendasTAT`, `items`, `historia`, `meta`).
- [ ] Construir los flujos de n8n para reemplazar el proceso manual de Excel.
- [ ] Conectar el agente IA para recomendaciones reales.
- [ ] Persistir histórico de ≥ 3 meses en base de datos (hoy es demostrativo, un solo corte real).
- [ ] Autenticación y roles si se requiere.
- [ ] Consiguir el archivo de inventario con lotes fechados (`INV. EDADES` del `.xlsm`) para poder
      mostrar el desglose real de edad por día y por CEDI en la vista Resumen.
- [ ] Consiguir una fuente real para los canales Food Service, Grandes Superficies, Hard Discount
      y Mayoristas (el informe actual solo cubre TAT).
- [x] Incorporar en el dashboard cómo se estructura la información en el informe TAT real
      (Alerta 1/2, PEPS, Regional TAT, Detalle por Talla) — ver `docs/CONTEXTO.md` sección 11.1.
- [x] Reemplazar las cifras simuladas por los números literales del informe real y de
      `ventas-1.xlsx` donde el informe los publica.
