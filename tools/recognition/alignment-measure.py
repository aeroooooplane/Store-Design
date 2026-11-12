"""像素贴线诊断，不读取金标准；墨线近邻距离不能代替语义正确性。"""
import argparse,json,math
from pathlib import Path
import numpy as np
from PIL import Image

def segment(a,b):
 n=max(1,math.ceil(math.dist(a,b)/2))
 return [[a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n] for i in range(n)]
def ring(points,closed=True):
 return [p for a,b in zip(points,points[1:]+(points[:1] if closed else [])) for p in segment(a,b)]
def samples(g):
 if g['type']=='polygon':return ring(g['points'])+[p for hole in g.get('holes',[]) for p in ring(hole)]
 if g['type']=='polyline':return ring(g['points'],False)
 if g['type'] in ('rect','roundedRect'):
  x,y,w,h,r=g['x'],g['y'],g['width'],g['height'],g.get('radius',0)
  if r==0:return ring([[x,y],[x+w,y],[x+w,y+h],[x,y+h]])
  p=[]
  for cx,cy,start in [(x+w-r,y+r,-90),(x+w-r,y+h-r,0),(x+r,y+h-r,90),(x+r,y+r,180)]:
   for d in np.linspace(start,start+90,9):p.append([cx+r*math.cos(math.radians(d)),cy+r*math.sin(math.radians(d))])
  return ring(p)
 if g['type']=='arc':
  return [[g['cx']+g['radius']*math.cos(math.radians(d)),g['cy']+g['radius']*math.sin(math.radians(d))] for d in np.linspace(g['start'],g['end'],100)]
 raise ValueError('未知几何')

def distances(ink,points,limit=50):
 result=[];h,w=ink.shape
 for x,y in points:
  ix,iy=int(round(x)),int(round(y));x1=max(0,ix-limit);x2=min(w,ix+limit+1);y1=max(0,iy-limit);y2=min(h,iy+limit+1)
  ys,xs=np.where(ink[y1:y2,x1:x2])
  result.append(min(float(limit),float(np.sqrt(np.min((xs+x1-x)**2+(ys+y1-y)**2)))) if len(xs) else float(limit))
 return result

def stats(d):
 return {'sampleCount':len(d),'medianPx':round(float(np.median(d)),3),'p95Px':round(float(np.quantile(d,.95)),3),'maxPx':round(max(d),3),'within2PxFraction':round(float(np.mean(np.array(d)<=2)),4)}

def main(c):
 data=json.loads(Path(c.annotation).read_text(encoding='utf-8'));raw=json.loads(Path(c.raw).read_text(encoding='utf-8'));ink=np.asarray(Image.open(c.image).convert('L'))<200
 allpoints=[];per=[]
 for f in data['features']:
  if f.get('alignmentMeasure',True) is False:continue
  d=distances(ink,samples(f['geometry']));allpoints+=d;per.append({'id':f['id'],'label':f['label'],**stats(d)})
 before=distances(ink,ring(raw['polygons'][0]['points']))
 dims=[{**d,'pixels':math.dist(d['a'],d['b']),'relativeError':abs(math.dist(d['a'],d['b'])*data['mmPerPixel']/d['mm']-1)} for d in data['dimensions']]
 result={'metric':'距原图灰度小于200墨线的最近距离；每约2px采样，半径50px封顶','notGoldScore':True,'limitations':['文字和填充墨迹也可能成为近邻，因此这不是完整识别精度或IoU。','边界虚拟闭合、入口投影和参考线不计入校正贴线统计。','尺寸复核由同一代理读取原图，不冒充独立标注人员复核。'],'automaticMainContour':stats(before),'correctedVisibleObjects':stats(allpoints),'objects':per,'dimensions':dims}
 Path(c.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'automatic':result['automaticMainContour'],'corrected':result['correctedVisibleObjects'],'over2px':[x['id'] for x in per if x['p95Px']>2]},ensure_ascii=False))
if __name__=='__main__':
 p=argparse.ArgumentParser()
 for name in ['annotation','raw','image','output']:p.add_argument('--'+name,required=True)
 main(p.parse_args())
