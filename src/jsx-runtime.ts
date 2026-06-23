import { h } from "./library.js";

type Props = { children?: unknown } & Record<string, unknown>;
const toChildren = (c: unknown) =>
  c == null ? [] : Array.isArray(c) ? c : [c];

export function jsx(type: any, props: Props) {
  const { children, ...rest } = props ?? {};
  return h(type, rest, ...toChildren(children));
}
export const jsxs = jsx;
export const jsxDEV = jsx; // for jsx-dev-runtime
export function Fragment(props: Props) {
  const frag = document.createDocumentFragment();
  frag.append(...(toChildren(props?.children) as Node[]));
  return frag;
}

export namespace JSX {
  export type Element = any;
  export interface IntrinsicElements {
    [name: string]: any;
  }
}
