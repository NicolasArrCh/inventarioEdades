/* =============================================================================
 *  data.js  —  CAPA DE DATOS (MOCK)
 * -----------------------------------------------------------------------------
 *  Este archivo simula la información que en el proyecto real vendrá del
 *  backend (ERP -> n8n -> base de datos -> API).
 *
 *  >>> PUNTO DE INTEGRACIÓN <<<
 *  Cuando se conecte el backend, basta con reemplazar el contenido de
 *  `DB.cargar()` por una llamada `fetch('/api/inventario?...')` que devuelva
 *  la misma estructura. El resto de la aplicación (app.js) no necesita cambios.
 *
 *  Estructura expuesta en `window.DB`:
 *    - regiones[]      : departamentos del país
 *    - cedis[]         : centros de distribución / plantas (ciudad)
 *    - canales[]       : TAT, FS, GS, HD, MAY
 *    - items[]         : tipos / referencias de huevo
 *    - registros[]     : grano (cedi, canal, item) con inventario, venta y edades
 *    - tiendasTAT[]    : detalle por tienda para el módulo TAT
 *    - historia[]      : serie de 90 días para tendencias
 *    - meta            : fecha de corte, parámetros, etc.
 * ========================================================================== */

(function () {
  'use strict';

  /* --- PRNG con semilla (resultados estables entre recargas) -------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rng = mulberry32(20260626);
  const rand = (min, max) => min + (max - min) * rng();
  const randInt = (min, max) => Math.floor(rand(min, max + 1));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  /* --- Catálogos ---------------------------------------------------------- */

  // Parámetros de negocio (parametrizables). "Días de inventario" = cobertura.
  const PARAMS = {
    // Zonas de DÍAS DE INVENTARIO (cobertura = inventario / venta diaria)
    zonas: {
      bajo:   { min: -Infinity, max: 2,        color: 'gris',  label: 'Bajo / sin rotación' },
      optimo: { min: 3,         max: 5,        color: 'verde', label: 'Óptimo' },
      critico:{ min: 6,         max: Infinity, color: 'rojo',  label: 'Exceso / riesgo' },
    },
    ventanaFrescuraDias: 5,   // el cliente exige el huevo con <= 5 días
    umbralEdadCriticaDias: 6, // a partir de 6 días el huevo es crítico
    umbralDiscrepanciaIncusan: 0.03, // 3% de diferencia vs INCUSAN dispara alerta
  };

  // Geografía real de Incubadora Santander / Huevos Kikes (ver docs/CONTEXTO.md).
  // Nivel: Nación -> Departamento (región) -> Ciudad (CEDI / planta).
  // Plantas de producción/clasificación: solo Caloto (Cauca) y Bucaramanga (Santander).
  const REGIONES = [
    {
      id: 'san', nombre: 'Santander', cedis: [
        // Complejo La Mesa de los Santos / Piedecuesta + CEDI
        { id: 'buc', nombre: 'Bucaramanga', planta: true,  reporto: true },
      ]
    },
    {
      id: 'nsa', nombre: 'Norte de Santander', cedis: [
        { id: 'cuc', nombre: 'Cúcuta',    planta: false, reporto: true },
      ]
    },
    {
      id: 'cun', nombre: 'Cundinamarca', cedis: [
        { id: 'bog', nombre: 'Bogotá',    planta: false, reporto: true },
      ]
    },
    {
      id: 'ant', nombre: 'Antioquia', cedis: [
        { id: 'med', nombre: 'Medellín',  planta: false, reporto: true },
      ]
    },
    {
      id: 'val', nombre: 'Valle del Cauca', cedis: [
        { id: 'cal', nombre: 'Cali',      planta: false, reporto: true },
      ]
    },
    {
      id: 'cau', nombre: 'Cauca', cedis: [
        { id: 'pop', nombre: 'Popayán',   planta: false, reporto: true },
        { id: 'clt', nombre: 'Caloto',    planta: true,  reporto: true }, // Granja Las Palmas
      ]
    },
    {
      id: 'ris', nombre: 'Risaralda', cedis: [
        { id: 'per', nombre: 'Pereira',   planta: false, reporto: false }, // revisión manual
      ]
    },
    {
      id: 'atl', nombre: 'Atlántico', cedis: [
        { id: 'baq', nombre: 'Barranquilla', planta: false, reporto: true },
      ]
    },
    {
      id: 'bol', nombre: 'Bolívar', cedis: [
        { id: 'ctg', nombre: 'Cartagena', planta: false, reporto: true },
      ]
    },
    {
      id: 'mag', nombre: 'Magdalena', cedis: [
        { id: 'smr', nombre: 'Santa Marta', planta: false, reporto: true },
      ]
    },
    {
      id: 'ces', nombre: 'Cesar', cedis: [
        { id: 'vup', nombre: 'Valledupar', planta: false, reporto: false }, // pendiente
      ]
    },
    {
      id: 'cor', nombre: 'Córdoba', cedis: [
        { id: 'mtr', nombre: 'Montería',  planta: false, reporto: true },
      ]
    },
    {
      id: 'suc', nombre: 'Sucre', cedis: [
        { id: 'snc', nombre: 'Sincelejo', planta: false, reporto: true },
      ]
    },
    {
      id: 'met', nombre: 'Meta', cedis: [
        { id: 'vvc', nombre: 'Villavicencio', planta: false, reporto: true },
      ]
    },
    {
      id: 'nar', nombre: 'Nariño', cedis: [
        { id: 'pst', nombre: 'Pasto',     planta: false, reporto: false }, // pendiente (lejano)
      ]
    },
  ];

  const CANALES = [
    { id: 'TAT', nombre: 'TAT (Tienda a Tienda)', corto: 'TAT' },
    { id: 'FS',  nombre: 'Food Service',          corto: 'FS'  },
    { id: 'GS',  nombre: 'Grandes Superficies',   corto: 'GS'  },
    { id: 'HD',  nombre: 'Hard Discount',         corto: 'HD'  },
    { id: 'MAY', nombre: 'Mayoristas',            corto: 'MAY' },
  ];

  const ITEMS = [
    { id: 'jum', nombre: 'Jumbo' },
    { id: 'xl',  nombre: 'XL' },
    { id: 'l',   nombre: 'L' },
    { id: 'm',   nombre: 'M' },
  ];

  // Aplana lista de cedis con su región
  const CEDIS = [];
  REGIONES.forEach(r => r.cedis.forEach(c => {
    CEDIS.push({ ...c, regionId: r.id, regionNombre: r.nombre });
  }));

  /* --- Generación de registros (grano: cedi x canal x item) --------------- */

  // Venta base por canal (huevos/día) — modula la magnitud
  const VENTA_BASE = { GS: [4000, 9000], HD: [3000, 7000], TAT: [1500, 5000], FS: [800, 3000], MAY: [500, 4000] };

  // Probabilidad de que exista una combinación (no todas las tallas se venden en todos los canales)
  function existeCombo(canal, item) {
    if (item === 'm'   && canal === 'GS')  return rng() > 0.40; // M menos frecuente en GS
    if (item === 'jum' && canal === 'TAT') return rng() > 0.50; // Jumbo poco en TAT
    return rng() > 0.12;
  }

  const registros = [];
  let recId = 0;

  CEDIS.forEach(cedi => {
    // Algunos cedis tienden a tener inventario más viejo (peor gestión)
    const sesgoEdad = pick([0.85, 1.0, 1.0, 1.2, 1.4]);
    CANALES.forEach(canal => {
      ITEMS.forEach(item => {
        if (!existeCombo(canal.id, item.id)) return;

        const base = VENTA_BASE[canal.id];
        const ventaDiaria = Math.round(rand(base[0], base[1]) * rand(0.6, 1.1));
        if (ventaDiaria <= 0) return;

        // Cobertura objetivo (días de inventario) sesgada para tener mezcla de zonas
        const cobObjetivo = pick([1, 2, 3, 4, 4, 5, 5, 6, 7, 9, 12]) * rand(0.8, 1.2);
        const inventario = Math.max(0, Math.round(ventaDiaria * cobObjetivo));

        // Distribución por edad a nivel de DÍA: buckets 0,1,2,3,4,5,6,7,8+ (9 valores).
        // El centro de la campana se desplaza a edades mayores cuanto mayor es la
        // cobertura y según el sesgo del CEDI -> más huevo crítico donde hay más stock.
        const NB = 9;
        const centro = 0.7 + (cobObjetivo / 12) * sesgoEdad * 4.4; // ~0.7 .. ~6.3
        const spread = 3.0;
        const w = []; let sw = 0, idxMax = 0;
        for (let dd = 0; dd < NB; dd++) {
          const val = Math.exp(-Math.pow(dd - centro, 2) / (2 * spread)) + rand(0, 0.04);
          w.push(val); sw += val;
          if (val > w[idxMax]) idxMax = dd;
        }
        const edadDias = new Array(NB).fill(0);
        let acum = 0;
        for (let dd = 0; dd < NB; dd++) { edadDias[dd] = Math.round(inventario * w[dd] / sw); acum += edadDias[dd]; }
        edadDias[idxMax] += inventario - acum;            // absorbe el redondeo en el bucket modal
        if (edadDias[idxMax] < 0) edadDias[idxMax] = 0;

        // Agregados por zona (compatibilidad con el resto de la app)
        const d0_2  = edadDias[0] + edadDias[1] + edadDias[2];
        const d3_5  = edadDias[3] + edadDias[4] + edadDias[5];
        const d6plus = edadDias[6] + edadDias[7] + edadDias[8];

        // Edad promedio ponderada por día (8+ se cuenta como 8)
        let sumEdad = 0;
        for (let dd = 0; dd < NB; dd++) sumEdad += dd * edadDias[dd];
        const edadProm = inventario > 0 ? sumEdad / inventario : 0;

        // Valor INCUSAN (cruce automático) con pequeña diferencia
        const incusan = Math.round(inventario * (1 + rand(-0.05, 0.05)));

        registros.push({
          id: recId++,
          cediId: cedi.id, cediNombre: cedi.nombre,
          regionId: cedi.regionId, regionNombre: cedi.regionNombre,
          planta: cedi.planta,
          reporto: cedi.reporto,
          canalId: canal.id, canalNombre: canal.corto,
          itemId: item.id, itemNombre: item.nombre,
          inventario, ventaDiaria,
          edad: { d0_2, d3_5, d6plus },
          edadDias,
          edadPromedio: +edadProm.toFixed(1),
          incusan,
        });
      });
    });
  });

  /* --- Tiendas (clientes) del canal TAT ----------------------------------
   * IMPORTANTE: las tiendas son CLIENTES a los que la empresa VENDE. No
   * almacenan inventario (el inventario solo existe en CEDIs y plantas).
   * Por eso cada tienda solo tiene VENTAS: venta diaria y venta promedio de
   * los últimos 3 días (para proyectar cobertura contra el inventario del CEDI).
   * --------------------------------------------------------------------- */
  const SUFIJOS_TIENDA = ['Centro', 'Norte', 'Sur', 'La 80', 'El Poblado', 'San Diego', 'La 14', 'Plaza', 'El Tunal', 'La 33'];
  const tiendasTAT = [];
  let tId = 0;
  CEDIS.filter(c => !c.planta).forEach(cedi => { // las tiendas se surten desde CEDIs
    const nTiendas = randInt(3, 6);
    for (let i = 0; i < nTiendas; i++) {
      const itemsTienda = [];
      const cuantos = randInt(2, 4);
      const elegidos = [...ITEMS].sort(() => rng() - 0.5).slice(0, cuantos);
      elegidos.forEach(item => {
        const ventaDiaria = randInt(40, 260);
        const ventaProm3d = Math.round(ventaDiaria * rand(0.8, 1.2)); // tendencia reciente
        itemsTienda.push({ itemId: item.id, itemNombre: item.nombre, ventaDiaria, ventaProm3d });
      });
      tiendasTAT.push({
        id: tId++,
        nombre: `Tienda ${cedi.nombre} ${pick(SUFIJOS_TIENDA)}`,
        cediId: cedi.id, cediNombre: cedi.nombre,
        regionId: cedi.regionId, regionNombre: cedi.regionNombre,
        items: itemsTienda,
      });
    }
  });

  /* --- Historia 90 días (totales nacionales para tendencias) -------------- */
  const historia = [];
  const hoy = new Date(2026, 5, 26); // 26 jun 2026 (mes 0-index)
  let invBase = 5200000;
  for (let d = 89; d >= 0; d--) {
    const fecha = new Date(hoy.getTime() - d * 86400000);
    const dow = fecha.getDay();
    const factorSemana = (dow === 0) ? 0.55 : (dow === 6 ? 0.8 : 1); // domingos bajan
    const ruido = rand(-0.04, 0.04);
    const tendencia = 1 + (89 - d) * 0.0008; // leve crecimiento
    const inventario = Math.round(invBase * tendencia * (1 + ruido));
    const ventaDia = Math.round(inventario / rand(3.6, 5.2) * factorSemana);
    const diasInv = +(inventario / ventaDia).toFixed(2);
    const pctCritico = +Math.min(38, Math.max(6, 18 + Math.sin(d / 7) * 6 + rand(-3, 3))).toFixed(1);
    historia.push({
      fecha: fecha.toISOString().slice(0, 10),
      inventario, ventaDia, diasInventario: diasInv, pctCritico,
    });
  }

  /* --- Meta --------------------------------------------------------------- */
  const meta = {
    fechaCorte: '2026-06-25',     // corte del día anterior para el día presente
    fechaEdades: '2026-06-26',    // edades van con el día actual
    actualizado: '2026-06-26 08:12',
    empresa: 'Incubadora Santander S.A. · Huevos Kikes',
    fuente: 'ERP (HU / HC) · Consolidado manual · Cruce INCUSAN',
    cedisSinReporte: CEDIS.filter(c => !c.reporto).map(c => c.nombre),
  };

  /* --- API expuesta ------------------------------------------------------- */
  window.DB = {
    PARAMS, regiones: REGIONES, cedis: CEDIS, canales: CANALES, items: ITEMS,
    registros, tiendasTAT, historia, meta,

    /* En el proyecto real, reemplazar por fetch al backend. */
    cargar: function () { return Promise.resolve(this); },
  };
})();
