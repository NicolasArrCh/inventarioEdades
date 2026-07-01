# 📋 Contexto del proyecto — Gestor de Inventario por Edades

> Documento maestro de contexto para **Incubadora Santander S.A. (Huevos Kikes)**.
> Reúne el contexto de negocio entregado por el cliente + la información verificada
> en la web. Es la fuente de verdad para construir el backend, los flujos de n8n y
> el modelo de datos definitivo.
>
> Última actualización: 2026-07-01

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

> ⚠️ **El semáforo visual (gris/verde/rojo, corte en 6 días) y el umbral de las
> alertas operativas de sobre-inventario (Alerta 1/2, corte en 5 días) son dos
> reglas independientes** — no confundirlas. Ver sección 11.

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

## 11. Pipeline TAT real — reglas confirmadas contra datos (v2, 2026-07-01)

> Código de referencia en [`pipeline/`](../pipeline/): `tat_pipeline.py` (reglas de negocio,
> lee 3 `.xlsx` y produce un JSON) + `tat_report.py` (maquetación del informe PDF). El detalle
> completo, con las cifras y el paso a paso de cada validación, está en
> [`pipeline/PROYECTO_TAT_MEMORIA.md`](../pipeline/PROYECTO_TAT_MEMORIA.md) — este apartado es
> el resumen ejecutivo para no perder estas reglas al trabajar la maquetación del dashboard.

Estas reglas se confirmaron corriendo el pipeline contra un informe real ya entregado
(`Informe_Dias_Inventario_30062026_19.pdf`, corte 30/06/2026) más su archivo de ventas
(`ventas-1.xlsx`). Aplican al **informe TAT en PDF** (el otro entregable del proyecto), pero
varias son relevantes también para este dashboard porque describen la fuente de verdad de los
datos que eventualmente lo alimentarán:

- **Venta diaria promedio excluye domingo.** No es "total ÷ días calendario", sino
  "total de lun-sáb ÷ días hábiles disponibles". Confirmado exacto contra datos reales.
- **El KPI "Inventario total" / "Días de inventario global" es de toda la compañía**, no solo
  del canal TAT (en la corrida de referencia: 27,25M unidades). El resto del informe (regional,
  alertas, canal TAT) sigue siendo específico de TAT.
- **Alerta 1/2 (sobre-inventario) usa umbral de 5 días de cobertura, no 6.** El semáforo visual
  del dashboard (gris/verde/rojo, corte en 6) es una regla aparte y no cambia.
- **El modelo de frescura PEPS** (despachar primero el lote más viejo) se calcula para
  **todas** las tiendas TAT, no solo las que están fuera de la Alerta 1. Se agregó la métrica
  **"días a vender"** = unidades a gestionar ÷ venta diaria de esa tienda.
- **Regla "GRIS manda":** todo artículo cuyo nombre contiene "GRIS" se suma también a la
  categoría `GRIS SUELTO`, sin restarlo de su categoría original (solape intencional, se marca
  con asterisco en el informe).
- **Regional (`ZONA`) es siempre la fuente de verdad**, nunca un mapeo manual de ciudad →
  departamento. Ojo: el nombre de dos regionales aparece distinto según la fuente
  ("COSTA ORIENTE"/"CENTRO" en el PDF del 30/06 vs. "COSTA"/"CENTRO ORIENTE" en el `.xlsx` del
  25/06) — pendiente de confirmar contra un `.xlsm` reciente antes de fijar nombres en el
  dashboard.

### Hallazgos abiertos (pendientes de decisión de negocio, no resueltos por cuenta propia)

1. **Bogotá Montevideo vs. Siberia** no siempre se puede distinguir por texto de canal —
   ≈120.000 u/día quedan en un bucket `TAT BOGOTA (sin distinguir)`, sin inventario propio.
2. **Pereira y Montería-Autoservicios** tienen canales reales de TAT que no contienen la
   palabra "TAT" en el nombre → quedan fuera del total oficial (~13.180 u/día).
3. **Umbral de frescura de 5 días**: sigue sin confirmar si responde a vida útil del producto o
   a acuerdo comercial con el cliente.
4. **Asignación de tienda por texto** no reproduce los números oficiales por tienda salvo casos
   simples; se recomendó pedir al negocio un **maestro de tiendas** (bodega → TAT → regional)
   para dejar de depender de reglas de texto frágiles.

> Estos hallazgos son del informe TAT en PDF, pero aplican igual si este dashboard llega a
> conectarse a las mismas fuentes: no asumir números "oficiales" por tienda/CEDI hasta tener el
> maestro de tiendas.

### 11.2 Investigación web — Regional real y distribución de CEDIs (2026-07-01)

Se investigó en la web cómo Huevos Kikes / Incubadora Santander gestiona sus regionales y
distribuye sus CEDIs, para no seguir usando el catálogo de 15 departamentos (invención propia sin
confirmar, usado hasta esta fecha como filtro "Región"). Hallazgos:

- **Huevos Kikes no publica** en su web, LinkedIn, prensa ni ofertas de empleo los nombres de sus
  zonas/regionales comerciales. No hay fuente externa que confirme "Occidente / Costa Oriente /
  Centro" como nomenclatura oficial de la empresa — esos nombres solo se conocen por las fuentes
  internas (informe PDF y `ventas-1.xlsx`).
- Sí hay dos cifras **oficiales confirmadas** en huevoskikes.com: **14 CEDIs** y **16 ciudades con
  presencia comercial** (sin nombrarlas). Estas dos cifras coinciden exactamente con la geografía
  ya usada en este dashboard: 14 CEDIs reales (Occidente 6 + Costa Oriente 6 + Centro 2) + Caloto
  y Pereira = 16 ciudades en total.
- El patrón de nomenclatura "Costa / Occidente / Centro / Centro Oriente" para zonas comerciales
  **sí es una convención reconocida en el sector FMCG colombiano** (usada, con sus propios límites,
  por Bavaria y Grupo Éxito), pero **cada empresa define sus propios límites** — no existe un
  mapeo estándar de industria que se pueda aplicar a Huevos Kikes sin confirmación directa.
  Conclusión: la inconsistencia de nombres de ZONA entre el extracto del 25/06 ("COSTA",
  "CENTRO ORIENTE") y el informe del 30/06 ("COSTA ORIENTE", "CENTRO") es previsible en una
  empresa que usa este tipo de convención de forma informal — probablemente un cambio de límites o
  de versión entre fechas, no un error de tipeo. **Sigue pendiente de confirmar con el dueño del
  dato en el ERP.**

**Cambio aplicado en el dashboard:** el filtro "Región (departamento)" se reemplazó por
**"Regional"**, usando la Regional real de las fuentes (Occidente / Costa Oriente / Centro) con
sus CEDIs reales tal como aparecen en el informe. Caloto (planta) y Pereira (sin tienda TAT ni
ZONA confirmada) quedan en un cuarto grupo explícito, **"Sin regional TAT confirmada"**, en vez de
asignarles una regional adivinada. Con esto, el filtro de "Regional TAT" que existía por separado
en las vistas Alerta 1/Alerta 2 quedó redundante y se eliminó — ahora hay un solo filtro de
Regional en toda la app.

### 11.1 Dashboard con datos REALES del informe (actualizado 2026-07-01)

El dashboard se reestructuró primero para *imitar la lógica* del informe real
`Informe_Dias_Inventario_30062026_19.pdf` (corte 30/06/2026) con cifras simuladas, y después se
reemplazaron esas cifras por los **números literales** del informe y de `ventas-1.xlsx` (archivos
del cliente, no versionados en este repo por ser datos comerciales). Estado actual:

**100% real (literal del informe, en `assets/js/data.js`):**
- **Detalle por Talla** (`DB.items`): YUMBO/XXL, HUEVO DE SEGUNDA, M, XL, B, C, L, AA, A, AAA, con
  inventario/venta/días exactos del informe (pág. 1). AAA sin venta → días `null` → se muestra "—".
- **Indicadores de compañía** (`DB.meta`): inventario total 27.251.311, huevo sin clasificar
  2.743.834, días de inventario global 5,2 — no cambian con los filtros, igual que en el informe.
- **Días de Inventario TAT por Regional** (`DB.regionalTAT`): Occidente / Costa Oriente / Centro
  (pág. 2), agregado independiente de las tablas por tienda — el informe no los reconcilia entre
  sí y este dashboard tampoco lo fuerza.
- **Alerta 1** (`DB.tiendasTAT` con `alerta:1`): 4 tiendas con cobertura ≥5 días (pág. 3), literal.
- **Alerta 2** (`DB.tiendasTAT` con `alerta:2`): 11 tiendas con cobertura <5 días + PEPS por
  referencia (págs. 3-5), literal — incluye el detalle por tienda/referencia con "unidades en
  riesgo" y "días a vender".
- **Alerta 3**: el informe no reporta ninguna tienda (nota literal en `DB.notaAlerta3`).

**Discrepancia conocida, documentada tal cual (no "corregida"):** el encabezado de "Referencias en
riesgo" (pág. 4) dice literalmente 9 tiendas / 22 referencias / 1.250.738 unidades
(`DB.alerta2Resumen`), pero sumar las filas de detalle de esas mismas 9 tiendas da 42 filas /
1.013.661 unidades. Es una inconsistencia del propio informe (consistente con los demás problemas
de calidad de dato ya documentados en `pipeline/PROYECTO_TAT_MEMORIA.md`) — el dashboard muestra
**ambos números** (el del encabezado, fijo, y el recalculado sobre el alcance filtrado) sin
intentar reconciliarlos.

**Reestructuración de menú (2026-07-01):** las vistas "Alerta 1" y "Alerta 2" del menú se
fusionaron en una sola sección **TAT** (dos bloques en la misma vista, cada uno con su panel de
filtros). Ambas alertas tienen filtro de tiempo tipo slider: el **"Umbral de cobertura (días)"**
se movió del panel de Alerta 1 al panel de **filtros generales** (🔍 Filtros de la topbar) y es el
corte que separa ambas alertas: Alerta 1 muestra tiendas con cobertura ≥ umbral; Alerta 2 muestra
las tiendas con "días a vender" < umbral (las sin dato se conservan) **más las tiendas de Alerta 1
cuya cobertura cae bajo el umbral** (al subirlo migran de bloque, con una nota "entra por el
umbral actual" bajo el nombre — sus "días a vender"/referencias salen "—"/vacías porque el informe
no las publica para Alerta 1). Además Alerta 2 tiene su slider propio "Máx. días a vender"
(0–5 d, tope = sin límite), que refina tanto tiendas como referencias. Las subtablas de referencias de Alerta 2 dejaron de ser desplegables:
ahora se muestran fijas debajo de cada tienda. Se agregó la columna **"Edad máx. (d)"** en las
**subtablas de referencias** (`edadMax` en cada referencia de `DB.tiendasTAT`, no a nivel de
tienda), calculada con la regla que definió el cliente (2026-07-01): **edad máx. = ventana de
frescura (5 d) + "días a vender"** (p. ej. 1.3 → 6.3, 0.7 → 5.7). Las referencias sin "días a
vender" (venta 0 o negativa) muestran "—". Antes de adoptar esta regla se verificó que la edad no
era derivable de `ventas-1.xlsx` (venta transaccional 26–29/06 sin fecha de lote; su
`fecha_vencimiento` es el plazo de pago de la factura, con términos de crédito 0/15/30/60 días).

**Cruce con ventas-1.xlsx (2026-07-01) — huecos del informe llenados con venta real:** se validó
que la "venta día" del informe sale de `ventas-1.xlsx` con la fórmula **unidades vendidas ÷ días
con venta** (26, 27 y 29/06; el 28 fue domingo): TAT Cúcuta cuadra exacto a nivel tienda
(324.958 ÷ 3 = 108.319) y por referencia (2.245 y 600). Con esa fórmula validada, y solo con
coincidencias EXACTAS de nombre de referencia, se llenaron los huecos del informe (marcados
`deVentas: true` en `data.js` y "· ventas reales" en la UI): (a) referencias de TAT Cartagena
(3) y TAT Sincelejo (2, ÷2 días), que el informe dejaba sin detalle — solo venta día; su
inventario/en riesgo no existe en el Excel → "–"; (b) TAT Bogotá Siberia, que el informe dejaba
con venta 0 "no asignable": venta real 60.533/día → días a vender 0,5; (c) 5 referencias con
venta 0 en el informe pero con venta real (YUMBO X20 en Montevideo/Pastó/Medellín, XL X 15 PET
CAJA X 300 en Pasto, XL X 15 - TAT en Siberia), con "días a vender" recalculado con la fórmula
del informe. Las 12 referencias que siguen en venta 0 NO tienen venta en el Excel (o solo con
variantes de nombre distintas, p. ej. "- BUCAROS" vs "- BGA") — se dejaron tal cual.

**Sin fuente real todavía (se muestra así, no se inventa un número):**
- El desglose de inventario **por día de edad y por CEDI** (histograma, tabla CEDI × día) requiere
  el archivo de inventario con lotes fechados (hoja `INV. EDADES` del `.xlsm`), que no se ha
  recibido — ver sección 0.1 de `pipeline/PROYECTO_TAT_MEMORIA.md`. Se retiró de la vista Resumen
  y se reemplazó por "Días de inventario por talla" (gráfica de los datos reales que sí existen).
- Los canales **Food Service, Grandes Superficies, Hard Discount y Mayoristas** no tienen fuente
  real (el informe solo cubre TAT) — su pestaña muestra un estado vacío explícito en vez de datos
  simulados (`DB.canales[].datosReales === false`).
- El **histórico de 90 días** sigue siendo una serie ilustrativa (el informe es la foto de un solo
  corte, no hay serie temporal real disponible) — la vista lo indica explícitamente.

- **Regional TAT** (Occidente / Costa Oriente / Centro, `DB.regionalesTAT`) es la agrupación
  comercial del informe, distinta del departamento geográfico usado para Nacional/Regional/CEDI.
  Se usa como filtro especializado en las vistas Alerta 1/2 y Canales → TAT.

---

## 12. Fuentes web consultadas

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
