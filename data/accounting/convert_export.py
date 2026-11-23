import csv,json,os,zipfile,shutil
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from collections import defaultdict, Counter
from pathlib import Path

SRC=Path('/mnt/data/BG Account Inquiry All(BG Account Inquiry All)(1).csv')
OUT=Path('/mnt/data/accounting-json-final')
if OUT.exists(): shutil.rmtree(OUT)
(OUT/'accounts').mkdir(parents=True)

COLS=[
'fy2026_27.original','fy2026_27.revised','fy2026_27.encumbrance','fy2026_27.actuals','fy2026_27.available',
'fy2025_26.original','fy2025_26.revised','fy2025_26.actuals',
'fy2024_25.original','fy2024_25.revised','fy2024_25.actuals',
'fy2023_24.original','fy2023_24.revised','fy2023_24.actuals','fy2022_23.actuals']
SRC_AMT=['Original Budget FY 2027','Revised Budget FY 2027','Encumbrance FY 2027','YTD Actuals FY 2027','Available Budget for FY 2027','Original Budget FY 2026','Revised Budget FY 2026','YTD Actuals FY 2026','Original Budget FY 2025','Revised Budget FY 2025','YTD Actuals FY 2025','Original Budget FY 2024','Revised Budget FY 2024','YTD Actuals FY 2024','YTD Actuals FY 2023']
Q=Decimal('0.01')
def money(s):
    s=s.strip()
    if s=='': return None
    neg=s.startswith('(') and s.endswith(')')
    if neg:s=s[1:-1]
    s=s.replace(',','').replace('$','')
    d=Decimal(s)
    if neg:d=-d
    return d.quantize(Q,rounding=ROUND_HALF_UP)
def jnum(d):
    if d is None:return None
    return int(d) if d==d.to_integral() else float(d)
def trimrow(r):return {k:(v.strip() if isinstance(v,str) else v) for k,v in r.items()}

dims={k:{} for k in ['departments','divisions','programs','subprograms','funds','organizations','objects']}
conflicts=[]; conflict_seen=set()
def adddim(kind,code,obj):
    if not code:return
    if code not in dims[kind]: dims[kind][code]=obj
    elif dims[kind][code]!=obj:
        key=(kind,code,json.dumps(obj,sort_keys=True))
        if key not in conflict_seen:
            conflict_seen.add(key); conflicts.append({'dimension':kind,'code':code,'kept':dims[kind][code],'alternate':obj})

rows_by_dept=defaultdict(list)
source_tot=defaultdict(lambda:defaultdict(lambda:Decimal('0')))
out_tot=defaultdict(lambda:defaultdict(lambda:Decimal('0')))
out_dept=defaultdict(lambda:defaultdict(lambda:defaultdict(lambda:Decimal('0'))))
value_error=[]; contingency_zero=0; contingency_nonzero=0; written=0; rows_in=0
largest=[]; anomaly_by_dept=Counter(); anomalies=[]

with SRC.open(encoding='cp1252',newline='') as f:
    rd=csv.DictReader(f)
    for raw in rd:
        rows_in+=1; r=trimrow(raw); typ=r['Object Type']
        vals=[money(r[c]) for c in SRC_AMT]
        group=typ if typ in ('Expenses','Revenues') else 'Other'
        # raw source totals for rows that will be written determined after drop checks
        if typ=='#VALUE!':
            value_error.append(r); continue
        nonzero=any(v is not None and v!=0 for v in vals)
        if typ=='Contingency' and not nonzero:
            contingency_zero+=1; continue
        if typ=='Contingency' and nonzero: contingency_nonzero+=1
        # dimensions from written rows only
        dep=r['Department']; div=r['Division']; prog=r['Program']; sub=r['SubProgram']; fund=r['Fund']; org=r['Org']; objcode=r['Object']
        adddim('departments',dep,{'code':dep,'name':r['Dept Desc']})
        adddim('divisions',div,{'code':div,'name':r['Division Desc'],'department':dep})
        adddim('programs',prog,{'code':prog,'name':r['Program Desc'],'division':div,'department':dep})
        adddim('subprograms',sub,{'code':sub,'name':r['Sub Program Desc'],'program':prog,'division':div,'department':dep})
        adddim('funds',fund,{'code':fund,'name':r['Fund Desc']})
        adddim('organizations',org,{'code':org,'name':r['Org Desc'],'fund':fund,'department':dep,'division':div,'program':prog,'subprogram':sub})
        adddim('objects',objcode,{'code':objcode,'title':r['Object Title'],'objectType':typ,'level1':r['Level 1'],'level2':r['Level 2'],'characterCode':r['Character Code'],'rollupCode':r['Rollup Code']})
        transformed=[(-v if typ=='Revenues' and v is not None else v) for v in vals]
        rows_by_dept[dep].append([org,objcode]+[jnum(v) for v in transformed]); written+=1
        for key,v,tv in zip(COLS,vals,transformed):
            if v is not None: source_tot[group][key]+=v
            if tv is not None:
                out_tot[group][key]+=tv; out_dept[dep][group][key]+=tv
        rev=transformed[1]
        largest.append((rev if rev is not None else Decimal('-Infinity'),org,objcode,dep))
        # anomaly: actuals nonzero while both original/revised are blank or zero, per FY with budget columns
        flagged=[]
        for label,oi,ri,ai in [('fy2026_27',0,1,3),('fy2025_26',5,6,7),('fy2024_25',8,9,10),('fy2023_24',11,12,13)]:
            a=transformed[ai]; o=transformed[oi]; rv=transformed[ri]
            if a not in (None,Decimal('0')) and o in (None,Decimal('0')) and rv in (None,Decimal('0')): flagged.append(label)
        if flagged:
            anomaly_by_dept[dep]+=1; anomalies.append((len(flagged),dep,org,objcode,flagged))

# write dimensions
outdims={k:[dims[k][c] for c in sorted(dims[k])] for k in dims}
with (OUT/'dimensions.json').open('w',encoding='utf-8') as f:json.dump(outdims,f,ensure_ascii=False,indent=2)
# accounts
for dep in sorted(rows_by_dept):
    with (OUT/'accounts'/f'{dep}.json').open('w',encoding='utf-8') as f:json.dump({'department':dep,'columns':COLS,'rows':rows_by_dept[dep]},f,ensure_ascii=False,separators=(',',':'))

def totals_json(src):return {g:{k:jnum(src[g][k]) for k in COLS} for g in ['Expenses','Revenues','Other']}
meta={'source':SRC.name,'exportDate':'2026-11-18','rowsInSource':rows_in,'rowsWritten':written,
'rowsDropped':{'valueError':value_error,'contingencyZero':contingency_zero},
'contingencyNonZeroKept':contingency_nonzero,
'amountsConvention':'Revenue amounts are positive; expenses as in the source',
'columns':COLS,'totals':totals_json(out_tot),
'totalsByDepartment':{d:totals_json(out_dept[d]) for d in sorted(out_dept)},'conflicts':conflicts}
with (OUT/'meta.json').open('w',encoding='utf-8') as f:json.dump(meta,f,ensure_ascii=False,indent=2)

# validations from generated files
# refs
orgs=set(dims['organizations']); objs=set(dims['objects']); missing_org=set(); missing_obj=set(); json_rows=0; json_tot=defaultdict(lambda:defaultdict(lambda:Decimal('0')))
for p in sorted((OUT/'accounts').glob('*.json')):
    d=json.load(p.open())
    for rr in d['rows']:
        json_rows+=1
        if rr[0] not in orgs:missing_org.add(rr[0])
        if rr[1] not in objs:missing_obj.add(rr[1])
        typ=dims['objects'][rr[1]]['objectType']; group=typ if typ in ('Expenses','Revenues') else 'Other'
        for k,x in zip(COLS,rr[2:]):
            if x is not None: json_tot[group][k]+=Decimal(str(x)).quantize(Q)
# expected transformed source comparison
mismatches=[]
for g in ['Expenses','Revenues','Other']:
    for k in COLS:
        expected=(-source_tot[g][k] if g=='Revenues' else source_tot[g][k])
        if expected!=json_tot[g][k]:mismatches.append((g,k,expected,json_tot[g][k]))

sizes={'dimensions':(OUT/'dimensions.json').stat().st_size,'meta':(OUT/'meta.json').stat().st_size}
aps=list((OUT/'accounts').glob('*.json')); total_acc=sum(p.stat().st_size for p in aps); maxp=max(aps,key=lambda p:p.stat().st_size)
largest=sorted(largest,reverse=True)[:10]
lines=[]
lines.append('VALIDATION REPORT')
lines.append(f'Rows: source={rows_in:,}; written={written:,}; dropped valueError={len(value_error):,}; dropped zero Contingency={contingency_zero:,}; reconciliation={written+len(value_error)+contingency_zero:,}')
lines.append(f'Non-zero Contingency rows retained: {contingency_nonzero:,}')
lines.append(f'Generated JSON rows re-read: {json_rows:,}')
lines.append(f'Cent-level reconciliation: {"PASS" if not mismatches else "FAIL"}')
lines.append(f'Referential integrity: missing orgs={len(missing_org)}, missing objects={len(missing_obj)}')
lines.append('Dimension counts: '+', '.join(f'{k}={len(v):,}' for k,v in dims.items()))
lines.append(f'Conflicts: {len(conflicts):,}')
lines.append(f'File sizes: dimensions.json={sizes["dimensions"]:,} bytes; meta.json={sizes["meta"]:,} bytes; largest account={maxp.name} {maxp.stat().st_size:,} bytes; accounts total={total_acc:,} bytes')
lines.append('\nRECONCILIATION TABLE (source -> expected/output; revenues expected is source x -1)')
for g in ['Expenses','Revenues','Other']:
    lines.append(f'[{g}]')
    for k in COLS:
        s=source_tot[g][k]; exp=-s if g=='Revenues' else s; out=json_tot[g][k]
        lines.append(f'{k}: source={s:.2f} expected={exp:.2f} json={out:.2f} diff={(out-exp):.2f}')
lines.append('\n10 LARGEST ACCOUNTS BY FY 2026-27 REVISED AMOUNT')
for amt,org,obj,dep in largest:
    lines.append(f'{amt:.2f} | dept {dep} | org {org} {dims["organizations"][org]["name"]} | object {obj} {dims["objects"][obj]["title"]}')
lines.append('\nACTUALS WITH NO ORIGINAL/REVISED BUDGET (account rows), TOP 10 DEPARTMENTS')
for dep,n in anomaly_by_dept.most_common(10):lines.append(f'{dep} {dims["departments"].get(dep,{}).get("name","")}: {n}')
lines.append(f'Total flagged account rows: {sum(anomaly_by_dept.values()):,}')
if mismatches:
    lines.append('\nMISMATCHES'); lines.extend(map(str,mismatches))
(OUT/'validation.txt').write_text('\n'.join(lines),encoding='utf-8')
# copy script
shutil.copy2(__file__,OUT/'convert_export.py')
# zip
zip_path=Path('/mnt/data/accounting-json.zip')
if zip_path.exists():zip_path.unlink()
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
    for p in OUT.rglob('*'):
        if p.is_file():z.write(p,p.relative_to(OUT.parent))
print('\n'.join(lines[:10]))
print('zip',zip_path,zip_path.stat().st_size)
if mismatches or missing_org or missing_obj or written+len(value_error)+contingency_zero!=rows_in: raise SystemExit(2)
