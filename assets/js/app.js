/* =============================================================================
 *  app.js  —  LÓGICA DE LA APLICACIÓN
 * -----------------------------------------------------------------------------
 *  Todas las cifras que se muestran (compañía, Detalle por Talla, Regional
 *  TAT, Alerta 1, Alerta 2 y sus referencias) vienen literales de
 *  `assets/js/data.js`, tomadas del informe real. Este archivo solo filtra,
 *  ordena y renderiza — no inventa ni recalcula números que el informe no
 *  publica (ver docs/CONTEXTO.md sección 11).
 *
 *  Filtros disponibles:
 *    - Regional / CEDI / Talla / Tipo de ubicación / Estado de reporte /
 *      Inventario mínimo -> aplican sobre las tiendas TAT reales. "Regional"
 *      reemplazó al antiguo filtro por departamento: ahora usa la Regional TAT
 *      real (Occidente / Costa Oriente / Centro) — ver docs/CONTEXTO.md 11.2.
 *    - Umbral de cobertura      -> especializado de Alerta 1.
 *    - Máx. días a vender       -> especializado de Alerta 2.
 * ========================================================================== */

(function () {
  'use strict';

  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const fmt = Charts.fmt;
  const P = DB.PARAMS;

  const idsRegiones = () => DB.regiones.map(r => r.id);
  const idsCedis    = () => DB.cedis.map(c => c.id);
  const idsItems    = () => DB.items.map(i => i.id);

  /* --- Estado global ------------------------------------------------------- */
  const state = {
    vista: 'edades',
    canalActivo: 'TAT',
    regiones: new Set(idsRegiones()),
    cedis:    new Set(idsCedis()),
    items:    new Set(idsItems()),
    tipoUbic: 'all',   // all | planta | cedi
    reporte:  'all',   // all | si | no
    invMin: 0,
    // Umbral de cobertura (días): filtro GLOBAL que corta ambas alertas —
    // Alerta 1 muestra tiendas con cobertura ≥ umbral, Alerta 2 tiendas con
    // días a vender < umbral.
    umbral: P.umbralAlertaCoberturaDias,
  };

  const stateAlerta1 = {
    sortCol: 'cobertura',
    sortDir: 'desc',
  };

  const stateAlerta2 = {
    diasVenderMax: null, // umbral del slider de tiempo (null = sin límite)
  };

  function zonaDe(dias) {
    if (dias == null || !isFinite(dias)) return 'rojo';
    if (dias >= P.zonas.critico.min) return 'rojo';
    if (dias >= P.zonas.optimo.min && dias <= P.zonas.optimo.max) return 'verde';
    return 'gris';
  }
  const COLOR_CLASE = { gris: 'z-gris', verde: 'z-verde', rojo: 'z-rojo' };
  const fmtDias = n => (n == null || !isFinite(n)) ? '—' : n.toFixed(1);

  function nivel() {
    if (state.cedis.size === 1) return 'cedi';
    const def = state.regiones.size === DB.regiones.length &&
      state.cedis.size === DB.cedis.length &&
      state.items.size === DB.items.length &&
      state.tipoUbic === 'all' && state.reporte === 'all' && state.invMin === 0 &&
      state.umbral === P.umbralAlertaCoberturaDias;
    return def ? 'nacional' : 'regional';
  }

  // Cuenta cuántos filtros están activos (distintos del valor "todo seleccionado"),
  // para el contador del botón "Filtros" en la topbar.
  function nAvanzados() {
    let n = 0;
    if (state.regiones.size < DB.regiones.length) n++;
    if (state.cedis.size < DB.cedis.length) n++;
    if (state.items.size < DB.items.length) n++;
    if (state.tipoUbic !== 'all') n++;
    if (state.reporte !== 'all') n++;
    if (state.invMin > 0) n++;
    if (state.umbral !== P.umbralAlertaCoberturaDias) n++;
    return n;
  }

  // Tiendas TAT reales respetando los filtros globales (Región/CEDI/tipo de
  // ubicación/estado de reporte se resuelven contra el CEDI que surte la tienda).
  function tiendasBase() {
    const s = state;
    return DB.tiendasTAT.filter(t => {
      if (!s.regiones.has(t.regionId)) return false;
      if (!s.cedis.has(t.cediId)) return false;
      if (t.invTotal < s.invMin) return false;
      const cedi = DB.cedis.find(c => c.id === t.cediId);
      if (s.tipoUbic === 'planta' && !cedi.planta) return false;
      if (s.tipoUbic === 'cedi' && cedi.planta) return false;
      if (s.reporte === 'si' && !cedi.reporto) return false;
      if (s.reporte === 'no' && cedi.reporto) return false;
      return true;
    });
  }

  /* =========================================================================
   *  COMPONENTE MULTI-SELECT (checkboxes con buscador)
   * ====================================================================== */
  function construirMS(host, label, opciones, getSet, onChange) {
    host.classList.add('ms');
    host.innerHTML = `
      <label>${label}</label>
      <button class="ms-btn" type="button"><span class="ms-txt"></span><i>▾</i></button>
      <div class="ms-panel">
        <div class="ms-actions">
          <input class="ms-search" placeholder="Buscar…">
          <button type="button" data-act="all">Todas</button>
          <button type="button" data-act="none">Ninguna</button>
        </div>
        <div class="ms-list">
          ${opciones.map(o => `<label class="ms-opt" data-txt="${o.nombre.toLowerCase()}">
            <input type="checkbox" value="${o.id}"><span>${o.nombre}</span>${o.sub ? `<em>${o.sub}</em>` : ''}</label>`).join('')}
        </div>
      </div>`;

    const set = getSet();
    $$('.ms-opt input', host).forEach(chk => { chk.checked = set.has(chk.value); });
    actualizarMSLabel(host, opciones, getSet);

    $('.ms-btn', host).addEventListener('click', e => {
      e.stopPropagation();
      const abierto = host.classList.contains('ms-open');
      cerrarTodosMS();
      if (!abierto) host.classList.add('ms-open');
    });
    $('.ms-panel', host).addEventListener('click', e => e.stopPropagation());

    $$('.ms-opt input', host).forEach(chk => chk.addEventListener('change', () => {
      const s = getSet();
      if (chk.checked) s.add(chk.value); else s.delete(chk.value);
      actualizarMSLabel(host, opciones, getSet);
      onChange();
    }));
    $('[data-act="all"]', host).addEventListener('click', () => {
      const s = getSet(); opciones.forEach(o => s.add(o.id));
      $$('.ms-opt input', host).forEach(c => c.checked = true);
      actualizarMSLabel(host, opciones, getSet); onChange();
    });
    $('[data-act="none"]', host).addEventListener('click', () => {
      const s = getSet(); s.clear();
      $$('.ms-opt input', host).forEach(c => c.checked = false);
      actualizarMSLabel(host, opciones, getSet); onChange();
    });
    const search = $('.ms-search', host);
    search.addEventListener('click', e => e.stopPropagation());
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      $$('.ms-opt', host).forEach(o => { o.style.display = o.dataset.txt.includes(q) ? '' : 'none'; });
    });
  }

  function actualizarMSLabel(host, opciones, getSet) {
    const s = getSet(), total = opciones.length, txt = $('.ms-txt', host);
    let t;
    if (s.size === 0) t = 'Ninguna';
    else if (s.size === total) t = `Todas (${total})`;
    else if (s.size === 1) t = (opciones.find(o => o.id === [...s][0]) || {}).nombre || '1';
    else t = `${s.size} de ${total}`;
    txt.textContent = t;
    host.classList.toggle('ms-partial', s.size > 0 && s.size < total);
  }

  function cerrarTodosMS() { $$('.ms').forEach(m => m.classList.remove('ms-open')); }

  function montarMSRegion() {
    const ops = DB.regiones.map(r => ({ id: r.id, nombre: r.nombre }));
    construirMS($('#ms-region'), 'Regional', ops, () => state.regiones, () => {
      sincronizarCedis();
      montarMSCedi();
      render();
    });
  }
  function montarMSCedi() {
    const ops = DB.cedis.filter(c => state.regiones.has(c.regionId))
      .map(c => ({ id: c.id, nombre: c.nombre + (c.planta ? ' (planta)' : ''), sub: c.regionNombre }));
    construirMS($('#ms-cedi'), 'CEDI / ciudad', ops, () => state.cedis, render);
  }
  function sincronizarCedis() {
    state.cedis = new Set(DB.cedis.filter(c => state.regiones.has(c.regionId)).map(c => c.id));
  }

  /* =========================================================================
   *  FILTROS — chips, segmentados
   * ====================================================================== */
  function poblarFiltros() {
    montarMSRegion();
    sincronizarCedis();
    montarMSCedi();
    const chipsHTML = DB.items.map(i =>
      `<button type="button" class="chip chip-on" data-val="${i.id}">${i.nombre}</button>`).join('');
    $('#f-items').innerHTML = chipsHTML;
    // Copia del filtro de talla dentro de la vista Resumen (comparten state.items)
    $('#f-items-edades').innerHTML = chipsHTML;
  }

  // Mantiene los chips de talla (topbar y vista Resumen) alineados con state.items
  function sincronizarChipsTalla() {
    ['#f-items', '#f-items-edades'].forEach(sel =>
      $$(sel + ' .chip').forEach(c => c.classList.toggle('chip-on', state.items.has(c.dataset.val))));
  }

  function wireChips(sel, getSet) {
    $(sel).addEventListener('click', e => {
      const b = e.target.closest('[data-val]'); if (!b) return;
      const s = getSet(), id = b.dataset.val;
      if (s.has(id)) { s.delete(id); b.classList.remove('chip-on'); }
      else { s.add(id); b.classList.add('chip-on'); }
      render();
    });
  }

  function wireSeg(sel, attr, setter) {
    const cont = $(sel);
    cont.addEventListener('click', e => {
      const b = e.target.closest(`[data-${attr}]`); if (!b) return;
      $$('button', cont).forEach(x => x.classList.toggle('seg-on', x === b));
      setter(b.dataset[attr]);
      render();
    });
  }

  function wireFiltros() {
    wireChips('#f-items', () => state.items);
    wireChips('#f-items-edades', () => state.items);
    $('#fe-reset').addEventListener('click', () => {
      state.items = new Set(idsItems());
      render();
    });
    wireSeg('#f-ubic', 'ubic', v => state.tipoUbic = v);
    wireSeg('#f-reporte', 'rep', v => state.reporte = v);

    $('#f-inv-min').addEventListener('input', e => {
      const v = e.target.value === '' ? 0 : +e.target.value;
      state.invMin = isNaN(v) ? 0 : v; render();
    });

    $('#f-umbral').addEventListener('input', e => {
      state.umbral = +e.target.value;
      $('#f-umbral-val').textContent = `${state.umbral} d`;
      render();
    });

    $('#f-toggle').addEventListener('click', () => {
      const p = $('#filtros-panel-completo');
      p.hidden = !p.hidden;
      $('#f-toggle').classList.toggle('abierto', !p.hidden);
    });
    $('#f-reset').addEventListener('click', resetFiltros);

    document.addEventListener('click', cerrarTodosMS);
  }

  function resetFiltros() {
    state.regiones = new Set(idsRegiones());
    sincronizarCedis();
    state.items = new Set(idsItems());
    state.tipoUbic = 'all'; state.reporte = 'all'; state.invMin = 0;
    state.umbral = P.umbralAlertaCoberturaDias;

    montarMSRegion(); montarMSCedi();
    $$('#f-ubic button').forEach(b => b.classList.toggle('seg-on', b.dataset.ubic === 'all'));
    $$('#f-reporte button').forEach(b => b.classList.toggle('seg-on', b.dataset.rep === 'all'));
    $('#f-inv-min').value = 0;
    $('#f-umbral').value = state.umbral;
    $('#f-umbral-val').textContent = `${state.umbral} d`;
    render();
  }

  function wireNav() {
    $$('.nav-item').forEach(b => b.addEventListener('click', () => {
      state.vista = b.dataset.vista;
      $$('.nav-item').forEach(x => x.classList.toggle('active', x === b));
      $$('.vista').forEach(v => v.classList.toggle('visible', v.id === 'vista-' + state.vista));
      $('#topbar-titulo').textContent = b.dataset.titulo;
      render();
    }));
  }

  /* --- Breadcrumb + meta -------------------------------------------------- */
  function renderContexto() {
    const partes = [];
    const totalR = DB.regiones.length, nR = state.regiones.size;
    if (nR === 0) partes.push('Sin selección');
    else if (nR === totalR) partes.push('Nacional');
    else if (nR === 1) partes.push(DB.regiones.find(r => r.id === [...state.regiones][0]).nombre);
    else partes.push(`${nR} regiones`);

    const dispC = DB.cedis.filter(c => state.regiones.has(c.regionId)).length;
    const nC = state.cedis.size;
    if (nC === 1) partes.push(DB.cedis.find(c => c.id === [...state.cedis][0]).nombre);
    else if (nC > 0 && nC < dispC) partes.push(`${nC} CEDIs`);

    $('#breadcrumb').innerHTML = partes.map((p, i) =>
      `<span class="${i === partes.length - 1 ? 'crumb-act' : ''}">${p}</span>`).join('<i>›</i>');

    const nv = nivel();
    $('#nivel-badge').textContent = nv === 'nacional' ? 'NACIONAL' : nv === 'regional' ? 'FILTRADO' : 'CEDI';
    $('#nivel-badge').className = 'nivel-badge nb-' + nv;

    const n = nAvanzados();
    $('#mas-count').textContent = n ? `(${n})` : '';
  }

  /* =========================================================================
   *  RENDER MAESTRO
   * ====================================================================== */
  function render() {
    renderContexto();
    sincronizarChipsTalla();

    // En Resumen el único filtro que aplica es la talla (inline en la vista):
    // se oculta el botón de filtros generales de la topbar.
    const enResumen = state.vista === 'edades';
    $('#f-toggle').hidden = enResumen;
    if (enResumen) {
      $('#filtros-panel-completo').hidden = true;
      $('#f-toggle').classList.remove('abierto');
    }

    switch (state.vista) {
      case 'edades':  renderEdades(); break;
      case 'tat':     renderAlerta1(); renderAlerta2(); break;
      case 'canales': renderCanales(); break;
    }
  }

  /* =========================================================================
   *  VISTA: RESUMEN — Indicadores Generales + Detalle por Talla (REAL)
   * ====================================================================== */
  function renderEdades() {
    // Los Indicadores Generales y el Detalle por Talla son cifras NACIONALES
    // del informe: no existe un desglose por CEDI en la fuente real, así que
    // no cambian con Región/CEDI/tipo de ubicación/estado de reporte/inv.
    // mínimo — el detalle real por CEDI/tienda está en TAT y Canales.

    // Detalle por Talla: filas reales, filtrables por talla (los números de
    // cada fila no cambian, solo se muestran/ocultan — el total sí se ajusta
    // al subconjunto visible).
    const filas = DB.items.filter(i => state.items.has(i.id)).slice().sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));
    const sinFiltroTalla = filas.length === DB.items.length;
    const ajuste = DB.ajusteTallaSinDesglosar;
    const totInv = filas.reduce((a, b) => a + b.inventario, 0) + (sinFiltroTalla ? ajuste.inventario : 0);
    const totVenta = filas.reduce((a, b) => a + b.venta, 0);

    // Fila anexa bajo el TOTAL: "Huevo sin clasificar" NO pertenece al desglose
    // por talla (el informe lo excluye — no tiene venta ni días por talla), por
    // eso va pegada a la tabla pero con estilo propio y sin sumar al TOTAL.
    const filaSinClasificar = `<tr class="row-anexa">
      <td>Huevo sin clasificar <span class="muted">· fuera del desglose por talla</span></td>
      <td class="num">${fmt(DB.meta.huevoSinClasificar)}</td>
      <td class="num">—</td>
      <td class="num">—</td>
    </tr>`;

    $('#tabla-talla-detalle tbody').innerHTML = filas.map(t => `<tr>
      <td><strong>${t.nombre}</strong></td>
      <td class="num">${fmt(t.inventario)}</td>
      <td class="num">${fmt(t.venta)}</td>
      <td class="num">${t.dias == null ? '<span class="muted">—</span>' : `<span class="badge b-${zonaDe(t.dias)}">${fmtDias(t.dias)}</span>`}</td>
    </tr>`).join('') + (filas.length
      ? `<tr class="row-total"><td><strong>TOTAL${filas.length < DB.items.length ? ' (filtrado)' : ''}</strong></td><td class="num"><strong>${fmt(totInv)}</strong></td><td class="num"><strong>${fmt(totVenta)}</strong></td><td class="num">—</td></tr>` + filaSinClasificar
      : '<tr><td colspan="4" class="empty">Sin tallas seleccionadas</td></tr>');

    const notaAjuste = $('#nota-ajuste-talla');
    if (notaAjuste) {
      notaAjuste.hidden = !sinFiltroTalla;
      notaAjuste.innerHTML = `El TOTAL incluye <strong>${fmt(ajuste.inventario)}</strong> unidades de ` +
        `<strong>${ajuste.nombre}</strong>, una categoría real que no viene desglosada por talla en el ` +
        `informe (no se conoce su venta día, por eso no aparece como fila propia).`;
    }
  }

  /* =========================================================================
   *  VISTA: ALERTA 1 — Sobre-inventario por tienda TAT (cobertura ≥ umbral)
   * ====================================================================== */
  function renderAlerta1() {
    // El único control propio de Alerta 1 es el ordenamiento por clic en los
    // encabezados de la tabla (el umbral de cobertura vive en 🔍 Filtros).
    const thead = $('#tabla-criticos thead');
    if (!thead.dataset.wired) {
      thead.addEventListener('click', e => {
        const th = e.target.closest('th[data-sort]'); if (!th) return;
        const sc = stateAlerta1, col = th.dataset.sort;
        if (sc.sortCol === col) sc.sortDir = sc.sortDir === 'desc' ? 'asc' : 'desc';
        else { sc.sortCol = col; sc.sortDir = 'desc'; }
        refreshAlerta1();
      });
      $$('th[data-sort]', thead).forEach(th => {
        th.title = 'Clic para ordenar por esta columna (otro clic invierte el orden)';
      });
      thead.dataset.wired = '1';
    }
    refreshAlerta1();
  }

  function refreshAlerta1() {
    const sc = stateAlerta1;
    const base = tiendasBase().filter(t => t.alerta === 1);
    let lista = base.filter(t => t.cobertura >= state.umbral);

    lista.sort((a, b) => {
      let d = 0;
      if      (sc.sortCol === 'cobertura')  d = a.cobertura - b.cobertura;
      else if (sc.sortCol === 'aGestionar') d = a.aGestionar - b.aGestionar;
      else if (sc.sortCol === 'invEdad')    d = a.invConEdad - b.invConEdad;
      else if (sc.sortCol === 'invTotal')   d = a.invTotal - b.invTotal;
      return sc.sortDir === 'desc' ? -d : d;
    });

    const totalGestionar = lista.reduce((a, b) => a + b.aGestionar, 0);
    const totalInv = lista.reduce((a, b) => a + b.invTotal, 0);
    kpis('#kpis-criticos', [
      { label: 'TAT en Alerta 1', valor: lista.length, sub: `de ${base.length} en el alcance`, icon: '🔺', clase: lista.length ? 'z-rojo' : 'z-verde' },
      { label: 'Unidades a gestionar', valor: fmt(totalGestionar), sub: 'sobre-inventario ≥ umbral', icon: '🥚', clase: 'z-rojo' },
    ]);

    const porRegional = DB.regionalesTAT.map(r => ({ nombre: r, valor: lista.filter(x => x.regionalTAT === r).reduce((a, b) => a + b.aGestionar, 0) }));
    $('#alerta1-subtotales').innerHTML = porRegional.map(r => `
      <div class="kpi z-rojo"><div class="kpi-icon">📍</div><div class="kpi-body">
        <div class="kpi-label">${r.nombre}</div><div class="kpi-valor">${fmt(r.valor)}</div>
        <div class="kpi-sub">a gestionar</div></div></div>`).join('');

    $$('#tabla-criticos th[data-sort]').forEach(th => {
      const col = th.dataset.sort, ind = th.querySelector('.sort-ind');
      if (ind) ind.textContent = col === sc.sortCol ? (sc.sortDir === 'desc' ? '▼' : '▲') : '↕';
      th.classList.toggle('th-sorted', col === sc.sortCol);
    });

    const rows = lista.map(t => `<tr>
      <td><span class="tag">${t.regionalTAT}</span></td>
      <td><strong>${t.nombre}</strong><br><span class="muted">${t.cediNombre}</span></td>
      <td class="num"><span class="badge b-${zonaDe(t.cobertura)}">${t.cobertura.toFixed(1)}</span></td>
      <td class="num">${fmt(t.invConEdad)}</td>
      <td class="num"><strong class="txt-rojo">${fmt(t.aGestionar)}</strong></td>
      <td class="num">${fmt(t.invTotal)}</td>
    </tr>`).join('');
    const totalRow = lista.length ? `<tr class="row-total">
      <td colspan="2"><strong>TOTAL Alerta 1</strong></td>
      <td class="num">—</td>
      <td class="num"><strong>${fmt(lista.reduce((a, b) => a + b.invConEdad, 0))}</strong></td>
      <td class="num"><strong>${fmt(totalGestionar)}</strong></td>
      <td class="num"><strong>${fmt(totalInv)}</strong></td>
    </tr>` : '';
    $('#tabla-criticos tbody').innerHTML = (rows ||
      '<tr><td colspan="6" class="empty">✅ Sin tiendas en Alerta 1 para los filtros actuales</td></tr>') + totalRow;
  }

  /* =========================================================================
   *  VISTA: ALERTA 2 — Inventario a gestionar por frescura (PEPS, cobertura <5 d)
   * ====================================================================== */
  function renderAlerta2() {
    if (!$('#fa2-dias')) initPanelAlerta2();
    refreshAlerta2();
  }

  function initPanelAlerta2() {
    const sc = stateAlerta2;
    const cont = $('#panel-filtros-proyeccion');
    if (!cont) return;

    // Slider de tiempo con la misma mecánica que el umbral de Alerta 1: el tope
    // del rango (5 d, el límite real de Alerta 2) equivale a "sin límite".
    const MAX_SLIDER = P.umbralAlertaCoberturaDias;
    const valorSlider = sc.diasVenderMax == null ? MAX_SLIDER : sc.diasVenderMax;

    cont.innerHTML = `
<div class="filtros-panel">
  <div class="filtros-panel-head">
    <h4>🍳 Filtros de Alerta 2 — frescura PEPS</h4>
    <span class="hint">"Días a vender" = unidades en riesgo ÷ venta diaria (dato real del informe). Aplica a tiendas y referencias</span>
    <button class="btn-reset" id="fa2-reset">↺ Limpiar</button>
  </div>
  <div class="filtros-panel-body">
    <div class="fc-group">
      <label>Máx. días a vender</label>
      <div class="slider-wrap">
        <input type="range" id="fa2-dias" min="0" max="${MAX_SLIDER}" step="0.5" value="${valorSlider}">
        <span class="slider-val" id="fa2-dias-val"></span>
      </div>
    </div>
  </div>
</div>`;

    const pintarValor = () => {
      $('#fa2-dias-val').textContent = sc.diasVenderMax == null ? 'Sin límite' : `≤ ${sc.diasVenderMax} d`;
    };
    pintarValor();

    $('#fa2-dias').addEventListener('input', e => {
      const v = +e.target.value;
      sc.diasVenderMax = v >= MAX_SLIDER ? null : v;
      pintarValor();
      refreshAlerta2();
    });
    $('#fa2-reset').addEventListener('click', () => {
      sc.diasVenderMax = null;
      $('#fa2-dias').value = MAX_SLIDER;
      pintarValor();
      refreshAlerta2();
    });
  }

  function badgeDiasAVender(dias) {
    if (dias == null) return '<span class="badge b-gris">—</span>';
    return `<span class="badge ${dias > 1 ? 'b-rojo' : 'b-naranja'}">${fmtDias(dias)}</span>`;
  }

  function refreshAlerta2() {
    const sc = stateAlerta2;
    const todas = tiendasBase();
    const base = todas.filter(t => t.alerta === 2);

    // Umbral de cobertura GLOBAL (🔍 Filtros): es el corte entre las dos alertas.
    // Por debajo del corte quedan las tiendas de Alerta 2 con "días a vender" <
    // umbral (las sin dato se conservan: el informe las clasifica en Alerta 2
    // igual) MÁS las tiendas del informe en Alerta 1 cuya cobertura cae bajo el
    // umbral — al subirlo, salen del bloque de arriba y entran a este.
    const migradas = todas.filter(t => t.alerta === 1 && t.cobertura < state.umbral);
    const bajoUmbral = base
      .filter(t => t.diasAVender == null || t.diasAVender < state.umbral)
      .concat(migradas);

    // El slider de tiempo propio de Alerta 2 refina a nivel de tienda: con un
    // máximo activo se ocultan las tiendas cuyos "días a vender" lo superan o
    // no existen en el informe.
    const lista = (sc.diasVenderMax == null ? bajoUmbral :
      bajoUmbral.filter(t => t.diasAVender != null && t.diasAVender <= sc.diasVenderMax))
      // Agrupadas por regional, en el mismo orden del filtro (Occidente ->
      // Costa Oriente -> Centro); dentro de cada regional, de mayor a menor
      // inventario a gestionar.
      .slice().sort((a, b) => {
        const orden = DB.regiones.findIndex(r => r.id === a.regionId) -
                      DB.regiones.findIndex(r => r.id === b.regionId);
        return orden !== 0 ? orden : b.aGestionar - a.aGestionar;
      });

    // Referencias en riesgo por tienda (respetando talla + máx. días a vender)
    const refsPorTienda = {};
    const refsFiltradas = [];
    lista.forEach(t => {
      const refs = t.referencias.filter(r => state.items.has(r.itemId)).filter(r => {
        if (sc.diasVenderMax != null && (r.diasAVender == null || r.diasAVender > sc.diasVenderMax)) return false;
        return true;
      });
      refsPorTienda[t.nombre] = refs;
      refs.forEach(r => refsFiltradas.push({ tienda: t.nombre, ...r }));
    });

    const filtroActivo = sc.diasVenderMax != null || state.items.size < DB.items.length ||
      state.regiones.size < DB.regiones.length || state.cedis.size < DB.cedis.length;
    const enAlcanceTiendas = new Set(refsFiltradas.map(r => r.tienda)).size;
    const enAlcanceUnidades = refsFiltradas.reduce((a, b) => a + (b.enRiesgo || 0), 0);

    const R = DB.alerta2Resumen;
    kpis('#kpis-proyeccion', [
      { label: 'TAT en riesgo (informe)', valor: `${R.tatEnRiesgo}`, sub: `de ${R.deTotalAlerta2} en Alerta 2`, icon: '🍳', clase: 'z-rojo' },
      { label: 'Referencias únicas (informe)', valor: R.referenciasUnicas, sub: 'según el informe real', icon: '🏷️' },
      { label: 'Total a gestionar (Alerta 2)', valor: fmt(lista.reduce((a, b) => a + b.aGestionar, 0)), sub: `${lista.length} tiendas en el alcance`, icon: '📦' },
    ]);
    $('#alerta2-nota').innerHTML = `Los 2 primeros KPIs son el encabezado literal del informe (no cambian con los filtros). ` +
      `<strong>En el alcance filtrado actual:</strong> ${enAlcanceTiendas} tiendas · ${refsFiltradas.length} referencias · ${fmt(enAlcanceUnidades)} unidades en riesgo` +
      (filtroActivo ? '' : ' (sin filtros activos)') + '.';

    // Cada tienda muestra, fija justo debajo de su fila, su propia subtabla de
    // referencias en riesgo (ya no es desplegable).
    const badgeEdadMax = e => e == null ? '<span class="badge b-gris">—</span>'
      : `<span class="badge b-${e >= P.umbralEdadCriticaDias ? 'rojo' : 'verde'}">${fmtDias(e)}</span>`;

    const rowsTiendas = lista.map(t => {
      const refs = refsPorTienda[t.nombre] || [];
      const filaPrincipal = `<tr class="fila-tienda-alerta2" data-tienda="${t.nombre}">
        <td><span class="tag">${t.regionalTAT}</span></td>
        <td><strong>${t.nombre}</strong>${t.alerta === 1
          ? `<br><span class="muted">cobertura ${t.cobertura.toFixed(1)} d — entra por el umbral actual (${state.umbral} d)</span>` : ''}</td>
        <td class="num">${fmt(t.invConEdad)}</td>
        <td class="num">${fmt(t.ventaDia)}</td>
        <td class="num"><strong class="txt-rojo">${fmt(t.aGestionar)}</strong></td>
        <td class="num">${badgeDiasAVender(t.diasAVender)}</td>
        <td class="num">${fmt(t.invTotal)}</td>
      </tr>`;

      const filasRef = refs.slice().sort((a, b) => (b.enRiesgo || 0) - (a.enRiesgo || 0)).map(r => `<tr>
        <td>${r.nombre}${r.deVentas ? ' <span class="muted" title="Venta día tomada de ventas-1.xlsx (el informe la dejaba vacía o en 0)">· ventas reales</span>' : ''}</td>
        <td class="num">${fmt(r.invActual)}</td>
        <td class="num">${fmt(r.ventaDia)}</td>
        <td class="num"><strong class="txt-rojo">${fmt(r.enRiesgo)}</strong></td>
        <td class="num">${badgeDiasAVender(r.diasAVender)}</td>
        <td class="num">${badgeEdadMax(r.edadMax)}</td>
      </tr>`).join('');
      const subContenido = refs.length
        ? `<table><thead><tr><th>Referencia</th><th class="num">Inv. actual</th><th class="num">Venta ref. (día)</th><th class="num">Unidades en riesgo</th><th class="num">Días a vender</th><th class="num">Edad máx. (d)</th></tr></thead><tbody>${filasRef}</tbody></table>`
        : '<div class="empty">El informe no trae detalle por referencia para esta tienda</div>';
      const filaDetalle = `<tr class="fila-detalle-alerta2" data-tienda-detalle="${t.nombre}">
        <td colspan="7"><div class="subtabla-wrap">${subContenido}</div></td>
      </tr>`;
      return filaPrincipal + filaDetalle;
    }).join('');

    const totalRow2 = lista.length ? `<tr class="row-total">
      <td colspan="2"><strong>TOTAL Alerta 2</strong></td>
      <td class="num"><strong>${fmt(lista.reduce((a, b) => a + b.invConEdad, 0))}</strong></td>
      <td class="num"><strong>${fmt(lista.reduce((a, b) => a + b.ventaDia, 0))}</strong></td>
      <td class="num"><strong>${fmt(lista.reduce((a, b) => a + b.aGestionar, 0))}</strong></td>
      <td class="num">—</td>
      <td class="num"><strong>${fmt(lista.reduce((a, b) => a + b.invTotal, 0))}</strong></td>
    </tr>` : '';
    $('#tabla-alerta2 tbody').innerHTML = (rowsTiendas ||
      '<tr><td colspan="7" class="empty">✅ Ninguna tienda en Alerta 2 con los filtros actuales</td></tr>') + totalRow2;
  }

  /* =========================================================================
   *  VISTA: CANALES (sección unificada con submenú de canales)
   * ====================================================================== */
  function renderCanales() {
    const subtabs = $('#canal-subtabs');
    subtabs.innerHTML = DB.canales.map(c =>
      `<button type="button" class="subtab ${c.id === state.canalActivo ? 'active' : ''}" data-canal="${c.id}">${c.nombre}</button>`).join('');
    if (!subtabs.dataset.wired) {
      subtabs.addEventListener('click', e => {
        const b = e.target.closest('[data-canal]'); if (!b) return;
        state.canalActivo = b.dataset.canal;
        renderCanales();
      });
      subtabs.dataset.wired = '1';
    }
    const canal = DB.canales.find(c => c.id === state.canalActivo);
    if (!canal.datosReales) { renderCanalSinDatos(canal); return; }
    renderCanalTAT();
  }

  function renderCanalSinDatos(canal) {
    $('#canal-contenido').innerHTML = `
      <div class="card">
        <div class="card-head"><h3>${canal.nombre}</h3></div>
        <div class="empty">Sin fuente de datos real todavía para este canal — el informe
          "Días de Inventario" solo cubre TAT. Se mostrará aquí en cuanto se conecte una
          fuente real (ERP / API) para ${canal.nombre}.</div>
      </div>`;
  }

  // --- Canal TAT: Días de Inventario TAT por Regional (real) + tiendas ---
  function renderCanalTAT() {
    const tiendas = tiendasBase();
    const filasRegional = DB.regionalTAT.map(r => `<tr>
      <td><strong>${r.nombre}</strong></td>
      <td class="num">${fmt(r.inv)}</td>
      <td class="num">${fmt(r.venta)}</td>
      <td class="num"><span class="badge b-${zonaDe(r.dias)}">${fmtDias(r.dias)}</span></td>
    </tr>`).join('');
    const T = DB.regionalTATTotal;

    const filasTiendas = tiendas.slice().sort((a, b) => b.invTotal - a.invTotal).map(t => `<tr>
      <td><span class="tag">${t.regionalTAT}</span></td>
      <td><strong>${t.nombre}</strong></td>
      <td class="num">${fmt(t.ventaDia)}</td>
      <td class="num">${fmt(t.invTotal)}</td>
      <td class="num">${t.alerta === 1 ? `<span class="badge b-${zonaDe(t.cobertura)}">${t.cobertura.toFixed(1)} d</span>` : badgeDiasAVender(t.diasAVender)}</td>
      <td>${t.alerta === 1 ? '<span class="badge b-rojo">Alerta 1</span>' : '<span class="badge b-verde">Alerta 2</span>'}</td>
    </tr>`).join('');

    $('#canal-contenido').innerHTML = `
      <p class="nota">Las tiendas TAT son <strong>clientes</strong>: solo registran <strong>ventas</strong>. La
        <strong>Regional</strong> (filtro de arriba) es la agrupación comercial real del informe
        (Occidente / Costa Oriente / Centro). La tabla regional y la de tiendas vienen de secciones
        distintas del informe y no se fuerzan a coincidir entre sí (ver docs/CONTEXTO.md sección 11).</p>
      <div class="card card-wide">
        <div class="card-head"><h3>Días de Inventario TAT por Regional</h3><span class="hint">🔒 Cifra fija del informe — no cambia con Región/CEDI/talla/etc.</span></div>
        <div class="tabla-wrap"><table>
          <thead><tr><th>Regional</th><th class="num">Inventario TAT</th><th class="num">Venta día</th><th class="num">Días de inventario</th></tr></thead>
          <tbody>${filasRegional}<tr class="row-total"><td><strong>TOTAL TAT</strong></td><td class="num"><strong>${fmt(T.inv)}</strong></td><td class="num"><strong>${fmt(T.venta)}</strong></td><td class="num"><strong>${fmtDias(T.dias)}</strong></td></tr></tbody>
        </table></div>
      </div>
      <div class="card card-wide">
        <div class="card-head"><h3>🏪 Tiendas TAT</h3><span class="hint">Esta tabla SÍ responde a los filtros. Alerta 1 muestra cobertura (días) · Alerta 2 muestra días a vender (PEPS)</span></div>
        <div class="tabla-wrap"><table>
          <thead><tr><th>Regional</th><th>Tienda</th><th class="num">Venta/día</th><th class="num">Inv. total</th><th class="num">Cobertura / días a vender</th><th>Estado</th></tr></thead>
          <tbody>${filasTiendas || '<tr><td colspan="6" class="empty">Sin tiendas TAT en el alcance actual</td></tr>'}</tbody>
        </table></div>
      </div>`;
  }

  /* --- Helpers UI --------------------------------------------------------- */
  function kpiCardsHTML(items) {
    return items.map(k => `
      <div class="kpi ${k.clase || ''}">
        <div class="kpi-icon">${k.icon || ''}</div>
        <div class="kpi-body">
          <div class="kpi-label">${k.label}</div>
          <div class="kpi-valor">${k.valor}</div>
          <div class="kpi-sub">${k.sub || ''}</div>
        </div>
      </div>`).join('');
  }
  function kpis(sel, items) { $(sel).innerHTML = kpiCardsHTML(items); }

  /* --- Init --------------------------------------------------------------- */
  function init() {
    $('#meta-actualizado').textContent = DB.meta.actualizado;
    $('#meta-corte').textContent = DB.meta.fechaCorte;

    // Indicadores generales de TODA LA COMPAÑÍA (informe real, no varían con filtros)
    // "Huevo sin clasificar" no va aquí: se muestra como fila anexa bajo el
    // TOTAL del Detalle por Talla (está excluido de ese desglose).
    kpis('#kpis-compania', [
      { label: 'Inventario total compañía', valor: fmt(DB.meta.inventarioTotalCompania), sub: 'todas las categorías', icon: '🏢' },
      { label: 'Días de inventario (global)', valor: DB.meta.diasInventarioGlobal.toFixed(1) + ' d', sub: 'toda la compañía', icon: '📅', clase: COLOR_CLASE[zonaDe(DB.meta.diasInventarioGlobal)] },
    ]);

    poblarFiltros();
    wireFiltros();
    wireNav();
    render();
  }

  DB.cargar().then(init);
})();
