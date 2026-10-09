import sys
from PIL import Image, ImageDraw
import pipeline as p
import fitz
sid=sys.argv[1];nums=[int(x) for x in sys.argv[2].split(',')]
r=next(r for r in p.inventory()['files'] if r['source_id']==sid)
d=fitz.open(r['path']);can=Image.new('RGB',(1600,310*((len(nums)+3)//4)),'#dddddd');dr=ImageDraw.Draw(can)
for i,n in enumerate(nums):
    page=d[n-1];scale=380/max(page.rect.width,page.rect.height);pix=page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False);im=Image.frombytes('RGB',(pix.width,pix.height),pix.samples)
    x=(i%4)*400;y=(i//4)*310;can.paste(im,(x,y+20));dr.text((x+5,y+3),f'{sid} p{n}',fill='black')
dest=p.CACHE/f'{sid}-contact-{nums[0]}-{nums[-1]}.png'
with dest.open('xb') as f:can.save(f,format='PNG')
print(dest)
