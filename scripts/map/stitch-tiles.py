# -*- coding: utf-8 -*-
"""4분면 타일(겹침 크롭 816x544 → 1536x1024 생성본)을 2배 세계 지도 3072x2048 로 이어 붙인다.
겹침 띠 안에서 두 타일 차이 + 비바다 비용이 최소인 이음선(DP seam)을 골라 자른다. 이어서 바다 분류 → 항해 마스크(침식) 생성."""
import sys, json
import numpy as np
from PIL import Image, ImageFilter
import os
R=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","..","assets")
G=R+'/_gen'; OUT=R+'/img'
SRC_BOX={'nw':(0,0),'ne':(720,0),'sw':(0,480),'se':(720,480)}  # 원본 1536 기준 오프셋, 크롭 816x544
W,H=3072,2048
def tile(k):
    im=Image.open(f'{G}/tile-{k}.png').convert('RGB').resize((1632,1088),Image.LANCZOS)  # 816*2 x 544*2
    return np.asarray(im).astype(np.float32)
def sea_mask(a):  # 밝은 파란 바다: B 높고 R 낮음
    r,g,b=a[...,0],a[...,1],a[...,2]
    return (b>140)&(r<130)&(b>g+10)
def vseam(left,right,x0,w):  # 가로 겹침 띠(폭 w)에서 세로 이음선: 각 행마다 x 선택, 인접 행 ±1
    a=left[:,x0:x0+w]; b=right[:,x0:x0+w]
    diff=np.abs(a-b).sum(-1); cost=diff+(~(sea_mask(a)&sea_mask(b)))*300.0
    h=cost.shape[0]; dp=cost.copy(); back=np.zeros_like(dp,dtype=np.int32)
    for y in range(1,h):
        prev=dp[y-1]; cand=np.stack([np.r_[np.inf,prev[:-1]],prev,np.r_[prev[1:],np.inf]])
        k=cand.argmin(0); dp[y]+=cand[k,np.arange(w)]; back[y]=k-1
    x=int(dp[-1].argmin()); seam=np.zeros(h,dtype=np.int32)
    for y in range(h-1,-1,-1): seam[y]=x; x+=back[y,x] if y>0 else 0
    return seam
def hseam(top,bot,y0,h):
    return vseam(top.transpose(1,0,2),bot.transpose(1,0,2),y0,h)  # 전치해서 같은 함수
T={k:tile(k) for k in SRC_BOX}
canvas=np.zeros((H,W,3),np.float32); 
# 1) 위 행: nw(0..1632) + ne(1440..3072), 겹침 x 1440..1632 (192)
top=np.zeros((1088,W,3),np.float32); top[:,:1632]=T['nw']; top[:,1440:]=T['ne']
L=np.zeros_like(top); L[:,:1632]=T['nw']; Rr=np.zeros_like(top); Rr[:,1440:]=T['ne']
s=vseam(L,Rr,1440,192)
for y in range(1088):
    xs=1440+s[y]; top[y,:xs]=L[y,:xs]; top[y,xs:]=Rr[y,xs:]
bot=np.zeros((1088,W,3),np.float32); L=np.zeros_like(bot); L[:,:1632]=T['sw']; Rr=np.zeros_like(bot); Rr[:,1440:]=T['se']
s=vseam(L,Rr,1440,192)
for y in range(1088):
    xs=1440+s[y]; bot[y,:xs]=L[y,:xs]; bot[y,xs:]=Rr[y,xs:]
# 2) 위/아래: 겹침 y 960..1088 (128)
Tt=np.zeros((H,W,3),np.float32); Tt[:1088]=top; Bb=np.zeros((H,W,3),np.float32); Bb[960:]=bot
s=hseam(Tt,Bb,960,128)
for x in range(W):
    ys=960+s[x]; canvas[:ys,x]=Tt[:ys,x]; canvas[ys:,x]=Bb[ys:,x]
img=Image.fromarray(canvas.clip(0,255).astype(np.uint8)); img.save(f'{G}/bg-worldmap-2x.png'); print('bg', img.size)
# 3) 항해 마스크: 바다 분류 → 작은 구멍 메움 → 큰 바다만(flood) → 육지 침식 여유(선체·해안 소품) 12px
sea=sea_mask(canvas)
m=Image.fromarray((sea*255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))  # 바다 안 잡티 제거
sea=np.asarray(m)>127
land=~sea
# 침식: 육지를 12px 팽창(= 바다 12px 침식)
dil=np.asarray(Image.fromarray((land*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(25)))>127
nav_land=dil
Image.fromarray((nav_land*255).astype(np.uint8)).save(f'{G}/mask-worldmap-2x.png')
Image.fromarray((land*255).astype(np.uint8)).save(f'{G}/mask-visual-2x.png')
print('land ratio visual %.3f nav %.3f'%(land.mean(),nav_land.mean()))
