import React from 'react';
import {AbsoluteFill,Easing,Img,interpolate,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
import {palette,type ShortData} from './campaign';

export const Short:React.FC<ShortData>=({episode,hook,relate,proof,cta})=>{const frame=useCurrentFrame();const {fps,durationInFrames}=useVideoConfig();const rise=(a:number,b:number)=>({opacity:interpolate(frame,[a*fps,b*fps],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),translate:interpolate(frame,[a*fps,b*fps],['0px 80px','0px 0px'],{easing:Easing.bezier(.16,1,.3,1),extrapolateLeft:'clamp',extrapolateRight:'clamp'})});return <AbsoluteFill style={{backgroundColor:palette.bg,color:palette.fg,overflow:'hidden'}}>
  <Img src={staticFile('assets/context-archaeology-portrait.png')} style={{position:'absolute',inset:-60,width:1200,height:2040,objectFit:'cover',opacity:.4,scale:interpolate(frame,[0,durationInFrames-1],[1.03,1.1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',output:'perceptual-scale'})}}/>
  <AbsoluteFill style={{background:'linear-gradient(to bottom,rgba(6,16,30,.25),rgba(6,16,30,.86) 60%,rgba(6,16,30,.98))'}}/>
  <div style={{position:'absolute',top:92,left:72,right:72,display:'flex',justifyContent:'space-between',font:'700 25px Courier New',letterSpacing:2,color:palette.muted}}><b style={{color:palette.blue}}>{episode}</b><span>DIRF</span></div>
  <div style={{position:'absolute',left:72,right:72,top:250,font:'900 90px/.97 Arial',letterSpacing:-5,...rise(.2,1.1)}}>{hook}</div>
  <div style={{position:'absolute',left:72,right:72,top:830,font:'38px/1.28 Georgia',color:palette.muted,...rise(1.6,2.35)}}>{relate}</div>
  <div style={{position:'absolute',left:72,right:72,top:1120,display:'grid',gap:22}}>{proof.map((x,i)=><div key={x} style={{padding:'30px 32px',border:`2px solid ${i===2?palette.green:'rgba(155,176,201,.28)'}`,borderRadius:22,background:'rgba(11,27,48,.94)',font:'900 34px Arial',...rise(3.4+i*.25,4.1+i*.25)}}>{i===2?'✓':`0${i+1}`}　{x}</div>)}</div>
  <div style={{position:'absolute',left:72,right:72,bottom:96,paddingTop:30,borderTop:`5px solid ${palette.blue}`,display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:30,...rise(8.8,9.6)}}><b style={{font:'900 38px/1.12 Arial',maxWidth:650}}>{cta}</b><span style={{font:'700 24px Courier New',color:palette.muted,textAlign:'right'}}>FULL WALKTHROUGH<br/>EPISODE 01</span></div>
  </AbsoluteFill>};
