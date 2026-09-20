"""Construct a new workbook from an allowlist of values and formatting."""
from pathlib import Path
import math,zipfile
import xml.etree.ElementTree as ET
import xlsxwriter
from openpyxl.utils.cell import coordinate_to_tuple

SHEETS=('CashFlowSummStRnt','DashboardStRnt')
def rgb(color):
    return '#'+color.rgb[-6:] if color and color.type=='rgb' and isinstance(color.rgb,str) else None

def export_results(source,result,target,layout=None):
    target=Path(target);target.parent.mkdir(parents=True,exist_ok=True)
    book=xlsxwriter.Workbook(str(target),{'strings_to_formulas':False,'strings_to_urls':False,'nan_inf_to_errors':False})
    book.set_properties({'title':'GeoFlow Lab calculation results','author':'GeoFlow Lab','comments':'Values-only results. Recalculate through the service.'})
    style_cache={}
    for sn in SHEETS:
        src=source[sn];dest=book.add_worksheet(sn);dest.hide_gridlines(2)
        for name,d in src.column_dimensions.items():
            if d.min and d.max:dest.set_column(d.min-1,d.max-1,min(d.width or 12,65))
        for idx,d in src.row_dimensions.items():
            if d.height:dest.set_row(idx-1,d.height)
        merged_children=set()
        for merged in src.merged_cells.ranges:
            a,b,c,d=merged.bounds
            merged_children.update((r,col) for r in range(b,d+1) for col in range(a,c+1) if (r,col)!=(b,a))
        def fmt(cell):
            key=cell.style_id
            if key not in style_cache:
                props={'font_name':cell.font.name or 'Calibri','font_size':cell.font.sz or 11,'bold':bool(cell.font.b),'italic':bool(cell.font.i),'text_wrap':bool(cell.alignment.wrap_text),'num_format':cell.number_format}
                if rgb(cell.font.color):props['font_color']=rgb(cell.font.color)
                if cell.fill.patternType=='solid' and rgb(cell.fill.fgColor):props['bg_color']=rgb(cell.fill.fgColor)
                if cell.alignment.horizontal in ('left','center','right'):props['align']=cell.alignment.horizontal
                if cell.alignment.vertical:props['valign']='vcenter' if cell.alignment.vertical=='center' else cell.alignment.vertical
                for edge in ['top','bottom','left','right']:
                    if getattr(cell.border,edge).style:props[edge]=1;props[edge+'_color']='#CDD6E0'
                style_cache[key]=book.add_format(props)
            return style_cache[key]
        for row in src:
            for c in row:
                if (c.row,c.column) in merged_children:continue
                value=c.value
                if c.data_type=='f':raise ValueError('Uncalculated formula supplied to exporter')
                if c.data_type=='e':raise ValueError('Error supplied to exporter')
                if isinstance(value,float) and not math.isfinite(value):raise ValueError('Nonfinite result')
                if value is not None:dest.write(c.row-1,c.column-1,value,fmt(c))
        for merged in src.merged_cells.ranges:
            a,b,c,d=merged.bounds;cell=src.cell(b,a)
            # Preserve legitimate zero values in merged headers/cells.
            dest.merge_range(b-1,a-1,d-1,c-1,cell.value if cell.value is not None else '',fmt(cell))
        dest.freeze_panes(7 if sn==SHEETS[0] else 5,0)
        dest.set_landscape();dest.fit_to_pages(1,0)
    dash=book.get_worksheet_by_name('DashboardStRnt')
    # Old stored sensitivity values are always overwritten with this run's variants.
    dash.write('AI75','Contractor NPV10 sensitivity — current calculation')
    for row in range(76,83):
        for col in range(34,39):dash.write_blank(row,col,None)
    for i,s in enumerate(result['sensitivity'],76):
        dash.write_row(i,34,[s['label'],s['low']/1e6,s['high']/1e6,(s['low']-s['baseline'])/1e6,(s['high']-s['baseline'])/1e6])
    charts=[('E71','Annual oil production','line',[('Oil','AE')]),('E91','Contractor cash flow','line',[('Annual','AJ'),('Cumulative','AK')]),('E112','State cash flow','line',[('Annual','AL'),('Cumulative','AM')]),('M112','Annual capital investment','column',[('Capex','AN')]),('E9','Type-well production','line',[('Production','AI')]),('M91','Annual operating costs','line',[('Opex','AO')]),('AR7','Operating costs','column',[('Opex','AO')]),('AR26','Type-well production','line',[('Production','AI')]),('L9','Field production','column',[('Oil','AE'),('Gas','AF')]),('F40','Cash flow and costs','column',[('Contractor','AJ'),('State','AL'),('Capex','AN'),('Opex','AO')])]
    colors=['#176B63','#405F9B','#BE8141','#8593A5']
    layout=layout or source['DashboardStRnt']
    def column_pixels(index):
        width=layout.sheet_format.defaultColWidth or 8.43
        for dim in layout.column_dimensions.values():
            if (dim.min or 0)<=index+1<=(dim.max or 0):width=min(dim.width or 12,65);break
        return int(width*7+5)
    def row_pixels(index):
        return int((layout.row_dimensions[index+1].height or layout.sheet_format.defaultRowHeight or 15)*4/3)
    for ci,(anchor,title,kind,series) in enumerate(charts):
        chart=book.add_chart({'type':kind})
        for i,(label,col) in enumerate(series):
            col_index=coordinate_to_tuple(col+'1')[1]-1
            options={'name':label,'categories':['DashboardStRnt',6,29,35,29],'values':['DashboardStRnt',6,col_index,35,col_index],'line':{'color':colors[i%4],'width':2},'y2_axis':title=='Field production' and i==1}
            if kind=='column':options['fill']={'color':colors[i%4]}
            chart.add_series(options)
        chart.set_title({'name':title});chart.set_x_axis({'name':'Project year'});chart.set_legend({'position':'bottom'})
        # Recreate placement from geometry only, never copy chart XML/formulas.
        placement={};width,height=480,300
        if ci<len(layout._charts):
            a=layout._charts[ci].anchor
            if hasattr(a,'to'):
                start,end=a._from,a.to
                width=sum(column_pixels(c) for c in range(start.col,end.col))+(end.colOff-start.colOff)/9525
                height=sum(row_pixels(r) for r in range(start.row,end.row))+(end.rowOff-start.rowOff)/9525
                placement={'x_offset':int(start.colOff/9525),'y_offset':int(start.rowOff/9525)}
        chart.set_size({'width':max(200,int(width)),'height':max(180,int(height))});dash.insert_chart(anchor,chart,placement)
    book.close()

def inspect_export(path):
    ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(path) as z:
        names=z.namelist();book=ET.fromstring(z.read('xl/workbook.xml'))
        sheets=book.findall('s:sheets/s:sheet',ns)
        assert [s.attrib['name'] for s in sheets]==list(SHEETS)
        assert all(s.attrib.get('state','visible')=='visible' for s in sheets)
        # XlsxWriter may emit legitimate print-area/title names.  Reject only
        # names that could expose another workbook or an unexpected sheet.
        for dn in book.findall('s:definedNames/s:definedName',ns):
            name=dn.attrib.get('name','')
            text=(dn.text or '')
            assert name in {'_xlnm.Print_Area','_xlnm.Print_Titles'}
            assert '!' not in text or 'DashboardStRnt!' in text or 'CashFlowSummStRnt!' in text
        assert not any(any(x in name for x in ['externalLinks','embeddings','vbaProject','comments','connections']) for name in names)
        for name in names:
            if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
                root=ET.fromstring(z.read(name));assert not root.findall('.//s:f',ns)
            if name.startswith('xl/charts/chart') and name.endswith('.xml'):
                root=ET.fromstring(z.read(name))
                for ref in root.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/chart}f'):
                    formula=(ref.text or '').replace("'DashboardStRnt'!",'DashboardStRnt!')
                    assert formula.startswith('DashboardStRnt!'), 'Unsafe chart source'
    return True
