from pathlib import Path
from PIL import Image,ImageDraw
p=Path(r'E:\效果图生成器\Store-Design\tmp\si-standards-review\model-views')
ids=[28034994,28192911,33660153,33819654,34320268,36887885,36890994,36929122,36929204,37758059]
for start in [0,5]:
 im=Image.new('RGB',(1200,5*500),'white');d=ImageDraw.Draw(im)
 for row,a in enumerate(ids[start:start+5]):
  for col in [0,1]:
   f=p/f'asset-{a}-{col}.png'
   if f.exists():
    pic=Image.open(f);pic.thumbnail((600,470));im.paste(pic,(col*600,row*500));d.text((col*600+10,row*500+474),f'{a} view{col}',fill='black')
 im.save(p/f'check-{start}.jpg')
