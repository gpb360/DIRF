export const palette = {
  bg: '#06101e', surface: '#0b1b30', fg: '#e8f1ff', muted: '#9bb0c9',
  blue: '#4f8cff', green: '#5ee2ad', amber: '#f6b94b', danger: '#ff6f7d',
};

export type ShortData = {
  id: string; episode: string; hook: string; relate: string;
  proof: [string, string, string]; cta: string;
};

export const shorts: ShortData[] = [
  {id:'DIRF-Short-01-Agreement',episode:'EP 01 / SHORT 01',hook:'Your agent did not forget the code. It forgot the agreement.',relate:'A fresh session can see the repository and still miss what changed, what passed, and what happens next.',proof:['STALE CHAT','CANONICAL HANDOFF','ONE CURRENT AGREEMENT'],cta:'Watch the context-loss walkthrough'},
  {id:'DIRF-Short-02-Evidence',episode:'EP 01 / SHORT 02',hook:'Done is not a feeling.',relate:'A green local test does not prove a merge, a deploy, or production verification.',proof:['UNCHECKED CLAIM','EVIDENCE GATE','RECEIPT RECORDED'],cta:'See how DIRF records proof'},
  {id:'DIRF-Short-03-Handoff',episode:'EP 01 / SHORT 03',hook:'A 200,000-token window can still have bad handoff hygiene.',relate:'More chat history does not create one authoritative objective or one exact next action.',proof:['200,000 TOKENS','CANONICAL STATE','EXACT NEXT ACTION'],cta:'Watch episode one'},
  {id:'DIRF-Short-04-Routing',episode:'EP 01 / SHORT 04',hook:'The wrong skill can be worse than no skill.',relate:'A vague task should not load every capability or let the first familiar tool choose the method.',proof:['CODE REVIEW','SECURITY','TEST VERIFICATION'],cta:'Run dirf flow first'},
  {id:'DIRF-Short-05-Three-Things',episode:'EP 01 / SHORT 05',hook:'Three things every resumed agent should see.',relate:'Continuity becomes useful when the next agent can act without replaying the entire project.',proof:['OBJECTIVE','EVIDENCE','NEXT ACTION'],cta:'Get the full model'},
];
