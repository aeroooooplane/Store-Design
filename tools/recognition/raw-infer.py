"""只从输入位图生成本地候选，不读取门店标签、描点或尺寸答案。"""
import argparse, hashlib, json, math, sys, time
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'recognition-training'))
from drawing_input import normalize_polarity

def area(points):
    return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points,points[1:]+points[:1]))/2

def rings(mask):
    """沿像素外边走，不取凸包，也不静默只保留最大块。"""
    h,w=mask.shape; edges={}
    def add(a,b): edges.setdefault(a,[]).append(b)
    for y,x in zip(*np.where(mask)):
        x,y=int(x),int(y)
        if y==0 or not mask[y-1,x]:add((x,y),(x+1,y))
        if x==w-1 or not mask[y,x+1]:add((x+1,y),(x+1,y+1))
        if y==h-1 or not mask[y+1,x]:add((x+1,y+1),(x,y+1))
        if x==0 or not mask[y,x-1]:add((x,y+1),(x,y))
    result=[]; directions={(1,0):0,(0,1):1,(-1,0):2,(0,-1):3}
    while edges:
        start=next(iter(edges));current=start;prev=0;ring=[]
        for _ in range(4*w*h+1):
            ring.append(current);options=edges[current]
            def priority(b):
                d=directions[(b[0]-current[0],b[1]-current[1])]
                return [1,0,3,2].index((d-prev)%4)
            nxt=min(options,key=priority);options.remove(nxt)
            if not options:del edges[current]
            prev=directions[(nxt[0]-current[0],nxt[1]-current[1])];current=nxt
            if current==start:break
        else:raise ValueError('轮廓追踪未闭合')
        result.append(ring)
    return result

def rdp(points,tolerance):
    if len(points)<3:return points
    a,b=np.array(points[0]),np.array(points[-1]);v=b-a;length=float(v@v)
    distances=[]
    for p in points[1:-1]:
        t=max(0,min(1,float((np.array(p)-a)@v)/length)) if length else 0
        distances.append(float(np.linalg.norm(np.array(p)-(a+t*v))))
    k=int(np.argmax(distances))+1
    if distances[k-1]<=tolerance:return [points[0],points[-1]]
    return rdp(points[:k+1],tolerance)[:-1]+rdp(points[k:],tolerance)

def simplify(ring):
    # 固定1个模型像素误差；闭环分成两段，避免首尾重合破坏RDP。
    k=max(range(1,len(ring)),key=lambda i:math.dist(ring[0],ring[i]))
    p=rdp(ring[:k+1],1)[:-1]+rdp(ring[k:]+ring[:1],1)[:-1]
    return p if len(p)>=3 else ring

def raster_lines(gray):
    """仅找轴向墨线供尺寸链尝试；不是墙/家具判定。"""
    ink=np.asarray(gray)<160; result=[]
    for vertical,arr in [(False,ink),(True,ink.T)]:
        groups={}
        for y,row in enumerate(arr):
            changes=np.diff(np.pad(row.astype(np.int8),(1,1)))
            for a,b in zip(np.where(changes==1)[0],np.where(changes==-1)[0]):
                if b-a<24:continue
                key=(round(int(a)/3),round(int(b)/3));last=groups.get(key)
                if last and y-last[1]<=2:last[1]=y
                else:
                    last=[y,y,int(a),int(b)];groups[key]=last;result.append((vertical,last))
    lines=[]
    for vertical,(lo,hi,a,b) in result:
        at=(lo+hi)/2
        # 很粗的填充块不当作尺寸线。
        if hi-lo>8:continue
        lines.append(dict(x1=at if vertical else a,y1=a if vertical else at,x2=at if vertical else b,y2=b if vertical else at,w=hi-lo+1,color='#000000'))
    if len(lines)>60000:raise ValueError('轴线过多，阻断而非截断输入')
    return lines

def opaque_image(im):
    # 透明PNG统一铺白，避免透明背景变成实心黑块。
    rgba=im.convert('RGBA')
    background=Image.new('RGBA',rgba.size,'white')
    return Image.alpha_composite(background,rgba).convert('RGB')

def infer(image,model,out):
    import onnxruntime as ort
    out=Path(out);out.mkdir(exist_ok=False)
    started=time.perf_counter();source=Path(image).read_bytes();im=Image.open(image)
    if max(im.size)>4000 or im.width*im.height>12000000:raise ValueError('图片过大，请先缩至长边4000像素以内')
    im=opaque_image(im);gray,inverted=normalize_polarity(im)
    side=256;k=side/max(gray.size);w=max(1,round(gray.width*k));h=max(1,round(gray.height*k));left=(side-w)//2;top=(side-h)//2
    canvas=Image.new('L',(side,side),255);canvas.paste(gray.resize((w,h),Image.Resampling.BILINEAR),(left,top))
    tensor=(1-np.asarray(canvas,dtype=np.float32)/255)[None,None]
    options=ort.SessionOptions();options.intra_op_num_threads=4;session=ort.InferenceSession(str(model),sess_options=options,providers=['CPUExecutionProvider'])
    logits=session.run(None,{session.get_inputs()[0].name:tensor})[0].squeeze();prob=1/(1+np.exp(-np.clip(logits,-80,80)));mask=prob>=.5
    # 清掉letterbox填充；原始概率仍完整保留。
    mask[:top]=False;mask[top+h:]=False;mask[:,:left]=False;mask[:,left+w:]=False
    np.save(out/'probability.npy',prob);Image.fromarray(mask.astype(np.uint8)*255).save(out/'mask.png')
    found=rings(mask);outer=[p for p in found if area(p)>0];holes=[p for p in found if area(p)<0];polygons=[];small=0
    for p in outer:
        if area(p)<4:small+=1;continue
        points=simplify(p)
        polygons.append({'modelAreaPx':area(p),'points':[[round((x-left)*im.width/w,3),round((y-top)*im.height/h,3)] for x,y in points]})
    polygons.sort(key=lambda p:-p['modelAreaPx'])
    result={'schemaVersion':1,'inputSha256':hashlib.sha256(source).hexdigest(),'modelSha256':hashlib.sha256(Path(model).read_bytes()).hexdigest(),'engine':'local-onnx-20261109','width':im.width,'height':im.height,'threshold':.5,'inverted':inverted,'polygons':polygons,'discardedTinyComponents':small,'holeCount':len(holes),'holes':[[[round((x-left)*im.width/w,3),round((y-top)*im.height/h,3)] for x,y in p] for p in holes],'lines':raster_lines(gray),'scale':None,'entrances':None,'obstacles':None,'ceilingHeight':None,'furniture':None,'labelsRead':False,'cloudRequests':0,'seconds':time.perf_counter()-started}
    (out/'raw.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8');im.save(out/'input.png');gray.save(out/'ocr-input.png')
    return result

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--image',required=True);a.add_argument('--model',required=True);a.add_argument('--out',required=True);c=a.parse_args();r=infer(c.image,c.model,c.out);print(json.dumps({'polygons':len(r['polygons']),'lines':len(r['lines']),'seconds':r['seconds']}))
