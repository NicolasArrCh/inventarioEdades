# Proyecto: Días de Inventario y Frescura TAT — Huevos Kikes

> Documento de continuidad para Claude Code. Contiene el contexto de negocio, las reglas
> acordadas, la metodología ya implementada y validada contra datos reales, y los pendientes
> de decisión. El objetivo inmediato sobre este repo es **mejorar la maquetación** del informe
> (hoy HTML→PDF con wkhtmltopdf) y dejarlo listo para recibir inventarios más recientes de forma
> recurrente.

## 0. Archivos que acompañan este documento

Este `.md` no va solo — va junto con un paquete de código ya probado contra los datos reales:

- `tat_pipeline.py` — pipeline completo (carga + todas las reglas de negocio de las
  secciones 2 y 3 de este documento) → produce un JSON. **No tocar para temas de
  maquetación.**
- `tat_report.py` — capa de presentación: lee ese JSON, construye el HTML y lo pasa a PDF.
  **Aquí es donde debe trabajarse el rediseño/maquetación.**
- `README.md` — cómo instalar y correr ambos.

Los tres archivos están en la misma carpeta que este documento. Cópialos a la raíz del repo
(o a una carpeta `pipeline/`) junto con este `.md`.

### Qué falta para un handoff 100% completo (honesto, no asumido)

- **Sigue sin llegar ningún archivo de inventario `.xlsm`/`.xlsx` actual** (ni el del 25/06 en
  su versión más reciente, ni `INVENTARIO_30_06_2026.xlsm`). Todo lo de inventario en este
  documento viene de la corrida del 25/06 o de leer los números ya calculados en el PDF del
  30/06 — nada de eso está probado end-to-end contra un archivo de inventario actual. Es el
  bloqueante #1 para dejar esto verdaderamente cerrado.
- **No sé qué hay actualmente en el repo `inventarioEdades`** (no tuve acceso): si ya existe
  código, stack de maquetación elegido (HTML plano, algún framework, etc.), o si está vacío.
  Esto cambia cómo debe encararse el trabajo de rediseño — conviene aclararlo antes de que
  Claude Code empiece a escribir código nuevo que choque con lo existente.
- Las secciones de "Hallazgos y Pendientes" y "Fuentes" del PDF original (texto narrativo
  sobre la corrida del 25/06) no están replicadas en `tat_report.py` — ver el README del
  paquete de código para las dos opciones de cómo cerrarlas.
- `tat_pipeline.py` fue actualizado (ver sección 0.1) con reglas confirmadas contra
  `ventas-1.xlsx`, pero la asignación de tienda por texto (columna J) sigue sin reproducir los
  números oficiales por tienda — tratar esos números como aproximados hasta tener un maestro de
  tiendas (ver sección 0.1).




## 0.1 Actualización — validado contra `Informe_Dias_Inventario_30062026_19.pdf` + `ventas-1.xlsx`

El 01/07/2026 el usuario compartió un informe ya generado (30/06/2026, fuentes
`INVENTARIO_30_06_2026.xlsm` + `ventas.xlsx`) y el archivo de ventas correspondiente
(`ventas-1.xlsx`, mismo esquema de columnas que antes: F=`cantidad`, I=`descripcion_articulo`,
J=`descripcion`, AL=`nombre_ciudad`, más columnas nuevas como `id_bodega`, `nom_negocio`,
`ciudad_entrega`). **No se recibió el `.xlsm` de inventario** — por eso lo de abajo se pudo
confirmar solo del lado de venta; el lado de inventario quedó como hipótesis a validar.

### Confirmado con certeza alta (reproducido exactamente contra `ventas-1.xlsx`)

- **La venta diaria promedio EXCLUYE domingo.** El PDF lo dice explícito ("vie 26, sáb 27, lun
  29" — salta el domingo 28 aunque el archivo sí trae ventas de ese día). Sumando
  `cantidad` de todo el archivo sin domingo y dividiendo entre 3 se reproduce **exacto** el
  total de venta día de la compañía del PDF (5.277.822). **Ya implementado en
  `tat_pipeline.py`** (filtra `dow == 6` antes de promediar).
- **El KPI "Inventario Total" / "Días de Inventario Global" es de TODA LA COMPAÑÍA**, no solo
  TAT (27.25M unidades, muy por encima de cualquier cifra TAT-only). Se confirmó cruzando
  27.251.311 ÷ 5.277.822 ≈ 5,2 días = el KPI del PDF. **Ya implementado**: `tat_pipeline.py`
  ahora calcula `inv_total_general_compania` (sin filtrar TAT) para ese KPI específico: el resto
  de secciones del informe (regional, alertas) siguen siendo TAT-específicas como antes.

### Confirmado por texto explícito del PDF (alta confianza, sin necesitar el .xlsm)

- **El umbral que separa Alerta 1 / Alerta 2 cambió a 5 días, no 6.** El PDF dice literalmente
  "Alerta 1 — Sobre-inventario (cobertura ≥ 5 días)". El semáforo visual (gris/verde/rojo) se
  mantiene igual (rojo sigue siendo ≥6) — son dos reglas independientes, no hay que confundirlas.
  **Ya implementado.**
- **El "a gestionar" (PEPS) ahora se calcula para TODAS las tiendas TAT**, no solo para las que
  quedan fuera de Alerta 1 (antes se excluían del todo). Cada tienda tiene su propio PEPS; luego
  se bucketiza en Alerta 1 o Alerta 2 según su cobertura total (≥5 o <5). **Ya implementado**
  (`calcular_peps_todas_tiendas` + `construir_alertas_1_y_2` en `tat_pipeline.py`).
- **Nueva métrica: "días a vender"** = a_gestionar ÷ venta_diaria de esa tienda (cuánto tardaría
  en liquidarse el sobrante al ritmo actual). **Ya implementado** como `dias_a_vender`.
- Alerta 3 (riesgo de quiebre ≤1 día) no cambió de umbral.

### Hallazgo importante, NO implementado todavía (necesita decisión + validación)

**La asignación de tienda por texto (columna J) no reproduce los números oficiales por tienda.**
Se comparó, tienda por tienda, la venta Verde/Canasta diaria calculada con la lógica actual
(`asignar_tienda`, basada en texto) contra el "VENTA DÍA" de la Alerta 2 del PDF real:
Sincelejo dio idéntico (12.582 = 12.582), pero el resto difiere bastante — Bogotá Montevideo
sale en 170.368 con la lógica de texto vs. 434.188 en el PDF oficial (61% más bajo).

Investigando por qué, se encontró que **`ventas-1.xlsx` trae una columna `id_bodega`** que
identifica la tienda física de forma mucho más precisa que el texto libre de `descripcion`:
- Cada tienda de Bogotá tiene su propio rango de código: Siberia = `H500x` (H5001–H5012),
  Montevideo = `H520x` (H5201–H5237). Estos rangos SIEMPRE coinciden con lo que dice el texto
  cuando el texto es explícito.
- Para el canal genérico "BLINDAR" (que en texto no dice si es Montevideo o Siberia), el
  `id_bodega` real de cada fila SÍ trae el código de la tienda física exacta (mezcla de códigos
  `H500x` y `H520x`) — es decir, **`id_bodega` puede resolver la ambigüedad de Bogotá que el
  texto no puede**.
- Ojo: no es una solución completa. Otros subcanales genéricos de Bogotá (`FOOD SERVICE`,
  `ESPECIAL`, `GRANDES SUPERFICIES`, `AUTOSERVICIO`) tienen su propio `id_bodega` "virtual"
  (ej. `FS59`, `H5940`, `H5960`, `H5250`) que **no** corresponde a una tienda física específica
  — para esos, ni texto ni `id_bodega` alcanzan solos.

**Recomendación para Claude Code**: antes de seguir parchando la función `asignar_tienda` con
más reglas de texto, vale la pena pedirle al negocio un **maestro de tiendas** (código de
bodega/punto de venta → tienda TAT → regional). Con eso, la asignación deja de depender de
parsear texto libre (frágil, con casos especiales creciendo) y pasa a ser un simple `JOIN`,
mucho más robusto y fácil de mantener. Mientras no se tenga ese maestro, los números por tienda
de `tat_pipeline.py` deben tratarse como aproximados, no oficiales.

### Otro punto a verificar (no se pudo confirmar sin el `.xlsm`)

- El PDF usa los nombres de regional **"COSTA ORIENTE"** y **"CENTRO"**, mientras que el campo
  `ZONA` de la hoja `inv` que analizamos el 25/06 traía **"COSTA"** y **"CENTRO ORIENTE"**
  (ver sección 2.1). Puede ser que el archivo `.xlsm` actual tenga los valores de `ZONA`
  escritos distinto, o que la maquetación les cambió el nombre para mostrar. **No hardcodear
  ninguno de los dos sin confirmar contra el `.xlsm` real más reciente.**
- No se pudo confirmar si "Detalle por Tipo de Huevo 2" / "Detalle por Talla" del PDF son
  también de toda la compañía (como el KPI) o TAT-only (como se había construido antes) — el
  total de venta de esa tabla (5.277.822) coincide con el total de compañía, lo que sugiere que
  sí es a nivel compañía completa, pero falta el inventario real para confirmar del todo.

## 1. Contexto y objetivo

Huevos Kikes (Incubadora Santander S.A.) necesita un informe automatizado (PDF) de **días de
inventario** para el canal TAT (tienda a tienda), que calcule cobertura por tipo de huevo, talla
y regional, y genere alertas de sobre-inventario y de riesgo de frescura. El análisis cruza un
archivo de inventario y un archivo de ventas diario.

Ya existe una primera versión funcional del pipeline (Python/pandas) y del informe (HTML/CSS →
PDF con `wkhtmltopdf`), validada contra datos reales del 25/06/2026. Este documento resume esa
versión para que el trabajo de maquetación/repo continúe sin perder las reglas de negocio ni los
hallazgos ya descubiertos.

## 2. Fuentes de datos

Tres archivos de entrada, típicamente `.xlsx`:

| Archivo | Rol |
| --- | --- |
| `Inventario_Hoy.xlsx` | Inventario al corte del informe (snapshot del día) |
| `Inventario_Ayer.xlsx` | Snapshot del día anterior, usado solo para comparativo de KPIs |
| `ventas.xlsx` | Detalle transaccional de venta, normalmente cubre varios días (no un solo día) |

### 2.1 `Inventario_*.xlsx` — hoja **`inv`**

Inventario consolidado por artículo (snapshot completo, todas las categorías). Es la fuente de
verdad para: inventario total TAT, detalle por Tipo de Huevo 2, detalle por Talla, inventario
Verde/Canasta por tienda (base de Alertas 1 y 3), y el lado "inventario total" de la
Conciliación.

Columnas clave:
- `cantidad` — unidades
- `descripcion_articulo` — nombre del artículo (de aquí se derivan talla y tipo)
- `DESTINO` — tienda/CEDI/planta (ej. `TAT BARRANQUILLA`, `TAT CE BOGOTA`)
- `GRUPO` — `BODEGA` / `TRANSITO` / `VEHICULOS` / `PLANTA CLASIFICACION` / `HUEVO SIN CLASIFICAR`
- `TIPO DE HUEVO` — **talla** (A, AA, AAA, B, C, L, M, XL, YUMBO, SEGUNDA, HUEVO SIN CLASIFICAR)
- `TIPO DE HUEVO 2` — categoría física (`VERDE`, `EMPACADOS`, `SEGUNDA`, `GRIS SUELTO`,
  `ETIQUETA`, `HUEVO SIN CLASIFICAR`)
- `ZONA` — **regional, fuente de verdad** (`COSTA`, `OCCIDENTE`, `CENTRO ORIENTE`,
  `CENTRO DE EMPAQUES`, o `-` para plantas). No mapear regional manualmente por ciudad: usar
  este campo.

⚠️ **Bug ya corregido**: para filtrar tiendas TAT excluyendo Centros de Empaque (CE), **no**
usar `~DESTINO.str.contains('CE')` — eso excluye por error `TAT SINCELEJO` y
`TAT VILLAVICENCIO` (ambos contienen la subcadena "CE"). Usar lista explícita de exclusión:
```python
CE_DESTINOS = {'TAT CE BARRANQUILLA', 'TAT CE BOGOTA', 'TAT CE CALI',
               'TAT CE MEDELLIN', 'TAT CE MONTERIA'}
mask = DESTINO.str.contains('TAT') & ~DESTINO.isin(CE_DESTINOS)
```

### 2.2 `Inventario_*.xlsx` — hoja **`INV. EDADES`**

Inventario **fechado por lote** (no por artículo agregado). Solo cubre huevo Verde/Canasta y
Empacado-con-talla **ya recepcionado y clasificado en bodega** — por eso es mucho más chico que
`inv` (en la corrida de referencia: 4.47M vs. 10.47M unidades). Es la fuente para el modelo de
frescura PEPS (Alerta 2) y el lado "con edad" de la Conciliación.

Columnas clave: `DESTINO`, `Edad` (días, observado rango 1–17), `CANTIDAD`, `Referencia`,
`tipo` (mismo significado que `TIPO DE HUEVO 2` en `inv`; usar `tipo == 'VERDE'` para la familia
"HUEVO (TALLA) X (CANT) CARTON VERDE CANASTA"), `ZONA`.

⚠️ **Inconsistencia de nombre conocida**: Pereira aparece aquí como `OL. PEREIRA`, no como
`TAT PEREIRA` (como en el resto de hojas). Armonizar con un rename antes de cruzar:
```python
RENAME_DESTINO = {'OL. PEREIRA': 'TAT PEREIRA'}
```

### 2.3 `ventas.xlsx` — hoja **`ventas`**

Detalle transaccional. **No viene pre-filtrado a un solo día**: en la corrida de referencia traía
3 días de transacciones (23–25 jun 2026). Venta diaria = promedio sobre los días disponibles
(`total / n_dias`), no un solo día puntual como en versiones previas del informe.

Columnas clave (nombres reales del archivo, no letras de Excel):
- `cantidad` (col. F) → unidades vendidas. Puede venir **negativa por fila** (notas
  crédito/devoluciones ya netedas a nivel de fila) — sumar directo da venta neta correcta, no
  hace falta restar `cantidad_devuelta` aparte.
- `descripcion_articulo` (col. I) → para talla y Tipo de Huevo 2
- `descripcion` (col. J) → texto del canal/tienda; **filtro e identificación de tienda TAT**
- `nombre_ciudad` (col. AL) → ciudad real; usar solo como **respaldo** cuando `descripcion` no
  trae ciudad explícita (ver sección 4.3)
- `fec_venta` → para promediar por número de días reales presentes en el archivo

## 3. Reglas de negocio acordadas

### 3.1 Semáforo de días de inventario
| Estado | Rango | 
| --- | --- |
| Gris | 0–2 días |
| Verde | 3–5 días |
| Rojo | ≥6 días |

### 3.2 Regla "GRIS manda" (aplica a inventario Y a venta, por separado)

Todo artículo cuyo nombre contiene `GRIS` se suma **también** a la categoría `GRIS SUELTO`,
**sin restar** de su categoría de origen (los `EMPACADOS`/`SEGUNDA` que tengan "GRIS" en el
nombre — normalmente porque vienen en bandeja/canasta gris, no porque sean huevo gris suelto —
conservan su total completo en su categoría original). Hay solape intencional: la suma de
categorías no da el total real. Marcar con asterisco en el informe.

```python
overlap = df[(df['contiene_GRIS_en_nombre']) & (df['categoria'] != 'GRIS SUELTO')]['cantidad'].sum()
total_gris_suelto_final = base_gris_suelto + overlap   # EMPACADOS/SEGUNDA mantienen su total intacto
```

Esto aplica igual para inventario (`inv`, campo `TIPO DE HUEVO 2`) y para venta, donde la
categoría hay que derivarla con un diccionario `descripcion_articulo → TIPO DE HUEVO 2`
construido desde la propia hoja `inv` (no hardcodear), con fallback por palabras clave si el
artículo no aparece en el diccionario: `ETIQUETA`, `GRIS`→`GRIS SUELTO`, `ROJO`→`GRIS SUELTO`,
`REVOLTURA`→`SEGUNDA`, `CARTON VERDE`→`VERDE`.

### 3.3 Filtro de venta canal TAT — usar "contiene TAT", no "empieza por TAT "

Existían dos reglas documentadas en conflicto. Validado contra datos reales: **usar
`descripcion.str.contains('TAT')`**. Si se usa "empieza por TAT " se pierden subcanales reales
como `ROTURAS TAT BARRANQUILLA` / `ROTURAS TAT BUCARAMANGA` (sí son TAT, no empiezan con la
palabra TAT).

**Hallazgo pendiente de decisión de negocio**: hay canales que SÍ son funcionalmente TAT
(Food Service, Autoservicios, Ruta Especial) pero **no contienen la palabra "TAT"** en
Pereira y Montería:
- `FOOD SERVICE PEREIRA - OP`
- `PEREIRA - RUTA ESPECIAL OPERADOR`
- `MONTERIA-AUTOSERVICIOS OPERADOR`

Bajo la regla oficial quedan fuera del total TAT. Impacto medido en la corrida de referencia:
~13.180 u/día fuera del oficial. Esto hace que `TAT PEREIRA` aparezca con venta ≈0 (no
calculable) pese a tener inventario. **No se resolvió por decisión propia — está documentado
como hallazgo, no aplicado al total oficial.**

### 3.4 Asignación de tienda TAT y regional (venta)

Estrategia validada, en este orden de prioridad:

1. **Texto del canal (`descripcion`/J) primero**: si menciona explícitamente una ciudad/tienda,
   usar esa coincidencia (más confiable que la ciudad real, que tiene ruido — filas con ciudad
   "rara" cruzada por error de sistema).
2. **Códigos genéricos sin ciudad en el texto** (ej. `TAT H1050 - AUTOSERVICIOS`): resolver por
   `nombre_ciudad` real de esas filas específicas (no por rango numérico del código, que no es
   confiable). Mapeo ya validado:
   ```python
   CODIGO_GENERICO_STORE = {
       'TAT H1050 - AUTOSERVICIOS': 'TAT BUCARAMANGA',
       'TAT H2050 - AUTOSERVICIOS': 'TAT CALI',
       'TAT H3050 - AUTOSERVICIOS': 'TAT MEDELLIN',
       'TAT H4050 - AUTOSERVICIOS': 'TAT BARRANQUILLA',
       'TAT H4150 - AUTOSERVICIOS': 'TAT CARTAGENA',
   }
   ```
3. **Bogotá sin Montevideo/Siberia explícito en el texto** (`TAT BOGOTA - H5200`,
   `TAT BOGOTA - ESPECIAL - H5490`, `TAT BOGOTA - GRANDES SUPERFICIES - H5960`,
   `TAT BOGOTA-BLINDAR H5949`, `TAT - FOOD SERVICE BOGOTA - FS59`,
   `TAT H5250 - AUTOSERVICIO - BOGOTA`): **no se puede distinguir**, ni por texto ni por ciudad
   (ambas tiendas reportan `Bogota D.C.`). Bucket aparte: `TAT BOGOTA (sin distinguir)`.
   **Hallazgo importante**: este bucket pesa ≈120.000 u/día — casi tan grande como la venta
   propia de Montevideo. No tiene inventario propio asociado (no entra en tabla por tienda ni
   en alertas), pero sí se debe mostrar el monto en hallazgos/notas.
4. **Regional**: una vez resuelta la tienda, el regional sale del campo `ZONA` de la hoja `inv`
   (sección 2.1) — no de un mapeo manual de ciudades.

### 3.5 Inventario TAT para alertas (Alerta 1 y 3) y para el modelo PEPS (Alerta 2)

- Base = familia "HUEVO (TALLA) X (CANT) CARTON VERDE CANASTA" = `TIPO DE HUEVO 2 == 'VERDE'`
  (en `inv`) / `tipo == 'VERDE'` (en `INV. EDADES`). Confirmado contra datos reales: esta
  categoría corresponde exactamente a esa familia de artículos (incluye variantes -BGA,
  -BARRANQUILLA, YUMBO).
- **Alerta 1 / 3 (cobertura por tienda)**: usar inventario **total** (`inv`, todas las
  filas con `GRUPO` — bodega + tránsito + vehículos, ya que todo está asignado a un `DESTINO`
  específico) dividido por venta diaria promedio Verde/Canasta de esa tienda.
- **Alerta 2 (frescura PEPS)**: usar solo `INV. EDADES` (inventario ya clasificado en bodega,
  el único que tiene edad), excluyendo tiendas ya señaladas en Alerta 1.

### 3.6 Modelo de frescura PEPS (Alerta 2) — umbral 5 días (pendiente de confirmar con negocio)

Por tienda: ordenar lotes de **más viejo a más nuevo** (PEPS = se despacha primero el más
antiguo). Recorrer la fila acumulando "lo que ya está delante":

```python
UMBRAL = 5
running_ahead = 0.0
a_gestionar_vencido = 0.0      # lotes con Edad >= UMBRAL: van enteros aquí
proyectado_a_cruzar = 0.0      # parte de lotes con Edad < UMBRAL que no alcanza a salir

for edad, cantidad in lotes_ordenados_de_mas_viejo_a_mas_nuevo:
    if edad >= UMBRAL:
        a_gestionar_vencido += cantidad
        running_ahead += cantidad
    else:
        margen = UMBRAL - edad
        capacidad_total = venta_diaria_tienda * margen
        capacidad_disponible = max(0.0, capacidad_total - running_ahead)
        despachable = min(cantidad, capacidad_disponible)
        en_riesgo = cantidad - despachable
        proyectado_a_cruzar += en_riesgo
        running_ahead += cantidad

a_gestionar_total = a_gestionar_vencido + proyectado_a_cruzar
```

`a_gestionar_total` es el KPI de la Alerta 2 por tienda (con subtotales por regional). El
detalle por referencia (para validar con el equipo comercial) son los lotes con `edad < UMBRAL`
y `en_riesgo > 0`, ordenados por `en_riesgo` descendente.

## 4. Conciliación de inventario (sección 4 del informe)

Brecha = inventario total (`inv`, tiendas TAT sin CE) − inventario con edad (`INV. EDADES`,
mismo universo). Descomponer en 3 causas:

1. **En movimiento** (`GRUPO` ∈ {TRANSITO, VEHICULOS}), solo sobre categorías que `INV. EDADES`
   sí cubre (`VERDE`, `EMPACADOS`, `ETIQUETA`) — es la causa dominante (~86–91% de la brecha).
2. **Categorías sin frescura** (`SEGUNDA`, `GRIS SUELTO`, `HUEVO SIN CLASIFICAR`) — `INV. EDADES`
   no las cubre por definición.
3. **Residual** = inventario en `BODEGA` de categorías con frescura menos el total con edad — es
   el único punto candidato a corrección real de dato (verde sin edad cargada o corte de
   horario).

En la corrida de referencia: 86.5% / 9.6% / 3.9% — y tránsito+vehículos pesaron 50.6% del
inventario TAT total (todas las categorías), más alto que el ~37% histórico mencionado en el
documento base del proyecto. Vale la pena monitorear si esto se sostiene corrida a corrida.

## 5. Estructura del informe (PDF actual)

1. Portada (fecha de corte, fechas de venta promediadas, fuentes)
2. Indicadores generales (KPIs: inventario total, inventario Verde/Canasta, días global,
   comparativo vs. ayer) + Detalle por Tipo de Huevo 2 + Detalle por Talla
3. Días de Inventario TAT por Regional + detalle por tienda
4. Alertas operativas:
   - Alerta 1 — Sobre-inventario (≥6 días)
   - Alerta 3 — Riesgo de quiebre (≤1 día)
   - Tiendas no calculables (venta = 0)
   - Alerta 2 — Frescura PEPS (con subtotales por regional) + detalle por referencia
5. Conciliación de inventario
6. Hallazgos y pendientes detectados en la corrida
7. Fuentes y trazabilidad (qué hoja/columna alimenta cada sección)

Implementación actual: Python (pandas) para todo el cálculo → HTML/CSS (una hoja por sección,
clases `.kpi-card`, `.sem-pill` con colores gris/verde/rojo, `.alerta-box`, `.hallazgo`,
`.fuente-box`) → PDF vía `wkhtmltopdf --enable-local-file-access`. Tamaño A4 horizontal
(landscape), una sección por página.

## 6. Hallazgos abiertos (decisión pendiente del usuario, NO resueltos por cuenta propia)

1. **Bogotá Montevideo vs. Siberia**: resuelto parcialmente (ver 3.4). Queda ≈120.000 u/día sin
   poder distinguir.
2. **Pereira y Montería-Autoservicios**: canales reales sin la palabra "TAT" en el nombre (ver
   3.3). ≈13.180 u/día fuera del total oficial.
3. **Umbral de frescura de 5 días**: el documento base lo marca como pendiente de confirmar
   (¿vida útil del producto o cobertura comercial?). Se usó 5 como valor de trabajo.
4. **TAT Santa Marta** apareció con inventario Verde/Canasta en 0 mientras seguía vendiendo
   (~88.447 u/día) en la corrida de referencia — antes de tratarlo como quiebre real automático
   en próximas corridas, vale la pena una validación con el equipo de la tienda (podría ser un
   corte que no capturó un despacho reciente).
5. **Tallas AA, C, AAA**: pueden no tener venta TAT medible en algunos periodos (consistente con
   el caso de talla C ya documentado en el proyecto original) — marcar `N/C`, no forzar un
   número.

## 7. Objetivo inmediato sobre este repositorio

El usuario (Nicolás) quiere mejorar la **maquetación** del informe dentro de este repo
(`inventarioEdades`), de forma que:
- La estructura visual cuadre con la lógica y secciones ya descritas arriba (no reinventar
  reglas de negocio: este documento es la fuente de verdad de las reglas).
- El pipeline quede listo para recibir **inventarios más recientes** de forma recurrente (no
  solo la corrida puntual del 25/06/2026 usada como referencia/ejemplo en este documento).
- Probablemente conviene parametrizar: fecha de corte, archivo de ventas (y su rango de días
  real, ya que no siempre es un solo día), y los tres archivos de entrada por nombre/ruta.

### Pendiente técnico explícito ya señalado en el documento base del proyecto
- Automatización: parametrizar fecha de corte y archivo de venta para regenerar el informe en
  un clic (este es probablemente el alcance de la maquetación que se va a trabajar ahora).
- Detalle Alerta 1: opcionalmente replicar el desglose por referencia/tienda que ya tiene la
  Alerta 2.

## 8. Notas para quien continúe el trabajo

- No hay un mapeo manual de ciudades a regional — usar siempre el campo `ZONA` de `inv` como
  fuente de verdad.
- Cualquier número específico citado en este documento (inventarios, ventas, días) corresponde
  a la corrida de referencia del 25/06/2026 — sirven para entender el comportamiento esperado y
  validar que el pipeline nuevo da resultados coherentes, no como valores fijos a reproducir.
- Antes de "arreglar" alguno de los hallazgos de la sección 6 de forma automática, confirmar con
  el usuario — varios de ellos cambian totales oficiales y el documento base los deja
  explícitamente como pendientes de decisión de negocio, no de implementación.
