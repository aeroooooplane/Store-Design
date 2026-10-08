from pathlib import Path
import fitz,json
root=Path(r'E:\效果图生成器\Store-Design');rows=[];count=0
terms=['亮脚','试飞台','字母凳','培训坐凳','配件边柜','开箱储物','储物边柜','1.3米','1.3m','骑行','600','1.6米配件柜']
for f in (root/'各门店图纸').glob('*.pdf'):
 try:
  d=fitz.open(f);count+=1
  for i in range(min(len(d),24)):
   p=d[i];t=p.get_text()
   if ('平面布置图' in t or '家具定位图' in t) and ('中岛桌' in t or '配件柜' in t):
    hits=[x for x in terms if x in t]
    if hits:rows.append({'file':f.name,'page':i+1,'hits':hits,'text':t})
  d.close()
 except Exception as e:print(f.name,str(e))
(root/'tmp/plan-legends/search.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),'utf-8')
print('files',count,'candidates',len(rows))
for r in sorted(rows,key=lambda r:len([x for x in r['hits'] if x!='600']),reverse=True)[:30]:print(r['file'],r['page'],','.join(r['hits']))
