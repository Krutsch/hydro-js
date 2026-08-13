import type { EventObject } from "./ownership.js";
export type HtmlPart = {
    kind: "text";
    path: number[];
    markers: number[];
    template: string;
    whole: boolean;
} | {
    kind: "attribute";
    path: number[];
    attr: string;
    markers: number[];
    template: string;
    whole: boolean;
};
type EventType = EventListener | EventObject;
type EventFunctions = Map<string, EventType>;
export interface Binding {
    buildHTMLParts(root: DocumentFragment): HtmlPart[];
    applyCompiledParts(root: DocumentFragment, parts: HtmlPart[], variables: unknown[]): void;
    setReactivity(DOM: Element | DocumentFragment | Text, eventFunctions?: EventFunctions | Record<string, EventType>): void;
    setReactivitySingle(node: Element | Text, key?: string, val?: string): void;
    wireReactiveValue(node: Element | Text, variable: unknown, key?: string): boolean;
    wireViewHProp(elem: Element, key: string, value: unknown): boolean;
    wireViewHChild(elem: Element | DocumentFragment, child: unknown): boolean;
}
interface BindingRuntime {
    isServerSideCached: boolean;
    showElement: number;
    reactivityRegex: RegExp;
    placeholder: {
        reactiveKey: string;
        twoWay: string;
        change: string;
        radio: string;
        checkbox: string;
        bind: string;
    };
    onEventRegex: RegExp;
    propChainRegex: RegExp;
    newLineRegex: RegExp;
    isTextNode(node: Node): node is Text;
    isNode(value: unknown): value is Node;
    isObject(value: unknown): value is Record<string, any>;
    isFunction(value: unknown): value is Function;
    isEventObject(value: unknown): value is EventObject;
    isReactiveValue(value: unknown): boolean;
    containsReactiveMarker(value: string): boolean;
    isBooleanAttribute(value: string): boolean;
    resolveObject(properties: PropertyKey[]): [any, any];
    getReactivePath(value: unknown): PropertyKey[];
    isProxy(value: unknown): boolean;
    setAttribute(node: Element, key: string, value: any): boolean;
    addEventListener(node: Element, eventName: string, value: EventObject | EventListener): void;
    trackBoundElement(proxy: object, elem: Element): void;
    setTraces(start: number, end: number, node: Text | Element, hydroKey: string, resolvedObj: object, key?: string): void;
    changeAttrVal(eventName: string, node: HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement, resolvedObj: object, lastProp: string, isChecked?: boolean): void;
}
export declare function createBinding(runtime: BindingRuntime): Binding;
export {};
