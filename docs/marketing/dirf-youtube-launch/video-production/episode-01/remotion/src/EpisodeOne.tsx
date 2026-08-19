import React from 'react';
import {Series} from 'remotion';
import {palette} from './campaign';
import {Scene, type SceneSpec} from './Scene';

const blue=(x:string)=><span style={{color:palette.blue}}>{x}</span>;
const green=(x:string)=><span style={{color:palette.green}}>{x}</span>;
const amber=(x:string)=><span style={{color:palette.amber}}>{x}</span>;

const scenes:{frames:number;spec:SceneSpec}[]=[
  {frames:1050,spec:{index:'01',label:'DIRF / EPISODE 01',kind:'handoff',title:<>Your agent did not forget the code.<br/>{blue('It forgot the agreement.')}</>,body:'If the answer is buried in 200 messages, you do not have a handoff. You have an archaeological site.'}},
  {frames:3150,spec:{index:'02',label:'FAILURE MODE 01',kind:'route',title:<>The wrong skill can be worse than {amber('no skill.')}</>,body:'DIRF selects a small workflow from the capabilities actually available now.'}},
  {frames:2850,spec:{index:'03',label:'FAILURE MODE 02',kind:'drift',title:<>A giant context window is still {blue('not continuity.')}</>,body:'One repository-keyed handoff remains stable across sessions and worktrees.'}},
  {frames:1950,spec:{index:'04',label:'FAILURE MODE 03',kind:'evidence',title:<>Done is not a {green('feeling.')}</>,body:'Different claims require different receipts.'}},
  {frames:2700,spec:{index:'05',label:'THE DIRF MODEL',kind:'model',title:<>{blue('Route.')} Record.<br/>{green('Finish line.')}</>,body:'A deliberately small operating layer for the agent stack you already have.'}},
  {frames:1800,spec:{index:'06',label:'HONEST BOUNDARIES',kind:'limits',title:<>DIRF owns the route.<br/>{amber('Authority stays human.')}</>,body:'Useful software has edges, and DIRF names them.'}},
  {frames:900,spec:{index:'07',label:'YOUR NEXT ACTION',kind:'cta',title:<>Keep your agent stack.<br/>Give it a {blue('route')}, a {green('record')}, and a finish line.</>,body:'Route before you build.'}},
];

export const EpisodeOne:React.FC=()=> <Series>{scenes.map(({frames,spec})=><Series.Sequence key={spec.index} durationInFrames={frames} name={spec.label}><Scene spec={spec}/></Series.Sequence>)}</Series>;
