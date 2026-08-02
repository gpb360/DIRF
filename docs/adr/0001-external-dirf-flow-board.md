# Keep the DIRF Flow Board separate

The DIRF Flow Board will live in its own repository at `E:\dirf-flow-board` rather than inside amf-dirf. It will consume one-shot JSON from DIRF's public CLI instead of importing internal modules, keeping the zero-dependency DIRF core independent from Electron while allowing the desktop application to evolve separately.
