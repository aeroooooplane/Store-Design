from pathlib import Path
import fitz,json,hashlib
from PIL import Image,ImageDraw,ImageFont
r=Path(r'E:\效果图生成器\Store-Design');b=r/'资源库/04_软装道具模型/单件模型';out=b/'平面图例';rows=json.loads((out/'index.json').read_text('utf-8'))
specs=[
('si1-stool','上海五角场万达授权体验店.pdf',1,[633,352,672,388],[1263,893],'培训坐凳（单凳图例）','原图单个450方凳；模型为4件组合且高350变体，不作为组合占地'),
('si2-stool','深圳卓悦中心.pdf',13,[1033,613,1121,691],[1787,1263],'字母凳（4件图例）','原图文字为子母凳4个；对应标准字母凳用途，模型排布方向不同'),
('flight','佛山禅西环宇城授权体验店.pdf',6,[939,357,1000,430],[1888,1335],'圆形试飞台','同类圆形图例；原图H600+320，模型总高921。文件名佛山而图签广州，保留该来源冲突'),
('si1-cab1600','上海万象城授权体验店（边厅）.pdf',7,[630,487,695,646],[1787,1263],'1.6米配件柜','原图明确1600与H2400，同规格平面外轮廓'),
('screen98','上海五角场万达授权体验店.pdf',1,[563,247,739,279],[1263,893],'98寸横向广告机','原图标注98寸横向，门店嵌入条件随原图保留'),
('screen55v','青岛城阳万象汇授权体验店.pdf',6,[251,405,329,487],[1787,1263],'55寸竖向广告机','同方向同尺寸图例，文字及靠墙关系保留'),
('screen65','昆山商厦家电市场照材专卖店（扩店）.pdf',10,[518,490,698,557],[1888,1335],'65寸横向广告机','原图标注原有设备，同规格平面参考'),
('edge-accessory','青岛城阳万象汇授权体验店.pdf',6,[1118,425,1342,520],[1787,1263],'带托盘配件边柜','同用途俯视图；平面不区分SI配色及柜门立面，不作为SI版本证据'),
('edge-cash','青岛城阳万象汇授权体验店.pdf',6,[681,425,904,520],[1787,1263],'收银边桌储物柜','同用途平面位置参考；此图简化了电脑与操作垫，与模型台面细节不同'),
('screen75v','乌鲁木齐德汇万达（边厅改中岛）.pdf',8,[1342,358,1537,503],[1787,1263],'75寸竖向广告机','原图明确75寸竖向，保留引线和标注'),
]
# Fix clipped Leica label on the initial crop.
for row in rows:
 if row['id']=='leica1200':
  d=fitz.open(r/row['source_pdf']);p=d[row['page']-1];rect=[1317,814,1362,957];clip=fitz.Rect(rect[0]/1888*p.rect.width,rect[1]/1335*p.rect.height,rect[2]/1888*p.rect.width,rect[3]/1335*p.rect.height);p.get_pixmap(matrix=fitz.Matrix(7,7),clip=clip).save(b/row['file']);row['crop_pdf_points']=list(clip)
for key,name,n,xy,size,label,note in specs:
 src=r/'各门店图纸'/name;d=fitz.open(src);p=d[n-1];clip=fitz.Rect(xy[0]/size[0]*p.rect.width,xy[1]/size[1]*p.rect.height,xy[2]/size[0]*p.rect.width,xy[3]/size[1]*p.rect.height)
 f=out/f'{key}.png';p.get_pixmap(matrix=fitz.Matrix(7,7),clip=clip).save(f);ctx=out/f'{key}-source-p{n}.jpg';p.get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(ctx)
 rows.append({'id':key,'label':label,'file':f.relative_to(b).as_posix(),'context':ctx.relative_to(b).as_posix(),'source_pdf':'各门店图纸/'+name,'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'page':n,'crop_pdf_points':list(clip),'note':note,'status':'已核对的原图裁片'})
(out/'index.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),'utf-8')
im=Image.new('RGB',(1500,960),'#ddd');draw=ImageDraw.Draw(im);font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',16)
for i,row in enumerate(rows[-10:]):
 pic=Image.open(b/row['file']);pic.thumbnail((480,195));x=i%3*500;y=i//3*240;im.paste(pic,(x+(480-pic.width)//2,y));draw.text((x+5,y+202),row['label'],font=font,fill='black')
im.save(r/'tmp/plan-legends/extra-check.jpg');print(len(rows))
