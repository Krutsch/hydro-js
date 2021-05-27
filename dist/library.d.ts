declare global {
    interface Window {
        $: Document["querySelector"];
        $$: Document["querySelectorAll"];
    }
    interface Number {
        setter(val: any): void;
    }
    interface String {
        setter(val: any): void;
    }
    interface Symbol {
        setter(val: any): void;
    }
    interface Boolean {
        setter(val: any): void;
    }
    interface BigInt {
        setter(val: any): void;
    }
    interface Object {
        setter(val: any): void;
    }
    interface Navigator {
        scheduling: {
            isInputPending(IsInputPendingOptions?: isInputPendingOptions): boolean;
        };
    }
}
declare type isInputPendingOptions = {
    includeContinuous: boolean;
};
interface hydroObject extends Record<PropertyKey, any> {
    isProxy: boolean;
    asyncUpdate: boolean;
    observe: (key: PropertyKey, fn: Function) => any;
    getObservers: () => Map<string, Set<Function>>;
    unobserve: (key?: PropertyKey, handler?: Function) => undefined;
}
interface EventObject {
    event: EventListener;
    options: AddEventListenerOptions;
}
declare type reactiveObject<T> = T & hydroObject & ((setter: any) => void);
declare type eventFunctions = Record<string, EventListener | EventObject>;
declare function setGlobalSchedule(willSchedule: boolean): void;
declare function setReuseElements(willReuse: boolean): void;
declare function setInsertDiffing(willInsert: boolean): void;
declare function setShouldSetReactivity(willSet: boolean): void;
declare function html(htmlArray: TemplateStringsArray, // The Input String, which is splitted by the template variables
...variables: Array<any>): Element | DocumentFragment | Text;
declare function h(name: string | ((...args: any[]) => ReturnType<typeof h>), props: Record<keyof any, any> | null, ...children: Array<any>): ReturnType<typeof html>;
declare function setReactivity(DOM: ReturnType<typeof html>, eventFunctions?: eventFunctions): void;
declare function compare(elem: Element | DocumentFragment, where: Element | DocumentFragment | Text, onlyTextChildren?: boolean): boolean;
declare function render(elem: ReturnType<typeof html> | reactiveObject<any>, where?: ReturnType<typeof html> | string, shouldSchedule?: boolean): ChildNode["remove"];
declare function reactive<T>(initial: T): reactiveObject<T>;
declare function unset(reactiveHydro: reactiveObject<any>): void;
declare function setAsyncUpdate(reactiveHydro: reactiveObject<any>, asyncUpdate: boolean): void;
declare function observe(reactiveHydro: reactiveObject<any>, fn: Function): void;
declare function unobserve(reactiveHydro: reactiveObject<any>): void;
declare function ternary(condition: Function | reactiveObject<any>, trueVal: any, falseVal: any, reactiveHydro?: reactiveObject<any>): any;
declare function emit(eventName: string, data: any, who: EventTarget, options?: object): void;
declare function watchEffect(fn: Function): () => void | undefined;
declare function getValue<T extends object>(reactiveHydro: T): T;
declare function onRender(fn: Function, elem: ReturnType<typeof html>, ...args: Array<any>): void;
declare function onCleanup(fn: Function, elem: ReturnType<typeof html>, ...args: Array<any>): void;
declare function view(root: string, data: reactiveObject<Array<any>>, renderFunction: (value: any, index: number) => Node): void;
declare const hydro: hydroObject;
declare const $: {
    <K extends keyof HTMLElementTagNameMap>(selectors: K): HTMLElementTagNameMap[K] | null;
    <K_1 extends keyof SVGElementTagNameMap>(selectors: K_1): SVGElementTagNameMap[K_1] | null;
    <E extends Element = Element>(selectors: string): E | null;
};
declare const $$: {
    <K extends keyof HTMLElementTagNameMap>(selectors: K): NodeListOf<HTMLElementTagNameMap[K]>;
    <K_1 extends keyof SVGElementTagNameMap>(selectors: K_1): NodeListOf<SVGElementTagNameMap[K_1]>;
    <E extends Element = Element>(selectors: string): NodeListOf<E>;
};
declare const internals: {
    compare: typeof compare;
};
export { render, html, h, hydro, setGlobalSchedule, setReuseElements, setInsertDiffing, setShouldSetReactivity, reactive, unset, setAsyncUpdate, unobserve, observe, ternary, emit, watchEffect, internals, getValue, onRender, onCleanup, setReactivity, $, $$, view, };
