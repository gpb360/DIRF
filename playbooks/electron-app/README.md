---
name: electron-app
kind: playbook
order: 4
description: "Build, debug, or review a cross-platform Electron desktop application."
uses: ["../../skills/minimal-implementation"]
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Build, debug, or review a cross-platform Electron desktop application.","keywords":["electron","desktop app","browserwindow","ipc","preload","main process","renderer process"],"agents":["rapid-prototyper","frontend-developer","backend-architect","test-engineer"],"workflow":{"phases":["map Electron boundaries","implement the smallest vertical slice","verify runtime behavior"],"output":"working Electron change with process-boundary and runtime verification","validation":"run the narrowest typecheck, build, and runtime smoke check for the Electron surface","recovery":"if the process boundary or IPC contract is unclear, document the missing contract before editing"},"questions":["Which Electron surface is changing: main, preload, renderer, IPC, or packaging?","What user-visible behavior must work in the packaged or development app?"],"skill_flow":{"label":"Electron idea → working desktop slice","steps":[{"stage":"map","reason":"Ground the change in Electron's main, renderer, preload, and IPC boundaries.","capability":"electron desktop"},{"stage":"build","reason":"Use safe context isolation and explicit IPC contracts.","capability":"electron ipc"},{"stage":"security","reason":"Keep node integration disabled and review Electron trust boundaries.","capability":"electron security"},{"stage":"verify","reason":"Prove the app builds and the changed runtime path works.","capability":"testing"}]}}
---

# electron-app

Build, debug, or review a cross-platform Electron desktop application.

Follow the ordered phases and capability requirements declared above.
