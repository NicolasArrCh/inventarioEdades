/* =============================================================================
 *  charts.js  —  GRÁFICAS SVG LIGERAS (sin dependencias)
 * -----------------------------------------------------------------------------
 *  Mini librería de visualización autocontenida. En el proyecto real se puede
 *  reemplazar por Chart.js / ECharts / Recharts manteniendo las mismas firmas.
 *
 *  API:  Charts.barras(el, datos, opts)
 *        Charts.barrasH(el, datos, opts)
 *        Charts.apilada(el, segmentos, opts)
 *        Charts.dona(el, segmentos, opts)
 *        Charts.linea(el, series, opts)
 * ========================================================================== */

window.Charts = (function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const COLORES = {
    gris: '#94a3b8', verde: '#16a34a', rojo: '#dc2626',
    ambar: '#d97706', azul: '#2563eb', slate: '#475569',
  };

  function el(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function svg(w, h) {
    const s = el('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'xMidYMid meet', class: 'chart-svg' });
    return s;
  }
  function fmt(n) {
    if (n == null || isNaN(n)) return '–';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return Math.round(n).toLocaleString('es-CO');
  }
  function clear(cont) { cont.innerHTML = ''; }

  /* --- Barras verticales -------------------------------------------------- */
  function barras(cont, datos, opts = {}) {
    clear(cont);
    const W = 520, H = 240, pad = { t: 16, r: 12, b: 46, l: 44 };
    const s = svg(W, H);
    const max = Math.max(1, ...datos.map(d => d.valor));
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const bw = iw / datos.length;

    // grid
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ih * (i / 4);
      s.appendChild(el('line', { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: '#e2e8f0', 'stroke-width': 1 }));
      const t = el('text', { x: pad.l - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-axis' });
      t.textContent = fmt(max * (1 - i / 4));
      s.appendChild(t);
    }

    datos.forEach((d, i) => {
      const h = (d.valor / max) * ih;
      const x = pad.l + i * bw + bw * 0.15;
      const y = pad.t + ih - h;
      const w = bw * 0.7;
      const rect = el('rect', {
        x, y, width: w, height: Math.max(0, h), rx: 4,
        fill: COLORES[d.color] || COLORES.azul, class: 'chart-bar',
      });
      const title = el('title', {}); title.textContent = `${d.label}: ${fmt(d.valor)}`;
      rect.appendChild(title);
      s.appendChild(rect);

      const vt = el('text', { x: x + w / 2, y: y - 5, 'text-anchor': 'middle', class: 'chart-val' });
      vt.textContent = fmt(d.valor);
      s.appendChild(vt);

      const lt = el('text', { x: x + w / 2, y: H - pad.b + 16, 'text-anchor': 'middle', class: 'chart-axis' });
      lt.textContent = d.label;
      s.appendChild(lt);
    });
    cont.appendChild(s);
  }

  /* --- Barras horizontales (ranking) ------------------------------------- */
  function barrasH(cont, datos, opts = {}) {
    clear(cont);
    const rowH = 30, padL = 4, padR = 60, padT = 6;
    const W = 520, H = padT * 2 + datos.length * rowH;
    const s = svg(W, Math.max(60, H));
    const max = Math.max(1, ...datos.map(d => d.valor));
    const labelW = opts.labelW || 130;
    const barX = labelW + 6;
    const barMax = W - barX - padR;

    datos.forEach((d, i) => {
      const y = padT + i * rowH;
      const lt = el('text', { x: padL, y: y + rowH / 2 + 4, class: 'chart-rowlabel' });
      lt.textContent = d.label;
      s.appendChild(lt);

      s.appendChild(el('rect', { x: barX, y: y + 5, width: barMax, height: rowH - 12, rx: 4, fill: '#f1f5f9' }));
      const w = (d.valor / max) * barMax;
      const rect = el('rect', {
        x: barX, y: y + 5, width: Math.max(2, w), height: rowH - 12, rx: 4,
        fill: COLORES[d.color] || COLORES.azul, class: 'chart-bar',
      });
      const title = el('title', {}); title.textContent = `${d.label}: ${fmt(d.valor)}${d.sufijo || ''}`;
      rect.appendChild(title);
      s.appendChild(rect);

      const vt = el('text', { x: barX + Math.max(2, w) + 6, y: y + rowH / 2 + 4, class: 'chart-val' });
      vt.textContent = fmt(d.valor) + (d.sufijo || '');
      s.appendChild(vt);
    });
    cont.appendChild(s);
  }

  /* --- Barra apilada horizontal (distribución por edades) ----------------- */
  function apilada(cont, segmentos, opts = {}) {
    clear(cont);
    const total = segmentos.reduce((a, b) => a + b.valor, 0) || 1;
    const wrap = document.createElement('div');
    wrap.className = 'stacked-wrap';

    const bar = document.createElement('div');
    bar.className = 'stacked-bar';
    segmentos.forEach(seg => {
      const pct = (seg.valor / total) * 100;
      const div = document.createElement('div');
      div.className = 'stacked-seg';
      div.style.width = pct + '%';
      div.style.background = COLORES[seg.color] || COLORES.azul;
      div.title = `${seg.label}: ${fmt(seg.valor)} (${pct.toFixed(1)}%)`;
      if (pct > 8) div.textContent = pct.toFixed(0) + '%';
      bar.appendChild(div);
    });
    wrap.appendChild(bar);

    const leg = document.createElement('div');
    leg.className = 'stacked-legend';
    segmentos.forEach(seg => {
      const pct = ((seg.valor / total) * 100).toFixed(1);
      const it = document.createElement('div');
      it.className = 'legend-item';
      it.innerHTML = `<span class="dot" style="background:${COLORES[seg.color] || COLORES.azul}"></span>` +
        `<span>${seg.label}</span><strong>${fmt(seg.valor)}</strong><em>${pct}%</em>`;
      leg.appendChild(it);
    });
    wrap.appendChild(leg);
    cont.appendChild(wrap);
  }

  /* --- Dona --------------------------------------------------------------- */
  function dona(cont, segmentos, opts = {}) {
    clear(cont);
    const total = segmentos.reduce((a, b) => a + b.valor, 0) || 1;
    const W = 220, H = 220, cx = 110, cy = 110, r = 78, sw = 26;
    const s = svg(W, H);
    let ang = -Math.PI / 2;
    const C = 2 * Math.PI * r;

    segmentos.forEach(seg => {
      const frac = seg.valor / total;
      const len = frac * C;
      const circle = el('circle', {
        cx, cy, r, fill: 'none',
        stroke: COLORES[seg.color] || COLORES.azul,
        'stroke-width': sw,
        'stroke-dasharray': `${len} ${C - len}`,
        'stroke-dashoffset': -((ang + Math.PI / 2) / (2 * Math.PI)) * C,
        transform: `rotate(0 ${cx} ${cy})`,
      });
      const title = el('title', {}); title.textContent = `${seg.label}: ${fmt(seg.valor)} (${(frac * 100).toFixed(1)}%)`;
      circle.appendChild(title);
      s.appendChild(circle);
      ang += frac * 2 * Math.PI;
    });

    const c1 = el('text', { x: cx, y: cy - 4, 'text-anchor': 'middle', class: 'donut-center' });
    c1.textContent = fmt(total);
    s.appendChild(c1);
    const c2 = el('text', { x: cx, y: cy + 16, 'text-anchor': 'middle', class: 'donut-sub' });
    c2.textContent = opts.centerLabel || 'Total';
    s.appendChild(c2);

    const box = document.createElement('div');
    box.className = 'donut-box';
    box.appendChild(s);

    const leg = document.createElement('div');
    leg.className = 'donut-legend';
    segmentos.forEach(seg => {
      const pct = ((seg.valor / total) * 100).toFixed(1);
      const it = document.createElement('div');
      it.className = 'legend-item';
      it.innerHTML = `<span class="dot" style="background:${COLORES[seg.color] || COLORES.azul}"></span>` +
        `<span>${seg.label}</span><strong>${pct}%</strong>`;
      leg.appendChild(it);
    });
    box.appendChild(leg);
    cont.appendChild(box);
  }

  /* --- Línea (tendencia histórica) --------------------------------------- */
  function linea(cont, series, opts = {}) {
    clear(cont);
    const W = 720, H = 260, pad = { t: 18, r: 16, b: 34, l: 50 };
    const s = svg(W, H);
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const n = series[0].puntos.length;

    let max = -Infinity, min = Infinity;
    series.forEach(ser => ser.puntos.forEach(p => { max = Math.max(max, p.y); min = Math.min(min, p.y); }));
    if (opts.desdeCero) min = 0;
    const rango = (max - min) || 1;
    const px = i => pad.l + (iw * i) / (n - 1);
    const py = v => pad.t + ih - ((v - min) / rango) * ih;

    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ih * (i / 4);
      s.appendChild(el('line', { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: '#eef2f6', 'stroke-width': 1 }));
      const t = el('text', { x: pad.l - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-axis' });
      t.textContent = fmt(min + rango * (1 - i / 4));
      s.appendChild(t);
    }

    // etiquetas de fecha (cada ~ n/6)
    const paso = Math.ceil(n / 6);
    for (let i = 0; i < n; i += paso) {
      const t = el('text', { x: px(i), y: H - pad.b + 18, 'text-anchor': 'middle', class: 'chart-axis' });
      t.textContent = series[0].puntos[i].x;
      s.appendChild(t);
    }

    series.forEach(ser => {
      let dPath = '';
      ser.puntos.forEach((p, i) => { dPath += (i === 0 ? 'M' : 'L') + px(i) + ' ' + py(p.y) + ' '; });
      // área suave opcional
      if (ser.area) {
        let aPath = dPath + `L${px(n - 1)} ${pad.t + ih} L${px(0)} ${pad.t + ih} Z`;
        s.appendChild(el('path', { d: aPath, fill: (COLORES[ser.color] || COLORES.azul), opacity: 0.08 }));
      }
      s.appendChild(el('path', { d: dPath, fill: 'none', stroke: COLORES[ser.color] || COLORES.azul, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
    });

    cont.appendChild(s);

    if (series.length > 1 || opts.leyenda) {
      const leg = document.createElement('div');
      leg.className = 'donut-legend';
      series.forEach(ser => {
        const it = document.createElement('div');
        it.className = 'legend-item';
        it.innerHTML = `<span class="dot" style="background:${COLORES[ser.color] || COLORES.azul}"></span><span>${ser.nombre}</span>`;
        leg.appendChild(it);
      });
      cont.appendChild(leg);
    }
  }

  return { barras, barrasH, apilada, dona, linea, COLORES, fmt };
})();
