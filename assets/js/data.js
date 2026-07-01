/* =============================================================================
 *  data.js  —  CAPA DE DATOS
 * -----------------------------------------------------------------------------
 *  Fuentes REALES de este archivo (no simuladas):
 *    - Informe_Dias_Inventario_30062026_19.pdf (corte 30/06/2026, informe oficial)
 *    - ventas-1.xlsx (detalle transaccional de venta usado para ese informe)
 *  Ambos son archivos del cliente, no versionados en este repo. Los números de
 *  compañía, Detalle por Talla, Regional TAT, Alerta 1 y Alerta 2 (incluida la
 *  referencia por tienda) están tomados LITERALMENTE de ese informe — ver el
 *  detalle punto por punto en docs/CONTEXTO.md sección 11.
 *
 *  >>> LO QUE SIGUE SIENDO DEMOSTRATIVO <<<
 *  Los canales FS / GS / HD / Mayoristas no tienen fuente real todavía (el
 *  informe solo cubre TAT) — se muestran como "pendiente de fuente real" en
 *  vez de inventar números. (La vista de histórico de 90 días se retiró: no
 *  hay serie temporal real disponible, el informe es la foto de un solo corte.)
 *
 *  >>> PUNTO DE INTEGRACIÓN <<<
 *  Cuando se conecte el backend, este archivo se reemplaza por un `fetch` que
 *  entregue la misma estructura (ver `DB.cargar`). El resto de la app no
 *  necesita cambios.
 *
 *  Estructura expuesta en `window.DB`:
 *    - regiones[] / cedis[]   : geografía real (departamento -> ciudad), ver docs/CONTEXTO.md
 *    - canales[]              : catálogo de canales (solo TAT tiene datos reales hoy)
 *    - items[]                : Detalle por Talla real (inventario, venta, días) — informe pág. 1
 *    - regionalesTAT[]        : nombres de la regional comercial TAT
 *    - regionalTAT[]          : Días de Inventario TAT por Regional real — informe pág. 2
 *    - tiendasTAT[]           : tiendas TAT reales con Alerta 1/2 y PEPS por referencia — pág. 3-5
 *    - alerta2Resumen         : KPIs literales del encabezado de "Referencias en riesgo" (pág. 4)
 *    - meta                   : indicadores de compañía + notas literales del informe
 * ========================================================================== */

(function () {
  'use strict';

  /* --- Parámetros de negocio (ver docs/CONTEXTO.md secciones 6 y 11) ------- */
  const PARAMS = {
    zonas: {
      bajo:   { min: -Infinity, max: 2,        color: 'gris',  label: 'Bajo / sin rotación' },
      optimo: { min: 3,         max: 5,        color: 'verde', label: 'Óptimo' },
      critico:{ min: 6,         max: Infinity, color: 'rojo',  label: 'Exceso / riesgo' },
    },
    ventanaFrescuraDias: 5,
    umbralEdadCriticaDias: 6,          // semáforo visual
    umbralAlertaCoberturaDias: 5,      // Alerta 1/2 real (independiente del semáforo)
    umbralQuiebreDias: 1,              // Alerta 3
    umbralDiscrepanciaIncusan: 0.03,
  };

  /* --- Regional (REAL — reemplaza el departamento geográfico) ------------
   * Antes este catálogo agrupaba los CEDIs por departamento (invención propia,
   * sin confirmar). Se reemplazó por la Regional que SÍ aparece en las fuentes
   * reales (campo ZONA del ERP, visible en el informe pág. 2-3 y en
   * `ventas-1.xlsx`): Occidente / Costa Oriente / Centro. Búsqueda web
   * (2026-07-01, ver docs/CONTEXTO.md sección 11.2) confirmó que Huevos Kikes
   * no publica esta nomenclatura públicamente, pero sí confirma **14 CEDIs**
   * y **16 ciudades con presencia comercial** — cifras que coinciden
   * exactamente con este catálogo (14 CEDIs reales + 2 plantas = 16 ciudades).
   * Caloto (planta) y Pereira (sin tienda TAT ni ZONA confirmada en las
   * fuentes) se dejan en un cuarto grupo explícito en vez de asignarles una
   * regional adivinada. */
  const REGIONES = [
    { id: 'occidente', nombre: 'Occidente', cedis: [
      { id: 'mtr', nombre: 'Montería',  planta: false, reporto: true },
      { id: 'pop', nombre: 'Popayán',   planta: false, reporto: true },
      { id: 'pst', nombre: 'Pasto',     planta: false, reporto: false },
      { id: 'med', nombre: 'Medellín',  planta: false, reporto: true },
      { id: 'cal', nombre: 'Cali',      planta: false, reporto: true },
      { id: 'snc', nombre: 'Sincelejo', planta: false, reporto: true },
    ] },
    { id: 'costa-oriente', nombre: 'Costa Oriente', cedis: [
      { id: 'vup', nombre: 'Valledupar',    planta: false, reporto: false },
      { id: 'ctg', nombre: 'Cartagena',     planta: false, reporto: true },
      { id: 'baq', nombre: 'Barranquilla',  planta: false, reporto: true },
      { id: 'smr', nombre: 'Santa Marta',   planta: false, reporto: true },
      { id: 'cuc', nombre: 'Cúcuta',        planta: false, reporto: true },
      { id: 'buc', nombre: 'Bucaramanga',   planta: true,  reporto: true },
    ] },
    { id: 'centro', nombre: 'Centro', cedis: [
      { id: 'bog', nombre: 'Bogotá',        planta: false, reporto: true },
      { id: 'vvc', nombre: 'Villavicencio', planta: false, reporto: true },
    ] },
    { id: 'sin-regional', nombre: 'Sin regional TAT confirmada', cedis: [
      { id: 'clt', nombre: 'Caloto',  planta: true,  reporto: true },
      { id: 'per', nombre: 'Pereira', planta: false, reporto: false },
    ] },
  ];

  const CANALES = [
    { id: 'TAT', nombre: 'TAT (Tienda a Tienda)', corto: 'TAT', datosReales: true },
    { id: 'FS',  nombre: 'Food Service',          corto: 'FS',  datosReales: false },
    { id: 'GS',  nombre: 'Grandes Superficies',   corto: 'GS',  datosReales: false },
    { id: 'HD',  nombre: 'Hard Discount',         corto: 'HD',  datosReales: false },
    { id: 'MAY', nombre: 'Mayoristas',            corto: 'MAY', datosReales: false },
  ];

  const CEDIS = [];
  REGIONES.forEach(r => r.cedis.forEach(c => CEDIS.push({ ...c, regionId: r.id, regionNombre: r.nombre })));

  /* --- Detalle por Talla (REAL) — Informe pág. 1 -------------------------
   * YUMBO y XXL unificados. AAA sin venta en el periodo (días = null -> "—"). */
  const ITEMS_RAW = [
    { id: 'yuxxl',   nombre: 'YUMBO/XXL',        inventario: 142835,   venta: 13031 },
    { id: 'segunda', nombre: 'HUEVO DE SEGUNDA',  inventario: 3565217,  venta: 359207 },
    { id: 'm',       nombre: 'M',                 inventario: 3131867,  venta: 498503 },
    { id: 'xl',      nombre: 'XL',                inventario: 3528975,  venta: 578456 },
    { id: 'b',       nombre: 'B',                 inventario: 1835728,  venta: 303406 },
    { id: 'c',       nombre: 'C',                 inventario: 130369,   venta: 27574 },
    { id: 'l',       nombre: 'L',                 inventario: 5348193,  venta: 1213323 },
    { id: 'aa',      nombre: 'AA',                inventario: 1725093,  venta: 904332 },
    { id: 'a',       nombre: 'A',                 inventario: 2107863,  venta: 1379990 },
    { id: 'aaa',     nombre: 'AAA',               inventario: 26300,    venta: 0 },
  ];
  const ITEMS = ITEMS_RAW.map(i => ({ ...i, dias: i.venta > 0 ? +(i.inventario / i.venta).toFixed(1) : null }));

  // Categoría real señalada por el cliente que no viene desglosada por talla en
  // el informe: HUEVO CE X 30 CARTON GRIS CANASTA. Se conoce su inventario pero
  // no su venta día, así que no se puede calcular sus "días de inventario" ni
  // mostrarla como fila propia (no hay con qué llenar esa columna) — se suma
  // solo al TOTAL de la tabla, con una nota visible en la vista.
  const AJUSTE_SIN_DESGLOSAR = { nombre: 'HUEVO CE X 30 CARTON GRIS CANASTA', inventario: 2965037 };

  const TALLA_TOTAL = {
    inventario: ITEMS.reduce((a, i) => a + i.inventario, 0) + AJUSTE_SIN_DESGLOSAR.inventario,
    venta: ITEMS.reduce((a, i) => a + i.venta, 0),
  };

  function tallaDeReferencia(nombre) {
    const tok = (nombre.split(' ')[1] || '').toUpperCase();
    if (tok === 'YUMBO') return 'yuxxl';
    const id = tok.toLowerCase();
    return ITEMS.some(i => i.id === id) ? id : 'l';
  }

  // Regiones que sí tienen tiendas TAT reales (excluye "Sin regional TAT confirmada").
  const REGIONALES_TAT = REGIONES.filter(r => r.id !== 'sin-regional').map(r => r.nombre);

  /* --- Días de Inventario TAT por Regional (REAL) — Informe pág. 2 --------
   * "Inventario TAT" = familia CARTON VERDE CANASTA. Esta tabla es una fuente
   * agregada independiente de las tablas de Alerta 1/2 por tienda (pág. 3):
   * el informe real las calcula por separado y no coinciden exactamente si se
   * suman una contra otra — se muestran tal cual, sin forzar su reconciliación. */
  const REGIONAL_TAT_RESUMEN = [
    { nombre: 'Occidente',     inv: 3288160, venta: 886140 },
    { nombre: 'Costa Oriente', inv: 3046714, venta: 872496 },
    { nombre: 'Centro',        inv: 1507885, venta: 442471 },
  ].map(r => ({ ...r, dias: +(r.inv / r.venta).toFixed(1) }));
  const REGIONAL_TAT_TOTAL = (() => {
    const inv = REGIONAL_TAT_RESUMEN.reduce((a, r) => a + r.inv, 0);
    const venta = REGIONAL_TAT_RESUMEN.reduce((a, r) => a + r.venta, 0);
    return { inv, venta, dias: +(inv / venta).toFixed(1) };
  })();

  /* --- Tiendas TAT reales — Informe pág. 3 (Alerta 1 y Alerta 2) ---------
   * Alerta 1 (cobertura ≥5 d) trae: inv. con edad, cobertura, a gestionar,
   * inv. total. Alerta 2 (cobertura <5 d) trae: inv. con edad, venta día, a
   * gestionar, días a vender, inv. total — el informe NO publica una
   * "cobertura" para las tiendas de Alerta 2 (por eso ese campo se omite en
   * vez de inventarlo). "ventaDia" de Alerta 1 se obtiene despejando la propia
   * fórmula del informe (cobertura = inv. total ÷ venta día), no es un dato
   * inventado. Alerta 3 (riesgo de quiebre ≤1 d): el informe no reporta
   * ninguna tienda en ese estado. ------------------------------------------ */
  const TIENDAS_TAT = [
    // Alerta 1 — cobertura ≥ 5 días
    { nombre: 'TAT VALLEDUPAR',    cediId: 'vup', alerta: 1, invConEdad: 252877, cobertura: 5.4, aGestionar: 220870, invTotal: 365655 },
    { nombre: 'TAT MONTERIA',      cediId: 'mtr', alerta: 1, invConEdad: 194344, cobertura: 9.3, aGestionar: 194344, invTotal: 508856 },
    { nombre: 'TAT POPAYAN',       cediId: 'pop', alerta: 1, invConEdad: 232200, cobertura: 5.1, aGestionar: 153656, invTotal: 796202 },
    { nombre: 'TAT VILLAVICENCIO', cediId: 'vvc', alerta: 1, invConEdad: 29149,  cobertura: 5.7, aGestionar: 29149,  invTotal: 51129 },
    // Alerta 2 — cobertura < 5 días (frescura PEPS)
    //
    // >>> Referencias completadas desde ventas-1.xlsx (2026-07-01) <<<
    // El informe deja algunas tiendas sin detalle por referencia y varias
    // referencias con venta 0, pero la venta real SÍ existe en ventas-1.xlsx.
    // Fórmula validada contra el propio informe: venta día = unidades vendidas
    // ÷ días con venta del periodo (26, 27 y 29/06 — el 28 fue domingo);
    // en TAT Cúcuta cuadra EXACTO a nivel tienda (324.958 ÷ 3 = 108.319) y por
    // referencia (2.245 y 600). Solo se tomaron coincidencias exactas de nombre.
    // Las referencias marcadas `deVentas: true` vienen solo del Excel: su
    // inventario/unidades en riesgo no existen en esa fuente -> null ("–").
    // Donde el Excel aporta la venta de una referencia que el informe dejaba en
    // 0, los "días a vender" se recalculan con la fórmula del informe
    // (en riesgo ÷ venta día).
    { nombre: 'TAT CARTAGENA',         cediId: 'ctg', alerta: 2, invConEdad: 737941, ventaDia: 218658, aGestionar: 737941, diasAVender: 3.4, invTotal: 1198379,
      referencias: [ // sin detalle en el informe; venta real de ventas-1.xlsx (÷3 días)
        { nombre: 'HUEVO M X 30 CARTON VERDE CANASTA', invActual: null, ventaDia: 135875, enRiesgo: null, diasAVender: null, deVentas: true },
        { nombre: 'HUEVO L X 30 CARTON VERDE CANASTA', invActual: null, ventaDia: 5380,   enRiesgo: null, diasAVender: null, deVentas: true },
        { nombre: 'HUEVO L X 15 PAGUE 14 PET EN CANASTA.', invActual: null, ventaDia: 2745, enRiesgo: null, diasAVender: null, deVentas: true },
      ] },
    { nombre: 'TAT BARRANQUILLA',      cediId: 'baq', alerta: 2, invConEdad: 671475, ventaDia: 277257, aGestionar: 671475, diasAVender: 2.4, invTotal: 1190618,
      referencias: [{ nombre: 'HUEVO L X 15 PAGUE 14 PET EN CANASTA.', invActual: 12780, ventaDia: 6905, enRiesgo: 5875, diasAVender: 0.9 }] },
    { nombre: 'TAT BOGOTA MONTEVIDEO', cediId: 'bog', alerta: 2, invConEdad: 933017, ventaDia: 434188, aGestionar: 562526, diasAVender: 1.3, invTotal: 2106540,
      referencias: [
        { nombre: 'HUEVO L X 30 CARTON VERDE CANASTA', invActual: 242640, ventaDia: 103462, enRiesgo: 139178, diasAVender: 1.3 },
        { nombre: 'HUEVO XL X 30 CARTON VERDE CANASTA', invActual: 359100, ventaDia: 150702, enRiesgo: 110575, diasAVender: 0.7 },
        { nombre: 'HUEVO L X 30 PAGUE 28 PET CAJA X 300', invActual: 70800, ventaDia: 23070, enRiesgo: 42390, diasAVender: 1.8 },
        { nombre: 'HUEVO L X 30 PET CAJA X 300', invActual: 51900, ventaDia: 18580, enRiesgo: 33320, diasAVender: 1.8 },
        { nombre: 'HUEVO XL X 15 PET CAJA X 300', invActual: 14280, ventaDia: 0, enRiesgo: 12000, diasAVender: null },
        { nombre: 'HUEVO L X 15 PAGUE 14 PET CAJA X 300.', invActual: 28800, ventaDia: 12730, enRiesgo: 9340, diasAVender: 0.7 },
        { nombre: 'HUEVO XL X 15 PAGUE 14 PET CAJA X 300', invActual: 21000, ventaDia: 3105, enRiesgo: 8700, diasAVender: 2.8 },
        { nombre: 'HUEVO L X 30 CARTON VERDE AMARRADO SIN ETIQUETA', invActual: 14070, ventaDia: 0, enRiesgo: 7920, diasAVender: null },
        // venta real de ventas-1.xlsx (14.562 ÷ 3); días a vender = 6.240 ÷ 4.854
        { nombre: 'HUEVO YUMBO X20 CARTON VERDE CANASTA', invActual: 29160, ventaDia: 4854, enRiesgo: 6240, diasAVender: 1.3, deVentas: true },
        { nombre: 'HUEVO L X 12 PET CAJA X 120', invActual: 4800, ventaDia: -40, enRiesgo: 4800, diasAVender: null },
        { nombre: 'HUEVO L X 12 PAGUE 11 PET CAJA X 120', invActual: 5040, ventaDia: 1176, enRiesgo: 1800, diasAVender: 1.5 },
      ] },
    { nombre: 'TAT PASTO',      cediId: 'pst', alerta: 2, invConEdad: 475285, ventaDia: 244520, aGestionar: 280937, diasAVender: 1.1, invTotal: 863979,
      referencias: [
        { nombre: 'HUEVO L X 30 CARTON VERDE CANASTA', invActual: 354772, ventaDia: 187427, enRiesgo: 167345, diasAVender: 0.9 },
        { nombre: 'HUEVO XL X 30 CARTON VERDE CANASTA', invActual: 82577, ventaDia: 39247, enRiesgo: 36829, diasAVender: 0.9 },
        // venta real de ventas-1.xlsx (2.260 ÷ 3); días a vender = 8.800 ÷ 753
        { nombre: 'HUEVO YUMBO X20 CARTON VERDE CANASTA', invActual: 8800, ventaDia: 753, enRiesgo: 8800, diasAVender: 11.7, deVentas: true },
        { nombre: 'HUEVO M X 30 CARTON VERDE CANASTA', invActual: 8496, ventaDia: 677, enRiesgo: 6464, diasAVender: 9.5 },
        // venta real de ventas-1.xlsx (2.700 ÷ 3); días a vender = 300 ÷ 900
        { nombre: 'HUEVO XL X 15 PET CAJA X 300', invActual: 300, ventaDia: 900, enRiesgo: 300, diasAVender: 0.3, deVentas: true },
        { nombre: 'HUEVO XL X 30 CARTON VERDE AMARRADO SIN ETIQUETA CANASTA', invActual: 2100, ventaDia: 1825, enRiesgo: 275, diasAVender: 0.2 },
      ] },
    { nombre: 'TAT MEDELLIN',   cediId: 'med', alerta: 2, invConEdad: 446520, ventaDia: 249598, aGestionar: 239102, diasAVender: 1.0, invTotal: 1096879,
      referencias: [
        { nombre: 'HUEVO XL X 15 PET CAJA X 300', invActual: 32700, ventaDia: 0, enRiesgo: 27000, diasAVender: null },
        { nombre: 'HUEVO XL X 30 CARTON VERDE CANASTA', invActual: 183600, ventaDia: 118988, enRiesgo: 26640, diasAVender: 0.2 },
        { nombre: 'HUEVO M X 30 CARTON VERDE CANASTA', invActual: 32160, ventaDia: 5184, enRiesgo: 15840, diasAVender: 3.1 },
        { nombre: 'HUEVO L X 30 CARTON VERDE AMARRADO SIN ETIQUETA', invActual: 7560, ventaDia: 0, enRiesgo: 7560, diasAVender: null },
        { nombre: 'HUEVO L X 15 PAGUE 14 PET CAJA X 300.', invActual: 12600, ventaDia: 3685, enRiesgo: 5230, diasAVender: 1.4 },
        // venta real de ventas-1.xlsx (4.850 ÷ 3); días a vender = 5.160 ÷ 1.617
        { nombre: 'HUEVO YUMBO X20 CARTON VERDE CANASTA', invActual: 5160, ventaDia: 1617, enRiesgo: 5160, diasAVender: 3.2, deVentas: true },
        { nombre: 'HUEVO XL X 15 PET CAJA X 300 - TAT', invActual: 11700, ventaDia: 4560, enRiesgo: 2580, diasAVender: 0.6 },
        { nombre: 'HUEVO L X 30 CARTON VERDE CANASTA', invActual: 99840, ventaDia: 49162, enRiesgo: 1516, diasAVender: 0.0 },
        { nombre: 'HUEVO XL X 30 CARTON VERDE AMARRADO SIN ETIQUETA CANASTA', invActual: 21600, ventaDia: 10675, enRiesgo: 616, diasAVender: 0.1 },
      ] },
    { nombre: 'TAT SANTA MARTA', cediId: 'smr', alerta: 2, invConEdad: 309579, ventaDia: 120898, aGestionar: 191081, diasAVender: 1.6, invTotal: 575795,
      referencias: [
        { nombre: 'HUEVO M X 30 CARTON VERDE CANASTA', invActual: 252658, ventaDia: 92199, enRiesgo: 160459, diasAVender: 1.7 },
        { nombre: 'HUEVO L X 30 PET CANASTA X 180 PV', invActual: 5850, ventaDia: 0, enRiesgo: 5850, diasAVender: null },
        { nombre: 'HUEVO XL X 15 PET CANASTA X 180 PV', invActual: 4290, ventaDia: 0, enRiesgo: 4290, diasAVender: null },
        { nombre: 'HUEVO L X 15 PAGUE 14 PET EN CANASTA.', invActual: 3024, ventaDia: 1295, enRiesgo: 434, diasAVender: 0.3 },
      ] },
    { nombre: 'TAT CALI',       cediId: 'cal', alerta: 2, invConEdad: 215315, ventaDia: 183549, aGestionar: 65502, diasAVender: 0.4, invTotal: 701570,
      referencias: [
        { nombre: 'HUEVO A X 30 CARTON GRIS AMARRADO - ALKOSTO.', invActual: 43500, ventaDia: 0, enRiesgo: 43500, diasAVender: null },
        { nombre: 'HUEVO L X 30 CARTON VERDE CANASTA', invActual: 91762, ventaDia: 60256, enRiesgo: 31506, diasAVender: 0.5 },
      ] },
    // El informe deja a Siberia con venta 0 ("venta no asignable"), pero la venta
    // real existe en ventas-1.xlsx: 181.600 und en 3 días = 60.533/día. Con esa
    // venta, días a vender = 31.434 ÷ 60.533 = 0,5 (fórmula del propio informe).
    { nombre: 'TAT BOGOTA SIBERIA', cediId: 'bog', alerta: 2, invConEdad: 31434, ventaDia: 60533, aGestionar: 31434, diasAVender: 0.5, invTotal: 327013,
      referencias: [{ nombre: 'HUEVO XL X 15 PET CAJA X 300 - TAT', invActual: 1200, ventaDia: 2375, enRiesgo: 1200, diasAVender: 0.5, deVentas: true }] },
    { nombre: 'TAT SINCELEJO',  cediId: 'snc', alerta: 2, invConEdad: 28571, ventaDia: 12582, aGestionar: 28571, diasAVender: 2.3, invTotal: 50918,
      referencias: [ // sin detalle en el informe; venta real de ventas-1.xlsx (÷2 días con venta: 26–27/06)
        { nombre: 'HUEVO L X 30 CARTON VERDE CANASTA', invActual: null, ventaDia: 14348, enRiesgo: null, diasAVender: null, deVentas: true },
        { nombre: 'HUEVO M X 30 CARTON VERDE CANASTA', invActual: null, ventaDia: 4524,  enRiesgo: null, diasAVender: null, deVentas: true },
      ] },
    { nombre: 'TAT CUCUTA',     cediId: 'cuc', alerta: 2, invConEdad: 92322, ventaDia: 108319, aGestionar: 5076, diasAVender: 0.0, invTotal: 218955,
      referencias: [
        { nombre: 'HUEVO L X 30 CARTON VERDE AMARRADO SIN ETIQUETA', invActual: 21240, ventaDia: 0, enRiesgo: 21240, diasAVender: null },
        { nombre: 'HUEVO L X 15 PAGUE 14 PET EN CANASTA.', invActual: 6210, ventaDia: 2245, enRiesgo: 3885, diasAVender: 1.7 },
        { nombre: 'HUEVO A X 30 CARTON GRIS AMARRADO SOL NACIENTE CANASTA.', invActual: 900, ventaDia: 0, enRiesgo: 900, diasAVender: null },
        { nombre: 'HUEVO L X 15 PAGUE 14 PET CAJA X 300.', invActual: 1500, ventaDia: 600, enRiesgo: 600, diasAVender: 1.0 },
      ] },
    { nombre: 'TAT BUCARAMANGA', cediId: 'buc', alerta: 2, invConEdad: 62376, ventaDia: 80432, aGestionar: 4752, diasAVender: 0.1, invTotal: 121966,
      referencias: [
        { nombre: 'HUEVO L X 30 CARTON VERDE CANASTA - BUCAROS', invActual: 34560, ventaDia: 0, enRiesgo: 34560, diasAVender: null },
        { nombre: 'HUEVO M X 30 CARTON VERDE CANASTA - BUCAROS', invActual: 7200, ventaDia: 0, enRiesgo: 7200, diasAVender: null },
        { nombre: 'HUEVO XL X 15 PET CAJA X 300', invActual: 3600, ventaDia: 0, enRiesgo: 3600, diasAVender: null },
        { nombre: 'HUEVO L X 12 PET CANASTA X 144 PV', invActual: 1296, ventaDia: 240, enRiesgo: 144, diasAVender: 0.6 },
      ] },
  ].map((t, idx) => {
    const cedi = CEDIS.find(c => c.id === t.cediId);
    const ventaDia = t.ventaDia != null ? t.ventaDia : Math.round(t.invTotal / t.cobertura);
    // edadMax por referencia = ventana de frescura (5 d) + "días a vender", regla
    // definida por el cliente (2026-07-01): p. ej. 1.3 -> 6.3, 0.7 -> 5.7. Sin
    // "días a vender" (venta 0 o negativa) no hay con qué calcularla -> null ("—").
    const referencias = (t.referencias || []).map(r => ({
      ...r, itemId: tallaDeReferencia(r.nombre),
      edadMax: r.diasAVender != null ? +(PARAMS.ventanaFrescuraDias + r.diasAVender).toFixed(1) : null,
    }));
    return {
      id: idx, nombre: t.nombre,
      cediId: cedi.id, cediNombre: cedi.nombre, regionId: cedi.regionId, regionNombre: cedi.regionNombre,
      regionalTAT: cedi.regionNombre,
      alerta: t.alerta, invConEdad: t.invConEdad, ventaDia,
      cobertura: t.cobertura ?? null, // solo tiendas de Alerta 1 lo traen en el informe
      aGestionar: t.aGestionar, diasAVender: t.diasAVender ?? null, invTotal: t.invTotal,
      referencias,
    };
  });

  // KPIs literales del encabezado "Referencias en riesgo de superar los 5 días" (pág. 4).
  // Nota: la suma de los bloques de detalle (por tienda) da 1.013.661 und / 42 filas, no
  // 1.250.738 — es una discrepancia del propio informe (no se fuerza a coincidir; ver
  // docs/CONTEXTO.md sección 11 y PROYECTO_TAT_MEMORIA.md sobre inconsistencias conocidas).
  const ALERTA2_RESUMEN = {
    tatEnRiesgo: 9, deTotalAlerta2: 11, referenciasUnicas: 22, unidadesEnRiesgo: 1250738,
  };

  /* --- Meta (indicadores de compañía reales — Informe pág. 1) ------------- */
  const meta = {
    fechaCorte: '2026-06-30',
    actualizado: '2026-06-30 19:00',
    empresa: 'Incubadora Santander S.A. · Huevos Kikes',
    fuente: 'Informe_Dias_Inventario_30062026_19.pdf · ventas-1.xlsx',
    cedisSinReporte: CEDIS.filter(c => !c.reporto).map(c => c.nombre),
    inventarioTotalCompania: 27251311,
    huevoSinClasificar: 2743834,
    diasInventarioGlobal: 5.2,
    tallaTotalInventario: TALLA_TOTAL.inventario,
    tallaTotalVenta: TALLA_TOTAL.venta,
  };

  /* --- API expuesta ------------------------------------------------------- */
  window.DB = {
    PARAMS, regiones: REGIONES, cedis: CEDIS, canales: CANALES, items: ITEMS,
    regionalesTAT: REGIONALES_TAT, regionalTAT: REGIONAL_TAT_RESUMEN, regionalTATTotal: REGIONAL_TAT_TOTAL,
    tiendasTAT: TIENDAS_TAT, alerta2Resumen: ALERTA2_RESUMEN,
    ajusteTallaSinDesglosar: AJUSTE_SIN_DESGLOSAR, meta, tallaDeReferencia,

    cargar: function () { return Promise.resolve(this); },
  };
})();
