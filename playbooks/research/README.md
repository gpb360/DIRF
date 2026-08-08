---
name: research
kind: playbook
order: 4
description: "Research a topic, competitor, technology, or market and synthesize recommendations."
uses: []
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Research a topic, competitor, technology, or market and synthesize recommendations.","keywords":["research","competitor","market","compare","evaluate","trend"],"agents":["research-analyst","competitive-analyst","content-marketer","knowledge-synthesizer"],"workflow":{"phases":["define decision","collect sources","compare","synthesize"],"output":"evidence-backed recommendation where every claim traces to a typed source or is marked unverified","validation":"every claim cites a primary or secondary source (typed as such); unverified claims are labeled, and the recommendation restates the decision it supports","recovery":"if sources are unavailable, mark claims as unverified rather than guessing"},"questions":["What decision should the research support?","Are web sources required or should this be repo-only?"],"skill_flow":{"label":"foggy effort → research before building","steps":[{"stage":"research","reason":"Investigate the decision against primary sources and preserve citations.","capability":"primary source research","output":"one cited markdown note whose claims each trace to a typed primary or secondary source; unverified claims labeled"},{"stage":"synthesize","reason":"Stop at the smallest evidence-backed recommendation.","capability":"minimalism","output":"a single recommendation with the smallest sufficient evidence, restating the decision it supports, and an explicit stop reason"}]}}
---

# research

Research a topic, competitor, technology, or market and synthesize recommendations.

Follow the ordered phases and capability requirements declared above.
