"""Local PDF render crops. Keeps store IDs and page-level provenance; no uploads."""
import json, hashlib
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'素材库/03_training_candidates/batch01'
OUT=ROOT/'素材库/04_training/style-v0'
OUT.mkdir(parents=True,exist_ok=True)
rows=json.loads((SOURCE/'manifest.json').read_text(encoding='utf-8'))
validation={'PDF-194','PDF-296'}
# Conservative removal of page headers/footers; retained original links permit audit.
crops={'PDF-079':(0,.02,1,.94),'PDF-083':(0,.08,1,.98),'PDF-417':(.08,.02,.98,.98),'PDF-293':(.05,.12,.95,.94),'PDF-296':(0,.10,1,.94)}
records=[]
for row in rows:
    for a in row['assets']:
        if a['role']!='render':continue
        source=SOURCE/row['id']/a['fullPage']
        with Image.open(source) as im:
            im=im.convert('RGB');box=crops.get(row['id'],(0,0,1,1));pixel=tuple(round(v*(im.width if i%2==0 else im.height)) for i,v in enumerate(box));im=im.crop(pixel)
            name=f"{row['id']}-p{a['page']}.png";im.save(OUT/name)
        style='SI1.0' if row['tag'].startswith('SI1') else 'SI2.0'
        text=('insta360si1 retail camera store, light grey display fixtures, pale countertops' if style=='SI1.0' else 'insta360si2 retail camera store, dark display fixtures and frames, pale countertops')
        text+=', '+('open island kiosk' if '中岛' in row['tag'] else 'shop interior')+', architectural visualization'
        records.append(dict(file_name=name,text=text,style=style,store_id=row['id'],split='validation' if row['id'] in validation else 'train',source_pdf=row['file'],source_sha256=row['sourceSha256'],source_page=a['page'],crop_ltrb_normalized=box,image_sha256=hashlib.sha256((OUT/name).read_bytes()).hexdigest(),label_status='master SI label; historical PDF revision not independently confirmed'))
train={r['store_id'] for r in records if r['split']=='train'};val={r['store_id'] for r in records if r['split']=='validation'};assert not train&val
(OUT/'metadata.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in records),encoding='utf-8')
summary={'stores':len(train|val),'train_stores':len(train),'validation_stores':len(val),'train_images':sum(r['split']=='train' for r in records),'validation_images':sum(r['split']=='validation' for r in records),'styles':{s:{split:sum(r['style']==s and r['split']==split for r in records) for split in ['train','validation']} for s in ['SI1.0','SI2.0']},'status':'pilot only; labels and within-PDF layout correspondence still need designer review'}
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
sheet=Image.new('RGB',(1000,((len(records)+3)//4)*185),'#eeeeee');draw=ImageDraw.Draw(sheet)
for i,r in enumerate(records):
    with Image.open(OUT/r['file_name']) as im:thumb=ImageOps.contain(im,(250,155));sheet.paste(thumb,(i%4*250,(i//4)*185+25))
    draw.text((i%4*250+5,(i//4)*185+4),f"{r['store_id']} {r['style']} {r['split']}",fill='black')
sheet.save(OUT/'contact.png');print(json.dumps(summary,ensure_ascii=False))
