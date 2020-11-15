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
}
interface hydroObject extends Record<keyof any, any> {
    isProxy: boolean;
    asyncUpdate: boolean;
    observe: (key: keyof any, fn: Function) => any;
    getObservers: () => Map<string, Set<Function>>;
    unobserve: (key?: keyof any) => undefined;
}
declare type reactiveObject<T> = T & hydroObject & ((setter: any) => void);
declare function setGlobalSchedule(willSchedule: boolean): void;
declare function setReuseElements(willReuse: boolean): void;
declare function setInsertDiffing(willInsert: boolean): void;
declare function html(htmlArray: TemplateStringsArray, // The Input String, which is splitted by the template variables
...variables: Array<any>): Element | DocumentFragment | Text;
declare function compare(elem: Element, where: Element): boolean;
declare function render(elem: ReturnType<typeof html>, where?: Element | string, shouldSchedule?: boolean): ChildNode["remove"];
declare function reactive<T>(initial: T): reactiveObject<T>;
declare function unset(reactiveHydro: reactiveObject<any>): void;
declare function observe(reactiveHydro: reactiveObject<any>, fn: Function): void;
declare function ternary(condition: Function | reactiveObject<any>, trueVal: any, falseVal: any, reactiveHydro?: reactiveObject<any>): any;
declare function emit(eventName: string, data: any, who: EventTarget, options?: object): void;
declare function getValue<T>(reactiveHydro: T): T;
declare function onRender(fn: Function, elem: ReturnType<typeof html>, ...args: Array<any>): void;
declare function onCleanup(fn: Function, elem: ReturnType<typeof html>, ...args: Array<any>): void;
declare const hydro: hydroObject;
declare const internals: {
    compare: typeof compare;
};
export { render, html, hydro, setGlobalSchedule, setReuseElements, setInsertDiffing, reactive, unset, observe, ternary, emit, internals, getValue, onRender, onCleanup, };
