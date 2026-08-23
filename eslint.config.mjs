import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next の既定 ignore を上書きする。
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "deploy/**"]),
]);

export default eslintConfig;
