import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {palette} from './campaign';

export type SceneSpec = {index:string; label:string; title:React.ReactNode; body:string; kind:'handoff'|'route'|'drift'|'evidence'|'model'|'limits'|'cta'};

const panel: React.CSSProperties = {background:'rgba(11,27,48,.92)',border:'2px solid rgba(155,176,201,.28)',borderRadius:22,boxShadow:'0 28px 90px rgba(0,0,0,.34)'};

export const Scene: React.FC<{spec:SceneSpec}> = ({spec}) => {
  const frame=useCurrentFrame(); const {fps,durationInFrames}=useVideoConfig();
  return <AbsoluteFill style={{backgroundColor:palette.bg,color:palette.fg,overflow:'hidden',fontFamily:'Georgia, serif'}}>
    <Img src={staticFile('assets/context-archaeology-landscape.png')} style={{position:'absolute',inset:-60,width:2040,height:1200,objectFit:'cover',opacity:.42,scale:interpolate(frame,[0,durationInFrames-1],[1.04,1.12],{extrapolateLeft:'clamp',extrapolateRight:'clamp',output:'perceptual-scale'})}}/>
    <AbsoluteFill style={{background:'radial-gradient(circle at 76% 44%,rgba(79,140,255,.17),transparent 30%),rgba(6,16,30,.42)'}}/>
    <AbsoluteFill style={{opacity:.18,backgroundImage:'linear-gradient(rgba(155,176,201,.28) 2px,transparent 2px),linear-gradient(90deg,rgba(155,176,201,.28) 2px,transparent 2px)',backgroundSize:'96px 96px'}}/>
    <div style={{position:'absolute',top:58,left:76,right:76,display:'flex',justifyContent:'space-between',fontFamily:'Courier New, monospace',fontWeight:700,fontSize:21,letterSpacing:3,color:palette.muted}}><b style={{color:palette.blue}}>{spec.label}</b><span>{spec.index} / 07</span></div>
    <div style={{position:'absolute',left:100,top:150,width:spec.kind==='cta'?1480:1120,opacity:interpolate(frame,[.2*fps,1.1*fps],[0,1],{easing:Easing.bezier(.16,1,.3,1),extrapolateLeft:'clamp',extrapolateRight:'clamp'}),translate:interpolate(frame,[.2*fps,1.1*fps],['-110px 0px','0px 0px'],{easing:Easing.bezier(.16,1,.3,1),extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}>
      <div style={{fontFamily:'Arial, sans-serif',fontWeight:900,fontSize:spec.kind==='cta'?112:132,lineHeight:.93,letterSpacing:-6}}>{spec.title}</div>
      <div style={{marginTop:38,maxWidth:950,fontSize:36,lineHeight:1.28,color:palette.muted}}>{spec.body}</div>
    </div>
    <ProofWorld kind={spec.kind} frame={frame} fps={fps}/>
  </AbsoluteFill>;
};

const ProofWorld:React.FC<{kind:SceneSpec['kind'];frame:number;fps:number}>=({kind,frame,fps})=>{
  const enter=(offset:number)=>({opacity:interpolate(frame,[(1.5+offset)*fps,(2.2+offset)*fps],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}),translate:interpolate(frame,[(1.5+offset)*fps,(2.2+offset)*fps],['90px 0px','0px 0px'],{easing:Easing.bezier(.16,1,.3,1),extrapolateLeft:'clamp',extrapolateRight:'clamp'})});
  if(kind==='handoff') return <div style={{...panel,position:'absolute',right:100,top:250,width:610,padding:34,...enter(.2)}}><h3 style={{font:'900 38px Arial',margin:'0 0 28px'}}>CANONICAL HANDOFF</h3>{['OBJECTIVE','EVIDENCE','NEXT ACTION'].map((x,i)=><div key={x} style={{display:'grid',gridTemplateColumns:'170px 1fr',padding:'20px 0',borderTop:'2px solid rgba(155,176,201,.18)',font:'700 23px Courier New'}}><span style={{color:palette.blue}}>{x}</span><b>{['One current agreement','What actually passed','One exact move'][i]}</b></div>)}</div>;
  if(kind==='route') return <div style={{position:'absolute',right:110,top:220,width:680,display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}}>{['CODE REVIEW','UI DESIGN','SECURITY','SEO','TEST VERIFICATION','COPYWRITING'].map((x,i)=><div key={x} style={{...panel,padding:22,textAlign:'center',font:'700 22px Courier New',color:[0,2,4].includes(i)?palette.fg:palette.muted,borderColor:[0,2,4].includes(i)?palette.blue:'rgba(155,176,201,.25)',...enter(i*.08)}}>{x}</div>)}</div>;
  if(kind==='drift') return <div style={{position:'absolute',left:100,right:100,bottom:120,display:'grid',gridTemplateColumns:'1fr 360px 1fr',gap:28}}>{['WORKTREE / A','ONE HANDOFF','WORKTREE / B'].map((x,i)=><div key={x} style={{...panel,padding:34,minHeight:280,textAlign:i===1?'center':'left',borderColor:i===1?palette.blue:'rgba(155,176,201,.25)',...enter(i*.16)}}><b style={{font:'900 36px Arial',color:i===1?palette.blue:palette.fg}}>{x}</b><p style={{font:'700 22px Courier New',color:palette.muted,lineHeight:1.5}}>{i===1?'Canonical project state takes precedence.':'Objective • evidence • next action'}</p></div>)}</div>;
  if(kind==='evidence') return <div style={{position:'absolute',right:105,top:190,width:800,display:'grid',gap:24}}>{['Focused test — EVIDENCED','Pull request merged — NOT PROVEN','Production verified — NOT PROVEN'].map((x,i)=><div key={x} style={{...panel,padding:32,font:'900 31px Arial',borderColor:i===0?palette.green:'rgba(155,176,201,.25)',color:i===0?palette.green:palette.fg,...enter(i*.18)}}>{x}</div>)}</div>;
  if(kind==='model') return <div style={{position:'absolute',left:100,right:100,bottom:150,display:'grid',gridTemplateColumns:'1fr 1.15fr 1fr',gap:28}}>{['ROUTE','RECORD','FINISH LINE'].map((x,i)=><div key={x} style={{...panel,padding:38,minHeight:300,borderColor:i===1?palette.blue:'rgba(155,176,201,.25)',...enter(i*.18)}}><b style={{font:'900 48px Arial'}}>{x}</b><p style={{fontSize:27,lineHeight:1.3,color:palette.muted}}>{['Select the right workflow.','Preserve the current truth.','Require checkable proof.'][i]}</p></div>)}</div>;
  if(kind==='limits') return <div style={{position:'absolute',left:100,right:100,bottom:120,display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}}>{['No live-agent theater','No issue-tracker claim','No automatic authority','No magical portability'].map((x,i)=><div key={x} style={{...panel,padding:30,font:'900 31px Arial',borderLeft:`8px solid ${palette.amber}`,...enter(i*.12)}}>{x}</div>)}</div>;
  return <div style={{...panel,position:'absolute',left:105,right:105,top:660,padding:'38px 44px',borderColor:palette.blue,font:'700 31px Courier New',...enter(.1)}}><span style={{color:palette.green}}>$</span> dirf flow &quot;&lt;your real task&gt;&quot; --path &lt;project&gt;</div>;
};
