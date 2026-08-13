import {
  createOwnership,
  type EventObject,
  type Ownership,
} from "./ownership.js";
import { createBinding, type Binding, type HtmlPart } from "./binding.js";
import {
  createUpdateEngine,
  type UpdateAdapter,
  type UpdateEngine,
} from "./updates.js";
import { createView, createViewState } from "./view.js";

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
type isInputPendingOptions = {
  includeContinuous: boolean;
};

export interface hydroObject extends Record<PropertyKey, any> {
  isProxy: boolean;
  asyncUpdate: boolean;
  observe: (key: PropertyKey, fn: Function) => (() => void) | undefined;
  getObservers: () => Map<string, Set<Function>>;
  unobserve: (key?: PropertyKey, handler?: Function) => undefined;
}
type reactiveObject<T> = T & hydroObject & ((setter: any) => void);
type eventType = EventListener | EventObject;
type eventFunctions = Map<string, eventType>;
type htmlPart = HtmlPart;

const enum Placeholder {
  attribute = "attribute",
  text = "text",
  string = "string",
  isProxy = "isProxy",
  asyncUpdate = "asyncUpdate",
  function = "function",
  template = "template",
  event = "event",
  options = "options",
  observe = "observe",
  getObservers = "getObservers",
  unobserve = "unobserve",
  twoWay = "two-way",
  change = "change",
  radio = "radio",
  checkbox = "checkbox",
  dummy = "-dummy",
  reactiveKey = "hydro-reactive-",
}

// Safari Polyfills
window.requestIdleCallback =
  /* c8 ignore next 4 */
  window.requestIdleCallback ||
  ((cb: Function, _: any, start = window.performance.now()) =>
    window.setTimeout(cb, 0, {
      didTimeout: false,
      timeRemaining: () => Math.max(0, 5 - (window.performance.now() - start)),
    }));
// Safari Polyfills END

// Hoisted out of the hot paths: every `window.X` is a global object lookup.
const NodeConstructor = window.Node;
const SHOW_ELEMENT = window.NodeFilter.SHOW_ELEMENT;

const range = document.createRange();
range.selectNodeContents(
  range.createContextualFragment(`<${Placeholder.template}>`).lastChild!,
);
const defaultParser = range.createContextualFragment.bind(range);

let ownership: Ownership;
let allNodeChanges: Ownership["allNodeChanges"];
let elemEventFunctions: Ownership["elemEventFunctions"];
let reactivityMap: Ownership["reactivityMap"];
let bindMap: Ownership["bindMap"];
let boundElemProxies: Ownership["boundElemProxies"];
let tmpSwap: Ownership["tmpSwap"];
let onRenderMap: Ownership["onRenderMap"];
let onCleanupMap: Ownership["onCleanupMap"];
let binding: Binding;
let updateEngine: UpdateEngine<Element | Text>;
const fragmentToElements = new WeakMap<DocumentFragment, Array<ChildNode>>(); // Used to retreive Elements from DocumentFragment after it has been rendered â€“ for diffing
const hydroToReactive = new WeakMap<hydroObject, reactiveObject<any>>(); // Used for internal mapping from hydroKeys to the the Proxy created by the reactive function
const ternaryDisposers = new WeakMap<
  reactiveObject<any>,
  { stop: () => void; done: boolean }
>();
const reactiveSymbol = Symbol("reactive");
const keysSymbol = Symbol("keys");
const htmlCache = new WeakMap<TemplateStringsArray, DocumentFragment>();
const htmlPartsCache = new WeakMap<TemplateStringsArray, htmlPart[]>();
const htmlTemplateCacheable = new WeakMap<TemplateStringsArray, boolean>();
const prewiredSymbol = Symbol("prewired");
const viewState = createViewState();
const isServerSideCached = isServerSide();

// Every map and flag above lives in module scope, so two copies of hydro-js in
// one page each get their own reactivity registry: elements rendered by one
// instance are invisible to the other's updates. That failure is silent, so
// leave a marker on globalThis and warn when a second instance boots.
// Skipped on the server: SSR toolchains (Vite's ssr/client graphs, Vitest)
// legitimately evaluate the module more than once per realm.
// Keep VERSION in sync with package.json — the build is a plain `tsc`, so
// there is no define step to inject it.
const VERSION = "1.9.5";
/* c8 ignore start */
if (!isServerSideCached) {
  const instanceKey = Symbol.for("hydro-js.instance");
  const registry = globalThis as Record<symbol, string>;
  const previousVersion = registry[instanceKey];

  if (previousVersion === undefined) {
    registry[instanceKey] = VERSION;
  } else {
    console.warn(
      `[hydro-js] Duplicate instances (${previousVersion}, ${VERSION}); ` +
        `separate reactivity state. Deduplicate with \`npm ls hydro-js\`, ` +
        `aligned ranges, or an "overrides" entry.`,
    );
  }
}
/* c8 ignore stop */

let globalSchedule = true; // Decides whether to schedule rendering and updating (async)
let reuseElements = true; // Reuses Elements when rendering
let insertBeforeDiffing = false; // Makes sense in Chrome only
let shouldSetReactivity = true;
let ignoreIsConnected = false;

/* c8 ignore start */
const reactivityRegex = new RegExp(
  isServerSideCached
    ? `\\{\\{([^]*?)\\}\\}|${Placeholder.reactiveKey}([a-zA-Z0-9_.-]+)`
    : `\\{\\{([^]*?)\\}\\}`,
);
/* c8 ignore end */
const HTML_FIND_INVALID = /<(\/?)(html|head|body)(>|\s.*?>)/g;
const HTML_FIND_TABLE_ROW = /^<tr(>|\s)/i;
const HTML_FIND_TABLE_CELL = /^<t[dh](>|\s)/i;
const HTML_FIND_TABLE_COL = /^<col(>|\s|\/)/i;
const HTML_FIND_TABLE_SECTION = /^<(tbody|thead|tfoot|caption|colgroup)(>|\s)/i;
const newLineRegex = /\n/g;
const propChainRegex = /[\.\[\]]/;
const onEventRegex = /^on/;

// https://html.spec.whatwg.org/#attributes-3
// if value for bool attr is falsy, then remove attr
// INFO: draggable and spellcheck are actually using booleans as string! Also, hidden is not really a bool attr, but is making use of the empty string too. Might consider to add 'translate' (yes and no as string)
const boolAttrSet = new Set([
  "allowfullscreen",
  "alpha",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "draggable",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected",
  "shadowrootclonable",
  "shadowrootcustomelementregistry",
  "shadowrootdelegatesfocus",
  "shadowrootserializable",
  "spellcheck",
]);
let lastSwapElem: null | Element = null;
let internReset = false;
let reactiveKeyCounter = 0;

const primitiveTypes = new Set([
  "number",
  "string",
  "symbol",
  "boolean",
  "bigint",
]);

function isObject(obj: object | unknown): obj is Record<string, any> {
  return obj != null && typeof obj === "object";
}
function isFunction(func: Function | unknown): func is Function {
  return typeof func === Placeholder.function;
}
function isTextNode(node: Node): node is Text {
  return (node as Text).splitText !== undefined;
}
function isNode(node: unknown): node is Node {
  return isObject(node) && node instanceof NodeConstructor;
}
function isDocumentFragment(node: Node): node is DocumentFragment {
  return node.nodeType === 11;
}
function isEventObject(obj: object | unknown): obj is EventObject {
  return (
    isObject(obj) && Placeholder.event in obj && Placeholder.options in obj
  );
}
function isProxy(hydroObject: any): hydroObject is hydroObject {
  const wasTracking = trackDeps;
  if (wasTracking) trackDeps = false;
  const result = Reflect.get(hydroObject, Placeholder.isProxy);
  if (wasTracking) trackDeps = true;
  return result;
}
function isPromise(obj: any): obj is Promise<any> {
  return isObject(obj) && typeof obj.then === "function";
}
function isServerSide() {
  return (
    window.navigator.userAgent.includes("Node.js") ||
    window.navigator.userAgent.includes("Deno") ||
    window.navigator.userAgent.includes("Bun") ||
    window.navigator.userAgent.includes("HappyDOM") ||
    window.navigator.userAgent.includes("jsdom")
  );
}
function randomText() {
  const randomChars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += randomChars.charAt(
      Math.floor(Math.random() * randomChars.length),
    );
  }
  return result;
  // return Math.random().toString(32).slice(2);
}

function setGlobalSchedule(willSchedule: boolean): void {
  globalSchedule = willSchedule;
  setHydroRecursive(hydro);
}
function setReuseElements(willReuse: boolean): void {
  reuseElements = willReuse;
}
function setInsertDiffing(willInsert: boolean): void {
  insertBeforeDiffing = willInsert;
}
function setShouldSetReactivity(willSet: boolean): void {
  shouldSetReactivity = willSet;
}
function setIgnoreIsConnected(ignore: boolean): void {
  ignoreIsConnected = ignore;
}
function setHydroRecursive(obj: hydroObject) {
  Reflect.set(obj, Placeholder.asyncUpdate, globalSchedule);

  for (const value of Object.values(obj)) {
    if (isObject(value) && isProxy(value)) {
      setHydroRecursive(value);
    }
  }
}

function setAttribute(node: Element, key: string, val: any): boolean {
  const isBoolAttr = boolAttrSet.has(key);
  if (isBoolAttr && !val) {
    node.removeAttribute(key);
    return false;
  }

  node.setAttribute(
    key,
    isFunction(val) && Reflect.has(val, reactiveSymbol)
      ? val
      : isBoolAttr
        ? ""
        : val,
  );
  return true;
}
function addEventListener(
  node: Element,
  eventName: string,
  obj: EventObject | EventListener,
) {
  ownership.addEventListener(node, eventName, obj);
}

function removeTrackedEventListener(
  node: Element,
  eventName: string,
  handler: EventListener,
) {
  ownership.removeTrackedEventListener(node, eventName, handler);
}

function purgeTrackedEventListeners(node: Element) {
  ownership.purgeTrackedEventListeners(node);
}

function trackBoundElement(proxy: hydroObject, elem: Element) {
  ownership.trackBoundElement(proxy, elem);
}

function untrackBoundElement(proxy: object, elem: Element) {
  ownership.untrackBoundElement(proxy, elem);
}

function html(
  htmlArray: TemplateStringsArray,
  ...variables: Array<any>
): Element | DocumentFragment | Text {
  const cachedDOM = createCachedHTML(htmlArray, variables);
  if (cachedDOM) return cachedDOM;

  const eventFunctions: eventFunctions = new Map(); // Temporarily store a mapping for string -> function, because eventListener have to be registered after the Element's creation
  const insertNodes: Node[] = []; // Nodes, that will be added after the parsing
  const template = `<${Placeholder.template} id="lbInsertNodes"></${Placeholder.template}>`;

  const resolvedVariables = new Array<string>(variables.length);
  for (let i = 0; i < variables.length; i++) {
    const variable = variables[i];

    if (isNode(variable)) {
      insertNodes.push(variable);
      resolvedVariables[i] = template;
    } else if (
      primitiveTypes.has(typeof variable) ||
      Reflect.has(variable, reactiveSymbol)
    ) {
      resolvedVariables[i] = String(variable);
    } else if (isFunction(variable) || isEventObject(variable)) {
      const funcName = randomText();
      eventFunctions.set(funcName, variable);
      if (viewState.rendering) viewState.eventFunctions.set(funcName, variable);
      resolvedVariables[i] = funcName;
    } else if (Array.isArray(variable)) {
      for (let index = 0; index < variable.length; index++) {
        const item = variable[index];
        if (isNode(item)) {
          insertNodes.push(item);
          variable[index] = template;
        }
      }
      resolvedVariables[i] = variable.join("");
    } else if (isObject(variable)) {
      let result = "";
      for (const [key, value] of Object.entries(variable)) {
        if (isFunction(value) || isEventObject(value)) {
          const funcName = randomText();
          eventFunctions.set(funcName, value);
          viewState.rendering && viewState.eventFunctions.set(funcName, value);
          result += `${key}="${funcName}"`;
        } else {
          result += `${key}="${value}"`;
        }
      }
      resolvedVariables[i] = result;
    }
  }

  // Find elements <html|head|body>, as they cannot be created by the parser. Replace them by fake Custom Elements and replace them afterwards.
  let DOMString = String.raw(htmlArray, ...resolvedVariables).trim();
  DOMString = DOMString.replace(
    HTML_FIND_INVALID,
    `<$1$2${Placeholder.dummy}$3`,
  );
  const DOM = parser(DOMString);

  // Delay Element iteration and manipulation after the elements have been added to the DOM.
  if (!viewState.rendering) {
    fillDOM(DOM, insertNodes, eventFunctions);
  }

  // Return DocumentFragment
  if (DOM.childNodes.length > 1) return DOM;

  // Return empty Text Node
  if (!DOM.firstChild) return document.createTextNode("");

  // Return Element | Text
  return DOM.firstChild as Element | Text;
}
function parser(DOMString: string) {
  const trimmed = DOMString.trimStart();
  if (HTML_FIND_TABLE_ROW.test(trimmed)) {
    return parseTableFragment("tbody", DOMString);
  }
  if (HTML_FIND_TABLE_CELL.test(trimmed)) {
    return parseTableFragment("tr", DOMString);
  }
  if (HTML_FIND_TABLE_COL.test(trimmed)) {
    return parseTableFragment("colgroup", DOMString);
  }
  if (HTML_FIND_TABLE_SECTION.test(trimmed)) {
    return parseTableFragment("table", DOMString);
  }
  return defaultParser(DOMString);
}
function parseTableFragment(parentName: string, DOMString: string) {
  const parent = document.createElement(parentName);
  parent.innerHTML = DOMString;
  const fragment = document.createDocumentFragment();
  fragment.append(...parent.childNodes);
  return fragment;
}
function isReactiveValue(value: unknown): value is reactiveObject<any> {
  return (
    (isObject(value) || isFunction(value)) && Reflect.has(value, reactiveSymbol)
  );
}
function containsReactiveMarker(value: string) {
  return (
    value.includes("{{") ||
    /* c8 ignore next */
    (isServerSideCached && value.includes(Placeholder.reactiveKey))
  );
}
function containsReactiveValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsReactiveValue);
  if (isReactiveValue(value)) return true;
  if (typeof value === Placeholder.string) return containsReactiveMarker(value);
  if (isObject(value) && !isNode(value)) {
    return Object.values(value).some(containsReactiveValue);
  }
  return false;
}
function containsParsedHTML(value: string) {
  return value.includes("<") || containsReactiveMarker(value);
}
function canCacheHTMLPosition(htmlArray: TemplateStringsArray, index: number) {
  const before = htmlArray.slice(0, index + 1).join("");
  if (/<\/?$/.test(before)) return false;
  return !/<[^>]*\s$/.test(before);
}
function isTemplateCacheable(htmlArray: TemplateStringsArray) {
  const cached = htmlTemplateCacheable.get(htmlArray);
  if (cached !== undefined) return cached;

  let cacheable = true;
  for (let index = 0; index < htmlArray.length; index++) {
    if (containsReactiveMarker(htmlArray[index])) {
      cacheable = false;
      break;
    }
  }
  if (cacheable) {
    for (let index = 0; index < htmlArray.length - 1; index++) {
      if (!canCacheHTMLPosition(htmlArray, index)) {
        cacheable = false;
        break;
      }
    }
  }

  htmlTemplateCacheable.set(htmlArray, cacheable);
  return cacheable;
}
function canCacheHTMLVariables(
  htmlArray: TemplateStringsArray,
  variables: unknown[],
) {
  if (!isTemplateCacheable(htmlArray)) return false;

  for (const variable of variables) {
    if (isNode(variable as Node) || Array.isArray(variable)) return false;
    if (isReactiveValue(variable)) continue;
    if (containsReactiveValue(variable)) return false;
    if (
      typeof variable === Placeholder.string &&
      containsParsedHTML(variable)
    ) {
      return false;
    }
    if (
      primitiveTypes.has(typeof variable) ||
      isFunction(variable) ||
      isEventObject(variable)
    ) {
      continue;
    }
    return false;
  }
  return true;
}
function createCachedHTML(
  htmlArray: TemplateStringsArray,
  variables: unknown[],
): Element | DocumentFragment | Text | undefined {
  if (!shouldSetReactivity || !canCacheHTMLVariables(htmlArray, variables)) {
    return undefined;
  }

  let cachedDOM = htmlCache.get(htmlArray);
  let parts = htmlPartsCache.get(htmlArray);
  if (!cachedDOM) {
    const markers = variables.map((_, index) => `__hydro${index}__`);
    const DOMString = String.raw(htmlArray, ...markers).trim();
    if (HTML_FIND_INVALID.test(DOMString)) return undefined;

    cachedDOM = parser(DOMString);
    htmlCache.set(htmlArray, cachedDOM);
    parts = buildHTMLParts(cachedDOM);
    htmlPartsCache.set(htmlArray, parts);
  }

  const DOM = cachedDOM.cloneNode(true) as DocumentFragment;
  applyCompiledParts(DOM, parts!, variables);
  if (DOM.childNodes.length > 1) {
    markCachedHTMLWired(DOM);
    return DOM;
  }
  if (!DOM.firstChild) return document.createTextNode("");
  markCachedHTMLWired(DOM.firstChild);
  return DOM.firstChild as Element | Text;
}
type prewirable = Node & Record<symbol, boolean | undefined>;
function markCachedHTMLWired(node: Node) {
  (node as prewirable)[prewiredSymbol] = true;
}
function isViewPrewired(node: Node) {
  return (node as prewirable)[prewiredSymbol] === true;
}
function buildHTMLParts(root: DocumentFragment) {
  return binding.buildHTMLParts(root);
}
function applyCompiledParts(
  root: DocumentFragment,
  parts: htmlPart[],
  variables: unknown[],
) {
  binding.applyCompiledParts(root, parts, variables);
}
// Fast path for a slot that is exactly one reactive value. Returns false when
// the value needs the generic (string parsing) path in setReactivitySingle.
function wireReactiveValue(
  node: Element | Text,
  variable: reactiveObject<any>,
  key?: string,
): boolean {
  return binding.wireReactiveValue(node, variable, key);
}
function fillDOM(
  elem: ReturnType<typeof html>,
  insertNodes: Node[],
  eventFunctions: eventFunctions,
) {
  const root = document.createNodeIterator(elem, SHOW_ELEMENT, {
    acceptNode(element: Element) {
      return element.localName.endsWith(Placeholder.dummy)
        ? window.NodeFilter.FILTER_ACCEPT
        : window.NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  let currentNode;
  while ((currentNode = root.nextNode())) {
    nodes.push(currentNode as Element);
  }

  for (const node of nodes) {
    const tag = node.localName.replace(Placeholder.dummy, "");
    const replacement = document.createElement(tag);

    /* c8 ignore next 3 */
    for (const key of node.getAttributeNames()) {
      replacement.setAttribute(key, node.getAttribute(key)!);
    }
    replacement.append(...node.childNodes);
    node.replaceWith(replacement);
  }

  // Insert HTML Elements, which were stored in insertNodes
  if (!isTextNode(elem)) {
    for (const template of elem.querySelectorAll("template[id^=lbInsertNodes]"))
      template.replaceWith(insertNodes.shift()!);
  }

  if (shouldSetReactivity) setReactivity(elem, eventFunctions);
}
/* c8 ignore start */
type FragmentCase = { children: ReturnType<typeof h>[] };
function wireViewHProp(elem: Element, key: string, value: unknown) {
  return binding.wireViewHProp(elem, key, value);
}
function wireViewHChild(elem: Element | DocumentFragment, child: unknown) {
  return binding.wireViewHChild(elem, child);
}
function h(
  name: string | ((...args: any[]) => ReturnType<typeof h>) | FragmentCase,
  props: Record<keyof any, any> | null,
  ...children: Array<any>
): ReturnType<typeof html> {
  if (isFunction(name)) return name({ ...props, children });

  const isFragment = typeof name !== Placeholder.string;
  const elem = isFragment
    ? document.createDocumentFragment()
    : document.createElement(
        name as string,
        props?.["is"] !== undefined ? { is: props["is"] } : undefined,
      );
  let viewPrewired = viewState.rendering;
  let needsScan = false;
  for (const i in props) {
    const value = props[i];
    if (viewState.rendering && (i === "bind" || isReactiveValue(value))) {
      if (wireViewHProp(elem as Element, i, value)) continue;
      viewPrewired = false;
    } else if (
      !viewState.rendering &&
      !needsScan &&
      (i === "bind" || i === Placeholder.twoWay || containsReactiveValue(value))
    ) {
      needsScan = true;
    }
    isElementProperty(elem, i, isFragment) && !boolAttrSet.has(i)
      ? //@ts-ignore
        (elem[i] = value)
      : setAttribute(elem as HTMLElement, i, value);
  }

  if (isFragment) {
    children = (name as FragmentCase).children;
  }
  // Manual scan: `children.some((i) => Array.isArray(i))` allocates a closure
  // per element, which is per row * per tag in a list render.
  let hasNestedChildren = false;
  for (let index = 0; index < children.length; index++) {
    if (Array.isArray(children[index])) {
      hasNestedChildren = true;
      break;
    }
  }
  const flatChildren = hasNestedChildren
    ? children.map(getChildren).flat()
    : children;
  for (let index = 0; index < flatChildren.length; index++) {
    const child = flatChildren[index];
    let childIsNode = false;
    if (viewState.rendering) {
      childIsNode = isNode(child);
      if (childIsNode) {
        if (!isViewPrewired(child)) viewPrewired = false;
      } else if (isReactiveValue(child)) {
        if (wireViewHChild(elem, child)) continue;
        viewPrewired = false;
      }
    } else if (!needsScan) {
      childIsNode = isNode(child);
      needsScan = childIsNode
        ? !isViewPrewired(child as Node)
        : containsReactiveValue(child);
    }
    childIsNode ? elem.appendChild(child as Node) : elem.append(child);
  }
  if (!viewState.rendering) {
    if (needsScan) setReactivity(elem);
    markCachedHTMLWired(elem);
  } else if (viewPrewired) {
    markCachedHTMLWired(elem);
  }
  return elem;
}
// `prop in element` walks the whole prototype chain across the JS/DOM
// boundary. The answer only depends on the element interface, so cache it per
// constructor - a not yet defined custom element never shares an entry with
// the upgraded one, and customized built-ins keep their own entry.
const elementProperties = new WeakMap<Function, Map<string, boolean>>();
function isElementProperty(
  elem: Element | DocumentFragment,
  prop: string,
  isFragment: boolean,
) {
  if (isFragment) return prop in elem;

  const interfaceConstructor = elem.constructor;
  let properties = elementProperties.get(interfaceConstructor);
  if (!properties) {
    properties = new Map();
    elementProperties.set(interfaceConstructor, properties);
  }
  let known = properties.get(prop);
  if (known === undefined) {
    known = prop in elem;
    properties.set(prop, known);
  }
  return known;
}
function getChildren(child: unknown) {
  return isObject(child) && !isNode(child as Node)
    ? Object.values(child)
    : child;
}
/* c8 ignore end */
function setReactivity(
  DOM: ReturnType<typeof html>,
  eventFunctions?: eventFunctions | Record<string, eventType>,
) {
  binding.setReactivity(DOM, eventFunctions);
}
function setReactivitySingle(node: Text): void;
function setReactivitySingle(node: Element, key: string, val: string): void;
function setReactivitySingle(
  node: Element | Text,
  key?: string,
  val?: string,
): void {
  binding.setReactivitySingle(node, key, val);
}
// Same behavior as v-model in https://v3.vuejs.org/guide/forms.html#basic-usage
function changeAttrVal(
  eventName: string,
  node: HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement,
  resolvedObj: hydroObject,
  lastProp: string,
  isChecked: boolean = false,
) {
  node.addEventListener(eventName, changeHandler);
  onCleanup(() => node.removeEventListener(eventName, changeHandler), node);

  function changeHandler({ target }: Event) {
    Reflect.set(
      resolvedObj,
      lastProp,
      isChecked
        ? (target as HTMLInputElement).checked
        : (target as HTMLInputElement).value,
    );
  }
}
function setTraces(
  start: number,
  end: number,
  node: Text | Element,
  hydroKey: string,
  resolvedObj: hydroObject,
  key?: string,
): void {
  ownership.recordTrace(start, end, node, hydroKey, resolvedObj, key);
}

// Helper function to return a value and hydro obj from a chain of properties
function resolveObject(propertyArray: Array<PropertyKey>): [any, hydroObject] {
  let value: any, prev: hydroObject;
  value = prev = hydro;

  for (const prop of propertyArray) {
    prev = value;
    value = Reflect.get(prev, prop);
  }

  return [value, prev];
}

function compareEvents(
  elem: Element | Text,
  where: Element | Text,
  onlyTextChildren?: boolean,
): boolean {
  const elemFunctions: Function[] = [];
  const whereFunctions: Function[] = [];

  if (isTextNode(elem)) {
    pushLifecycleFunctions(elemFunctions, onRenderMap, elem);
    pushLifecycleFunctions(elemFunctions, onCleanupMap, elem);
    pushLifecycleFunctions(whereFunctions, onRenderMap, where);
    pushLifecycleFunctions(whereFunctions, onCleanupMap, where);

    return (
      elemFunctions.length === whereFunctions.length &&
      String(elemFunctions) === String(whereFunctions)
    );
  }

  pushTrackedHandlers(elemFunctions, elem);
  pushTrackedHandlers(whereFunctions, where as Element);

  pushLifecycleFunctions(elemFunctions, onRenderMap, elem);
  pushLifecycleFunctions(elemFunctions, onCleanupMap, elem);
  pushLifecycleFunctions(whereFunctions, onRenderMap, where);
  pushLifecycleFunctions(whereFunctions, onCleanupMap, where);

  if (elemFunctions.length !== whereFunctions.length) return false;
  if (String(elemFunctions) !== String(whereFunctions)) return false;

  for (let i = 0; i < elem.childNodes.length; i++) {
    const elemChild = elem.childNodes[i] as Element | Text;
    const whereChild = where.childNodes[i] as Element | Text;
    if (onlyTextChildren) {
      if (isTextNode(elemChild)) {
        if (!compareEvents(elemChild, whereChild, onlyTextChildren)) {
          return false;
        }
      }
    } else if (!compareEvents(elemChild, whereChild)) {
      return false;
    }
  }

  return true;
}
function pushTrackedHandlers(functions: Function[], elem: Element) {
  ownership.pushTrackedHandlers(functions, elem);
}
function pushLifecycleFunctions(
  functions: Function[],
  lifecycleMap: typeof onRenderMap | typeof onCleanupMap,
  node: ReturnType<typeof html>,
) {
  ownership.pushLifecycleFunctions(
    functions,
    lifecycleMap === onRenderMap ? "render" : "cleanup",
    node,
  );
}

function compare(
  elem: Element | DocumentFragment,
  where: Element | DocumentFragment | Text,
  onlyTextChildren?: boolean,
): boolean {
  if (isDocumentFragment(elem) || isDocumentFragment(where)) return false;
  return (
    elem.isEqualNode(where) && compareEvents(elem, where, onlyTextChildren)
  );
}

function render(
  elem: ReturnType<typeof html> | reactiveObject<any>,
  where: ReturnType<typeof html> | string = "",
  shouldSchedule = globalSchedule,
): ChildNode["remove"] {
  /* c8 ignore next 4 */
  if (shouldSchedule) {
    schedule(render, elem, where, false);
    return unmount(elem);
  }

  // Get elem value if elem is reactiveObject
  if (Reflect.has(elem, reactiveSymbol)) {
    elem = getValue(elem);
  }

  // Store elements of documentFragment for later unmount
  let elemChildren: Array<ChildNode> = [];
  if (isDocumentFragment(elem)) {
    elemChildren = Array.from(elem.childNodes);
    fragmentToElements.set(elem, elemChildren); // For diffing later
  }

  if (!where) {
    document.body.append(elem);
  } else {
    if (typeof where === Placeholder.string) {
      const resolveStringToElement = $(where as string);
      if (resolveStringToElement) {
        where = resolveStringToElement;
      } else {
        return noop;
      }
    }

    if (!reuseElements) {
      const previous = where as ReturnType<typeof html>;
      replaceElement(elem, previous);
      purgeDetached(previous);
    } else {
      if (isTextNode(elem)) {
        const previous = where as ReturnType<typeof html>;
        replaceElement(elem, previous);
        purgeDetached(previous);
      } else if (!compare(elem, where as Element | DocumentFragment | Text)) {
        treeDiff(
          elem as Element | DocumentFragment,
          where as Element | DocumentFragment | Text,
        );
      }
    }
  }

  runLifecyle(elem, onRenderMap);
  for (const subElem of elemChildren) {
    runLifecyle(subElem as Element | Text, onRenderMap);
  }

  return unmount(isDocumentFragment(elem) ? elemChildren : elem);
}
function noop() {}

function runLifecyle(
  node: ReturnType<typeof html>,
  lifecyleMap: typeof onRenderMap | typeof onCleanupMap,
) {
  ownership.runLifecycle(
    node,
    lifecyleMap === onRenderMap ? "render" : "cleanup",
  );
}

function filterTag2Elements(
  tag2Elements: Map<string, Array<Element>>,
  root: Element,
) {
  for (const [localName, list] of tag2Elements.entries()) {
    // Process list in reverse to avoid index issues when splicing
    for (let i = list.length - 1; i >= 0; i--) {
      const elem = list[i];

      if (root.contains(elem) || root.isSameNode(elem)) {
        list.splice(i, 1);
      }
    }
    if (list.length === 0) {
      tag2Elements.delete(localName);
    }
  }
}
function treeDiff(
  elem: Element | DocumentFragment,
  where: Element | DocumentFragment | Text,
) {
  const elemElements = [...elem.querySelectorAll("*")];
  if (!isDocumentFragment(elem)) elemElements.unshift(elem);

  let whereElements: typeof elemElements = [];
  if (!isTextNode(where)) {
    whereElements = [...where.querySelectorAll("*")];
    if (!isDocumentFragment(where)) whereElements.unshift(where);
  }

  let template: HTMLTemplateElement | HTMLDivElement;
  if (insertBeforeDiffing) {
    template = document.createElement(isServerSideCached ? "div" : "template");
    /* c8 ignore next 3 */
    if (where === document.documentElement) {
      where.append(template);
    } else {
      if (isDocumentFragment(where)) {
        fragmentToElements.get(where)![0].before(template);
      } else {
        where.before(template);
      }
    }
    template.append(elem);
  }

  // Create Mapping for easier diffing, eg: "div" -> [...Element]
  const tag2Elements = new Map<string, Array<Element>>();
  for (const wElem of whereElements) {
    /* c8 ignore next 2 */
    if (insertBeforeDiffing && wElem === template!) return;

    const sameTag = tag2Elements.get(wElem.localName);
    if (sameTag) {
      sameTag.push(wElem);
    } else {
      tag2Elements.set(wElem.localName, [wElem]);
    }
  }

  // Re-use any where Element if possible, then remove elem Element
  for (const subElem of elemElements) {
    const sameElements = tag2Elements!.get(subElem.localName);

    if (sameElements) {
      for (const whereElem of sameElements) {
        if (compare(subElem, whereElem, true)) {
          subElem.replaceWith(whereElem);
          runLifecyle(subElem, onCleanupMap);
          filterTag2Elements(tag2Elements, whereElem);
          break;
        }
      }
    }
  }

  if (insertBeforeDiffing) {
    const newElems = isDocumentFragment(elem)
      ? Array.from(template!.childNodes)
      : [elem];
    if (isDocumentFragment(where)) {
      const oldElems = fragmentToElements.get(where)!;
      for (const e of newElems) oldElems[0].before(e);
      for (const e of oldElems) e.remove();
    } else {
      if (where instanceof window.HTMLHtmlElement) {
        replaceElement(elem, where);
      } else {
        where.replaceWith(...newElems);
      }
    }
    template!.remove();
    runLifecyle(where, onCleanupMap);
  } else {
    replaceElement(elem, where);
  }
  if (!ignoreIsConnected) {
    for (const subElem of elemElements) {
      if (!subElem.isConnected) purgeSubtree(subElem);
    }
    for (const subElem of whereElements) {
      if (!subElem.isConnected) purgeSubtree(subElem);
    }
  }
  tag2Elements.clear();
}

function replaceElement(
  elem: ReturnType<typeof html>,
  where: ReturnType<typeof html>,
) {
  if (isDocumentFragment(where)) {
    const fragmentChildren = fragmentToElements.get(where)!;
    if (isDocumentFragment(elem)) {
      const fragmentElements = Array.from(elem.childNodes);
      for (let index = 0; index < fragmentChildren.length; index++) {
        const fragWhere = fragmentChildren[index];
        if (index < fragmentElements.length) {
          render(fragmentElements[index], fragWhere as Element);
        } else {
          fragWhere.remove();
        }
      }
    } else {
      for (let index = 0; index < fragmentChildren.length; index++) {
        const fragWhere = fragmentChildren[index];
        if (index === 0) {
          render(elem, fragWhere as Element);
        } else {
          fragWhere.remove();
        }
      }
    }
    /* c8 ignore start */
  } else if (isServerSideCached) {
    if (
      elem instanceof window.HTMLHtmlElement &&
      where instanceof window.HTMLHtmlElement
    ) {
      for (const key of elem.getAttributeNames()) {
        setAttribute(where, key, elem.getAttribute(key));
      }
      where.replaceChildren(...elem.childNodes);
    } else {
      where.replaceWith(elem);
    }
    /* c8 ignore end */
  } else {
    where.replaceWith(elem);
  }
  runLifecyle(where, onCleanupMap);
}

function unmount<T = ReturnType<typeof html> | Array<ChildNode>>(elem: T) {
  if (Array.isArray(elem)) {
    return () => elem.forEach(removeElement);
  } else {
    return () => removeElement(elem as unknown as Text | Element);
  }
}

function removeElement(elem: Text | Element) {
  if (!ignoreIsConnected && elem.isConnected) {
    elem.remove();
    runLifecyle(elem, onCleanupMap);
    purgeSubtree(elem);
  }
}

function purgeSubtree(root: Text | Element | DocumentFragment) {
  ownership.purgeSubtree(root);
}

function purgeDetached(node: ReturnType<typeof html>) {
  ownership.purgeDetached(node);
}

/* c8 ignore next 13 */
const hasScheduler = "scheduler" in window;
const schedulerOptions = { priority: "user-blocking" };
function schedule(fn: Function, ...args: any): void {
  if (hasScheduler) {
    // @ts-ignore
    window.scheduler.postTask(() => fn(...args), schedulerOptions);
  } else {
    // @ts-ignore
    window.requestIdleCallback(() => fn(...args));
  }
}

ownership = createOwnership({
  showElement: SHOW_ELEMENT,
  fragmentToElements,
  isTextNode,
  schedule,
  shouldSchedule: () => globalSchedule,
  shouldIgnoreIsConnected: () => ignoreIsConnected,
});
allNodeChanges = ownership.allNodeChanges;
elemEventFunctions = ownership.elemEventFunctions;
reactivityMap = ownership.reactivityMap;
bindMap = ownership.bindMap;
boundElemProxies = ownership.boundElemProxies;
tmpSwap = ownership.tmpSwap;
onRenderMap = ownership.onRenderMap;
onCleanupMap = ownership.onCleanupMap;
binding = createBinding({
  isServerSideCached,
  showElement: SHOW_ELEMENT,
  reactivityRegex,
  placeholder: {
    reactiveKey: Placeholder.reactiveKey,
    twoWay: Placeholder.twoWay,
    change: Placeholder.change,
    radio: Placeholder.radio,
    checkbox: Placeholder.checkbox,
    bind: "bind",
  },
  onEventRegex,
  propChainRegex,
  newLineRegex,
  isTextNode,
  isNode,
  isObject,
  isFunction,
  isEventObject,
  isReactiveValue,
  containsReactiveMarker,
  isBooleanAttribute: (value) => boolAttrSet.has(value),
  resolveObject,
  getReactivePath: (value) =>
    Reflect.get(value as object, keysSymbol.description!) as PropertyKey[],
  isProxy,
  setAttribute,
  addEventListener,
  trackBoundElement,
  setTraces,
  changeAttrVal,
});

const updateAdapter: UpdateAdapter<Element | Text> = {
  isConnected: (node) => node.isConnected,
  isText: isTextNode,
  isNode,
  isFunction,
  isEventObject,
  isObject: (value): value is Record<string, unknown> => isObject(value),
  replace: (node, value) => {
    replaceElement(
      value as ReturnType<typeof html>,
      node as ReturnType<typeof html>,
    );
    return isDocumentFragment(value as Node) ? null : (value as Element);
  },
  applyText: (node, start, end, value) => {
    const text = node as Text;
    const current = text.nodeValue!;
    text.nodeValue =
      current.substring(0, start) + value + current.substring(end);
  },
  applyControl: (node, _key, value) => {
    const elem = node as Element;
    if (
      elem instanceof window.HTMLInputElement &&
      elem.type === Placeholder.radio
    ) {
      elem.checked = Array.isArray(value)
        ? value.includes(elem.name)
        : String(value) === elem.value;
    } else if (
      elem instanceof window.HTMLInputElement &&
      elem.type === Placeholder.checkbox
    ) {
      elem.checked = Boolean(value);
    } else if (
      elem instanceof window.HTMLTextAreaElement ||
      elem instanceof window.HTMLSelectElement ||
      elem instanceof window.HTMLInputElement
    ) {
      (elem as HTMLInputElement).value = String(value);
    }
  },
  applyEvent: (node, key, value, oldValue) => {
    const elem = node as Element;
    const previous = oldValue as EventObject | EventListener;
    const oldHandler = isFunction(previous) ? previous : previous.event;
    removeTrackedEventListener(elem, key, oldHandler);
    addEventListener(elem, key, value as EventObject | EventListener);
  },
  applyObject: (node, value, oldValue) => {
    const elem = node as Element;
    const previous = oldValue as Record<string, any> | undefined;
    for (const [subKey, subValue] of Object.entries(value)) {
      if (isFunction(subValue) || isEventObject(subValue)) {
        const previousHandler = previous?.[subKey];
        const oldHandler = isFunction(previousHandler)
          ? previousHandler
          : previousHandler?.event;
        const eventName = subKey.replace(onEventRegex, "");
        if (oldHandler) removeTrackedEventListener(elem, eventName, oldHandler);
        addEventListener(elem, eventName, subValue as EventObject | EventListener);
      } else {
        setAttribute(elem, subKey, subValue);
      }
    }
  },
  applyAttribute: (node, key, start, end, value) => {
    const elem = node as Element;
    let attr = elem.getAttribute(key);
    const valueString = String(value);
    if (attr) {
      attr = attr.substring(0, start) + valueString + attr.substring(end);
      setAttribute(elem, key, attr === valueString ? value : attr);
    } else {
      setAttribute(elem, key, value);
    }
  },
};
updateEngine = createUpdateEngine({
  adapter: updateAdapter,
  allNodeChanges,
  reactivityMap,
  schedule,
  isAsync: (obj) => Reflect.get(obj, Placeholder.asyncUpdate),
  isServerSideCached,
  shouldIgnoreIsConnected: () => ignoreIsConnected,
  onEvent: (key) => key.replace(onEventRegex, ""),
  twoWayKey: Placeholder.twoWay,
});

function reactive<T>(initial: T): reactiveObject<T> {
  let key: string;

  do key = `hydror${reactiveKeyCounter++}`;
  while (Reflect.has(hydro, key));

  Reflect.set(hydro, key, initial);
  Reflect.set(setter, reactiveSymbol, true);

  const chainKeysProxy = chainKeys(setter, [key]);
  if (isObject(initial)) {
    hydroToReactive.set(Reflect.get(hydro, key), chainKeysProxy);
  }
  return chainKeysProxy;

  function setter<U>(val: U) {
    const keys = // @ts-ignore
      (this && Reflect.has(this, reactiveSymbol) ? this : chainKeysProxy)[
        keysSymbol.description!
      ];
    const [resolvedValue, resolvedObj] = resolveObject(keys);
    const lastProp = keys[keys.length - 1];

    if (isFunction(val)) {
      const returnVal = val(resolvedValue);
      const sameObject = resolvedValue === returnVal;
      if (sameObject) return;

      Reflect.set(resolvedObj, lastProp, returnVal ?? resolvedValue);
    } else {
      Reflect.set(resolvedObj, lastProp, val);
    }
  }
}
function chainKeys(initial: Function | any, keys: Array<PropertyKey>): any {
  // One-slot memo per chain node: a row builder touches the same path
  // (e.g. data[index]) several times, so re-allocating a Proxy plus a copied
  // key array on every property read is pure garbage.
  let cachedKey: PropertyKey | undefined;
  let cachedProxy: any;
  let toPrimitive: (() => string) | undefined;

  return new Proxy(initial, {
    get(target, subKey, _receiver) {
      if (subKey === reactiveSymbol.description) return true;
      if (subKey === keysSymbol.description) {
        return keys;
      }

      if (subKey === Symbol.toPrimitive) {
        return (toPrimitive ??= () =>
          isServerSideCached
            ? `${Placeholder.reactiveKey}${keys.join(".")}`
            : `{{${keys.join(".")}}}`);
      }

      if (subKey === cachedKey) return cachedProxy;

      const chained = chainKeys(target, [...keys, subKey]) as hydroObject &
        ((setter: any) => void);
      cachedKey = subKey;
      cachedProxy = chained;
      return chained;
    },
  });
}
function getReactiveKeys(reactiveHydro: reactiveObject<any>) {
  const keys = reactiveHydro[keysSymbol.description!];
  const lastProp = keys[keys.length - 1];
  return [lastProp, keys.length === 1];
}
function unset(reactiveHydro: reactiveObject<any>): void {
  const ternaryDisposer = ternaryDisposers.get(reactiveHydro);
  if (ternaryDisposer) {
    if (ternaryDisposer.done) return;
    ternaryDisposer.stop();
    ternaryDisposer.done = true;
  }

  const [lastProp, oneKey] = getReactiveKeys(reactiveHydro);

  if (oneKey) {
    const previousValue = Reflect.get(hydro, lastProp);
    Reflect.set(hydro, lastProp, null);
    hydroToReactive.delete(previousValue);
  } else {
    const [_, resolvedObj] = resolveObject(
      reactiveHydro[keysSymbol.description!],
    );
    Reflect.set(resolvedObj, lastProp, null);
  }
}
function setAsyncUpdate(
  reactiveHydro: reactiveObject<any>,
  asyncUpdate: boolean,
) {
  const [_, oneKey] = getReactiveKeys(reactiveHydro);

  if (oneKey) {
    hydro.asyncUpdate = asyncUpdate;
  } else {
    const [_, resolvedObj] = resolveObject(
      reactiveHydro[keysSymbol.description!],
    );
    resolvedObj.asyncUpdate = asyncUpdate;
  }
}
function observe(reactiveHydro: reactiveObject<any>, fn: Function) {
  if (reactiveHydro === undefined) return reactiveHydro;
  const [lastProp, oneKey] = getReactiveKeys(reactiveHydro);

  if (oneKey) {
    return hydro.observe(lastProp, fn);
  } else {
    const [_, resolvedObj] = resolveObject(
      reactiveHydro[keysSymbol.description!],
    );
    return resolvedObj.observe(lastProp, fn);
  }
}
function unobserve(reactiveHydro: reactiveObject<any>) {
  const [lastProp, oneKey] = getReactiveKeys(reactiveHydro);

  if (oneKey) {
    hydro.unobserve(lastProp);
  } else {
    const [_, resolvedObj] = resolveObject(
      reactiveHydro[keysSymbol.description!],
    );
    resolvedObj.unobserve(lastProp);
  }
}
function ternary(
  condition: Function | reactiveObject<any>,
  trueVal: any,
  falseVal: any,
  reactiveHydro: reactiveObject<any> = condition,
) {
  // Resolve the shape of the inputs once instead of on every notification: a
  // list where every row observes the same signal calls this per row per change.
  const conditionIsFunction =
    !Reflect.has(condition, reactiveSymbol) && isFunction(condition);
  const trueValIsFunction = isFunction(trueVal);
  const falseValIsFunction = isFunction(falseVal);

  const checkCondition = (cond: any) =>
    (
      conditionIsFunction
        ? (condition as Function)(cond)
        : isPromise(cond)
          ? false
          : cond
    )
      ? trueValIsFunction
        ? trueVal()
        : trueVal
      : falseValIsFunction
        ? falseVal()
        : falseVal;

  const ternaryValue = reactive(checkCondition(getValue(reactiveHydro)));

  const stopObserving = observe(reactiveHydro, (newVal: any) => {
    if (newVal === null) {
      unset(ternaryValue);
      return;
    }

    const nextValue = checkCondition(newVal);
    // Setting the identical value is a no-op inside the Proxy anyway - skip the
    // setter round trip for every row whose derived value did not change.
    if (nextValue === getValue(ternaryValue)) return;

    ternaryValue(nextValue);
  });

  if (stopObserving) {
    ternaryDisposers.set(ternaryValue, {
      stop: stopObserving,
      done: false,
    });
  }

  return ternaryValue;
}
function emit(
  eventName: string,
  data: any,
  who: EventTarget,
  options: object = { bubbles: true },
) {
  who.dispatchEvent(
    new window.CustomEvent(eventName, { ...options, detail: data }),
  );
}
let trackDeps = false;
const trackProxies = new Set<hydroObject>();
function trackDependency(receiver: hydroObject, key: PropertyKey) {
  trackProxies.add(receiver);
  const keys = trackMap.get(receiver);
  if (keys) {
    keys.add(key);
  } else {
    trackMap.set(receiver, new Set([key]));
  }
}
const trackMap = new WeakMap<hydroObject, Set<PropertyKey>>();
const unobserveMap = new WeakMap<
  Function,
  Array<{ proxy: hydroObject; key: PropertyKey }>
>();
function watchEffect(fn: Function) {
  trackDeps = true;
  const res = fn();
  if (isPromise(res)) {
    res.then(() => {
      trackDeps = false;
    });
  } else {
    trackDeps = false;
  }

  const reRun = (newVal: PropertyKey) => {
    if (newVal !== null) fn();
  };

  for (const proxy of trackProxies) {
    const trackedKeys = trackMap.get(proxy);
    if (!trackedKeys) continue;

    for (const key of trackedKeys) {
      proxy.observe(key, reRun);

      const entries = unobserveMap.get(reRun);
      if (entries) {
        entries.push({ proxy, key });
      } else {
        unobserveMap.set(reRun, [{ proxy, key }]);
      }
    }
    trackMap.delete(proxy);
  }

  trackProxies.clear();

  return () => {
    const entries = unobserveMap.get(reRun);
    if (!entries) return;

    entries.forEach((entry) => entry.proxy.unobserve(entry.key, reRun));
    unobserveMap.delete(reRun);
  };
}

function getValue<T extends object>(reactiveHydro: T): T {
  if (reactiveHydro === undefined) return reactiveHydro;
  const [resolvedValue] = resolveObject(
    Reflect.get(reactiveHydro, keysSymbol.description!) as PropertyKey[],
  );
  return resolvedValue;
}

function addLifecycle(
  lifecycleMap: typeof onRenderMap | typeof onCleanupMap,
  elem: ReturnType<typeof html>,
  fn: Function,
) {
  ownership.addLifecycle(
    lifecycleMap === onRenderMap ? "render" : "cleanup",
    elem,
    fn,
  );
}
function onRender(
  fn: Function,
  elem: ReturnType<typeof html>,
  ...args: Array<any>
) {
  addLifecycle(onRenderMap, elem, args.length ? fn.bind(fn, ...args) : fn);
}
function onCleanup(
  fn: Function,
  elem: ReturnType<typeof html>,
  ...args: Array<any>
) {
  addLifecycle(onCleanupMap, elem, args.length ? fn.bind(fn, ...args) : fn);
}

// Core of the library
const sharedHandlers = Symbol("handlers");
type handlerMap = Map<PropertyKey, Set<Function>>;
// The handler Map is created lazily: most Proxies (e.g. every row object of a
// list) are never observed, so allocating a Map per Proxy is wasted memory.
function getHandlers(obj: object): handlerMap | undefined {
  return Reflect.get(obj, sharedHandlers) as handlerMap | undefined;
}
function ensureHandlers(obj: object): handlerMap {
  let map = Reflect.get(obj, sharedHandlers) as handlerMap | undefined;
  if (!map) {
    map = new Map();
    Reflect.defineProperty(obj, sharedHandlers, { value: map });
  }
  return map;
}
function observeMethod(this: hydroObject, key: PropertyKey, handler: Function) {
  const map = ensureHandlers(this);
  const handlersForKey = map.get(key);
  if (handlersForKey) {
    handlersForKey.add(handler);
  } else {
    map.set(key, new Set([handler]));
  }

  return () => {
    const handlersForKey = map.get(key);
    if (!handlersForKey) return;

    handlersForKey.delete(handler);
    if (handlersForKey.size === 0) map.delete(key);
  };
}
function getObserversMethod(this: hydroObject) {
  return ensureHandlers(this);
}
function unobserveMethod(
  this: hydroObject,
  key: PropertyKey,
  handler: Function,
) {
  const map = getHandlers(this);
  if (!map) return;

  if (key) {
    const handlersForKey = map.get(key);
    if (!handlersForKey) return;

    if (handler == null) {
      map.delete(key);
    } else if (handlersForKey.has(handler)) {
      handlersForKey.delete(handler);
      if (handlersForKey.size === 0) map.delete(key);
    }
  } else {
    map.clear();
  }
}
// Reused descriptor map: defining the internal properties on the raw target
// before wrapping it saves the defineProperty trap round trips and the five
// descriptor objects each created reactive object used to allocate.
const proxyDescriptors: PropertyDescriptorMap = {
  [Placeholder.isProxy]: { value: true },
  [Placeholder.asyncUpdate]: { value: true, writable: true },
  [Placeholder.observe]: { value: observeMethod, configurable: true },
  [Placeholder.getObservers]: { value: getObserversMethod, configurable: true },
  [Placeholder.unobserve]: { value: unobserveMethod, configurable: true },
};
function generateProxy(obj?: Record<PropertyKey, unknown>): hydroObject {
  const target = obj ?? {};
  proxyDescriptors[Placeholder.asyncUpdate].value = globalSchedule;
  Object.defineProperties(target, proxyDescriptors);

  return new Proxy(target, proxyHandler) as hydroObject;
}

// One shared handler object for every Proxy: a per-call object literal with two
// closures would allocate three objects per reactive object (10k rows = 30k).
const proxyBoundFunctions = new WeakMap<object, WeakMap<Function, Function>>();
function bindToTarget(target: object, value: Function) {
  let boundFunctions = proxyBoundFunctions.get(target);
  const cachedFunction = boundFunctions?.get(value);
  if (cachedFunction) return cachedFunction;

  const boundFunction = value.bind(target);
  if (!boundFunctions) {
    boundFunctions = new WeakMap();
    proxyBoundFunctions.set(target, boundFunctions);
  }
  boundFunctions.set(value, boundFunction);
  return boundFunction;
}
const proxyHandler = {
  // If receiver is a getter, then it is the object on which the search first started for the property|key -> Proxy
  set(target, key, val, receiver) {
    if (trackDeps) trackDependency(receiver, key);

    let returnSet = true;
    let oldVal = Reflect.get(target, key, receiver);
    if (oldVal === val) return returnSet;

    // Reset Path - mostly GC
    if (val === null) {
      // Remove entry from reactitivyMap underlying Map
      if (reactivityMap.has(receiver)) {
        const key2NodeMap = reactivityMap.get(receiver)!;
        key2NodeMap.delete(String(key));
        if (key2NodeMap.size === 0) {
          reactivityMap.delete(receiver);
        }
      }

      // Inform the Observers about null change and unobserve
      const observer = Reflect.get(target, sharedHandlers, receiver) as
        | handlerMap
        | undefined;
      const handlersForKey = observer?.get(key);
      if (handlersForKey) {
        for (const handler of handlersForKey) {
          handler(null, oldVal);
        }
        handlersForKey.clear();
        receiver.unobserve(key);
      }

      // If oldVal is a Proxy - clean it
      const boundTo = isObject(oldVal) && isProxy(oldVal) ? oldVal : receiver;
      if (boundTo === oldVal) {
        oldVal.unobserve();
        reactivityMap.delete(oldVal);
      }
      const boundElements = bindMap.get(boundTo);
      if (boundElements) {
        bindMap.delete(boundTo);
        boundElements.forEach(removeElement);
      }

      // Remove item from array
      /* c8 ignore next 4 */
      if (!internReset && Array.isArray(receiver)) {
        receiver.splice(Number(key), 1);
        return returnSet;
      }

      return Reflect.deleteProperty(receiver, key);
    }

    // Set the value
    if (isPromise(val)) {
      val
        .then((value) => {
          // No Reflect in order to trigger the Getter
          receiver[key] = value;
        })
        .catch((e) => {
          console.error(e);
          receiver[key] = null;
        });
      returnSet = Reflect.set(target, key, val, receiver);
      return returnSet;
    } else if (isNode(val)) {
      returnSet = Reflect.set(target, key, val, receiver);
    } else if (isObject(val) && !isProxy(val)) {
      returnSet = Reflect.set(target, key, generateProxy(val), receiver);

      // Recursively set properties to Proxys too
      const subKeys = Object.keys(val);
      for (let index = 0; index < subKeys.length; index++) {
        const subKey = subKeys[index];
        const subVal = val[subKey];
        if (isObject(subVal) && !isProxy(subVal)) {
          Reflect.set(val, subKey, generateProxy(subVal));
        }
      }
    } else {
      // A swap: the incoming value already sits somewhere else in the same
      // array. One indexOf answers both "is it a member" and "where" -
      // includes + includes + findIndex walked the array three times. Array
      // methods are bound to the raw target by the get trap, so this does not
      // re-enter the Proxy per element.
      const swapIndex =
        !reuseElements &&
        Array.isArray(receiver) &&
        bindMap.has(val) &&
        bindMap.has(oldVal)
          ? (receiver.indexOf(val) as number)
          : -1;
      if (swapIndex !== -1) {
        /* c8 ignore start */
        const [elem] = bindMap.get(val)!;
        if (lastSwapElem !== elem) {
          const [oldElem] = bindMap.get(oldVal)!;
          lastSwapElem = oldElem;

          const prevElem = elem.previousSibling!;
          const prevOldElem = oldElem.previousSibling!;

          // Move it in the array too without triggering the proxy set
          receiver.splice(Number(key), 1, val);
          receiver.splice(swapIndex, 1, oldVal);

          prevElem.after(oldElem);
          prevOldElem.after(elem);
          lastSwapElem = null;
        }
        return true;
      } else {
        /* c8 ignore end */
        returnSet = Reflect.set(target, key, val, receiver);
      }
    }

    const newVal = Reflect.get(target, key, receiver);

    // Check if DOM needs to be updated
    // oldVal can be Proxy value too
    const oldValReactivity = reactivityMap.get(oldVal);
    if (oldValReactivity) {
      checkReactivityMap(oldVal, key, newVal, oldVal);
    } else if (reactivityMap.has(receiver)) {
      checkReactivityMap(receiver, key, newVal, oldVal);
    }

    // current val (before setting) is a proxy - take over its keyToNodeMap
    if (oldValReactivity && isObject(val) && isProxy(val)) {
      // Store old reactivityMap if it is a swap operation
      if (reuseElements) tmpSwap.set(oldVal, oldValReactivity);

      const swapped = tmpSwap.get(val);
      if (swapped) {
        reactivityMap.set(oldVal, swapped);
        tmpSwap.delete(val);
      } else {
        reactivityMap.set(oldVal, reactivityMap.get(val)!);
      }
    }

    // Inform the Observers
    if (returnSet) {
      const handlers = getHandlers(target)?.get(key);
      if (handlers) {
        for (const handler of handlers) handler(newVal, oldVal);
      }
    }

    // If oldVal is a Proxy - clean it
    !reuseElements && oldVal && cleanProxy(oldVal);

    return returnSet;
  },

  // fix proxy bugs, e.g Map
  get(target, prop, receiver) {
    if (trackDeps) trackDependency(receiver, prop);
    const value = Reflect.get(target, prop, receiver);
    if (!isFunction(value)) {
      return value;
    }

    return bindToTarget(target, value);
  },
} as ProxyHandler<hydroObject>;

function cleanProxy(proxy: any) {
  if (isObject(proxy) && isProxy(proxy)) {
    proxy.unobserve();
    reactivityMap.delete(proxy);
    /* c8 ignore next 5 */
    const boundElements = bindMap.get(proxy);
    if (boundElements) {
      bindMap.delete(proxy);
      boundElements.forEach(removeElement);
    }
  }
}

function checkReactivityMap(obj: any, key: PropertyKey, val: any, oldVal: any) {
  updateEngine.checkReactivityMap(obj, key, val, oldVal);
}

function resetViewRows(rootElem: Element) {
  ownership.resetViewRows(rootElem);
}

const viewImplementation = createView({
  state: viewState,
  select: (root) => $(root),
  getValue: (data) => getValue(data as reactiveObject<any[]>),
  observe: (data, handler) => observe(data as reactiveObject<any[]>, handler),
  unset: (data) => unset(data as reactiveObject<any>),
  onCleanup,
  runLifecycle: (node) => runLifecyle(node as ReturnType<typeof html>, onRenderMap),
  setReactivity: (root, eventFunctions) =>
    setReactivity(root, eventFunctions as eventFunctions),
  isPrewired: isViewPrewired,
  resetRows: resetViewRows,
  reuseElements: () => reuseElements,
});
function view(
  root: string,
  data: reactiveObject<Array<any>>,
  renderFunction: (value: any, index: number) => Node,
) {
  viewImplementation(root, data, renderFunction);
}

const hydro = generateProxy();
const $ = document.querySelector.bind(document) as <T extends string>(
  query: T,
) => QueryResult<T>;
const $$ = document.querySelectorAll.bind(document) as unknown as <
  T extends string,
>(
  query: T,
) => Array<NonNullable<QueryResult<T>>> | [];

// Credit to https://twitter.com/MikeRyanDev/status/1308472279010025477
type Split<
  S extends string,
  D extends string,
> = S extends `${infer T}${D}${infer U}` ? [T, ...Split<U, D>] : [S];
type TakeLast<V> = V extends []
  ? never
  : V extends [string]
    ? V[0]
    : V extends [string, ...infer R]
      ? TakeLast<R>
      : never;
type TrimLeft<V extends string> = V extends ` ${infer R}` ? TrimLeft<R> : V;
type TrimRight<V extends string> = V extends `${infer R} ` ? TrimRight<R> : V;
type Trim<V extends string> = TrimLeft<TrimRight<V>>;
type StripModifier<
  V extends string,
  M extends string,
> = V extends `${infer L}${M}${infer A}` ? L : V;
type StripModifiers<V extends string> = StripModifier<
  StripModifier<StripModifier<StripModifier<V, ".">, "#">, "[">,
  ":"
>;
type TakeLastAfterToken<V extends string, T extends string> = StripModifiers<
  TakeLast<Split<Trim<V>, T>>
>;
type GetLastElementName<V extends string> = TakeLastAfterToken<
  TakeLastAfterToken<V, " ">,
  ">"
>;
type GetEachElementName<V, L extends string[] = []> = V extends []
  ? L
  : V extends [string]
    ? [...L, GetLastElementName<V[0]>]
    : V extends [string, ...infer R]
      ? GetEachElementName<R, [...L, GetLastElementName<V[0]>]>
      : [];
type GetElementNames<V extends string> = GetEachElementName<Split<V, ",">>;
type ElementByName<V extends string> = V extends keyof HTMLElementTagNameMap
  ? HTMLElementTagNameMap[V]
  : V extends keyof SVGElementTagNameMap
    ? SVGElementTagNameMap[V]
    : Element;
type MatchEachElement<V, L extends Element | null = null> = V extends []
  ? L
  : V extends [string]
    ? L | ElementByName<V[0]>
    : V extends [string, ...infer R]
      ? MatchEachElement<R, L | ElementByName<V[0]>>
      : L;
type QueryResult<T extends string> = MatchEachElement<GetElementNames<T>>;

const internals = {
  compare,
  allNodeChanges,
  hydroToReactive,
  boolAttrList: Array.from(boolAttrSet),
};
export {
  render,
  html,
  h,
  hydro,
  setGlobalSchedule,
  setReuseElements,
  setInsertDiffing,
  setShouldSetReactivity,
  setIgnoreIsConnected,
  reactive,
  unset,
  setAsyncUpdate,
  unobserve,
  observe,
  ternary,
  emit,
  watchEffect,
  internals,
  getValue,
  onRender,
  onCleanup,
  setReactivity,
  $,
  $$,
  view,
  isServerSide,
};
