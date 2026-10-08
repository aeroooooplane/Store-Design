from pathlib import Path
import fitz,json,hashlib
from PIL import Image,ImageDraw,ImageFont
root=Path(r'E:\效果图生成器\Store-Design');base=root/'素材库/04_assets/按SI标准命名-20261001';work=root/'tmp/plan-legends';dest=base/'平面图例';dest.mkdir(exist_ok=True)
refs={r['store_id']:r for r in json.loads((work/'case-refs.json').read_text('utf-8')) if r['role']=='design_plan'}
# Coordinates on the inspected 1888 x 1335 page overview, converted to original PDF points.
specs=[
('si1-island','PDF-201',[768,763,978,880],'SI1.0中岛桌','同类图例；清单与定位图深度存在800/1000冲突，以原图记录为准'),
('si1-unbox','PDF-235',[861,459,1042,630],'SI1.0开箱桌及4凳','同类图例；原图操作垫和陈列细节与模型可能不同'),
('si1-cab1200','PDF-235',[1080,484,1126,594],'SI1.0 1.2米配件柜','同规格平面符号'),
('si1-storage','PDF-201',[870,498,1078,561],'SI1.0 1.8米边桌储物柜','同用途和名义长度，产品陈列不同'),
('si1-storage-unbox','PDF-201',[1074,498,1283,625],'SI1.0 1.8米开箱储物柜及2凳','同用途图例；原图双垫简化为台面轮廓'),
('si2-island','PDF-001',[509,630,678,707],'SI2.0 1.8米中岛桌','同类俯视图；仅凭本图不能证明普通或亮脚，二者共用并保留腿型说明'),
('si2-unbox','PDF-001',[1084,607,1254,730],'SI2.0 1.8米开箱桌及4凳','同类俯视图；普通和亮脚共用平面表达，桌腿差异由模型确认'),
('si2-cash-left','PDF-342',[750,414,920,475],'SI2.0 1.8米收银桌左款','左侧收银挡板，右侧操作垫，与已命名左款对应'),
('si2-cab3600','PDF-001',[984,527,1313,574],'SI2.0 3.6米配件柜','同规格外轮廓；不表达柜面陈列版本'),
('si2-cab2400','PDF-088',[398,578,457,852],'SI2.0 2.4米配件柜','同规格外轮廓，场景产品布局不在俯视图中表达'),
('si2-avbu2400','PDF-342',[623,503,671,723],'SI2.0 2.4米AVBU配件柜','原图明确AVBU；混合陈列型号仅作同外轮廓参考'),
('water-sign','PDF-342',[1074,1111,1130,1150],'电子水牌','同类落地屏平面符号，具体型号与高度仍以模型为准'),
('screen75','PDF-088',[1073,491,1270,535],'75寸横向广告机','原图明确75寸横向；不对应竖屏或其他尺寸'),
('screen86','PDF-001',[790,549,973,590],'86寸横向广告机','原图明确86寸横向；边框与嵌入墙条件属门店做法'),
('leica1200','PDF-088',[1339,814,1361,957],'1.2米徕卡墙平面位置','仅为墙面位置符号；对应组合模型中的1.2米部分，非完整组合轮廓'),
]
rows=[];hashes={}
for key,case,rect,label,note in specs:
 ref=refs[case];src=root/ref['source_pdf'];doc=fitz.open(src);page=doc[ref['page']-1]
 clip=fitz.Rect(rect[0]/1888*page.rect.width,rect[1]/1335*page.rect.height,rect[2]/1888*page.rect.width,rect[3]/1335*page.rect.height)
 p=dest/f'{key}.png';page.get_pixmap(matrix=fitz.Matrix(7,7),clip=clip,alpha=False).save(p)
 context=dest/f'{case}-p{ref["page"]}.jpg'
 if not context.exists():page.get_pixmap(matrix=fitz.Matrix(1.7,1.7),alpha=False).save(context)
 if str(src) not in hashes:hashes[str(src)]=hashlib.sha256(src.read_bytes()).hexdigest()
 rows.append({'id':key,'label':label,'file':p.relative_to(base).as_posix(),'context':context.relative_to(base).as_posix(),'source_pdf':ref['source_pdf'],'source_sha256':hashes[str(src)],'page':ref['page'],'crop_pdf_points':list(clip),'note':note,'status':'已核对的原图裁片'})
 doc.close()
(dest/'index.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),'utf-8')
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',18)
im=Image.new('RGB',(1500,((len(rows)+2)//3)*240),'#dddddd');d=ImageDraw.Draw(im)
for i,r in enumerate(rows):
 pic=Image.open(base/r['file']);pic.thumbnail((470,200));x=i%3*500;y=i//3*240;im.paste(pic,(x+(480-pic.width)//2,y));d.text((x+8,y+202),r['label'],fill='black',font=font)
im.save(work/'crop-check.jpg')
print('cropped',len(rows))
