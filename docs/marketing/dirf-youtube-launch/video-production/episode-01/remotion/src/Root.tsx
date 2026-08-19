import React from 'react';
import {Composition,Folder} from 'remotion';
import {EpisodeOne} from './EpisodeOne';
import {Short} from './Short';
import {shorts} from './campaign';

export const Root:React.FC=()=> <>
  <Composition id="DIRF-Episode-01" component={EpisodeOne} durationInFrames={14400} fps={30} width={1920} height={1080}/>
  <Folder name="Episode-01-Shorts">{shorts.map((s)=><Composition key={s.id} id={s.id} component={Short} defaultProps={s} durationInFrames={840} fps={30} width={1080} height={1920}/>)}</Folder>
</>;
