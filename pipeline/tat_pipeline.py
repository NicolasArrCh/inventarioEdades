#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tat_pipeline.py — Pipeline de datos para el informe de Dias de Inventario y Frescura TAT.

Lee los 3 archivos de entrada, aplica TODAS las reglas de negocio acordadas (ver
PROYECTO_TAT_MEMORIA.md) y produce un unico JSON con todo lo que necesita la capa de
presentacion (tat_report.py) para construir el informe.

Uso:
    python tat_pipeline.py \
        --inv-hoy Inventario_Hoy.xlsx \
        --inv-ayer Inventario_Ayer.xlsx \
        --ventas ventas.xlsx \
        --out datos_tat.json \
        --umbral-frescura 5

No tocar la logica de negocio de este archivo para cambios de maquetacion/diseno --
esa parte vive en tat_report.py. Este archivo es la fuente de verdad de las reglas.
"""
import argparse
import json
import re
import sys

import numpy as np
import pandas as pd

CE_DESTINOS = {'TAT CE BARRANQUILLA', 'TAT CE BOGOTA', 'TAT CE CALI',
               'TAT CE MEDELLIN', 'TAT CE MONTERIA'}

TIENDA_REGION = {
    'TAT BARRANQUILLA': 'Costa', 'TAT CARTAGENA': 'Costa', 'TAT SANTA MARTA': 'Costa',
    'TAT VALLEDUPAR': 'Costa', 'TAT SINCELEJO': 'Costa', 'TAT MONTERIA': 'Costa',
    'TAT BUCARAMANGA': 'Costa', 'TAT CUCUTA': 'Costa',
    'TAT CALI': 'Occidente', 'TAT MEDELLIN': 'Occidente', 'TAT PEREIRA': 'Occidente',
    'TAT PASTO': 'Occidente', 'TAT POPAYAN': 'Occidente',
    'TAT BOGOTA MONTEVIDEO': 'Centro Oriente', 'TAT BOGOTA SIBERIA': 'Centro Oriente',
    'TAT BOGOTA (sin distinguir)': 'Centro Oriente', 'TAT VILLAVICENCIO': 'Centro Oriente',
}

KEYWORD_STORE = [
    ('MONTEVIDEO', 'TAT BOGOTA MONTEVIDEO'), ('SIBERIA', 'TAT BOGOTA SIBERIA'),
    ('BARRANQUILLA', 'TAT BARRANQUILLA'), ('CARTAGENA', 'TAT CARTAGENA'),
    ('SANTAMARTA', 'TAT SANTA MARTA'), ('SANTA MARTA', 'TAT SANTA MARTA'),
    ('VALLEDUPAR', 'TAT VALLEDUPAR'), ('SINCELEJO', 'TAT SINCELEJO'),
    ('MONTERIA', 'TAT MONTERIA'), ('BUCARAMANGA', 'TAT BUCARAMANGA'),
    ('CUCUTA', 'TAT CUCUTA'), ('CALI', 'TAT CALI'), ('MEDELLIN', 'TAT MEDELLIN'),
    ('PEREIRA', 'TAT PEREIRA'), ('PASTO', 'TAT PASTO'), ('POPAYAN', 'TAT POPAYAN'),
    ('VILLAVICENCIO', 'TAT VILLAVICENCIO'),
]

CODIGO_GENERICO_STORE = {
    'TAT H1050 - AUTOSERVICIOS': 'TAT BUCARAMANGA', 'TAT H2050 - AUTOSERVICIOS': 'TAT CALI',
    'TAT H3050 - AUTOSERVICIOS': 'TAT MEDELLIN', 'TAT H4050 - AUTOSERVICIOS': 'TAT BARRANQUILLA',
    'TAT H4150 - AUTOSERVICIOS': 'TAT CARTAGENA',
}

BOGOTA_GENERICO = {
    'TAT BOGOTA - H5200', 'TAT BOGOTA - ESPECIAL - H5490', 'TAT BOGOTA - GRANDES SUPERFICIES - H5960',
    'TAT BOGOTA-BLINDAR H5949', 'TAT - FOOD SERVICE BOGOTA - FS59', 'TAT H5250 - AUTOSERVICIO - BOGOTA',
}

# Canales funcionalmente TAT pero sin la palabra "TAT" en el nombre -> NO se incluyen en el
# total oficial (ver memoria, seccion 3.3). Se reportan aparte como hallazgo.
ORPHAN_TAT_LIKE = {
    'FOOD SERVICE PEREIRA - OP': 'TAT PEREIRA',
    'MONTERIA-AUTOSERVICIOS OPERADOR': 'TAT MONTERIA',
    'PEREIRA - RUTA ESPECIAL OPERADOR': 'TAT PEREIRA',
}

RENAME_DESTINO_EDADES = {'OL. PEREIRA': 'TAT PEREIRA', 'TAT SANTA MARTA ': 'TAT SANTA MARTA'}

PAT_TALLA = re.compile(r'HUEVO\s+(YUMBO|XXL|XL|AAA|AA|A|B|C|L|M)\b')
FALLBACK_KEYWORDS = [
    ('ETIQUETA', 'ETIQUETA'), ('GRIS', 'GRIS SUELTO'), ('ROJO', 'GRIS SUELTO'),
    ('REVOLTURA', 'SEGUNDA'), ('CARTON VERDE', 'VERDE'),
]


def tat_mask(df):
    d = df['DESTINO'].astype(str)
    return d.str.contains('TAT', na=False) & ~d.isin(CE_DESTINOS)


def get_talla(desc):
    if pd.isna(desc):
        return None
    m = PAT_TALLA.search(str(desc).upper())
    return m.group(1) if m else None


def asignar_tienda(desc):
    d = str(desc).upper()
    for kw, store in KEYWORD_STORE:
        if kw in d:
            return store
    if desc in CODIGO_GENERICO_STORE:
        return CODIGO_GENERICO_STORE[desc]
    if desc in BOGOTA_GENERICO:
        return 'TAT BOGOTA (sin distinguir)'
    return 'TAT SIN IDENTIFICAR'


def semaforo(dias):
    if dias is None:
        return 'NC'
    if dias >= 6:
        return 'ROJO'
    if dias >= 3:
        return 'VERDE'
    return 'GRIS'


def dias_inv(inventario, venta_diaria):
    if venta_diaria is None or venta_diaria <= 0:
        return None
    return inventario / venta_diaria


def cargar_y_clasificar(inv_hoy_path, inv_ayer_path, ventas_path):
    inv_hoy = pd.read_excel(inv_hoy_path, sheet_name='inv')
    inv_ayer = pd.read_excel(inv_ayer_path, sheet_name='inv')
    edades_hoy = pd.read_excel(inv_hoy_path, sheet_name='INV. EDADES')
    edades_ayer = pd.read_excel(inv_ayer_path, sheet_name='INV. EDADES')

    fecha_hoy = edades_hoy['Fecha'].dropna().iloc[0]
    fecha_ayer = edades_ayer['Fecha'].dropna().iloc[0]

    ventas = pd.read_excel(ventas_path, sheet_name='ventas',
                            usecols=['cantidad', 'descripcion_articulo', 'descripcion',
                                     'nombre_ciudad', 'fec_venta'])
    ventas['descripcion'] = ventas['descripcion'].astype(str)
    ventas['dia'] = ventas['fec_venta'].dt.date
    ventas['dow'] = ventas['fec_venta'].dt.dayofweek  # 6 = domingo

    dic_tipo2 = (inv_hoy[['descripcion_articulo', 'TIPO DE HUEVO 2']]
                 .dropna().drop_duplicates(subset='descripcion_articulo')
                 .set_index('descripcion_articulo')['TIPO DE HUEVO 2'].to_dict())

    def clasificar_tipo2(desc):
        if pd.isna(desc):
            return 'HUEVO SIN CLASIFICAR'
        if desc in dic_tipo2:
            return dic_tipo2[desc]
        desc_u = str(desc).upper()
        for kw, tipo in FALLBACK_KEYWORDS:
            if kw in desc_u:
                return tipo
        return 'HUEVO SIN CLASIFICAR'

    ventas['tipo_huevo2_base'] = ventas['descripcion_articulo'].apply(clasificar_tipo2)
    ventas['es_gris_nombre'] = ventas['descripcion_articulo'].astype(str).str.upper().str.contains('GRIS', na=False)
    ventas['talla'] = ventas['descripcion_articulo'].apply(get_talla)
    ventas['es_tat'] = ventas['descripcion'].str.contains('TAT', na=False)
    ventas['tienda_tat'] = np.where(ventas['es_tat'], ventas['descripcion'].apply(asignar_tienda), None)
    ventas['regional'] = ventas['tienda_tat'].map(TIENDA_REGION)

    # Regla confirmada en la corrida del 30/06/2026: la venta diaria promedio EXCLUYE domingo
    # (el archivo de ventas trae el domingo igual, pero no se usa para el promedio). Se filtra
    # DESPUES de clasificar para no perder columnas.
    dias_todos = sorted(ventas['dia'].unique())
    ventas = ventas[ventas['dow'] != 6].copy()
    dias_venta = sorted(ventas['dia'].unique())
    n_dias_venta = len(dias_venta)
    dias_excluidos_domingo = sorted(set(dias_todos) - set(dias_venta))

    orphan_mask = ventas['descripcion'].isin(ORPHAN_TAT_LIKE.keys())
    orphan_total_3d = float(ventas.loc[orphan_mask, 'cantidad'].sum())

    meta = {'fecha_hoy': str(fecha_hoy), 'fecha_ayer': str(fecha_ayer),
            'dias_venta': [str(d) for d in dias_venta], 'n_dias_venta': n_dias_venta,
            'dias_excluidos_domingo': [str(d) for d in dias_excluidos_domingo],
            'orphan_total_3d': orphan_total_3d}

    return inv_hoy, inv_ayer, edades_hoy, edades_ayer, ventas, meta


def agregar_venta(ventas, n_dias):
    tat = ventas[ventas['es_tat']].copy()

    base = tat.groupby('tipo_huevo2_base')['cantidad'].sum()
    overlap = tat[(tat['es_gris_nombre']) & (tat['tipo_huevo2_base'] != 'GRIS SUELTO')]['cantidad'].sum()
    venta_tipo2 = base.to_dict()
    venta_tipo2['GRIS SUELTO'] = venta_tipo2.get('GRIS SUELTO', 0) + overlap
    venta_tipo2_diaria = {str(k): v / n_dias for k, v in venta_tipo2.items()}

    venta_talla_diaria = {str(k): v / n_dias for k, v in tat.groupby('talla')['cantidad'].sum().to_dict().items()}

    verde = tat[tat['tipo_huevo2_base'] == 'VERDE']
    venta_verde_tienda_diaria = {str(k): v / n_dias for k, v in verde.groupby('tienda_tat')['cantidad'].sum().to_dict().items()}

    return {
        'venta_tipo2_diaria': venta_tipo2_diaria,
        'venta_talla_diaria': venta_talla_diaria,
        'venta_verde_tienda_diaria': venta_verde_tienda_diaria,
        'overlap_gris_diaria': float(overlap / n_dias),
        'venta_total_diaria': float(tat['cantidad'].sum() / n_dias),
        # Venta de TODA la compania (no solo TAT) -- base del KPI "Dias de Inventario Global"
        # confirmada contra el informe del 30/06/2026 (ver PROYECTO_TAT_MEMORIA.md seccion 9).
        'venta_total_diaria_compania': float(ventas['cantidad'].sum() / n_dias),
    }


def agregar_inventario(inv_hoy, inv_ayer):
    tat_hoy = inv_hoy[tat_mask(inv_hoy)].copy()
    tat_ayer = inv_ayer[tat_mask(inv_ayer)].copy()
    tat_hoy['es_gris_nombre'] = tat_hoy['descripcion_articulo'].astype(str).str.upper().str.contains('GRIS', na=False)

    # Inventario de TODA la compania (todos los destinos: TAT + CE + plantas + bodegas centrales),
    # sin filtrar -- confirmado como base del KPI "Inventario Total" / "Dias de Inventario Global"
    # contra el informe del 30/06/2026.
    inv_total_general_compania = float(inv_hoy['cantidad'].sum())

    base = tat_hoy.groupby('TIPO DE HUEVO 2')['cantidad'].sum()
    overlap = tat_hoy[tat_hoy['es_gris_nombre'] & (tat_hoy['TIPO DE HUEVO 2'] != 'GRIS SUELTO')]['cantidad'].sum()
    inv_tipo2 = base.to_dict()
    inv_tipo2['GRIS SUELTO'] = inv_tipo2.get('GRIS SUELTO', 0) + overlap

    inv_talla = tat_hoy.groupby('TIPO DE HUEVO')['cantidad'].sum().to_dict()

    verde_hoy = tat_hoy[tat_hoy['TIPO DE HUEVO 2'] == 'VERDE']
    verde_ayer = tat_ayer[tat_ayer['TIPO DE HUEVO 2'] == 'VERDE']

    def to_native(d):
        return {str(k): float(v) for k, v in d.items()}

    return {
        'inv_tipo2': to_native(inv_tipo2),
        'inv_talla': to_native(inv_talla),
        'inv_verde_tienda_hoy': to_native(verde_hoy.groupby('DESTINO')['cantidad'].sum().to_dict()),
        'inv_verde_tienda_ayer': to_native(verde_ayer.groupby('DESTINO')['cantidad'].sum().to_dict()),
        'overlap_gris_inv': float(overlap),
        'inv_total_tat_hoy': float(tat_hoy['cantidad'].sum()),
        'inv_total_tat_ayer': float(tat_ayer['cantidad'].sum()),
        'inv_verde_total_hoy': float(verde_hoy['cantidad'].sum()),
        'inv_verde_total_ayer': float(verde_ayer['cantidad'].sum()),
        'inv_total_general_compania': inv_total_general_compania,
    }


def calcular_dias_inventario(venta, inv):
    tabla_tipo2 = []
    for cat in ['VERDE', 'EMPACADOS', 'SEGUNDA', 'GRIS SUELTO', 'ETIQUETA', 'HUEVO SIN CLASIFICAR']:
        i = inv['inv_tipo2'].get(cat, 0)
        v = venta['venta_tipo2_diaria'].get(cat, 0)
        d = dias_inv(i, v)
        tabla_tipo2.append({'categoria': cat, 'inventario': i, 'venta_diaria': v, 'dias': d, 'semaforo': semaforo(d)})

    TALLAS = ['YUMBO', 'XL', 'L', 'M', 'A', 'AA', 'AAA', 'B', 'C', 'XXL']
    tabla_talla = []
    for t in TALLAS:
        i = inv['inv_talla'].get(t, 0)
        v = venta['venta_talla_diaria'].get(t, 0)
        if i == 0 and v == 0:
            continue
        d = dias_inv(i, v)
        tabla_talla.append({'talla': t, 'inventario': i, 'venta_diaria': v, 'dias': d, 'semaforo': semaforo(d)})
    for extra, key_inv, key_venta in [('Huevo de Segunda', 'SEGUNDA', 'SEGUNDA'),
                                       ('Sin Clasificar', 'HUEVO SIN CLASIFICAR', 'HUEVO SIN CLASIFICAR')]:
        i = inv['inv_talla'].get(key_inv, 0) if key_inv == 'SEGUNDA' else inv['inv_tipo2'].get('HUEVO SIN CLASIFICAR', 0)
        v = venta['venta_tipo2_diaria'].get(key_venta, 0)
        d = dias_inv(i, v)
        tabla_talla.append({'talla': extra, 'inventario': i, 'venta_diaria': v, 'dias': d, 'semaforo': semaforo(d)})

    # KPI "Dias de Inventario Global": confirmado contra el informe del 30/06/2026 que es a
    # nivel de TODA LA COMPANIA (inventario total todas las categorias/destinos, no solo TAT
    # Verde/Canasta). Se deja tambien 'inv_global_verde'/'venta_global_verde' por compatibilidad
    # con el KPI TAT-especifico que se mostraba antes.
    inv_global_compania = inv.get('inv_total_general_compania')
    venta_global_compania = venta['venta_total_diaria_compania']
    dias_global = dias_inv(inv_global_compania, venta_global_compania) if inv_global_compania else None

    inv_global_verde = inv['inv_verde_total_hoy']
    venta_global_verde = sum(venta['venta_verde_tienda_diaria'].values())

    return {'tabla_tipo2': tabla_tipo2, 'tabla_talla': tabla_talla,
            'inv_global_verde': inv_global_verde, 'venta_global_verde': venta_global_verde,
            'inv_global_compania': inv_global_compania, 'venta_global_compania': venta_global_compania,
            'dias_global': dias_global, 'inv_total_general': inv['inv_total_tat_hoy']}


def calcular_tiendas_y_alertas(venta, inv):
    tiendas = [t for t in TIENDA_REGION if t != 'TAT BOGOTA (sin distinguir)']
    tabla_tiendas = []
    for t in tiendas:
        i = inv['inv_verde_tienda_hoy'].get(t, 0)
        v = venta['venta_verde_tienda_diaria'].get(t, 0)
        d = (i / v) if v > 0 else None
        tabla_tiendas.append({'tienda': t, 'regional': TIENDA_REGION[t], 'inventario': i,
                               'venta_diaria': v, 'dias': d, 'semaforo': semaforo(d)})
    tabla_tiendas.sort(key=lambda r: -r['inventario'])

    regiones = {}
    for r in tabla_tiendas:
        reg = regiones.setdefault(r['regional'], {'inventario': 0, 'venta_diaria': 0})
        reg['inventario'] += r['inventario']
        reg['venta_diaria'] += r['venta_diaria']
    tabla_regional = []
    for reg, vals in regiones.items():
        d = (vals['inventario'] / vals['venta_diaria']) if vals['venta_diaria'] > 0 else None
        tabla_regional.append({'regional': reg, 'inventario': vals['inventario'], 'venta_diaria': vals['venta_diaria'],
                                'dias': d, 'semaforo': semaforo(d)})
    tabla_regional.sort(key=lambda r: -r['inventario'])

    # NOTA: el umbral de division Alerta1/Alerta2 se confirmo en 5 dias (no 6) en el informe
    # del 30/06/2026 ("Alerta 1 - Sobre-inventario (cobertura >= 5 dias)"). El semaforo visual
    # (funcion semaforo(), rojo >=6) NO cambio -- son dos cosas distintas.
    alerta1 = sorted([r for r in tabla_tiendas if r['dias'] is not None and r['dias'] >= 5],
                      key=lambda r: -r['dias'])
    alerta3 = sorted([r for r in tabla_tiendas if r['dias'] is not None and r['dias'] <= 1],
                      key=lambda r: r['dias'])
    nc = [r for r in tabla_tiendas if r['dias'] is None]

    return {'tabla_tiendas': tabla_tiendas, 'tabla_regional': tabla_regional,
            'alerta1': alerta1, 'alerta3': alerta3, 'nc': nc}


def calcular_peps_todas_tiendas(edades_hoy, venta, umbral=5):
    """Calcula el 'a gestionar' PEPS para TODAS las tiendas TAT con inventario fechado.

    Cambio confirmado contra el informe del 30/06/2026: antes esto solo se calculaba para
    tiendas fuera de Alerta 1 (exclusion total). Ahora se calcula para TODAS las tiendas -- las
    de Alerta 1 tambien muestran su propio 'a gestionar' PEPS en la tabla. La division en
    Alerta 1 (cobertura >=5d) vs Alerta 2 (cobertura <5d) para el INFORME se hace despues, en
    main(), usando el resultado de esta funcion + la cobertura total ya calculada en
    calcular_tiendas_y_alertas.
    """
    verde = edades_hoy[edades_hoy['tipo'] == 'VERDE'].copy()
    verde = verde.dropna(subset=['Edad', 'DESTINO'])
    verde['DESTINO'] = verde['DESTINO'].replace(RENAME_DESTINO_EDADES)

    resultado_tiendas, detalle_referencias = [], []
    for tienda, grupo in verde.groupby('DESTINO'):
        if not str(tienda).startswith('TAT '):
            continue
        vd = venta['venta_verde_tienda_diaria'].get(tienda, 0)
        lotes = grupo.sort_values('Edad', ascending=False)[['Edad', 'CANTIDAD', 'Referencia']]

        a_gestionar_vencido = proyectado_a_cruzar = running_ahead = 0.0
        detalle_lotes = []
        for _, lote in lotes.iterrows():
            E, Q = lote['Edad'], lote['CANTIDAD']
            if E >= umbral:
                a_gestionar_vencido += Q
                running_ahead += Q
            else:
                margen = umbral - E
                capacidad_disp = max(0.0, vd * margen - running_ahead)
                despachable = min(Q, capacidad_disp)
                en_riesgo = Q - despachable
                proyectado_a_cruzar += en_riesgo
                running_ahead += Q
                if en_riesgo > 0:
                    detalle_lotes.append({'referencia': lote['Referencia'], 'edad': float(E),
                                           'cantidad_lote': float(Q), 'en_riesgo': float(en_riesgo)})

        a_gestionar_total = a_gestionar_vencido + proyectado_a_cruzar
        inv_con_edad = float(lotes['CANTIDAD'].sum())
        dias_a_vender = (a_gestionar_total / vd) if vd > 0 else None
        resultado_tiendas.append({'tienda': tienda, 'venta_diaria': vd,
                                   'a_gestionar_vencido': a_gestionar_vencido,
                                   'proyectado_a_cruzar': proyectado_a_cruzar,
                                   'a_gestionar_total': a_gestionar_total,
                                   'dias_a_vender': dias_a_vender,
                                   'inventario_dated_total': inv_con_edad})
        for d in detalle_lotes:
            d['tienda'] = tienda
            detalle_referencias.append(d)

    resultado_tiendas.sort(key=lambda r: -r['a_gestionar_total'])
    return {'resultado_tiendas': resultado_tiendas, 'detalle_referencias': detalle_referencias,
            'umbral': umbral}


def calcular_conciliacion(inv_hoy, edades_hoy):
    tat = inv_hoy[tat_mask(inv_hoy)].copy()
    inv_total = tat['cantidad'].sum()

    sin_frescura_cats = ['SEGUNDA', 'GRIS SUELTO', 'HUEVO SIN CLASIFICAR']
    inv_sin_frescura = tat[tat['TIPO DE HUEVO 2'].isin(sin_frescura_cats)]['cantidad'].sum()

    cats_con_frescura = ['VERDE', 'EMPACADOS', 'ETIQUETA']
    tat_cf = tat[tat['TIPO DE HUEVO 2'].isin(cats_con_frescura)]
    inv_en_movimiento = tat_cf[tat_cf['GRUPO'].isin(['TRANSITO', 'VEHICULOS'])]['cantidad'].sum()
    inv_bodega_clasif = tat_cf[tat_cf['GRUPO'] == 'BODEGA']['cantidad'].sum()

    ed = edades_hoy.dropna(subset=['DESTINO']).copy()
    ed['DESTINO'] = ed['DESTINO'].replace(RENAME_DESTINO_EDADES)
    ed_tat = ed[ed['DESTINO'].astype(str).str.startswith('TAT ') & ~ed['DESTINO'].isin(CE_DESTINOS)]
    edades_total = ed_tat['CANTIDAD'].sum()

    brecha = inv_total - edades_total
    residual = inv_bodega_clasif - edades_total
    mov_total_todas_cat = tat[tat['GRUPO'].isin(['TRANSITO', 'VEHICULOS'])]['cantidad'].sum()

    return {
        'inv_total': float(inv_total), 'edades_total': float(edades_total), 'brecha': float(brecha),
        'en_movimiento': float(inv_en_movimiento), 'sin_frescura': float(inv_sin_frescura),
        'residual': float(residual), 'mov_total_todas_cat': float(mov_total_todas_cat),
        'pct_en_movimiento_brecha': float(inv_en_movimiento / brecha * 100) if brecha else 0,
        'pct_sin_frescura_brecha': float(inv_sin_frescura / brecha * 100) if brecha else 0,
        'pct_residual_brecha': float(residual / brecha * 100) if brecha else 0,
        'pct_en_movimiento_total': float(inv_en_movimiento / inv_total * 100) if inv_total else 0,
        'pct_sin_frescura_total': float(inv_sin_frescura / inv_total * 100) if inv_total else 0,
        'pct_residual_total': float(residual / inv_total * 100) if inv_total else 0,
        'pct_mov_todas_cat': float(mov_total_todas_cat / inv_total * 100) if inv_total else 0,
    }


def construir_alertas_1_y_2(tiendas_alertas, peps, umbral):
    """Une cobertura total (tabla_tiendas) con el 'a gestionar' PEPS por tienda, y separa en
    Alerta 1 (cobertura >= umbral) / Alerta 2 (cobertura < umbral), cada una con su subtotal
    regional de 'a gestionar' -- estructura confirmada contra el informe del 30/06/2026.
    """
    peps_por_tienda = {r['tienda']: r for r in peps['resultado_tiendas']}
    filas = []
    for r in tiendas_alertas['tabla_tiendas']:
        p = peps_por_tienda.get(r['tienda'], {})
        filas.append({
            'tienda': r['tienda'], 'regional': r['regional'],
            'inv_total': r['inventario'], 'venta_diaria': r['venta_diaria'], 'dias': r['dias'],
            'inv_con_edad': p.get('inventario_dated_total', 0.0),
            'a_gestionar': p.get('a_gestionar_total', 0.0),
            'dias_a_vender': p.get('dias_a_vender'),
        })

    alerta1 = sorted([f for f in filas if f['dias'] is not None and f['dias'] >= umbral],
                      key=lambda f: -f['dias'])
    alerta2 = sorted([f for f in filas if f['dias'] is not None and f['dias'] < umbral],
                      key=lambda f: -f['a_gestionar'])

    def subtotales(lista):
        sub = {}
        for f in lista:
            sub[f['regional']] = sub.get(f['regional'], 0.0) + f['a_gestionar']
        return sub

    return {
        'alerta1': alerta1, 'alerta2': alerta2,
        'alerta1_subtotal_regional': subtotales(alerta1),
        'alerta2_subtotal_regional': subtotales(alerta2),
        'alerta1_total_a_gestionar': sum(f['a_gestionar'] for f in alerta1),
        'alerta2_total_a_gestionar': sum(f['a_gestionar'] for f in alerta2),
        'alerta1_inv_total': sum(f['inv_total'] for f in alerta1),
        'alerta2_inv_total': sum(f['inv_total'] for f in alerta2),
    }


def main():
    ap = argparse.ArgumentParser(description='Pipeline de datos TAT - Dias de Inventario y Frescura')
    ap.add_argument('--inv-hoy', required=True)
    ap.add_argument('--inv-ayer', required=True)
    ap.add_argument('--ventas', required=True)
    ap.add_argument('--out', required=True, help='Ruta del JSON de salida')
    ap.add_argument('--umbral-frescura', type=int, default=5,
                     help='Umbral en dias para PEPS Y para la division Alerta1/Alerta2 (confirmado en 5)')
    args = ap.parse_args()

    print('Cargando y clasificando datos...', file=sys.stderr)
    inv_hoy, inv_ayer, edades_hoy, edades_ayer, ventas, meta = cargar_y_clasificar(
        args.inv_hoy, args.inv_ayer, args.ventas)

    print('Agregando venta e inventario...', file=sys.stderr)
    venta = agregar_venta(ventas, meta['n_dias_venta'])
    inv = agregar_inventario(inv_hoy, inv_ayer)

    print('Calculando dias de inventario, tiendas y alertas...', file=sys.stderr)
    dias = calcular_dias_inventario(venta, inv)
    tiendas_alertas = calcular_tiendas_y_alertas(venta, inv)

    print('Calculando PEPS (a gestionar) para todas las tiendas...', file=sys.stderr)
    peps = calcular_peps_todas_tiendas(edades_hoy, venta, umbral=args.umbral_frescura)
    alertas_1_2 = construir_alertas_1_y_2(tiendas_alertas, peps, umbral=args.umbral_frescura)

    print('Calculando conciliacion...', file=sys.stderr)
    conciliacion = calcular_conciliacion(inv_hoy, edades_hoy)

    delta_total = inv['inv_total_tat_hoy'] - inv['inv_total_tat_ayer']
    delta_verde = inv['inv_verde_total_hoy'] - inv['inv_verde_total_ayer']
    dias_global_ayer_est = (inv['inv_verde_total_ayer'] / dias['venta_global_verde']
                             if dias['venta_global_verde'] else None)

    salida = {
        'meta': meta,
        'venta_agregada': venta,
        'inv_agregado': inv,
        'dias_inventario': dias,
        'tiendas_alertas13': tiendas_alertas,
        'peps_por_tienda': peps,
        'alertas_1_2': alertas_1_2,
        'conciliacion': conciliacion,
        'comparacion_ayer': {'delta_total': float(delta_total), 'delta_verde': float(delta_verde),
                              'dias_global_ayer_est': dias_global_ayer_est},
        'store_meta': {'TIENDA_REGION': TIENDA_REGION, 'ORPHAN_TAT_LIKE': ORPHAN_TAT_LIKE,
                       'orphan_total': meta['orphan_total_3d']},
    }

    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(salida, f, ensure_ascii=False, indent=2)
    print(f'OK -> {args.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
