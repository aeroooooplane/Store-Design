"""Render pilot raster-heavy candidates, saving full-resolution evidence and contacts."""
from pipeline import *
from PIL import Image,ImageDraw
def main():
    dest=CACHE/'render-review';dest.mkdir(exist_ok=True)
    receipt=dest/'queue.json'
    if receipt.exists():return
    items=[]
    for row in inventory()['files']:
        cached=CACHE/'classified-r2'/f'{row["source_id"]}.json'
        if not cached.exists():continue
        with fitz.open(row['path']) as doc:
            for p in read(cached)['pages']:
                if p['type']!='render' and not(p['signals']['bitmap_area_ratio']>.55 and p['signals']['vector_path_count']<100):continue
                page=doc[p['page']-1];filename=f'{row["source_id"]}-p{p["page"]:03}.png';out=dest/filename
                if not out.exists():
                    with out.open('xb') as f:f.write(page.get_pixmap(matrix=fitz.Matrix(2500/max(page.rect.width,page.rect.height),2500/max(page.rect.width,page.rect.height)),alpha=False).tobytes('png'))
                items.append(dict(source_id=row['source_id'],page=p['page'],path=str(out),sha256=digest(out)))
    for batch in range((len(items)+5)//6):
        can=Image.new('RGB',(1800,1000),'#dddddd');dr=ImageDraw.Draw(can)
        for k,a in enumerate(items[batch*6:(batch+1)*6]):
            im=Image.open(a['path']);im.thumbnail((590,465));x=k%3*600;y=k//3*500;can.paste(im,(x,y+30));dr.text((x+5,y+5),f'{a["source_id"]} p{a["page"]}',fill='black');a['contact_batch']=batch+1
        target=dest/f'contact-{batch+1:03}.png'
        if target.exists():raise FileExistsError(target)
        with target.open('xb') as f:can.save(f,format='PNG')
    write(receipt,dict(items=items,note='Raster-heavy queue: needs actual visual inspection; no automatic render label.'))
    print('pages',len(items),'contacts',(len(items)+5)//6)
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');main()
