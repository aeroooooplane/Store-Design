from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,re
root=Path(r'E:\效果图生成器\Store-Design'); work=root/'tmp/si-standards-review'; font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',17)
def sheet(items,dest,cols=3,cw=530,ch=335):
 im=Image.new('RGB',(cols*cw,((len(items)+cols-1)//cols)*ch),'#e6e6e6'); d=ImageDraw.Draw(im)
 for i,(p,label) in enumerate(items):
  pic=Image.open(p).convert('RGB');pic.thumbnail((cw-8,ch-48)); x=(i%cols)*cw;y=(i//cols)*ch; im.paste(pic,(x+(cw-pic.width)//2,y));d.text((x+5,y+ch-44),label,font=font,fill='black')
 im.save(dest)
for folder in work.iterdir():
 if folder.is_dir():
  pics=sorted(folder.glob('*.PNG'),key=lambda p:int(re.search(r'(\d+)$',p.stem).group(1)))
  if not pics: pics=sorted(folder.glob('*.png'),key=lambda p:int(re.search(r'(\d+)$',p.stem).group(1)))
  for k in range(0,len(pics),12):sheet([(p,f'{folder.name} / {i+1}') for i,p in enumerate(pics) if k<=i<k+12],work/f'{folder.name}-contact-{k//12+1:02}.jpg')
base=root/'素材库/04_assets/incoming/split-20260925-v2';assets=json.loads((base/'manifest.json').read_text('utf-8'))['assets']; items=[]
for i,a in enumerate(assets):
 dims=a['instances'][0]['world_bounds_m']; label=f"{i+1:02} {a['asset_id']} {a['category']}\n"+'x'.join(str(round(v*1000)) for v in dims)+' mm'
 items.append((base/a['asset_id']/'preview-instance.png',label))
for k in range(0,len(items),15):sheet(items[k:k+15],work/f'assets-{k//15+1:02}.jpg',cols=3,cw=530,ch=370)
(work/'asset-list.json').write_text(json.dumps([{'n':i+1,**{k:a[k] for k in ['asset_id','category','definition','folder']},'dimensions_mm':[round(v*1000,1) for v in a['instances'][0]['world_bounds_m']]} for i,a in enumerate(assets)],ensure_ascii=False,indent=2),'utf-8')
print('contact sheets',len(list(work.glob('*.jpg'))))
