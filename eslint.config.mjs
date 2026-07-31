import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  // Reference trees and packaged/generated output are not source to lint.
  { ignores: ["ref-repos/**", "release/**", ".next/**"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Electron's main/preload processes intentionally use CommonJS so they can
  // run directly under Electron without a transpilation step.
  {
    files: ["electron/**/*.js", "main.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
