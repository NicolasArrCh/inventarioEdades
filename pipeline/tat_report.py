#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tat_report.py — Capa de presentacion (maquetacion) del informe TAT.

Lee el JSON que produce tat_pipeline.py y construye el informe en HTML, despues lo
convierte a PDF con wkhtmltopdf. ESTE es el archivo donde debe vivir el trabajo de
rediseno/maquetacion -- no requiere tocar tat_pipeline.py (la logica de negocio ya
validada) para cambiar colores, layout, tipografia, orden de secciones, etc.

Uso:
    python tat_report.py --datos datos_tat.json --out informe.pdf
    python tat_report.py --datos datos_tat.json --out informe.html --solo-html

Requiere wkhtmltopdf instalado en el sistema (apt install wkhtmltopdf / choco / brew).
"""
import argparse
import json
import subprocess
import sys
import tempfile
import os

CSS = """
@page { size: A4 landscape; margin: 14mm 12mm 16mm 12mm; }
* { box-sizing: border-box; }
body { font-family: 'Helvetica Neue', Arial, sans-serif; color:#1f2937; font-size:11px; margin:0; }
h1,h2,h3 { font-family: 'Helvetica Neue', Arial, sans-serif; margin:0; }
.portada { text-align:center; padding-top:90px; }
.portada h1 { font-size:30px; color:#0f3d3e; letter-spacing:0.5px; }
.portada .sub { font-size:15px; color:#4b5563; margin-top:8px; }
.portada .meta { margin-top:40px; font-size:12px; color:#6b7280; line-height:1.8; }
.portada .badge { display:inline-block; margin-top:30px; padding:6px 18px; border:1px solid #0f3d3e; border-radius:20px; color:#0f3d3e; font-size:11px; letter-spacing:1px; }
.page { page-break-after: always; padding-top:4px; }
.page:last-child { page-break-after: auto; }
.section-title { font-size:16px; color:#0f3d3e; border-bottom:2px solid #0f3d3e; padding-bottom:5px; margin-bottom:10px; }
.section-sub { font-size:10.5px; color:#6b7280; margin-bottom:12px; margin-top:-6px;}
.kpi-row { display:flex; gap:12px; margin-bottom:16px; }
.kpi-card { flex:1; background:#f3f6f5; border-left:4px solid #0f3d3e; border-radius:4px; padding:12px 14px; }
.kpi-card .label { font-size:9.5px; color:#6b7280; text-transform:uppercase; letter-spacing:0.5px;}
.kpi-card .value { font-size:22px; color:#0f3d3e; font-weight:700; margin-top:4px;}
.kpi-card .delta { font-size:9.5px; margin-top:3px; color:#6b7280;}
table { width:100%; border-collapse:collapse; margin-bottom:14px; }
th { background:#0f3d3e; color:#fff; font-size:9.5px; text-transform:uppercase; letter-spacing:0.3px; padding:6px 8px; text-align:left; }
td { padding:5px 8px; font-size:10.5px; border-bottom:1px solid #e5e7eb; }
tr:nth-child(even) td { background:#f8fafa; }
td.num, th.num { text-align:right; }
td.center, th.center { text-align:center; }
.sem-pill { display:inline-block; min-width:46px; text-align:center; padding:2px 8px; border-radius:10px; font-size:9.5px; font-weight:600; }
.sem-gris { background:#e5e7eb; color:#374151; }
.sem-verde { background:#d1fae5; color:#065f46; }
.sem-rojo { background:#fee2e2; color:#991b1b; }
.sem-nc { background:#f3f4f6; color:#9ca3af; }
.nota { font-size:9.5px; color:#6b7280; margin-top:4px; margin-bottom:10px; }
.asterisco { font-size:9px; color:#9ca3af; }
.alerta-box { border:1px solid #e5e7eb; border-radius:6px; padding:10px 14px; margin-bottom:14px; }
.alerta-box h3 { font-size:12.5px; color:#0f3d3e; margin-bottom:6px;}
.alerta-rojo h3 { color:#991b1b; }
.subtotales { display:flex; gap:10px; margin-top:8px; }
.subtotal-chip { background:#f3f6f5; border-radius:4px; padding:6px 10px; font-size:9.5px; flex:1; }
.subtotal-chip b { display:block; font-size:13px; color:#0f3d3e; }
.hallazgo { border-left:3px solid #b45309; background:#fffbeb; padding:8px 12px; margin-bottom:8px; border-radius:3px; }
.hallazgo b { color:#92400e; }
.hallazgo .impacto { font-size:9.5px; color:#6b7280; margin-top:3px; }
.fuente-box { border:1px solid #e5e7eb; border-radius:5px; padding:8px 12px; margin-bottom:8px; font-size:9.5px; }
.fuente-box .archivo { color:#0f3d3e; font-weight:700; }
.footer-note { font-size:9px; color:#9ca3af; margin-top:16px; text-align:right; }
.two-col { display:flex; gap:16px; }
.two-col > div { flex:1; }
.small-title { font-size:11.5px; color:#0f3d3e; font-weight:700; margin:10px 0 6px 0; }
"""


def fnum(x, dec=0):
    return "—" if x is None else f"{x:,.{dec}f}"


def dtxt(x):
    return f"{x:.1f}" if x is not None else "N/C"


def sem_class(s):
    return {'GRIS': 'sem-gris', 'VERDE': 'sem-verde', 'ROJO': 'sem-rojo', 'NC': 'sem-nc'}.get(s, 'sem-nc')


def sem_label(s):
    return {'GRIS': 'Gris', 'VERDE': 'Verde', 'ROJO': 'Rojo', 'NC': 'N/C'}.get(s, 'N/C')


def build_html(d):
    meta = d['meta']; venta = d['venta_agregada']; inv = d['inv_agregado']
    dias = d['dias_inventario']; ta = d['tiendas_alertas13']; a12 = d['alertas_1_2']
    peps = d['peps_por_tienda']; conc = d['conciliacion']; cmp_ = d['comparacion_ayer']

    FECHA_HOY = meta['fecha_hoy'][:10]
    FECHA_AYER = meta['fecha_ayer'][:10]
    DIAS_VENTA = ", ".join(x[:10] for x in meta['dias_venta'])

    portada = f"""
    <div class="page portada">
      <h1>Días de Inventario y Frescura TAT</h1>
      <div class="sub">Huevos Kikes · Incubadora Santander S.A. — Inteligencia Operativa, Logística</div>
      <div class="meta">
        Inventario al corte: <b>{FECHA_HOY}</b> (comparativo vs. {FECHA_AYER})<br>
        Venta diaria promedio calculada sobre: {DIAS_VENTA}
      </div>
      <div class="badge">INFORME GENERADO AUTOMÁTICAMENTE</div>
    </div>
    """

    def delta_html(delta):
        arrow = "▲" if delta > 0 else ("▼" if delta < 0 else "—")
        return f'<div class="delta">{arrow} {fnum(abs(delta))} vs. {FECHA_AYER}</div>'

    dg = dias['dias_global']
    sem_g = 'ROJO' if (dg or 0) >= 6 else 'VERDE' if (dg or 0) >= 3 else 'GRIS'
    kpis = f"""
    <div class="kpi-row">
      <div class="kpi-card"><div class="label">Inventario Total (toda la compañía)</div>
        <div class="value">{fnum(dias.get('inv_global_compania'))}</div></div>
      <div class="kpi-card"><div class="label">Inventario Verde/Canasta TAT (base alertas)</div>
        <div class="value">{fnum(inv['inv_verde_total_hoy'])}</div>{delta_html(cmp_['delta_verde'])}</div>
      <div class="kpi-card"><div class="label">Días de Inventario Global (compañía)</div>
        <div class="value">{dtxt(dg)} <span class="sem-pill {sem_class(sem_g)}">{sem_label(sem_g)}</span></div>
        <div class="delta">Ayer (TAT, estimado): {dtxt(cmp_['dias_global_ayer_est'])} días</div></div>
    </div>
    """

    rows_tipo2 = "".join(
        f"""<tr><td>{r['categoria']}{' *' if r['categoria'] in ('GRIS SUELTO','EMPACADOS','SEGUNDA') else ''}</td>
        <td class="num">{fnum(r['inventario'])}</td><td class="num">{fnum(r['venta_diaria'])}</td>
        <td class="num">{dtxt(r['dias'])}</td>
        <td class="center"><span class="sem-pill {sem_class(r['semaforo'])}">{sem_label(r['semaforo'])}</span></td></tr>"""
        for r in dias['tabla_tipo2'])
    rows_talla = "".join(
        f"""<tr><td>{r['talla']}</td><td class="num">{fnum(r['inventario'])}</td>
        <td class="num">{fnum(r['venta_diaria'])}</td><td class="num">{dtxt(r['dias'])}</td>
        <td class="center"><span class="sem-pill {sem_class(r['semaforo'])}">{sem_label(r['semaforo'])}</span></td></tr>"""
        for r in dias['tabla_talla'])

    pagina1 = f"""
    <div class="page">
      <div class="section-title">1 · Indicadores Generales</div>
      {kpis}
      <div class="two-col">
        <div><div class="small-title">Detalle por Tipo de Huevo 2</div>
          <table><tr><th>Categoría</th><th class="num">Inventario</th><th class="num">Venta diaria</th>
          <th class="num">Días</th><th class="center">Semáforo</th></tr>{rows_tipo2}</table>
          <div class="nota"><span class="asterisco">*</span> Regla "GRIS manda": ver metodología.</div></div>
        <div><div class="small-title">Detalle por Talla</div>
          <table><tr><th>Talla</th><th class="num">Inventario</th><th class="num">Venta diaria</th>
          <th class="num">Días</th><th class="center">Semáforo</th></tr>{rows_talla}</table></div>
      </div>
    </div>
    """

    rows_regional = "".join(
        f"""<tr><td><b>{r['regional']}</b></td><td class="num">{fnum(r['inventario'])}</td>
        <td class="num">{fnum(r['venta_diaria'])}</td><td class="num">{dtxt(r['dias'])}</td>
        <td class="center"><span class="sem-pill {sem_class(r['semaforo'])}">{sem_label(r['semaforo'])}</span></td></tr>"""
        for r in ta['tabla_regional'])
    rows_tiendas = "".join(
        f"""<tr><td>{r['tienda']}</td><td>{r['regional']}</td><td class="num">{fnum(r['inventario'])}</td>
        <td class="num">{fnum(r['venta_diaria'])}</td><td class="num">{dtxt(r['dias'])}</td>
        <td class="center"><span class="sem-pill {sem_class(r['semaforo'])}">{sem_label(r['semaforo'])}</span></td></tr>"""
        for r in ta['tabla_tiendas'])

    pagina2 = f"""
    <div class="page">
      <div class="section-title">2 · Días de Inventario TAT por Regional</div>
      <table><tr><th>Regional</th><th class="num">Inventario</th><th class="num">Venta diaria</th>
      <th class="num">Días</th><th class="center">Semáforo</th></tr>{rows_regional}</table>
      <div class="small-title">Detalle por tienda</div>
      <table><tr><th>Tienda</th><th>Regional</th><th class="num">Inventario</th><th class="num">Venta diaria</th>
      <th class="num">Días</th><th class="center">Semáforo</th></tr>{rows_tiendas}</table>
    </div>
    """

    def filas_alerta12(lista):
        return "".join(
            f"""<tr><td>{f['regional']}</td><td>{f['tienda']}</td>
            <td class="num">{fnum(f['inv_con_edad'])}</td><td class="num"><b>{dtxt(f['dias'])}</b></td>
            <td class="num">{fnum(f['a_gestionar'])}</td><td class="num">{fnum(f['inv_total'])}</td></tr>"""
            for f in lista)

    def filas_alerta3(lista):
        return "".join(
            f"""<tr><td>{r['tienda']}</td><td>{r['regional']}</td><td class="num">{fnum(r['inventario'])}</td>
            <td class="num">{fnum(r['venta_diaria'])}</td><td class="num"><b>{dtxt(r['dias'])}</b></td></tr>"""
            for r in lista)

    subt1 = "".join(f'<div class="subtotal-chip">{reg}<b>{fnum(val)}</b></div>'
                     for reg, val in sorted(a12['alerta1_subtotal_regional'].items(), key=lambda x: -x[1]))
    subt2 = "".join(f'<div class="subtotal-chip">{reg}<b>{fnum(val)}</b></div>'
                     for reg, val in sorted(a12['alerta2_subtotal_regional'].items(), key=lambda x: -x[1]))

    pagina3 = f"""
    <div class="page">
      <div class="section-title">3 · Alertas Operativas (1 de 2)</div>
      <div class="section-sub">Umbral de división Alerta 1 / Alerta 2: {peps['umbral']} días de cobertura total. "A gestionar" es el
      mismo cálculo PEPS en ambas alertas (ver metodología).</div>

      <div class="alerta-box alerta-rojo"><h3>Alerta 1 — Sobre-inventario (cobertura ≥ {peps['umbral']} días)</h3>
        <table><tr><th>Regional</th><th>Tienda</th><th class="num">Inv. con edad</th><th class="num">Cobertura (d)</th>
        <th class="num">A gestionar</th><th class="num">Inv. total</th></tr>{filas_alerta12(a12['alerta1'])}</table>
        <div class="subtotales">{subt1}</div>
        <div class="nota">{len(a12['alerta1'])} tiendas · inventario total en la alerta: {fnum(a12['alerta1_inv_total'])} und.</div></div>

      <div class="alerta-box alerta-rojo"><h3>Alerta 3 — Riesgo de quiebre (cobertura ≤ 1 día)</h3>
        <table><tr><th>Tienda</th><th>Regional</th><th class="num">Inventario</th><th class="num">Venta diaria</th>
        <th class="num">Días</th></tr>{filas_alerta3(ta['alerta3'])}</table>
        <div class="nota">{len(ta['alerta3'])} tienda(s) en riesgo crítico de quiebre.</div></div>

      <div class="alerta-box"><h3>Tiendas no calculables (venta Verde/Canasta = 0)</h3>
        <table><tr><th>Tienda</th><th>Regional</th><th class="num">Inventario</th><th class="num">Venta diaria</th>
        <th class="num">Días</th></tr>{filas_alerta3(ta['nc'])}</table></div>
    </div>
    """

    rows_detalle = "".join(
        f"""<tr><td>{r['tienda']}</td><td>{r['referencia']}</td><td class="num">{r['edad']:.0f}</td>
        <td class="num">{fnum(r['cantidad_lote'])}</td><td class="num"><b>{fnum(r['en_riesgo'])}</b></td></tr>"""
        for r in sorted(peps['detalle_referencias'], key=lambda x: -x['en_riesgo'])[:25])

    pagina4 = f"""
    <div class="page">
      <div class="section-title">3 · Alertas Operativas (2 de 2) — Alerta 2: Frescura (cobertura &lt; {peps['umbral']} días)</div>
      <table><tr><th>Regional</th><th>Tienda</th><th class="num">Inv. con edad</th><th class="num">Cobertura (d)</th>
      <th class="num">A gestionar</th><th class="num">Inv. total</th></tr>{filas_alerta12(a12['alerta2'])}</table>
      <div class="subtotales">{subt2}</div>
      <div class="nota">{len(a12['alerta2'])} tiendas · inventario total en la alerta: {fnum(a12['alerta2_inv_total'])} und.</div>

      <div class="small-title">Detalle por referencia en riesgo (edad &lt; {peps['umbral']}d, top 25 por unidades)</div>
      <table><tr><th>Tienda</th><th>Referencia</th><th class="num">Edad</th><th class="num">Cantidad lote</th>
      <th class="num">En riesgo</th></tr>{rows_detalle}</table>
    </div>
    """

    pagina5 = f"""
    <div class="page">
      <div class="section-title">4 · Conciliación de Inventario</div>
      <div class="kpi-row">
        <div class="kpi-card"><div class="label">Inventario Total TAT</div><div class="value">{fnum(conc['inv_total'])}</div></div>
        <div class="kpi-card"><div class="label">Con Edad Cargada</div><div class="value">{fnum(conc['edades_total'])}</div></div>
        <div class="kpi-card"><div class="label">Brecha</div><div class="value">{fnum(conc['brecha'])}</div></div>
      </div>
      <table><tr><th>Causa</th><th class="num">Unidades</th><th class="num">% brecha</th><th class="num">% inv. total</th></tr>
        <tr><td>1. En movimiento (tránsito + vehículos)</td><td class="num">{fnum(conc['en_movimiento'])}</td>
            <td class="num">{conc['pct_en_movimiento_brecha']:.1f}%</td><td class="num">{conc['pct_en_movimiento_total']:.1f}%</td></tr>
        <tr><td>2. Sin frescura (Segunda, Gris Suelto, Sin Clasificar)</td><td class="num">{fnum(conc['sin_frescura'])}</td>
            <td class="num">{conc['pct_sin_frescura_brecha']:.1f}%</td><td class="num">{conc['pct_sin_frescura_total']:.1f}%</td></tr>
        <tr><td>3. Residual (sin edad cargada / corte)</td><td class="num">{fnum(conc['residual'])}</td>
            <td class="num">{conc['pct_residual_brecha']:.1f}%</td><td class="num">{conc['pct_residual_total']:.1f}%</td></tr>
      </table>
      <div class="nota">Tránsito + vehículos pesan hoy el <b>{conc['pct_mov_todas_cat']:.1f}%</b> del inventario TAT total.</div>
    </div>
    """

    return f"""<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
    <title>Días de Inventario y Frescura TAT</title><style>{CSS}</style></head>
    <body>{portada}{pagina1}{pagina2}{pagina3}{pagina4}{pagina5}</body></html>"""


def main():
    ap = argparse.ArgumentParser(description='Genera el informe TAT (HTML/PDF) a partir del JSON del pipeline')
    ap.add_argument('--datos', required=True, help='JSON producido por tat_pipeline.py')
    ap.add_argument('--out', required=True, help='Ruta de salida (.pdf o .html)')
    ap.add_argument('--solo-html', action='store_true', help='No convertir a PDF, dejar solo el .html')
    args = ap.parse_args()

    with open(args.datos, encoding='utf-8') as f:
        d = json.load(f)

    html = build_html(d)

    if args.out.lower().endswith('.html') or args.solo_html:
        out_html = args.out if args.out.lower().endswith('.html') else args.out + '.html'
        with open(out_html, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f'OK -> {out_html}', file=sys.stderr)
        return

    with tempfile.NamedTemporaryFile('w', suffix='.html', delete=False, encoding='utf-8') as tmp:
        tmp.write(html)
        tmp_path = tmp.name
    try:
        subprocess.run(['wkhtmltopdf', '--enable-local-file-access', '--javascript-delay', '200',
                         tmp_path, args.out], check=True)
        print(f'OK -> {args.out}', file=sys.stderr)
    finally:
        os.unlink(tmp_path)


if __name__ == '__main__':
    main()
