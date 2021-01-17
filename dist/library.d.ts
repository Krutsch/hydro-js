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
interface EventObject {
    event: EventListener;
    options: AddEventListenerOptions;
}
declare type reactiveObject<T> = T & hydroObject & ((setter: any) => void);
declare type eventFunctions = Record<string, EventListener | EventObject>;
declare function setGlobalSchedule(willSchedule: boolean): void;
declare function setReuseElements(willReuse: boolean): void;
declare function setInsertDiffing(willInsert: boolean): void;
declare function html(htmlArray: TemplateStringsArray, // The Input String, which is splitted by the template variables
...variables: Array<any>): Element | DocumentFragment | Text;
declare function setReactivity(DOM: Node, eventFunctions?: eventFunctions): void;
declare function compare(elem: Element, where: Element, onlyTextChildren?: boolean): boolean;
declare function render(elem: ReturnType<typeof html> | reactiveObject<any>, where?: ReturnType<typeof html> | string, shouldSchedule?: boolean): ChildNode["remove"];
declare function reactive<T>(initial: T): reactiveObject<T>;
declare function unset(reactiveHydro: reactiveObject<any>): void;
declare function setAsyncUpdate(reactiveHydro: reactiveObject<any>, asyncUpdate: boolean): void;
declare function observe(reactiveHydro: reactiveObject<any>, fn: Function): void;
declare function unobserve(reactiveHydro: reactiveObject<any>): void;
declare function ternary(condition: Function | reactiveObject<any>, trueVal: any, falseVal: any, reactiveHydro?: reactiveObject<any>): any;
declare function emit(eventName: string, data: any, who: EventTarget, options?: object): void;
declare function getValue<T>(reactiveHydro: T): T;
declare function onRender(fn: Function, elem: ReturnType<typeof html>, ...args: Array<any>): void;
declare function onCleanup(fn: Function, elem: ReturnType<typeof html>, ...args: Array<any>): void;
declare const hydro: hydroObject;
declare const $: {
    <K extends "object" | "a" | "abbr" | "address" | "applet" | "area" | "article" | "aside" | "audio" | "b" | "base" | "basefont" | "bdi" | "bdo" | "blockquote" | "body" | "br" | "button" | "canvas" | "caption" | "cite" | "code" | "col" | "colgroup" | "data" | "datalist" | "dd" | "del" | "details" | "dfn" | "dialog" | "dir" | "div" | "dl" | "dt" | "em" | "embed" | "fieldset" | "figcaption" | "figure" | "font" | "footer" | "form" | "frame" | "frameset" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "head" | "header" | "hgroup" | "hr" | "html" | "i" | "iframe" | "img" | "input" | "ins" | "kbd" | "label" | "legend" | "li" | "link" | "main" | "map" | "mark" | "marquee" | "menu" | "meta" | "meter" | "nav" | "noscript" | "ol" | "optgroup" | "option" | "output" | "p" | "param" | "picture" | "pre" | "progress" | "q" | "rp" | "rt" | "ruby" | "s" | "samp" | "script" | "section" | "select" | "slot" | "small" | "source" | "span" | "strong" | "style" | "sub" | "summary" | "sup" | "table" | "tbody" | "td" | "template" | "textarea" | "tfoot" | "th" | "thead" | "time" | "title" | "tr" | "track" | "u" | "ul" | "var" | "video" | "wbr">(selectors: K): HTMLElementTagNameMap[K] | null;
    <K_1 extends "symbol" | "svg" | "a" | "script" | "style" | "title" | "circle" | "clipPath" | "defs" | "desc" | "ellipse" | "feBlend" | "feColorMatrix" | "feComponentTransfer" | "feComposite" | "feConvolveMatrix" | "feDiffuseLighting" | "feDisplacementMap" | "feDistantLight" | "feFlood" | "feFuncA" | "feFuncB" | "feFuncG" | "feFuncR" | "feGaussianBlur" | "feImage" | "feMerge" | "feMergeNode" | "feMorphology" | "feOffset" | "fePointLight" | "feSpecularLighting" | "feSpotLight" | "feTile" | "feTurbulence" | "filter" | "foreignObject" | "g" | "image" | "line" | "linearGradient" | "marker" | "mask" | "metadata" | "path" | "pattern" | "polygon" | "polyline" | "radialGradient" | "rect" | "stop" | "switch" | "text" | "textPath" | "tspan" | "use" | "view">(selectors: K_1): SVGElementTagNameMap[K_1] | null;
    <E extends Element = Element>(selectors: string): E | null;
};
declare const $$: {
    <K extends "object" | "a" | "abbr" | "address" | "applet" | "area" | "article" | "aside" | "audio" | "b" | "base" | "basefont" | "bdi" | "bdo" | "blockquote" | "body" | "br" | "button" | "canvas" | "caption" | "cite" | "code" | "col" | "colgroup" | "data" | "datalist" | "dd" | "del" | "details" | "dfn" | "dialog" | "dir" | "div" | "dl" | "dt" | "em" | "embed" | "fieldset" | "figcaption" | "figure" | "font" | "footer" | "form" | "frame" | "frameset" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "head" | "header" | "hgroup" | "hr" | "html" | "i" | "iframe" | "img" | "input" | "ins" | "kbd" | "label" | "legend" | "li" | "link" | "main" | "map" | "mark" | "marquee" | "menu" | "meta" | "meter" | "nav" | "noscript" | "ol" | "optgroup" | "option" | "output" | "p" | "param" | "picture" | "pre" | "progress" | "q" | "rp" | "rt" | "ruby" | "s" | "samp" | "script" | "section" | "select" | "slot" | "small" | "source" | "span" | "strong" | "style" | "sub" | "summary" | "sup" | "table" | "tbody" | "td" | "template" | "textarea" | "tfoot" | "th" | "thead" | "time" | "title" | "tr" | "track" | "u" | "ul" | "var" | "video" | "wbr">(selectors: K): NodeListOf<HTMLElementTagNameMap[K]>;
    <K_1 extends "symbol" | "svg" | "a" | "script" | "style" | "title" | "circle" | "clipPath" | "defs" | "desc" | "ellipse" | "feBlend" | "feColorMatrix" | "feComponentTransfer" | "feComposite" | "feConvolveMatrix" | "feDiffuseLighting" | "feDisplacementMap" | "feDistantLight" | "feFlood" | "feFuncA" | "feFuncB" | "feFuncG" | "feFuncR" | "feGaussianBlur" | "feImage" | "feMerge" | "feMergeNode" | "feMorphology" | "feOffset" | "fePointLight" | "feSpecularLighting" | "feSpotLight" | "feTile" | "feTurbulence" | "filter" | "foreignObject" | "g" | "image" | "line" | "linearGradient" | "marker" | "mask" | "metadata" | "path" | "pattern" | "polygon" | "polyline" | "radialGradient" | "rect" | "stop" | "switch" | "text" | "textPath" | "tspan" | "use" | "view">(selectors: K_1): NodeListOf<SVGElementTagNameMap[K_1]>;
    <E extends Element = Element>(selectors: string): NodeListOf<E>;
};
declare const internals: {
    compare: typeof compare;
};
export { render, html, hydro, setGlobalSchedule, setReuseElements, setInsertDiffing, reactive, unset, setAsyncUpdate, unobserve, observe, ternary, emit, internals, getValue, onRender, onCleanup, setReactivity, $, $$, };
