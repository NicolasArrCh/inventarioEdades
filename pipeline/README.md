# Pipeline TAT — código de referencia (v2, actualizado 01/07/2026)

Dos archivos, separación deliberada entre **lógica de negocio** y **maquetación**:

```
tat_pipeline.py   -> lee los 3 xlsx, aplica TODAS las reglas de negocio, escribe un JSON.
                      NO TOCAR para cambios de diseño/layout. Es la fuente de verdad de las
                      reglas (ver PROYECTO_TAT_MEMORIA.md, secciones 2, 3 y 0.1).

tat_report.py     -> lee ese JSON, construye el HTML y lo convierte a PDF con wkhtmltopdf.
                      ESTE es el archivo donde debe vivir el trabajo de maquetación/rediseño.
                      Cambiar CSS, orden de secciones, agregar gráficos, etc. aquí, sin
                      tocar tat_pipeline.py.
```

## Requisitos

```bash
pip install pandas numpy openpyxl
# wkhtmltopdf debe estar instalado en el sistema (apt install wkhtmltopdf / brew / choco)
```

## Uso

```bash
# 1) Calcular todo y dejarlo en un JSON
python tat_pipeline.py \
  --inv-hoy Inventario_Hoy.xlsx \
  --inv-ayer Inventario_Ayer.xlsx \
  --ventas ventas.xlsx \
  --out datos_tat.json

# 2) Generar el informe (PDF)
python tat_report.py --datos datos_tat.json --out informe.pdf

# (o solo el HTML, para iterar más rápido en la maquetación sin esperar el render a PDF)
python tat_report.py --datos datos_tat.json --out informe.html --solo-html
```

Separar los dos pasos significa que para la próxima corrida con inventarios más recientes
**no hay que tocar código**, solo volver a correr el paso 1 con los archivos nuevos y luego el
paso 2.

## Qué cambió en v2 (validado contra `Informe_Dias_Inventario_30062026_19.pdf` + `ventas-1.xlsx`)

Ver el detalle completo en `PROYECTO_TAT_MEMORIA.md` sección 0.1. Resumen:

- ✅ Venta diaria promedio ahora **excluye domingo** (confirmado exacto contra datos reales).
- ✅ KPI "Inventario Total" / "Días de Inventario Global" pasó a ser de **toda la compañía**,
  no solo TAT (confirmado exacto).
- ✅ Umbral Alerta 1 / Alerta 2 cambió de **≥6 a ≥5 días** de cobertura (confirmado por texto
  explícito del PDF real). El semáforo visual (rojo ≥6) NO cambió — son reglas independientes.
- ✅ El PEPS ("a gestionar") ahora se calcula para **todas las tiendas TAT**, no solo las que
  quedan fuera de Alerta 1. Se agregó la métrica **"días a vender"** (a_gestionar ÷ venta_diaria).
- ⚠️ **Sin resolver todavía**: la asignación de tienda por texto (`asignar_tienda`, columna J)
  no reproduce los números oficiales por tienda. Se encontró evidencia de que la columna
  `id_bodega` (presente en `ventas-1.xlsx`) identifica la tienda física con mucha más precisión
  — recomendación: pedir al negocio un maestro de tiendas (bodega → TAT → regional) en vez de
  seguir parchando reglas de texto. Ver sección 0.1 del `.md` para el detalle completo.

## Validado contra la corrida de referencia (25/06/2026)

Corriendo este código con los 3 archivos originales del 25/06 se reproducen los mismos
resultados de fondo que el informe ya entregado (días global TAT 4.5 con la lógica vieja,
conciliación 86.5% / 9.6% / 3.9%); los números de alertas cambian un poco respecto a la primera
entrega porque ahora usan el umbral de 5 días confirmado en vez del umbral de 6 que se había
asumido antes de tener el PDF real de referencia.

## Qué NO incluye todavía este paquete (a propósito)

Las secciones 5, 6 y 7 del PDF original (Hallazgos y Pendientes, Fuentes y Trazabilidad) se
dejaron fuera de `tat_report.py` porque eran texto narrativo escrito a mano sobre los hallazgos
de ESA corrida puntual (Bogotá sin distinguir, Pereira/Montería, etc. — ver
`PROYECTO_TAT_MEMORIA.md` sección 6). Si se quiere que el informe siga mostrando esos
hallazgos en cada corrida, hay dos caminos:
1. Calcularlos dinámicamente dentro de `tat_pipeline.py` (por ejemplo: cuánto pesa
   `TAT BOGOTA (sin distinguir)` o el total huérfano cada vez que se corre), y agregarlos al
   JSON para que `tat_report.py` los muestre con números actualizados.
2. Dejarlos como página estática de metodología (texto fijo) en `tat_report.py`.

No se decidió cuál — queda como punto a definir con el resto del trabajo de maquetación.

## Pendiente bloqueante

Todavía no se ha recibido ningún archivo de inventario (`.xlsm`/`.xlsx`) de una fecha reciente
(ni la versión actual del 25/06, ni `INVENTARIO_30_06_2026.xlsm`). Sin eso no se puede: refrescar
el diccionario descripción→categoría con los artículos nuevos, validar la conciliación, ni
confirmar los nombres de regional actuales (`ZONA`). Es el siguiente archivo a conseguir antes
de dar el pipeline por completamente validado en v2.

