type Props = {
    children?: unknown;
} & Record<string, unknown>;
export declare function jsx(type: any, props: Props): Element | Text | DocumentFragment;
export declare const jsxs: typeof jsx;
export declare const jsxDEV: typeof jsx;
export declare function Fragment(props: Props): DocumentFragment;
export declare namespace JSX {
    type Element = any;
    interface IntrinsicElements {
        [name: string]: any;
    }
}
export {};
