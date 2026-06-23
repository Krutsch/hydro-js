import { h } from "./library.js";
const toChildren = (c) => c == null ? [] : Array.isArray(c) ? c : [c];
export function jsx(type, props) {
    const { children, ...rest } = props ?? {};
    return h(type, rest, ...toChildren(children));
}
export const jsxs = jsx;
export const jsxDEV = jsx; // for jsx-dev-runtime
export function Fragment(props) {
    const frag = document.createDocumentFragment();
    frag.append(...toChildren(props?.children));
    return frag;
}
