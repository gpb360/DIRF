# Keep the DIRF Flow Board separate

The DIRF Flow Board will live in a separate repository rather than inside the
DIRF core. It will consume one-shot JSON from DIRF's public CLI instead of
importing internal modules, keeping the zero-dependency core independent from
Electron while allowing the desktop application to evolve separately.
