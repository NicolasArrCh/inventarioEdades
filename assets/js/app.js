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
  };

  const stateAlerta1 = {
    umbral: P.umbralAlertaCoberturaDias,
    aGestMin: 0,
    sortCol: 'cobertura',
    sortDir: 'desc',
  };

  const stateAlerta2 = {
    diasVenderMax: null,
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
      state.tipoUbic === 'all' && state.reporte === 'all' && state.invMin === 0;
    return def ? 'nacional' : 'regional';
  }

  function nAvanzados() {
    let n = 0;
    if (state.tipoUbic !== 'all') n++;
    if (state.reporte !== 'all') n++;
    if (state.invMin > 0) n++;
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
    construirMS($('#ms-region'), 'Región (departamento)', ops, () => state.regiones, () => {
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
    $('#f-items').innerHTML = DB.items.map(i =>
      `<button type="button" class="chip chip-on" data-val="${i.id}">${i.nombre}</button>`).join('');
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
    wireSeg('#f-ubic', 'ubic', v => state.tipoUbic = v);
    wireSeg('#f-reporte', 'rep', v => state.reporte = v);

    $('#f-inv-min').addEventListener('input', e => {
      const v = e.target.value === '' ? 0 : +e.target.value;
      state.invMin = isNaN(v) ? 0 : v; render();
    });

    $('#f-mas').addEventListener('click', () => {
      const p = $('#filtros-avanzados');
      p.hidden = !p.hidden;
      $('#f-mas').classList.toggle('abierto', !p.hidden);
    });
    $('#f-reset').addEventListener('click', resetFiltros);

    document.addEventListener('click', cerrarTodosMS);
  }

  function resetFiltros() {
    state.regiones = new Set(idsRegiones());
    sincronizarCedis();
    state.items = new Set(idsItems());
    state.tipoUbic = 'all'; state.reporte = 'all'; state.invMin = 0;

    montarMSRegion(); montarMSCedi();
    $$('#f-items .chip').forEach(c => c.classList.add('chip-on'));
    $$('#f-ubic button').forEach(b => b.classList.toggle('seg-on', b.dataset.ubic === 'all'));
    $$('#f-reporte button').forEach(b => b.classList.toggle('seg-on', b.dataset.rep === 'all'));
    $('#f-inv-min').value = 0;
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

    const sin = DB.meta.cedisSinReporte;
    const badge = $('#sin-reporte-badge');
    badge.innerHTML = `<span class="pulse"></span> ${sin.length} CEDIs sin reporte`;
    badge.title = 'Pendientes: ' + sin.join(', ');

    const n = nAvanzados();
    $('#mas-count').textContent = n ? `(${n})` : '';
  }

  /* =========================================================================
   *  RENDER MAESTRO
   * ====================================================================== */
  function render() {
    renderContexto();
    switch (state.vista) {
      case 'edades':     renderEdades(); break;
      case 'criticos':   renderAlerta1(); break;
      case 'proyeccion': renderAlerta2(); break;
      case 'canales':    renderCanales(); break;
      case 'historico':  renderHistorico(); break;
    }
  }

  /* =========================================================================
   *  VISTA: RESUMEN — Indicadores Generales + Detalle por Talla (REAL)
   * ====================================================================== */
  function renderEdades() {
    // Detalle por Talla: filas reales, filtrables por talla (los números de
    // cada fila no cambian, solo se muestran/ocultan — el total sí se ajusta
    // al subconjunto visible).
    const filas = DB.items.filter(i => state.items.has(i.id)).slice().sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));
    const totInv = filas.reduce((a, b) => a + b.inventario, 0);
    const totVenta = filas.reduce((a, b) => a + b.venta, 0);

    $('#tabla-talla-detalle tbody').innerHTML = filas.map(t => `<tr>
      <td><strong>${t.nombre}</strong></td>
      <td class="num">${fmt(t.inventario)}</td>
      <td class="num">${fmt(t.venta)}</td>
      <td class="num">${t.dias == null ? '<span class="muted">—</span>' : `<span class="badge b-${zonaDe(t.dias)}">${fmtDias(t.dias)}</span>`}</td>
    </tr>`).join('') + (filas.length
      ? `<tr class="row-total"><td><strong>TOTAL${filas.length < DB.items.length ? ' (filtrado)' : ''}</strong></td><td class="num"><strong>${fmt(totInv)}</strong></td><td class="num"><strong>${fmt(totVenta)}</strong></td><td class="num">—</td></tr>`
      : '<tr><td colspan="4" class="empty">Sin tallas seleccionadas</td></tr>');

    // "Días de inventario por talla" — mismos datos de la tabla, en gráfica
    Charts.barrasH($('#chart-dias-talla'),
      filas.filter(t => t.dias != null).map(t => ({ label: t.nombre, valor: t.dias, color: zonaDe(t.dias) }))
        .sort((a, b) => b.valor - a.valor),
      { labelW: 130 });

    renderAlertasReales();
    renderRecomendacionesReales();
  }

  // Alertas basadas en cifras reales: tallas en zona roja del semáforo visual
  // (≥6 d), tallas sin venta, y CEDIs sin reporte (hecho operativo conocido,
  // ver docs/CONTEXTO.md).
  function renderAlertasReales() {
    const alertas = [];
    DB.meta.cedisSinReporte.forEach(c =>
      alertas.push({ tipo: 'pend', icon: '⏰', txt: `<strong>${c}</strong> no reporta edades de forma regular (ver docs/CONTEXTO.md).` }));
    DB.items.filter(i => i.dias == null).forEach(i =>
      alertas.push({ tipo: 'pend', icon: '❔', txt: `<strong>${i.nombre}</strong> sin venta en el periodo del informe — días de inventario no calculable.` }));
    DB.items.filter(i => i.dias != null && i.dias >= P.umbralEdadCriticaDias).sort((a, b) => b.dias - a.dias).forEach(i =>
      alertas.push({ tipo: 'critico', icon: '🚨', txt: `<strong>${i.nombre}</strong>: ${i.dias} días de inventario (zona roja, ≥ 6 días).` }));

    $('#panel-alertas').innerHTML = alertas.length
      ? alertas.map(a => `<div class="alerta a-${a.tipo}"><span>${a.icon}</span><p>${a.txt}</p></div>`).join('')
      : '<div class="empty">Sin alertas en los datos reales disponibles ✅</div>';
  }

  function renderRecomendacionesReales() {
    const recs = [];
    DB.items.filter(i => i.dias != null && i.dias >= P.umbralEdadCriticaDias).sort((a, b) => b.dias - a.dias).slice(0, 4).forEach(i => {
      recs.push({ prio: i.dias >= 9 ? 'alta' : 'media', titulo: i.nombre,
        texto: `${i.dias} días de inventario a nivel compañía. Redirigir a <strong>Mayorista</strong> o activar promoción para acelerar rotación.` });
    });
    const a1 = DB.tiendasTAT.filter(t => t.alerta === 1).length;
    const a2 = DB.tiendasTAT.filter(t => t.alerta === 2 && t.aGestionar > 0).length;
    if (a1) recs.push({ prio: 'media', titulo: `${a1} tiendas TAT en Alerta 1`, texto: `Sobre-inventario (cobertura ≥ 5 días). Ver detalle en la vista <strong>Alerta 1</strong>.` });
    if (a2) recs.push({ prio: 'media', titulo: `${a2} tiendas TAT en Alerta 2`, texto: `Riesgo de frescura (PEPS). Ver detalle en la vista <strong>Alerta 2</strong>.` });

    const orden = { alta: 0, media: 1, baja: 2 };
    recs.sort((a, b) => orden[a.prio] - orden[b.prio]);
    $('#panel-ia-edades').innerHTML = recs.length
      ? recs.map(r => `<div class="rec rec-${r.prio}"><div class="rec-head"><span class="rec-prio">${r.prio.toUpperCase()}</span><strong>${r.titulo}</strong></div><p>${r.texto}</p></div>`).join('')
      : '<div class="empty">Sin recomendaciones: inventario saludable ✅</div>';
  }

  /* =========================================================================
   *  Filtro compartido "Regional TAT" (chips) para las vistas Alerta 1/2
   * ====================================================================== */
  function chipsRegionalTAT(set) {
    return DB.regionalesTAT.map(r =>
      `<button type="button" class="chip ${set.has(r) ? 'chip-on' : ''}" data-val="${r}">${r}</button>`).join('');
  }
  function wireChipsRegionalTAT(id, set, onChange) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('[data-val]'); if (!b) return;
      const r = b.dataset.val;
      if (set.has(r)) { set.delete(r); b.classList.remove('chip-on'); }
      else { set.add(r); b.classList.add('chip-on'); }
      onChange();
    });
  }

  /* =========================================================================
   *  VISTA: ALERTA 1 — Sobre-inventario por tienda TAT (cobertura ≥ umbral)
   * ====================================================================== */
  function renderAlerta1() {
    if (!$('#fa1-umbral')) initPanelAlerta1();
    refreshAlerta1();
  }

  function initPanelAlerta1() {
    const sc = stateAlerta1;
    const cont = $('#panel-filtros-criticos');
    if (!cont) return;

    cont.innerHTML = `
<div class="filtros-panel">
  <div class="filtros-panel-head">
    <h4>🔺 Filtros de Alerta 1 — sobre-inventario</h4>
    <span class="hint">Cobertura = inventario total ÷ venta diaria de la tienda (dato real del informe)</span>
    <button class="btn-reset" id="fa1-reset">↺ Limpiar</button>
  </div>
  <div class="filtros-panel-body">
    <div class="fc-group">
      <label>Regional TAT</label>
      <div class="chips" id="fa1-regional">${chipsRegionalTAT(sc.regionales)}</div>
    </div>
    <div class="fc-group">
      <label>Umbral de cobertura (días)</label>
      <div class="slider-wrap">
        <input type="range" id="fa1-umbral" min="0" max="15" step="0.5" value="${sc.umbral}">
        <span class="slider-val" id="fa1-umbral-val">≥ ${sc.umbral} d</span>
      </div>
    </div>
    <div class="fc-group">
      <label>Mín. unidades a gestionar</label>
      <input type="number" id="fa1-min" class="fc-input" min="0" step="1000" value="${sc.aGestMin}">
    </div>
    <div class="fc-group">
      <label>Ordenar por</label>
      <select id="fa1-orden" class="filtro-select-sm">
        <option value="cobertura_desc">Cobertura ↓</option>
        <option value="cobertura_asc">Cobertura ↑</option>
        <option value="aGestionar_desc">A gestionar ↓</option>
        <option value="invEdad_desc">Inv. con edad ↓</option>
        <option value="invTotal_desc">Inv. total ↓</option>
      </select>
    </div>
  </div>
</div>`;

    wireChipsRegionalTAT('#fa1-regional', sc.regionales, refreshAlerta1);
    $('#fa1-umbral').addEventListener('input', e => {
      sc.umbral = +e.target.value;
      $('#fa1-umbral-val').textContent = `≥ ${sc.umbral} d`;
      refreshAlerta1();
    });
    $('#fa1-min').addEventListener('input', e => { sc.aGestMin = +e.target.value || 0; refreshAlerta1(); });
    $('#fa1-orden').value = `${sc.sortCol}_${sc.sortDir}`;
    $('#fa1-orden').addEventListener('change', e => {
      const v = e.target.value, i = v.lastIndexOf('_');
      sc.sortCol = v.slice(0, i); sc.sortDir = v.slice(i + 1);
      refreshAlerta1();
    });
    $('#fa1-reset').addEventListener('click', () => {
      sc.umbral = P.umbralAlertaCoberturaDias; sc.aGestMin = 0; sc.sortCol = 'cobertura'; sc.sortDir = 'desc';
      sc.regionales = new Set(DB.regionalesTAT);
      $('#fa1-umbral').value = sc.umbral; $('#fa1-umbral-val').textContent = `≥ ${sc.umbral} d`;
      $('#fa1-min').value = 0; $('#fa1-orden').value = 'cobertura_desc';
      $$('#fa1-regional .chip').forEach(c => c.classList.add('chip-on'));
      refreshAlerta1();
    });

    $('#tabla-criticos thead').addEventListener('click', e => {
      const th = e.target.closest('th[data-sort]'); if (!th) return;
      const col = th.dataset.sort;
      if (sc.sortCol === col) sc.sortDir = sc.sortDir === 'desc' ? 'asc' : 'desc';
      else { sc.sortCol = col; sc.sortDir = 'desc'; }
      const sel = $('#fa1-orden'), val = `${sc.sortCol}_${sc.sortDir}`;
      if ([...sel.options].some(o => o.value === val)) sel.value = val;
      refreshAlerta1();
    });
  }

  function refreshAlerta1() {
    const sc = stateAlerta1;
    const base = tiendasBase().filter(t => t.alerta === 1 && sc.regionales.has(t.regionalTAT));
    let lista = base.filter(t => t.cobertura >= sc.umbral && t.aGestionar >= sc.aGestMin);

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
      { label: 'Tiendas en Alerta 1', valor: lista.length, sub: `de ${base.length} en el alcance`, icon: '🔺', clase: lista.length ? 'z-rojo' : 'z-verde' },
      { label: 'Unidades a gestionar', valor: fmt(totalGestionar), sub: 'sobre-inventario ≥ umbral', icon: '🥚', clase: 'z-rojo' },
      { label: 'Inventario total en la alerta', valor: fmt(totalInv), sub: 'informe pág. 3', icon: '📦' },
      { label: 'Umbral activo', valor: `≥ ${sc.umbral} d`, sub: 'cobertura (independiente del semáforo)', icon: '📏' },
    ]);

    const porRegional = DB.regionalesTAT.map(r => ({ nombre: r, valor: lista.filter(x => x.regionalTAT === r).reduce((a, b) => a + b.aGestionar, 0) }));
    $('#alerta1-subtotales').innerHTML = porRegional.map(r => `
      <div class="kpi z-rojo"><div class="kpi-icon">📍</div><div class="kpi-body">
        <div class="kpi-label">${r.nombre}</div><div class="kpi-valor">${fmt(r.valor)}</div>
        <div class="kpi-sub">a gestionar</div></div></div>`).join('');

    $$('#tabla-criticos th[data-sort]').forEach(th => {
      const col = th.dataset.sort, ind = th.querySelector('.sort-ind');
      if (ind) ind.textContent = col === sc.sortCol ? (sc.sortDir === 'desc' ? ' ▼' : ' ▲') : ' ↕';
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

    $('#alerta1-nota-alerta3').textContent = DB.notaAlerta3;
    renderRecomendacionesTAT('#panel-ia-criticos', tiendasBase().filter(t => sc.regionales.has(t.regionalTAT)), 8);
  }

  /* =========================================================================
   *  VISTA: ALERTA 2 — Inventario a gestionar por frescura (PEPS, cobertura <5 d)
   * ====================================================================== */
  function renderAlerta2() {
    if (!$('#fa2-regional')) initPanelAlerta2();
    refreshAlerta2();
  }

  function initPanelAlerta2() {
    const sc = stateAlerta2;
    const cont = $('#panel-filtros-proyeccion');
    if (!cont) return;

    cont.innerHTML = `
<div class="filtros-panel">
  <div class="filtros-panel-head">
    <h4>🍳 Filtros de Alerta 2 — frescura PEPS</h4>
    <span class="hint">"Días a vender" = unidades en riesgo ÷ venta diaria de la referencia (dato real del informe)</span>
    <button class="btn-reset" id="fa2-reset">↺ Limpiar</button>
  </div>
  <div class="filtros-panel-body">
    <div class="fc-group">
      <label>Regional TAT</label>
      <div class="chips" id="fa2-regional">${chipsRegionalTAT(sc.regionales)}</div>
    </div>
    <div class="fc-group">
      <label>Máx. días a vender</label>
      <input type="number" id="fa2-dias" class="fc-input" min="0" step="0.5" placeholder="Sin límite">
    </div>
  </div>
</div>`;

    wireChipsRegionalTAT('#fa2-regional', sc.regionales, refreshAlerta2);
    $('#fa2-dias').addEventListener('input', e => {
      const v = e.target.value;
      sc.diasVenderMax = v === '' ? null : +v;
      refreshAlerta2();
    });
    $('#fa2-reset').addEventListener('click', () => {
      sc.regionales = new Set(DB.regionalesTAT);
      sc.diasVenderMax = null;
      $$('#fa2-regional .chip').forEach(c => c.classList.add('chip-on'));
      $('#fa2-dias').value = '';
      refreshAlerta2();
    });
  }

  function badgeDiasAVender(dias) {
    if (dias == null) return '<span class="badge b-gris">—</span>';
    return `<span class="badge ${dias > 1 ? 'b-rojo' : 'b-verde'}">${fmtDias(dias)}</span>`;
  }

  function refreshAlerta2() {
    const sc = stateAlerta2;
    const base = tiendasBase().filter(t => t.alerta === 2 && sc.regionales.has(t.regionalTAT));

    const refsFiltradas = [];
    base.forEach(t => {
      t.referencias.filter(r => state.items.has(r.itemId)).forEach(r => {
        if (sc.diasVenderMax != null && (r.diasAVender == null || r.diasAVender > sc.diasVenderMax)) return;
        refsFiltradas.push({ tienda: t.nombre, regional: t.regionalTAT, ...r });
      });
    });

    const filtroActivo = sc.regionales.size < DB.regionalesTAT.length || sc.diasVenderMax != null || state.items.size < DB.items.length ||
      state.regiones.size < DB.regiones.length || state.cedis.size < DB.cedis.length;
    const enAlcanceTiendas = new Set(refsFiltradas.map(r => r.tienda)).size;
    const enAlcanceUnidades = refsFiltradas.reduce((a, b) => a + b.enRiesgo, 0);

    const R = DB.alerta2Resumen;
    kpis('#kpis-proyeccion', [
      { label: 'TAT en riesgo (informe)', valor: `${R.tatEnRiesgo}`, sub: `de ${R.deTotalAlerta2} en Alerta 2`, icon: '🍳', clase: 'z-rojo' },
      { label: 'Referencias únicas (informe)', valor: R.referenciasUnicas, sub: 'según el informe real', icon: '🏷️' },
      { label: 'Unidades en riesgo (informe)', valor: fmt(R.unidadesEnRiesgo), sub: 'a acelerar rotación', icon: '⏳', clase: 'z-rojo' },
      { label: 'Total a gestionar (Alerta 2)', valor: fmt(base.reduce((a, b) => a + b.aGestionar, 0)), sub: `${base.length} tiendas en el alcance`, icon: '📦' },
      { label: 'Inventario total en la alerta', valor: fmt(base.reduce((a, b) => a + b.invTotal, 0)), sub: 'informe pág. 3', icon: '🏬' },
    ]);
    $('#alerta2-nota').innerHTML = `Los 3 primeros KPIs son el encabezado literal del informe (no cambian con los filtros). ` +
      `<strong>En el alcance filtrado actual:</strong> ${enAlcanceTiendas} tiendas · ${refsFiltradas.length} referencias · ${fmt(enAlcanceUnidades)} unidades en riesgo` +
      (filtroActivo ? '' : ' (sin filtros activos)') + '.';

    const rowsTiendas = base.map(t => `<tr>
      <td><span class="tag">${t.regionalTAT}</span></td>
      <td><strong>${t.nombre}</strong></td>
      <td class="num">${fmt(t.invConEdad)}</td>
      <td class="num">${fmt(t.ventaDia)}</td>
      <td class="num"><strong class="txt-rojo">${fmt(t.aGestionar)}</strong></td>
      <td class="num">${badgeDiasAVender(t.diasAVender)}</td>
      <td class="num">${fmt(t.invTotal)}</td>
    </tr>`).join('');
    const totalRow2 = base.length ? `<tr class="row-total">
      <td colspan="2"><strong>TOTAL Alerta 2</strong></td>
      <td class="num"><strong>${fmt(base.reduce((a, b) => a + b.invConEdad, 0))}</strong></td>
      <td class="num"><strong>${fmt(base.reduce((a, b) => a + b.ventaDia, 0))}</strong></td>
      <td class="num"><strong>${fmt(base.reduce((a, b) => a + b.aGestionar, 0))}</strong></td>
      <td class="num">—</td>
      <td class="num"><strong>${fmt(base.reduce((a, b) => a + b.invTotal, 0))}</strong></td>
    </tr>` : '';
    $('#tabla-alerta2 tbody').innerHTML = (rowsTiendas ||
      '<tr><td colspan="7" class="empty">✅ Ninguna tienda en Alerta 2 con los filtros actuales</td></tr>') + totalRow2;

    const porTienda = {};
    refsFiltradas.forEach(r => { (porTienda[r.tienda] = porTienda[r.tienda] || []).push(r); });
    const bloques = Object.entries(porTienda).map(([tienda, refs]) => {
      const total = refs.reduce((a, b) => a + b.enRiesgo, 0);
      const regional = refs[0].regional;
      const filas = refs.slice().sort((a, b) => b.enRiesgo - a.enRiesgo).map(r => `<tr>
        <td>${r.nombre}</td>
        <td class="num">${fmt(r.invActual)}</td>
        <td class="num">${fmt(r.ventaDia)}</td>
        <td class="num"><strong class="txt-rojo">${fmt(r.enRiesgo)}</strong></td>
        <td class="num">${badgeDiasAVender(r.diasAVender)}</td>
      </tr>`).join('');
      return `<div class="card">
        <div class="card-head"><h3>${tienda}</h3><span class="hint">${regional} · ${refs.length} referencias en riesgo · total ${fmt(total)} und</span></div>
        <div class="tabla-wrap"><table>
          <thead><tr><th>Referencia</th><th class="num">Inv. actual</th><th class="num">Venta ref. (día)</th><th class="num">Unidades en riesgo</th><th class="num">Días a vender</th></tr></thead>
          <tbody>${filas}</tbody>
        </table></div>
      </div>`;
    }).join('');
    $('#detalle-referencias-riesgo').innerHTML = bloques ||
      '<div class="empty">Sin referencias en riesgo para los filtros actuales (Cartagena y Sincelejo no traen detalle por referencia en el informe) ✅</div>';

    renderRecomendacionesTAT('#panel-ia-proyeccion', base, 8);
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
        <strong>Regional TAT</strong> (Occidente / Costa Oriente / Centro) es la agrupación comercial del
        informe real — distinta del departamento geográfico. La tabla regional y la de tiendas vienen de
        secciones distintas del informe y no se fuerzan a coincidir entre sí (ver docs/CONTEXTO.md sección 11).</p>
      <div class="card card-wide">
        <div class="card-head"><h3>Días de Inventario TAT por Regional</h3><span class="hint">Inventario "CARTON VERDE CANASTA" ÷ venta diaria promedio</span></div>
        <div class="tabla-wrap"><table>
          <thead><tr><th>Regional</th><th class="num">Inventario TAT</th><th class="num">Venta día</th><th class="num">Días de inventario</th></tr></thead>
          <tbody>${filasRegional}<tr class="row-total"><td><strong>TOTAL TAT</strong></td><td class="num"><strong>${fmt(T.inv)}</strong></td><td class="num"><strong>${fmt(T.venta)}</strong></td><td class="num"><strong>${fmtDias(T.dias)}</strong></td></tr></tbody>
        </table></div>
      </div>
      <div class="card card-wide">
        <div class="card-head"><h3>🏪 Tiendas TAT</h3><span class="hint">Alerta 1 muestra cobertura (días) · Alerta 2 muestra días a vender (PEPS)</span></div>
        <div class="tabla-wrap"><table>
          <thead><tr><th>Regional</th><th>Tienda</th><th class="num">Venta/día</th><th class="num">Inv. total</th><th class="num">Cobertura / días a vender</th><th>Estado</th></tr></thead>
          <tbody>${filasTiendas || '<tr><td colspan="6" class="empty">Sin tiendas TAT en el alcance actual</td></tr>'}</tbody>
        </table></div>
      </div>
      ${panelIAHTML('panel-ia-canal')}`;
    renderRecomendacionesTAT('#panel-ia-canal', tiendas, 8);
  }

  function panelIAHTML(id) {
    return `<div class="card">
      <div class="card-head"><h3>🤖 Recomendaciones IA <span class="live">● en vivo</span></h3><span class="hint">Días bajos y críticos del canal</span></div>
      <div class="lista-grid" id="${id}"></div>
    </div>`;
  }

  /* Recomendaciones a partir de tiendas TAT reales (Alerta 1 / Alerta 2) */
  function generarRecomendacionesTAT(tiendas) {
    const recs = [];

    tiendas.filter(t => t.alerta === 1).sort((a, b) => b.aGestionar - a.aGestionar).slice(0, 5).forEach(t => {
      recs.push({
        prio: t.aGestionar > 150000 ? 'alta' : 'media',
        titulo: `${t.nombre} · ${t.regionalTAT}`,
        texto: `Alerta 1 — cobertura de <strong>${t.cobertura.toFixed(1)} días</strong>. ` +
          `${fmt(t.aGestionar)} unidades a gestionar: frenar despacho y acelerar rotación.`,
      });
    });

    tiendas.filter(t => t.alerta === 2 && t.aGestionar > 0).sort((a, b) => b.aGestionar - a.aGestionar).slice(0, 5).forEach(t => {
      recs.push({
        prio: (t.diasAVender != null && t.diasAVender > 1) ? 'alta' : 'media',
        titulo: `${t.nombre} · ${t.regionalTAT}`,
        texto: `Alerta 2 — frescura PEPS: ${fmt(t.aGestionar)} unidades en riesgo de superar ` +
          `${P.umbralAlertaCoberturaDias} días${t.diasAVender != null ? ` (≈${t.diasAVender} d para liquidarse)` : ''}. ` +
          `Priorizar despacho del lote más antiguo.`,
      });
    });

    const orden = { alta: 0, media: 1, baja: 2 };
    return recs.sort((a, b) => orden[a.prio] - orden[b.prio]);
  }

  function renderRecomendacionesTAT(sel, tiendas, limite) {
    const recs = generarRecomendacionesTAT(tiendas).slice(0, limite);
    const cont = $(sel);
    cont.innerHTML = recs.length
      ? recs.map(r => `<div class="rec rec-${r.prio}">
          <div class="rec-head"><span class="rec-prio">${r.prio.toUpperCase()}</span><strong>${r.titulo}</strong></div>
          <p>${r.texto}</p></div>`).join('')
      : '<div class="empty">Sin recomendaciones: tiendas TAT en rango saludable ✅</div>';
  }

  /* =========================================================================
   *  VISTA: HISTÓRICO (90 días) — demostrativa, ver nota en la vista
   * ====================================================================== */
  function renderHistorico() {
    const h = DB.historia, et = f => f.slice(5);
    Charts.linea($('#chart-hist-inv'), [{ nombre: 'Inventario', color: 'azul', area: true, puntos: h.map(d => ({ x: et(d.fecha), y: d.inventario })) }]);
    Charts.linea($('#chart-hist-dias'), [{ nombre: 'Días de inventario', color: 'ambar', area: true, puntos: h.map(d => ({ x: et(d.fecha), y: d.diasInventario })) }], { desdeCero: true });
    Charts.linea($('#chart-hist-critico'), [{ nombre: '% edad crítica', color: 'rojo', area: true, puntos: h.map(d => ({ x: et(d.fecha), y: d.pctCritico })) }], { desdeCero: true });
    Charts.linea($('#chart-hist-venta'), [{ nombre: 'Venta diaria', color: 'verde', area: true, puntos: h.map(d => ({ x: et(d.fecha), y: d.ventaDia })) }]);
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
    kpis('#kpis-compania', [
      { label: 'Inventario total compañía', valor: fmt(DB.meta.inventarioTotalCompania), sub: 'todas las categorías', icon: '🏢' },
      { label: 'Huevo sin clasificar', valor: fmt(DB.meta.huevoSinClasificar), sub: 'excluido del detalle por talla', icon: '❔', clase: 'z-gris' },
      { label: 'Días de inventario (global)', valor: DB.meta.diasInventarioGlobal.toFixed(1) + ' d', sub: 'toda la compañía', icon: '📅', clase: COLOR_CLASE[zonaDe(DB.meta.diasInventarioGlobal)] },
    ]);

    poblarFiltros();
    wireFiltros();
    wireNav();
    render();
  }

  DB.cargar().then(init);
})();
