# 📋 Contexto del proyecto — Gestor de Inventario por Edades

> Documento maestro de contexto para **Incubadora Santander S.A. (Huevos Kikes)**.
> Reúne el contexto de negocio entregado por el cliente + la información verificada
> en la web. Es la fuente de verdad para construir el backend, los flujos de n8n y
> el modelo de datos definitivo.
>
> Última actualización: 2026-06-26

---

## 1. La empresa

**Incubadora Santander S.A.** — marca comercial **Huevos Kikes**. Parte del Grupo ISSA.
Es la mayor productora de huevo de Colombia.

- Fundada en **1962** en Bucaramanga.
- **Sede principal:** Piedecuesta, Santander (Carrera 15 #3AN-50, Torre Empresarial
  CC Delacuesta, piso 10).
- Producción: **> 4–5 millones de huevos/día** (meta histórica de hasta 10M/día).
- **> 2.000 empleados** y **~350–400 vehículos** de distribución.
- Contacto: servicioalcliente@kikes.com.co · (57)(607) 6910841.

### Producto adicional verificado
- **Huevo en cáscara pasteurizado** y **huevo líquido pasteurizado** (producto
  diferenciador en el mercado colombiano).
- Línea de **gallina** (Gallina Kampeona, planta en Puerto Tejada, Cauca).

---

## 2. Cadena de suministro (flujo del huevo)

```
Granja → Planta de Clasificación → CEDI → Cliente
                                 ↘ (GS / FS) → directo al cliente sin pasar por CEDI
```

> 🔑 **Principio de modelado (clave para el backend):** el **inventario** solo
> existe en **CEDIs y plantas** (es donde se almacena el huevo). Las **tiendas /
> clientes** (TAT, GS, FS, HD, MAY) **no almacenan inventario**: de ellas solo se
> registran las **ventas** que la empresa les hace. Por eso la "cobertura / días de
> inventario" de un canal o tienda se calcula como
> *inventario del CEDI ÷ venta del canal/cliente*.

- La **planta de clasificación** puede ser parte de la granja o estar aparte
  (mismo departamento donde están la mayoría de granjas).
- La relación **clasificadora → CEDI es fija** (se mide por eficiencia de tiempo:
  qué tan rápido llega de la clasificadora a los CEDIs cercanos).
- Para clientes de **Grandes Superficies (GS)** y **Food Service (FS)**, a veces el
  huevo sale directo de la planta al cliente, **saltándose el CEDI**.

---

## 3. Estructura geográfica (Nación → Región → CEDI)

Red real: **14–16 CEDIs en 14–16 ciudades** (las fuentes varían entre 14 y 16),
con **2 complejos principales de producción/clasificación**:

| Complejo de producción | Departamento | Notas |
|------------------------|--------------|-------|
| **Caloto** (Granja Las Palmas) | Cauca | 18 galpones automatizados, +2M huevos/día |
| **La Mesa de los Santos / Piedecuesta** | Santander | Complejo histórico (cerca de Bucaramanga) |
| Villa Rica (pasteurizadora) | Cauca | 600 t huevo líquido/mes + 8M huevo cáscara/mes |

**Granjas mencionadas:** Egipto & Palmas (Nariño), Bellavista & Lebrija (Santander).

> ⚠️ **Regla del cliente:** las **únicas con planta** son **Bucaramanga (Santander)**
> y **Caloto (Cauca)**. El resto de ciudades son **solo CEDIs**.

### CEDIs por departamento (modelo implementado en `data.js`)

| Departamento (región) | Ciudad (CEDI) | Planta |
|-----------------------|---------------|:------:|
| Santander | Bucaramanga | ✅ |
| Norte de Santander | Cúcuta | |
| Cundinamarca | Bogotá | |
| Antioquia | Medellín | |
| Valle del Cauca | Cali | |
| Cauca | Popayán · **Caloto** | ✅ (Caloto) |
| Risaralda | Pereira | |
| Atlántico | Barranquilla | |
| Bolívar | Cartagena | |
| Magdalena | Santa Marta | |
| Cesar | Valledupar | |
| Córdoba | Montería | |
| Sucre | Sincelejo | |
| Meta | Villavicencio | |
| Nariño | Pasto | |

> Niveles de análisis del dashboard:
> - **Nacional** = todo (incluye plantas).
> - **Regional** = todos los CEDIs del departamento.
> - **CEDI** = un solo centro/planta.

---

## 4. Tallas de huevo

El cliente trabaja la gestión con estas **4 tallas** (nomenclatura de empaque actual):

| Talla | Equivalencia histórica Kikes (peso) |
|-------|-------------------------------------|
| **Jumbo** | > 78,0 g |
| **XL** | ~ AAA (67,0 – 77,9 g) |
| **L** | ~ AA (60,0 – 66,9 g) |
| **M** | ~ A (53,0 – 59,9 g) |

> Clasificación histórica de Kikes por peso: B (46–52,9) · A (53–59,9) ·
> AA (60–66,9) · AAA (67–77,9) · Jumbo (>78). La gestión actual usa Jumbo/XL/L/M.

---

## 5. Canales de cliente

| Código | Canal | Notas |
|--------|-------|-------|
| **TAT** | Tienda a Tienda | Canal tradicional; gestión por tienda |
| **FS** | Food Service | Puede salir directo de planta |
| **GS** | Grandes Superficies | Puede salir directo de planta |
| **HD** | Hard Discount | |
| **MAY** | Mayoristas | Último recurso: huevo de edad alta / "de segunda" |

---

## 6. Regla de negocio central: frescura y edades

- **Ventana de frescura:** el cliente exige el huevo con **≤ 5 días**. Más de eso es
  producto no deseado → puede **retornar al CEDI** o venderse a **mayorista**.
- **Edad crítica del huevo:** **≥ 6 días**.

### Metodología "Días de inventario" (cobertura = inventario ÷ venta diaria)

| Días de inventario | Estado | Color |
|--------------------|--------|-------|
| ≤ 2 (o negativo, raro) | Bajo / sin rotación | ⬜ Gris |
| 3 – 5 | Óptimo | 🟩 Verde |
| ≥ 6 | Exceso / riesgo de vencimiento | 🟥 Rojo |

- Tener **1 día** o menos = malo (riesgo de agotado).
- De **0 a < -3** = igual de malo (sobre-comprometido) — caso muy raro porque se
  surten huevos a diario para evitar escasez.
- Todos los umbrales son **parametrizables** (`PARAMS` en `data.js`).

---

## 7. Proceso manual actual (a automatizar)

Los informes de inventario y edades llegan de **plantas y CEDIs** y se consolidan a
mano en Excel. Resumen del proceso diario:

### Archivo de INVENTARIO
1. Tomar archivo del día anterior → cambiar fecha al presente.
2. ERP → *Informes y Existencias* → línea **HU** → *Recuperar bodegas* (fecha actual).
3. Exportar a Excel → corregir fecha → pegar columnas **A→S** en *Inventario BD*.
4. Verificar fórmulas.

### Archivo de VENTAS
1. ERP → *Ventas de clientes / Datos clientes por línea* → fecha anterior
   (todos los días menos domingos).
2. Línea **HU** → *Planilla de distribución* → *Recuperar bodegas* (ventas TAT).
3. Exportar → corregir fecha (col. **F**) → pegar columnas **W, AY, K, L, BF** en
   *Ventas actualizadas* → arrastrar fórmulas.
4. En *Resumen TD* actualizar fecha y eliminar el día más antiguo.

### Consolidación de edades
- Pestañas clave: `inv`, `inv EDADES`, `Valid`, `VENTAS 2`, `ventas`, `resumen`,
  `gestión edades`.
- **Fecha de corte:** inventario usa fecha del **día anterior**; **edades** van con la
  **fecha actual**.
- Se eliminan: roturas, no facturados, huevos desechados/no clasificados, filtro `CL`.
- **Cruce con INCUSAN** (inventario automático) → ajustar para que los totales cuadren.
- CEDIs con gestión especial:
  - **Pereira** → revisión manual en archivo aparte.
  - **Valledupar / Pasto** (lejanos) → suelen reportar tarde; contactar antes de las
    9:00 AM para consolidar.
- Al cerrar: copiar el archivo y enviarlo por correo a personas definidas. Si un CEDI
  no subió edades, se reporta el estado "sin edades" y se adjuntan fotos.
- **Hoja de venta a mayorista:** disponibilidad de huevo de edad alta / segunda;
  el analista decide qué va a mayorista y se actualiza durante el día.

---

## 8. Requerimientos del dashboard (lo que pidió el cliente)

- Visualizar a **nivel país, región (departamento) y CEDI (ciudad)**, filtrando en
  tiempo real ("jugar con los filtros").
- Ver los huevos **más viejos (≥ 6 días)** y alertas de críticos (de 6 a infinito).
- **Filtros especializados combinables** (sin conflicto entre ellos): por críticos,
  inventario, días, edad promedio, tipo de huevo, canal, CEDI/región.
- Vista de **proyección**: referencias que se pasarán de 5 días con la venta actual.
- Alertas **TAT**: tiendas con inventario < 1 día y tiendas que superarán los 5 días.
- **Recomendaciones IA** en tiempo real sobre la información crítica.
- **Histórico de al menos 3 meses**.
- Mencionó **Streamlit** como posible tecnología de visualización.

---

## 9. Automatización prevista (n8n + IA)

```
ERP (HU / HC) ──> n8n (extracción + limpieza Excel) ──> Base de datos ──> API ──> Dashboard
                                   │
                                   ├──> Agente IA (recomendaciones)
                                   └──> Correo automático de cierre diario + fotos
```

Puntos de enganche ya preparados en la maqueta:
- `data.js → DB.cargar()` → reemplazar por `fetch` a la base consolidada.
- `app.js → generarRecomendaciones()` → reemplazar por respuestas del agente IA.

---

## 10. Estado de la maqueta

Implementado en HTML/CSS/JS sin dependencias (ver `README.md`). Vistas: Resumen,
Inventario por edades, Críticos (con filtros especializados), Proyección, Canal TAT,
Mayoristas, Recomendaciones IA, Histórico. Datos simulados de forma determinista a
partir de la geografía real de arriba.

---

## 11. Fuentes web consultadas

- LinkedIn — Incubadora Santander: <https://co.linkedin.com/company/incubadora-santander-s-a->
- Sanovo Group (testimonial Kikes): <https://www.sanovogroup.com/en/egg/testimonials/kikes/>
- Semana — "La empresa más fuerte del sector avícola": <https://www.semana.com/100-empresas/articulo/incubadora-santander-la-empresa-mas-fuerte-del-sector-avicola/616762/>
- WATTPoultry — Huevos Kikes: <https://www.wattagnet.com/top-poultry-companies/company/huevos-kikes>
- WATTAgNet — huevo en cáscara pasteurizado: <https://www.wattagnet.com/broilers-turkeys/article/15517421/kikes-anuncia-venta-en-colombia-de-huevo-en-cascara-pasteurizado-wattagnet>
- aviNews — Hito sector postura: <https://avicultura.info/hito-sector-postura-incubadora-santander-colombia/>
- La República — planta en Cauca (gallina congelada): <https://www.larepublica.co/empresas/huevos-kikes-inauguro-planta-en-cauca-que-le-permitira-vender-gallina-congelada-2501251>
- El Tiempo — planta de energía renovable en Cauca: <https://www.eltiempo.com/colombia/cali/incubadora-santander-con-planta-de-energia-renovable-en-el-cauca-81924>
- Huevos Kikes — Procesos productivos: <https://huevoskikes.com/somos-imparables/procesos-productivos/>
- Huevos Kikes — Guía de tallas: <https://www.huevoskikes.com/pages/campana-de-tallas>
- Huevos Kikes — Contáctanos: <https://huevoskikes.com/contactanos/>
- Las2Orillas — historia de la familia detrás de Kikes: <https://www.las2orillas.co/la-familia-en-santander-detras-de-huevos-kikes-la-poderosa-productora-que-nacio-vendiendo-pollos/>

> Nota: las cifras exactas de CEDIs (14 vs 16) y el listado ciudad-por-ciudad no están
> publicados de forma oficial completa; el modelo usa el conjunto de ciudades
> confirmadas por múltiples fuentes. **Confirmar con el cliente** la lista definitiva
> de CEDIs, plantas y qué ciudades tienen doble CEDI.
