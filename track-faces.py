"""Local face tracks for crop animation. No network, identification, or recognition."""
import argparse, json, math
from pathlib import Path
import cv2
import numpy as np

parser=argparse.ArgumentParser()
parser.add_argument('--video',required=True)
parser.add_argument('--output',required=True)
args=parser.parse_args()
cap=cv2.VideoCapture(args.video)
fps=cap.get(cv2.CAP_PROP_FPS)
if not cap.isOpened() or fps <= 0: raise RuntimeError('Cannot read tracking video')
width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
detector=cv2.FaceDetectorYN.create(str(Path(__file__).with_name('face_detection_yunet_2023mar.onnx')), '', (width,height), 0.75, 0.3, 5000)
frames=[]; previous={}; next_id=1; index=0
while True:
    ok, frame=cap.read()
    if not ok: break
    _,detections=detector.detect(frame)
    faces=[]; used=set(); current={}
    for face in ([] if detections is None else sorted(detections,key=lambda f:float(f[2]*f[3]),reverse=True)):
        x,y,w,h=map(float,face[:4]); cx=(x+w/2)/width; cy=(y+h/2)/height
        candidates=[(math.hypot(cx-p['x'],cy-p['y']),ident) for ident,p in previous.items() if ident not in used and index-p['frame'] <= fps*1.5 and 0.45 < (w*h)/(p['area']+1e-6) < 2.2]
        distance,ident=min(candidates,default=(1,None))
        if distance > max(0.08,w/width): ident=next_id; next_id+=1
        used.add(ident)
        # Mouth patch motion is only an automatic focus heuristic, not speaker identity.
        mx=(float(face[10])+float(face[12]))/2; my=(float(face[11])+float(face[13]))/2
        left=max(0,int(mx-w*.25)); right=min(width,int(mx+w*.25)); top=max(0,int(my-h*.12)); bottom=min(height,int(my+h*.16))
        patch=frame[top:bottom,left:right]
        motion=0.0; gray=None
        if patch.size:
            gray=cv2.resize(cv2.cvtColor(patch,cv2.COLOR_BGR2GRAY),(32,20)).astype(float)
            gray=(gray-gray.mean())/(gray.std()+10)
            old=previous.get(ident,{}).get('patch')
            if old is not None: motion=float(np.abs(gray-old).mean())
        prior=previous.get(ident,{})
        energy=.6*prior.get('motion',0)+.4*motion
        current[ident]={'x':cx,'y':cy,'area':w*h,'patch':gray,'frame':index,'motion':energy}
        faces.append({'id':ident,'x':round(cx,5),'y':round(cy,5),'w':round(w/width,5),'h':round(h/height,5),'motion':round(energy,5)})
    previous={**{k:v for k,v in previous.items() if index-v['frame']<fps*1.5},**current}
    frames.append({'time':round(index/fps,4),'faces':faces}); index+=1
cap.release()
Path(args.output).write_text(json.dumps({'width':width,'height':height,'fps':fps,'frames':frames}),encoding='utf-8')
print(f'Tracked {next_id-1} face tracks across {len(frames)} frames')
