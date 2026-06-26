/* =============================================================================
 *  app.js  —  LÓGICA DE LA APLICACIÓN
 * -----------------------------------------------------------------------------
 *  - Estado de filtros multi-selección (región, cedi, item, canal) + avanzados
 *  - Agregaciones sobre los registros (recalculadas en tiempo real)
 *  - Render de cada sección/vista del dashboard
 *
 *  MODELO: el INVENTARIO solo existe en CEDIs y plantas. Las tiendas (TAT) son
 *  CLIENTES y solo tienen VENTAS.
 *
 *  Nivel de análisis (derivado de los filtros):
 *    Nacional  -> todo seleccionado
 *    Regional  -> subconjunto de regiones / filtros activos
 *    CEDI      -> un solo CEDI seleccionado
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
  const idsCanales  = () => DB.canales.map(c => c.id);

  /* --- Estado global (todo seleccionado por defecto) --------------------- */
  const state = {
    vista: 'edades',
    canalActivo: 'TAT', // canal seleccionado dentro de la sección "Canales"
    regiones: new Set(idsRegiones()),
    cedis:    new Set(idsCedis()),
    items:    new Set(idsItems()),
    canales:  new Set(idsCanales()),
    // avanzados
    tipoUbic: 'all',   // all | planta | cedi
    reporte:  'all',   // all | si | no
    zonas:    new Set(['gris', 'verde', 'rojo']),
    edadMin: 0, edadMax: 20,
    diasMin: 0, diasMax: 99,
    invMin: 0,
  };

  /* --- Estado local — Vista Críticos ------------------------------------- */
  const stateCriticos = {
    edadMin: 6,        // umbral de edad para contar "unidades críticas"
    critMin: 0,        // mín. unidades críticas para listar
    sortCol: 'edad',
    sortDir: 'desc',
    _regs: null,
  };

  /* --- Clasificación por DÍAS DE INVENTARIO (cobertura) ------------------- */
  function zonaDe(dias) {
    if (dias == null || !isFinite(dias)) return 'rojo';
    if (dias >= P.zonas.critico.min) return 'rojo';
    if (dias >= P.zonas.optimo.min && dias <= P.zonas.optimo.max) return 'verde';
    return 'gris';
  }
  const COLOR_CLASE = { gris: 'z-gris', verde: 'z-verde', rojo: 'z-rojo' };

  // Buckets de edad por día (índice 0..8, donde 8 = "8+")
  const EDAD_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7', '8+'];
  const zonaPorDia = i => (i <= 2 ? 'gris' : i <= 5 ? 'verde' : 'rojo');
  const edadPromDe = (edadDias, inv) => {
    if (!inv) return 0;
    let s = 0; for (let i = 0; i < edadDias.length; i++) s += i * edadDias[i];
    return s / inv;
  };

  function nivel() {
    if (state.cedis.size === 1) return 'cedi';
    const def = state.regiones.size === DB.regiones.length &&
      state.cedis.size === DB.cedis.length &&
      state.items.size === DB.items.length &&
      state.canales.size === DB.canales.length &&
      state.tipoUbic === 'all' && state.reporte === 'all' &&
      state.zonas.size === 3 && state.edadMin === 0 && state.edadMax === 20 &&
      state.diasMin === 0 && state.diasMax === 99 && state.invMin === 0;
    return def ? 'nacional' : 'regional';
  }

  function nAvanzados() {
    let n = 0;
    if (state.tipoUbic !== 'all') n++;
    if (state.reporte !== 'all') n++;
    if (state.zonas.size < 3) n++;
    if (state.edadMin > 0 || state.edadMax < 20) n++;
    if (state.diasMin > 0 || state.diasMax < 99) n++;
    if (state.invMin > 0) n++;
    return n;
  }

  /* --- Filtrado de registros según estado -------------------------------- */
  function registrosFiltrados() {
    const s = state;
    return DB.registros.filter(r => {
      if (!s.regiones.has(r.regionId)) return false;
      if (!s.cedis.has(r.cediId)) return false;
      if (!s.items.has(r.itemId)) return false;
      if (!s.canales.has(r.canalId)) return false;
      if (s.tipoUbic === 'planta' && !r.planta) return false;
      if (s.tipoUbic === 'cedi' && r.planta) return false;
      if (s.reporte === 'si' && !r.reporto) return false;
      if (s.reporte === 'no' && r.reporto) return false;
      if (r.edadPromedio < s.edadMin || r.edadPromedio > s.edadMax) return false;
      if (r.inventario < s.invMin) return false;
      const dias = r.ventaDiaria > 0 ? r.inventario / r.ventaDiaria : 999;
      if (dias < s.diasMin || dias > s.diasMax) return false;
      if (!s.zonas.has(zonaDe(dias))) return false;
      return true;
    });
  }

  /* --- Agregaciones ------------------------------------------------------- */
  function totales(regs) {
    let inv = 0, venta = 0, d0_2 = 0, d3_5 = 0, d6 = 0, incusan = 0;
    const edadDias = new Array(9).fill(0);
    regs.forEach(r => {
      inv += r.inventario; venta += r.ventaDiaria;
      d0_2 += r.edad.d0_2; d3_5 += r.edad.d3_5; d6 += r.edad.d6plus;
      incusan += r.incusan;
      for (let i = 0; i < 9; i++) edadDias[i] += r.edadDias[i];
    });
    const dias = venta > 0 ? inv / venta : Infinity;
    const pctCritico = inv > 0 ? (d6 / inv) * 100 : 0;
    return { inv, venta, dias, d0_2, d3_5, d6, incusan, pctCritico, edadDias };
  }

  function agrupar(regs, claveId, claveNombre) {
    const m = new Map();
    regs.forEach(r => {
      const k = r[claveId];
      if (!m.has(k)) m.set(k, { id: k, nombre: r[claveNombre], regs: [] });
      m.get(k).regs.push(r);
    });
    return Array.from(m.values()).map(g => ({ id: g.id, nombre: g.nombre, ...totales(g.regs) }));
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
    // Al cambiar regiones, los CEDIs disponibles = todos los de esas regiones
    state.cedis = new Set(DB.cedis.filter(c => state.regiones.has(c.regionId)).map(c => c.id));
  }

  /* =========================================================================
   *  FILTROS — chips, segmentados, rangos
   * ====================================================================== */
  function poblarFiltros() {
    montarMSRegion();
    sincronizarCedis();
    montarMSCedi();
    $('#f-items').innerHTML = DB.items.map(i =>
      `<button type="button" class="chip chip-on" data-val="${i.id}">${i.nombre}</button>`).join('');
    $('#f-canales').innerHTML = DB.canales.map(c =>
      `<button type="button" class="chip chip-on" data-val="${c.id}" title="${c.nombre}">${c.corto}</button>`).join('');
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
    wireChips('#f-canales', () => state.canales);
    wireChips('#f-zonas', () => state.zonas);
    wireSeg('#f-ubic', 'ubic', v => state.tipoUbic = v);
    wireSeg('#f-reporte', 'rep', v => state.reporte = v);

    const num = (id, key, def) => $(id).addEventListener('input', e => {
      const v = e.target.value === '' ? def : +e.target.value;
      state[key] = isNaN(v) ? def : v; render();
    });
    num('#f-edad-min', 'edadMin', 0);
    num('#f-edad-max', 'edadMax', 20);
    num('#f-dias-min', 'diasMin', 0);
    num('#f-dias-max', 'diasMax', 99);
    num('#f-inv-min', 'invMin', 0);

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
    state.canales = new Set(idsCanales());
    state.zonas = new Set(['gris', 'verde', 'rojo']);
    state.tipoUbic = 'all'; state.reporte = 'all';
    state.edadMin = 0; state.edadMax = 20; state.diasMin = 0; state.diasMax = 99; state.invMin = 0;

    montarMSRegion(); montarMSCedi();
    $$('#f-items .chip, #f-canales .chip, #f-zonas .chip').forEach(c => c.classList.add('chip-on'));
    $$('#f-ubic button').forEach(b => b.classList.toggle('seg-on', b.dataset.ubic === 'all'));
    $$('#f-reporte button').forEach(b => b.classList.toggle('seg-on', b.dataset.rep === 'all'));
    $('#f-edad-min').value = 0; $('#f-edad-max').value = 20;
    $('#f-dias-min').value = 0; $('#f-dias-max').value = 99; $('#f-inv-min').value = 0;
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
    const regs = registrosFiltrados();
    const t = totales(regs);

    switch (state.vista) {
      case 'edades':     renderEdades(regs, t); break;
      case 'criticos':   renderCriticos(regs); break;
      case 'proyeccion': renderProyeccion(regs); break;
      case 'canales':    renderCanales(); break;
      case 'historico':  renderHistorico(); break;
    }
  }

  /* =========================================================================
   *  VISTA: INVENTARIO POR EDADES (a detalle) + KPIs de resumen
   * ====================================================================== */
  function renderEdades(regs, t) {
    const cedisAfectados = agrupar(regs, 'cediId', 'cediNombre');
    const cedisCriticos = cedisAfectados.filter(c => c.dias >= 6 || c.pctCritico >= 25).length;
    const edadPromGlobal = edadPromDe(t.edadDias, t.inv);

    // --- KPIs (con foco en edades) ---
    kpis('#kpis-edades', [
      { label: 'Inventario total', valor: fmt(t.inv), sub: 'huevos en CEDIs/plantas', icon: '🥚' },
      { label: 'Edad promedio', valor: edadPromGlobal.toFixed(1) + ' d', sub: 'antigüedad media', icon: '🗓️', clase: edadPromGlobal >= 6 ? 'z-rojo' : edadPromGlobal >= 3 ? 'z-verde' : 'z-gris' },
      { label: '% en edad crítica', valor: t.pctCritico.toFixed(1) + '%', sub: `≥ 6 días · ${fmt(t.d6)} huevos`, icon: '⚠️', clase: t.pctCritico >= 20 ? 'z-rojo' : t.pctCritico >= 10 ? 'z-gris' : 'z-verde' },
      { label: 'Días de inventario', valor: isFinite(t.dias) ? t.dias.toFixed(1) : '∞', sub: 'cobertura promedio', icon: '📅', clase: COLOR_CLASE[zonaDe(t.dias)] },
      { label: 'CEDIs en alerta', valor: cedisCriticos + '/' + cedisAfectados.length, sub: 'requieren acción', icon: '🚨', clase: cedisCriticos > 0 ? 'z-rojo' : 'z-verde' },
    ]);

    // --- Histograma de inventario por día de edad (protagonista) ---
    Charts.barras($('#chart-hist-edades'),
      t.edadDias.map((v, i) => ({ label: EDAD_LABELS[i], valor: v, color: zonaPorDia(i) })));

    // --- Distribución por zona (apilada) ---
    Charts.apilada($('#chart-dist-edades'), [
      { label: '0–2 días (bajo)', valor: t.d0_2, color: 'gris' },
      { label: '3–5 días (óptimo)', valor: t.d3_5, color: 'verde' },
      { label: '≥ 6 días (crítico)', valor: t.d6, color: 'rojo' },
    ]);

    // --- Huevo crítico por tipo ---
    const items = agrupar(regs, 'itemId', 'itemNombre').sort((a, b) => b.d6 - a.d6);
    Charts.barrasH($('#chart-edades-items'),
      items.map(i => ({ label: i.nombre, valor: i.d6, color: 'rojo' })), { labelW: 70 });

    // --- TABLA DETALLE: inventario por edad (día) y CEDI ---
    renderTablaEdadesDetalle(cedisAfectados, t);

    // --- Secundario: ranking %crítico + días por CEDI ---
    const ranking = cedisAfectados
      .map(c => ({ label: c.nombre, valor: +c.pctCritico.toFixed(1), color: c.pctCritico >= 25 ? 'rojo' : c.pctCritico >= 12 ? 'gris' : 'verde', sufijo: '%' }))
      .sort((a, b) => b.valor - a.valor);
    Charts.barrasH($('#chart-ranking-edades'), ranking, { labelW: 110 });

    const diasCedi = cedisAfectados
      .map(c => ({ label: c.nombre, valor: +(isFinite(c.dias) ? c.dias : 0).toFixed(1), color: zonaDe(c.dias) }))
      .sort((a, b) => b.valor - a.valor);
    Charts.barras($('#chart-dias-edades'), diasCedi);

    // --- Alertas + recomendaciones IA integradas ---
    renderAlertas('#panel-alertas', regs);
    renderRecomendaciones('#panel-ia-edades', regs, 4);
  }

  // Tabla detallada: filas = CEDI, columnas = cantidad de huevos por día de edad
  function renderTablaEdadesDetalle(cedis, t) {
    // Encabezado (con columnas de día coloreadas por zona)
    const headCols = EDAD_LABELS.map((lbl, i) =>
      `<th class="num col-${zonaPorDia(i)}">${lbl}${i === 8 ? '' : ' d'}</th>`).join('');
    $('#edades-detalle-head').innerHTML =
      `<th>CEDI</th>${headCols}<th class="num">Total</th><th class="num">Edad</th><th class="num">% crít.</th><th class="num">Días inv.</th>`;

    const filas = cedis.slice().sort((a, b) => b.pctCritico - a.pctCritico).map(c => {
      const cedi = DB.cedis.find(x => x.id === c.id);
      const edadP = edadPromDe(c.edadDias, c.inv);
      const celdas = c.edadDias.map((v, i) =>
        `<td class="num col-${zonaPorDia(i)}">${v ? fmt(v) : '·'}</td>`).join('');
      return `<tr>
        <td><strong>${c.nombre}</strong> ${cedi.planta ? '<span class="tag tag-planta">planta</span>' : ''}${!cedi.reporto ? '<span class="tag tag-pend">sin reporte</span>' : ''}</td>
        ${celdas}
        <td class="num">${fmt(c.inv)}</td>
        <td class="num"><span class="badge ${edadP >= 6 ? 'b-rojo' : edadP >= 3 ? 'b-verde' : 'b-gris'}">${edadP.toFixed(1)}</span></td>
        <td class="num"><span class="badge ${c.pctCritico >= 25 ? 'b-rojo' : c.pctCritico >= 12 ? 'b-gris' : 'b-verde'}">${c.pctCritico.toFixed(1)}%</span></td>
        <td class="num"><span class="badge b-${zonaDe(c.dias)}">${isFinite(c.dias) ? c.dias.toFixed(1) : '∞'}</span></td>
      </tr>`;
    }).join('');

    // Fila de totales
    const edadPT = edadPromDe(t.edadDias, t.inv);
    const totCeldas = t.edadDias.map((v, i) => `<td class="num col-${zonaPorDia(i)}">${v ? fmt(v) : '·'}</td>`).join('');
    const totalRow = `<tr class="row-total">
      <td><strong>TOTAL</strong></td>${totCeldas}
      <td class="num"><strong>${fmt(t.inv)}</strong></td>
      <td class="num">${edadPT.toFixed(1)}</td>
      <td class="num">${t.pctCritico.toFixed(1)}%</td>
      <td class="num">${isFinite(t.dias) ? t.dias.toFixed(1) : '∞'}</td></tr>`;

    $('#tabla-edades-detalle tbody').innerHTML = (filas || '') + (cedis.length ? totalRow :
      '<tr><td colspan="14" class="empty">Sin datos para el filtro actual</td></tr>');
  }

  /* =========================================================================
   *  VISTA: CRÍTICOS — usa filtros globales + especiales (umbral/min/orden)
   * ====================================================================== */
  // Unidades con edad >= umbral (usa la granularidad por día; 8+ es el tope)
  function calcCritUmbral(r, umbral) {
    const u = Math.min(8, Math.max(0, umbral));
    let s = 0; for (let i = u; i < 9; i++) s += r.edadDias[i];
    return s;
  }

  function filtrarCriticos(regs) {
    const sc = stateCriticos;
    const out = [];
    regs.forEach(r => {
      const crit = calcCritUmbral(r, sc.edadMin);
      if (crit < Math.max(1, sc.critMin)) return;
      const dias = r.ventaDiaria > 0 ? r.inventario / r.ventaDiaria : Infinity;
      out.push({
        cediNombre: r.cediNombre, regionNombre: r.regionNombre,
        canalNombre: r.canalNombre, itemNombre: r.itemNombre,
        edad: r.edadPromedio, criticos: crit, inv: r.inventario, dias,
        pct: r.inventario > 0 ? (crit / r.inventario) * 100 : 0,
      });
    });
    out.sort((a, b) => {
      let d = 0;
      if      (sc.sortCol === 'edad')     d = a.edad - b.edad;
      else if (sc.sortCol === 'criticos') d = a.criticos - b.criticos;
      else if (sc.sortCol === 'inv')      d = a.inv - b.inv;
      else if (sc.sortCol === 'dias')     d = (isFinite(a.dias) ? a.dias : 9999) - (isFinite(b.dias) ? b.dias : 9999);
      else if (sc.sortCol === 'pct')      d = a.pct - b.pct;
      return sc.sortDir === 'desc' ? -d : d;
    });
    return out;
  }

  function renderCriticos(regs) {
    stateCriticos._regs = regs;
    if (!$('#fc-edad-min')) initPanelCriticos();
    refreshTablaCriticos();
  }

  function initPanelCriticos() {
    const sc = stateCriticos;
    const cont = $('#panel-filtros-criticos');
    if (!cont) return;

    const umbralLbl = n => (n <= 2 ? `≥ ${n} d · todo el stock` : n <= 5 ? `≥ ${n} d · precaución+` : `≥ ${n} d · crítico`);

    cont.innerHTML = `
<div class="filtros-panel">
  <div class="filtros-panel-head">
    <h4>🔍 Filtros especializados de críticos</h4>
    <span class="hint">Se aplican sobre los filtros globales de arriba</span>
    <button class="btn-reset" id="fc-reset">↺ Limpiar</button>
  </div>
  <div class="filtros-panel-body">
    <div class="fc-group">
      <label>Umbral de edad del huevo</label>
      <div class="slider-wrap">
        <input type="range" id="fc-edad-min" min="0" max="12" step="1" value="${sc.edadMin}">
        <span class="slider-val" id="fc-edad-val">${umbralLbl(sc.edadMin)}</span>
      </div>
    </div>
    <div class="fc-group">
      <label>Mín. unidades críticas</label>
      <input type="number" id="fc-crit-min" class="fc-input" min="0" step="100" value="${sc.critMin}" placeholder="0">
    </div>
    <div class="fc-group">
      <label>Ordenar por</label>
      <select id="fc-orden" class="filtro-select-sm">
        <option value="edad_desc">Edad ↓ (mayor primero)</option>
        <option value="edad_asc">Edad ↑ (menor primero)</option>
        <option value="criticos_desc">Unidades críticas ↓</option>
        <option value="criticos_asc">Unidades críticas ↑</option>
        <option value="pct_desc">% crítico ↓</option>
        <option value="inv_desc">Inventario ↓</option>
        <option value="dias_desc">Días inv. ↓</option>
        <option value="dias_asc">Días inv. ↑</option>
      </select>
    </div>
  </div>
</div>`;

    $('#fc-orden').value = `${sc.sortCol}_${sc.sortDir}`;

    $('#fc-edad-min').addEventListener('input', e => {
      sc.edadMin = +e.target.value;
      $('#fc-edad-val').textContent = umbralLbl(sc.edadMin);
      refreshTablaCriticos();
    });
    $('#fc-crit-min').addEventListener('input', e => { sc.critMin = +e.target.value || 0; refreshTablaCriticos(); });
    $('#fc-orden').addEventListener('change', e => {
      const v = e.target.value, i = v.lastIndexOf('_');
      sc.sortCol = v.slice(0, i); sc.sortDir = v.slice(i + 1);
      refreshTablaCriticos();
    });
    $('#fc-reset').addEventListener('click', () => {
      sc.edadMin = 6; sc.critMin = 0; sc.sortCol = 'edad'; sc.sortDir = 'desc';
      $('#fc-edad-min').value = 6; $('#fc-edad-val').textContent = umbralLbl(6);
      $('#fc-crit-min').value = 0; $('#fc-orden').value = 'edad_desc';
      refreshTablaCriticos();
    });

    $('#tabla-criticos thead').addEventListener('click', e => {
      const th = e.target.closest('th[data-sort]'); if (!th) return;
      const col = th.dataset.sort;
      if (sc.sortCol === col) sc.sortDir = sc.sortDir === 'desc' ? 'asc' : 'desc';
      else { sc.sortCol = col; sc.sortDir = 'desc'; }
      const sel = $('#fc-orden'), val = `${sc.sortCol}_${sc.sortDir}`;
      if ([...sel.options].some(o => o.value === val)) sel.value = val;
      refreshTablaCriticos();
    });
  }

  function refreshTablaCriticos() {
    const sc = stateCriticos;
    const lista = filtrarCriticos(sc._regs || []);

    $('#criticos-count').textContent = lista.length;
    $('#criticos-unidades').textContent = fmt(lista.reduce((a, b) => a + b.criticos, 0));

    $$('#tabla-criticos th[data-sort]').forEach(th => {
      const col = th.dataset.sort, ind = th.querySelector('.sort-ind');
      if (ind) ind.textContent = col === sc.sortCol ? (sc.sortDir === 'desc' ? ' ▼' : ' ▲') : ' ↕';
      th.classList.toggle('th-sorted', col === sc.sortCol);
    });

    const rows = lista.slice(0, 300).map(c => `
      <tr>
        <td><strong>${c.cediNombre}</strong><br><span class="muted">${c.regionNombre}</span></td>
        <td><span class="tag">${c.canalNombre}</span></td>
        <td>${c.itemNombre}</td>
        <td class="num"><span class="badge ${c.edad >= 6 ? 'b-rojo' : c.edad >= 3 ? 'b-verde' : 'b-gris'}">${c.edad.toFixed(1)} d</span></td>
        <td class="num"><strong class="txt-rojo">${fmt(c.criticos)}</strong></td>
        <td class="num"><span class="badge ${c.pct >= 50 ? 'b-rojo' : c.pct >= 20 ? 'b-gris' : 'b-verde'}">${c.pct.toFixed(1)}%</span></td>
        <td class="num">${fmt(c.inv)}</td>
        <td class="num"><span class="badge b-${zonaDe(c.dias)}">${isFinite(c.dias) ? c.dias.toFixed(1) : '∞'}</span></td>
      </tr>`).join('');
    $('#tabla-criticos tbody').innerHTML = rows ||
      '<tr><td colspan="8" class="empty">✅ Sin combinaciones que cumplan los filtros actuales</td></tr>';

    renderRecomendaciones('#panel-ia-criticos', sc._regs || [], 8);
  }

  /* =========================================================================
   *  VISTA: PROYECCIÓN
   * ====================================================================== */
  function renderProyeccion(regs) {
    const proy = regs.map(r => {
      const diasParaVencer = Math.max(0, P.umbralEdadCriticaDias - r.edadPromedio);
      const enRiesgo = Math.max(0, Math.round(r.inventario - r.ventaDiaria * diasParaVencer));
      return {
        cedi: r.cediNombre, canal: r.canalNombre, item: r.itemNombre,
        edad: r.edadPromedio, inv: r.inventario, venta: r.ventaDiaria,
        diasParaVencer: +diasParaVencer.toFixed(1), enRiesgo,
        pct: r.inventario > 0 ? (enRiesgo / r.inventario * 100) : 0,
      };
    }).filter(p => p.enRiesgo > 0).sort((a, b) => b.enRiesgo - a.enRiesgo);

    const totalRiesgo = proy.reduce((a, b) => a + b.enRiesgo, 0);
    kpis('#kpis-proyeccion', [
      { label: 'Unidades en riesgo', valor: fmt(totalRiesgo), sub: 'se pasarán de la ventana', icon: '⏳', clase: 'z-rojo' },
      { label: 'Combinaciones', valor: proy.length, sub: 'requieren acción hoy', icon: '🎯' },
      { label: 'Ventana de frescura', valor: P.ventanaFrescuraDias + ' días', sub: 'máximo exigido', icon: '📦' },
    ]);

    Charts.barrasH($('#chart-proyeccion'),
      proy.slice(0, 10).map(p => ({ label: `${p.cedi}·${p.item}`, valor: p.enRiesgo, color: 'rojo' })),
      { labelW: 160 });

    const rows = proy.slice(0, 120).map(p => `
      <tr>
        <td><strong>${p.cedi}</strong></td>
        <td><span class="tag">${p.canal}</span></td>
        <td>${p.item}</td>
        <td class="num">${p.edad.toFixed(1)} d</td>
        <td class="num">${fmt(p.inv)}</td>
        <td class="num">${fmt(p.venta)}</td>
        <td class="num">${p.diasParaVencer} d</td>
        <td class="num"><strong class="txt-rojo">${fmt(p.enRiesgo)}</strong> <span class="muted">(${p.pct.toFixed(0)}%)</span></td>
      </tr>`).join('');
    $('#tabla-proyeccion tbody').innerHTML = rows ||
      '<tr><td colspan="8" class="empty">✅ Ninguna combinación proyecta vencimiento con la venta actual</td></tr>';

    renderRecomendaciones('#panel-ia-proyeccion', regs, 8);
  }

  /* =========================================================================
   *  VISTA: CANALES (sección unificada con submenú de canales)
   * ====================================================================== */

  // Registros de un canal específico respetando todos los filtros globales (menos canal)
  function regsDeCanal(cid) {
    const s = state;
    return DB.registros.filter(r => {
      if (r.canalId !== cid) return false;
      if (!s.regiones.has(r.regionId)) return false;
      if (!s.cedis.has(r.cediId)) return false;
      if (!s.items.has(r.itemId)) return false;
      if (s.tipoUbic === 'planta' && !r.planta) return false;
      if (s.tipoUbic === 'cedi' && r.planta) return false;
      if (s.reporte === 'si' && !r.reporto) return false;
      if (s.reporte === 'no' && r.reporto) return false;
      if (r.edadPromedio < s.edadMin || r.edadPromedio > s.edadMax) return false;
      if (r.inventario < s.invMin) return false;
      const dias = r.ventaDiaria > 0 ? r.inventario / r.ventaDiaria : 999;
      if (dias < s.diasMin || dias > s.diasMax) return false;
      if (!s.zonas.has(zonaDe(dias))) return false;
      return true;
    });
  }

  // Registros para mayoristas: solo geografía/ubicación (queremos ver TODO el huevo viejo)
  function regsMayorista() {
    const s = state;
    return DB.registros.filter(r =>
      s.regiones.has(r.regionId) && s.cedis.has(r.cediId) && s.items.has(r.itemId) &&
      !(s.tipoUbic === 'planta' && !r.planta) && !(s.tipoUbic === 'cedi' && r.planta) &&
      !(s.reporte === 'si' && !r.reporto) && !(s.reporte === 'no' && r.reporto));
  }

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
    const cid = state.canalActivo;
    if (cid === 'TAT') renderCanalTAT();
    else if (cid === 'MAY') renderCanalMayoristas();
    else renderCanalGenerico(cid);
  }

  // Filas de cobertura CEDI × referencia (inventario en CEDI ÷ venta del canal)
  function filasCobertura(regsCanal) {
    return regsCanal.map(r => ({
      cedi: r.cediNombre, item: r.itemNombre, inv: r.inventario, edad: r.edadPromedio,
      venta: r.ventaDiaria, dias: r.ventaDiaria > 0 ? r.inventario / r.ventaDiaria : Infinity,
    })).sort((a, b) => (isFinite(b.dias) ? b.dias : 9999) - (isFinite(a.dias) ? a.dias : 9999))
      .slice(0, 80).map(c => {
        let estado;
        if (isFinite(c.dias) && c.dias < 1) estado = '<span class="badge b-gris">Bajo abast.</span>';
        else if ((isFinite(c.dias) ? c.dias >= 6 : true) || c.edad >= 6) estado = '<span class="badge b-rojo">Riesgo venc.</span>';
        else estado = '<span class="badge b-verde">OK</span>';
        return `<tr>
          <td><strong>${c.cedi}</strong></td>
          <td>${c.item}</td>
          <td class="num">${fmt(c.inv)}</td>
          <td class="num"><span class="badge ${c.edad >= 6 ? 'b-rojo' : c.edad >= 3 ? 'b-verde' : 'b-gris'}">${c.edad.toFixed(1)} d</span></td>
          <td class="num">${fmt(c.venta)}</td>
          <td class="num"><span class="badge b-${zonaDe(c.dias)}">${isFinite(c.dias) ? c.dias.toFixed(1) : '∞'}</span></td>
          <td>${estado}</td>
        </tr>`;
      }).join('');
  }

  // --- Canal TAT (clientes con ventas + cobertura del CEDI) ---
  function renderCanalTAT() {
    const tiendas = DB.tiendasTAT.filter(t => state.regiones.has(t.regionId) && state.cedis.has(t.cediId));
    const filasTiendas = tiendas.map(t => {
      const items = t.items.filter(it => state.items.has(it.itemId));
      const venta = items.reduce((a, b) => a + b.ventaDiaria, 0);
      const prom = items.reduce((a, b) => a + b.ventaProm3d, 0);
      return { nombre: t.nombre, cedi: t.cediNombre, region: t.regionNombre, venta, prom, tend: venta - prom, nref: items.length };
    }).filter(t => t.nref > 0).sort((a, b) => b.venta - a.venta);

    const ventaTAT = filasTiendas.reduce((a, b) => a + b.venta, 0);
    const regsCanal = regsDeCanal('TAT');
    const riesgoVenc = regsCanal.filter(r => { const d = r.ventaDiaria > 0 ? r.inventario / r.ventaDiaria : Infinity; return (isFinite(d) ? d >= 6 : true) || r.edadPromedio >= 6; }).length;
    const bajoAbast = regsCanal.filter(r => { const d = r.ventaDiaria > 0 ? r.inventario / r.ventaDiaria : Infinity; return isFinite(d) && d < 1; }).length;

    $('#canal-contenido').innerHTML = `
      <p class="nota">Las tiendas son <strong>clientes</strong>: solo registran <strong>ventas</strong>.
        El inventario vive en los CEDIs/plantas que las surten. Cobertura = <em>inventario CEDI ÷ venta TAT</em>.</p>
      <div class="kpis">${kpiCardsHTML([
        { label: 'Tiendas TAT', valor: filasTiendas.length, sub: 'clientes en alcance', icon: '🏪' },
        { label: 'Venta diaria a TAT', valor: fmt(ventaTAT), sub: 'huevos/día vendidos', icon: '📈' },
        { label: 'Referencias en riesgo', valor: riesgoVenc, sub: 'cobertura ≥6 d o edad ≥6 d', icon: '🔺', clase: riesgoVenc ? 'z-rojo' : 'z-verde' },
        { label: 'Bajo abastecimiento', valor: bajoAbast, sub: 'cobertura < 1 día', icon: '🔻', clase: bajoAbast ? 'z-gris' : 'z-verde' },
      ])}</div>
      <div class="grid grid-2">
        <div class="card card-wide">
          <div class="card-head"><h3>🏪 Ventas a tiendas TAT</h3><span class="hint">Venta diaria vs. promedio últimos 3 días</span></div>
          <div class="tabla-wrap"><table>
            <thead><tr><th>Tienda (cliente)</th><th>CEDI que surte</th><th class="num">Venta/día</th><th class="num">Prom. 3d</th><th class="num">Tendencia</th><th class="num"># Ref.</th></tr></thead>
            <tbody>${filasTiendas.slice(0, 80).map(t => {
              const sube = t.tend >= 0;
              return `<tr><td><strong>${t.nombre}</strong></td><td>${t.cedi}<br><span class="muted">${t.region}</span></td>
                <td class="num">${fmt(t.venta)}</td><td class="num">${fmt(t.prom)}</td>
                <td class="num"><span style="color:${sube ? 'var(--rojo)' : 'var(--verde)'}">${sube ? '▲' : '▼'}</span> ${fmt(Math.abs(t.tend))}</td>
                <td class="num">${t.nref}</td></tr>`;
            }).join('') || '<tr><td colspan="6" class="empty">Sin tiendas TAT en el alcance actual</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="card card-wide">
          <div class="card-head"><h3>📦 Cobertura del canal por CEDI</h3><span class="hint">Riesgo de vencimiento (≥6 d) o de quiebre (&lt;1 d)</span></div>
          <div class="tabla-wrap"><table>
            <thead><tr><th>CEDI</th><th>Tipo</th><th class="num">Inv. CEDI</th><th class="num">Edad</th><th class="num">Venta TAT</th><th class="num">Días inv.</th><th>Estado</th></tr></thead>
            <tbody>${filasCobertura(regsCanal) || '<tr><td colspan="7" class="empty">Sin referencias del canal en el alcance actual</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
      ${panelIAHTML('panel-ia-canal')}`;
    renderRecomendaciones('#panel-ia-canal', regsCanal, 8);
  }

  // --- Canal genérico (FS / GS / HD): cobertura por CEDI ---
  function renderCanalGenerico(cid) {
    const regsCanal = regsDeCanal(cid);
    const t = totales(regsCanal);
    const canal = DB.canales.find(c => c.id === cid);
    const directo = (cid === 'GS' || cid === 'FS');

    $('#canal-contenido').innerHTML = `
      ${directo ? `<p class="nota">El canal <strong>${canal.nombre}</strong> puede despacharse <strong>directo de planta</strong>, saltándose el CEDI cercano.</p>` : ''}
      <div class="kpis">${kpiCardsHTML([
        { label: 'Inventario del canal', valor: fmt(t.inv), sub: 'huevos en CEDIs/plantas', icon: '🥚' },
        { label: 'Días de inventario', valor: isFinite(t.dias) ? t.dias.toFixed(1) : '∞', sub: 'cobertura promedio', icon: '📅', clase: COLOR_CLASE[zonaDe(t.dias)] },
        { label: '% en edad crítica', valor: t.pctCritico.toFixed(1) + '%', sub: '≥ 6 días', icon: '⚠️', clase: t.pctCritico >= 20 ? 'z-rojo' : t.pctCritico >= 10 ? 'z-gris' : 'z-verde' },
        { label: 'Venta diaria', valor: fmt(t.venta), sub: `huevos/día a ${canal.corto}`, icon: '📈' },
      ])}</div>
      <div class="card card-wide">
        <div class="card-head"><h3>📦 Cobertura del canal ${canal.corto} por CEDI</h3><span class="hint">Riesgo de vencimiento (≥6 d) o de quiebre (&lt;1 d)</span></div>
        <div class="tabla-wrap"><table>
          <thead><tr><th>CEDI</th><th>Tipo</th><th class="num">Inv. CEDI</th><th class="num">Edad</th><th class="num">Venta ${canal.corto}</th><th class="num">Días inv.</th><th>Estado</th></tr></thead>
          <tbody>${filasCobertura(regsCanal) || '<tr><td colspan="7" class="empty">Sin referencias del canal en el alcance actual</td></tr>'}</tbody>
        </table></div>
      </div>
      ${panelIAHTML('panel-ia-canal')}`;
    renderRecomendaciones('#panel-ia-canal', regsCanal, 8);
  }

  // --- Canal Mayoristas (huevo de edad alta disponible) ---
  function renderCanalMayoristas() {
    const dispo = regsMayorista().filter(r => r.edad.d6plus > 0).map(r => ({
      cedi: r.cediNombre, region: r.regionNombre, item: r.itemNombre,
      disponible: r.edad.d6plus, edad: r.edadPromedio, origen: r.canalNombre,
    })).sort((a, b) => (b.edad - a.edad) || (b.disponible - a.disponible));

    const total = dispo.reduce((a, b) => a + b.disponible, 0);
    const porCedi = {};
    dispo.forEach(d => { porCedi[d.cedi] = (porCedi[d.cedi] || 0) + d.disponible; });

    $('#canal-contenido').innerHTML = `
      <p class="nota">Disponibilidad de huevo de <strong>edad alta / segunda</strong> (≥6 días) en CEDIs y plantas,
        candidato a venderse a <strong>mayorista</strong>. Origen = canal donde estaba asignado.</p>
      <div class="kpis">${kpiCardsHTML([
        { label: 'Disponible para mayorista', valor: fmt(total), sub: 'huevos edad ≥ 6 días', icon: '📦', clase: 'z-rojo' },
        { label: 'Referencias', valor: dispo.length, sub: 'combinaciones disponibles', icon: '🏷️' },
        { label: 'Edad máxima', valor: (dispo[0]?.edad || 0).toFixed(1) + ' d', sub: 'lote más antiguo', icon: '⏱️' },
      ])}</div>
      <div class="grid grid-2">
        <div class="card"><div class="card-head"><h3>Disponible por CEDI</h3></div><div id="chart-mayoristas"></div></div>
        <div class="card card-wide">
          <div class="card-head"><h3>Hoja de venta a mayorista</h3><span class="hint">Orden por edad descendente</span></div>
          <div class="tabla-wrap"><table>
            <thead><tr><th>CEDI</th><th>Tipo de huevo</th><th>Origen</th><th class="num">Edad</th><th class="num">Disponible</th></tr></thead>
            <tbody>${dispo.slice(0, 150).map(d => `<tr>
              <td><strong>${d.cedi}</strong><br><span class="muted">${d.region}</span></td>
              <td>${d.item}</td><td><span class="tag">${d.origen}</span></td>
              <td class="num"><span class="badge b-rojo">${d.edad.toFixed(1)} d</span></td>
              <td class="num"><strong>${fmt(d.disponible)}</strong></td></tr>`).join('') ||
              '<tr><td colspan="5" class="empty">No hay huevo de edad alta disponible para mayorista</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>`;
    Charts.barrasH($('#chart-mayoristas'),
      Object.entries(porCedi).map(([k, v]) => ({ label: k, valor: v, color: 'ambar' })).sort((a, b) => b.valor - a.valor),
      { labelW: 110 });
  }

  function panelIAHTML(id) {
    return `<div class="card">
      <div class="card-head"><h3>🤖 Recomendaciones IA <span class="live">● en vivo</span></h3><span class="hint">Días bajos y críticos del canal</span></div>
      <div class="lista-grid" id="${id}"></div>
    </div>`;
  }

  /* Recomendaciones para los días BAJOS (gris) y CRÍTICOS (rojo).
   * Los óptimos (verde) no generan recomendación: están bien. */
  function generarRecomendaciones(regs) {
    const recs = [];

    // CRÍTICO (rojo) — edad alta: redirigir / promocionar
    regs.filter(r => r.edad.d6plus > 1000).sort((a, b) => b.edad.d6plus - a.edad.d6plus).slice(0, 6).forEach(r => {
      recs.push({
        prio: r.edad.d6plus > 8000 ? 'alta' : 'media',
        titulo: `${r.cediNombre} · ${r.itemNombre}`,
        texto: `${fmt(r.edad.d6plus)} huevos con edad ≥ 6 días en canal ${r.canalNombre}. ` +
          `Redirigir a <strong>Mayorista</strong> o activar promoción en <strong>Hard Discount</strong> hoy.`,
      });
    });

    // CRÍTICO (rojo) — cobertura excesiva: frenar despacho
    regs.filter(r => r.ventaDiaria > 0 && r.inventario / r.ventaDiaria >= 7)
      .sort((a, b) => (b.inventario / b.ventaDiaria) - (a.inventario / a.ventaDiaria)).slice(0, 4).forEach(r => {
        const d = (r.inventario / r.ventaDiaria).toFixed(1);
        recs.push({
          prio: 'media', titulo: `${r.cediNombre} · ${r.itemNombre}`,
          texto: `Cobertura de <strong>${d} días</strong> (zona roja) en ${r.canalNombre}. ` +
            `Frenar despacho desde planta y acelerar rotación para no superar la ventana de frescura.`,
        });
      });

    // BAJO (gris) — riesgo de quiebre: reabastecer
    regs.filter(r => r.ventaDiaria > 0 && r.inventario / r.ventaDiaria < 2)
      .sort((a, b) => (a.inventario / a.ventaDiaria) - (b.inventario / b.ventaDiaria)).slice(0, 5).forEach(r => {
        const d = r.inventario / r.ventaDiaria;
        recs.push({
          prio: d < 1 ? 'alta' : 'media', titulo: `${r.cediNombre} · ${r.itemNombre}`,
          texto: `Cobertura de <strong>${d.toFixed(1)} días</strong> (zona baja) en ${r.canalNombre}. ` +
            `Riesgo de quiebre: priorizar <strong>reabastecimiento / despacho</strong> desde planta.`,
        });
      });

    // CEDIs sin reporte
    DB.meta.cedisSinReporte.forEach(c => {
      recs.push({
        prio: 'alta', titulo: `CEDI ${c} sin reporte`,
        texto: `No ha cargado edades hoy. Contactar antes de las 9:00 AM para consolidar y evitar decisiones a ciegas.`,
      });
    });

    const orden = { alta: 0, media: 1, baja: 2 };
    return recs.sort((a, b) => orden[a.prio] - orden[b.prio]);
  }

  function renderRecomendaciones(sel, regs, limite) {
    const recs = generarRecomendaciones(regs).slice(0, limite);
    const cont = $(sel);
    cont.innerHTML = recs.length
      ? recs.map(r => `<div class="rec rec-${r.prio}">
          <div class="rec-head"><span class="rec-prio">${r.prio.toUpperCase()}</span><strong>${r.titulo}</strong></div>
          <p>${r.texto}</p></div>`).join('')
      : '<div class="empty">Sin recomendaciones: inventario saludable ✅</div>';
  }

  /* =========================================================================
   *  VISTA: HISTÓRICO (90 días)
   * ====================================================================== */
  function renderHistorico() {
    const h = DB.historia, et = f => f.slice(5);
    Charts.linea($('#chart-hist-inv'), [{ nombre: 'Inventario', color: 'azul', area: true, puntos: h.map(d => ({ x: et(d.fecha), y: d.inventario })) }]);
    Charts.linea($('#chart-hist-dias'), [{ nombre: 'Días de inventario', color: 'ambar', area: true, puntos: h.map(d => ({ x: et(d.fecha), y: d.diasInventario })) }], { desdeCero: true });
    Charts.linea($('#chart-hist-critico'), [{ nombre: '% edad crítica', color: 'rojo', area: true, puntos: h.map(d => ({ x: et(d.fecha), y: d.pctCritico })) }], { desdeCero: true });
    Charts.linea($('#chart-hist-venta'), [{ nombre: 'Venta diaria', color: 'verde', area: true, puntos: h.map(d => ({ x: et(d.fecha), y: d.ventaDia })) }]);
  }

  /* =========================================================================
   *  ALERTAS (panel)
   * ====================================================================== */
  function renderAlertas(sel, regs) {
    const alertas = [];
    DB.meta.cedisSinReporte.forEach(c =>
      alertas.push({ tipo: 'pend', icon: '⏰', txt: `<strong>${c}</strong> no ha cargado edades hoy.` }));

    const cedis = agrupar(regs, 'cediId', 'cediNombre');
    cedis.forEach(c => {
      const diff = c.incusan > 0 ? Math.abs(c.inv - c.incusan) / c.incusan : 0;
      if (diff > P.umbralDiscrepanciaIncusan)
        alertas.push({ tipo: 'incusan', icon: '🔁', txt: `<strong>${c.nombre}</strong>: diferencia de ${(diff * 100).toFixed(1)}% vs INCUSAN (${fmt(c.inv)} vs ${fmt(c.incusan)}).` });
    });
    cedis.filter(c => c.pctCritico >= 25).sort((a, b) => b.pctCritico - a.pctCritico).slice(0, 4).forEach(c =>
      alertas.push({ tipo: 'critico', icon: '🚨', txt: `<strong>${c.nombre}</strong>: ${c.pctCritico.toFixed(1)}% del inventario en edad crítica.` }));

    $(sel).innerHTML = alertas.length
      ? alertas.map(a => `<div class="alerta a-${a.tipo}"><span>${a.icon}</span><p>${a.txt}</p></div>`).join('')
      : '<div class="empty">Sin alertas en el alcance actual ✅</div>';
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

  function ctxTexto() {
    if (state.cedis.size === 1) return DB.cedis.find(c => c.id === [...state.cedis][0]).nombre;
    if (state.regiones.size === 1) return DB.regiones.find(r => r.id === [...state.regiones][0]).nombre;
    if (state.regiones.size === DB.regiones.length) return 'Nacional';
    return `${state.regiones.size} regiones`;
  }

  /* --- Init --------------------------------------------------------------- */
  function init() {
    $('#meta-actualizado').textContent = DB.meta.actualizado;
    $('#meta-corte').textContent = DB.meta.fechaCorte;
    poblarFiltros();
    wireFiltros();
    wireNav();
    render();
  }

  DB.cargar().then(init);
})();
