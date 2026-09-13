"""Bake tight crops from original pixels before the HTML composition step."""
import argparse, bisect, json, math, subprocess
from pathlib import Path
import cv2
import numpy as np
p=argparse.ArgumentParser()
for name in ['video','plan','output','ffmpeg']:p.add_argument('--'+name,required=True)
a=p.parse_args();plan=json.loads(Path(a.plan).read_text(encoding='utf-8'))
cap=cv2.VideoCapture(a.video);fps=cap.get(cv2.CAP_PROP_FPS)
if not cap.isOpened() or fps<=0:raise RuntimeError('Cannot read source for chest-up framing')
cv2.setNumThreads(2)
segments=plan['segments'];starts=[];end=0
for s in segments:starts.append(end);end+=s['sourceEnd']-s['sourceStart']
log=Path(a.output).with_suffix('.log')
with log.open('wb') as errors:
 proc=subprocess.Popen([a.ffmpeg,'-y','-f','rawvideo','-pixel_format','bgr24','-video_size','1080x1920','-framerate','30','-i','-','-an','-c:v','libx264','-threads','2','-preset','veryfast','-crf','18','-g','30','-pix_fmt','yuv420p','-movflags','+faststart',a.output],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=errors)
 current=-1;frame=None
 try:
  for n in range(math.ceil(end*30)):
   t=min(n/30,end-1e-5);i=min(len(segments)-1,bisect.bisect_right(starts,t)-1);s=segments[i];local=t-starts[i]
   target=int((s['sourceStart']+local)*fps)
   if target<current or target-current>fps*2:cap.set(cv2.CAP_PROP_POS_FRAMES,target);current=target-1
   while current<target:
    ok,frame=cap.read();current+=1
    if not ok:raise RuntimeError(f'Source ended before output frame {n}')
   h,w=frame.shape[:2];keys=s.get('keyframes')
   if keys:
    k=min(len(keys)-1,bisect.bisect_right([f['time'] for f in keys],local)-1);left=keys[max(0,k)];right=keys[min(k+1,len(keys)-1)]
    mix=max(0,min(1,(local-left['time'])/max(1e-8,right['time']-left['time'])))
    f={name:left[name]+(right[name]-left[name])*mix for name in ['x','y','scale','width','height']}
    x=-f['x']/(f['width']*f['scale'])*w;y=-f['y']/(f['height']*f['scale'])*h
    cw=1080/(f['width']*f['scale'])*w;ch=1920/(f['height']*f['scale'])*h
   else:
    cover=max(1080/w,1920/h)*s.get('zoom',1);cw=1080/cover;ch=1920/cover;x=(w-cw)/2;y=(h-ch)/2
   x=max(0,min(w-cw,x));y=max(0,min(h-ch,y))
   matrix=np.float32([[1080/cw,0,-x*1080/cw],[0,1920/ch,-y*1920/ch]])
   output=cv2.warpAffine(frame,matrix,(1080,1920),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REPLICATE)
   proc.stdin.write(output.tobytes())
  proc.stdin.close()
  if proc.wait()!=0:raise RuntimeError('Crop encoder failed; see '+str(log))
 except BaseException:
  proc.kill();proc.wait();raise
 finally:cap.release()
print('Chest-up frames rendered from original source pixels')
