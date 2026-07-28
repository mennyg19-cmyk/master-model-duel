// Plain CSS side-effect imports (app/globals.css). Next ships declarations for
// *.module.css only; TS 6 errors on undeclared side-effect imports (TS2882).
declare module "*.css";
