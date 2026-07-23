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
type nodeChanges = Array<
  [number, number, string | undefined, hydroObject, string]
>;

// Circular reference
type nodeToChangeMap = Map<
  Element | Text | nodeChanges,
  Element | Text | nodeChanges
>;
interface keyToNodeMap extends Map<string, nodeToChangeMap> {}
interface EventObject {
  event: EventListener;
  options: AddEventListenerOptions;
}
type reactiveObject<T> = T & hydroObject & ((setter: any) => void);
type eventType = EventListener | EventObject;
type eventFunctions = Map<string, eventType>;
type lifecycleFn = Function | Function[];
type htmlPart =
  | {
      kind: "text";
      path: number[];
      markers: number[];
      template: string;
    }
  | {
      kind: "attribute";
      path: number[];
      attr: string;
      markers: number[];
      template: string;
    };

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

const range = document.createRange();
range.selectNodeContents(
  range.createContextualFragment(`<${Placeholder.template}>`).lastChild!,
);
const defaultParser = range.createContextualFragment.bind(range);

const allNodeChanges = new WeakMap<Text | Element, nodeChanges>(); // Maps a Node against an array of changes. An array is necessary because a node can have multiple variables for one text / attribute.
const elemEventFunctions = new WeakMap<
  Element,
  Map<string, Set<EventListener>>
>(); // Stores event functions in order to compare Elements against each other.
const reactivityMap = new WeakMap<hydroObject, keyToNodeMap>(); // Maps Proxy Objects to another Map(proxy-key, node).
const bindMap = new WeakMap<hydroObject, Array<Element>>(); // Bind an Element to data. If the data is being unset, the DOM Element disappears too.
const boundElemProxies = new WeakMap<
  Element,
  hydroObject | Array<hydroObject>
>(); // Reverse of bindMap: which Proxies an Element is bound to.
const tmpSwap = new WeakMap<hydroObject, keyToNodeMap>(); // Take over keyToNodeMap if the new value is a hydro Proxy. Save old reactivityMap entry here, in case for a swap operation.
const onRenderMap = new WeakMap<ReturnType<typeof html>, lifecycleFn>(); // Lifecycle Hook that is being called after rendering
const onCleanupMap = new WeakMap<ReturnType<typeof html>, lifecycleFn>(); // Lifecycle Hook that is being called when unmount function is being called
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
const viewElementsEventFunctions = new Map() as eventFunctions;
const isServerSideCached = isServerSide();

let globalSchedule = true; // Decides whether to schedule rendering and updating (async)
let reuseElements = true; // Reuses Elements when rendering
let insertBeforeDiffing = false; // Makes sense in Chrome only
let shouldSetReactivity = true;
let viewElements = false;
let ignoreIsConnected = false;

const reactivityRegex = new RegExp(
  isServerSideCached
    ? `\\{\\{([^]*?)\\}\\}|${Placeholder.reactiveKey}([a-zA-Z0-9_.-]+)`
    : `\\{\\{([^]*?)\\}\\}`,
);
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
  return isObject(node) && node instanceof window.Node;
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
  const isFn = isFunction(obj);
  const handler = isFn ? obj : obj.event;

  node.addEventListener(eventName, handler, isFn ? {} : obj.options);
  if (elemEventFunctions.has(node)) {
    const events = elemEventFunctions.get(node)!;
    if (events.has(eventName)) {
      events.get(eventName)!.add(handler);
    } else {
      events.set(eventName, new Set([handler]));
    }
  } else {
    elemEventFunctions.set(node, new Map([[eventName, new Set([handler])]]));
  }
}

function removeTrackedEventListener(
  node: Element,
  eventName: string,
  handler: EventListener,
) {
  node.removeEventListener(eventName, handler);
  node.removeEventListener(eventName, handler, true);
  const map = elemEventFunctions.get(node);
  if (!map) return;

  const handlers = map.get(eventName);
  if (!handlers) return;

  handlers.delete(handler);
  if (handlers.size === 0) {
    map.delete(eventName);
  }
  if (map.size === 0) {
    elemEventFunctions.delete(node);
  }
}

function purgeTrackedEventListeners(node: Element) {
  const events = elemEventFunctions.get(node);
  if (!events) return;

  events.forEach((handlers, eventName) => {
    handlers.forEach((handler) => {
      node.removeEventListener(eventName, handler);
      node.removeEventListener(eventName, handler, true);
    });
  });
  elemEventFunctions.delete(node);
}

function trackBoundElement(proxy: hydroObject, elem: Element) {
  if (bindMap.has(proxy)) {
    bindMap.get(proxy)!.push(elem);
  } else {
    bindMap.set(proxy, [elem]);
  }

  const current = boundElemProxies.get(elem);
  if (!current) {
    boundElemProxies.set(elem, proxy);
  } else if (Array.isArray(current)) {
    if (!current.includes(proxy)) current.push(proxy);
  } else if (current !== proxy) {
    boundElemProxies.set(elem, [current, proxy]);
  }
}

function untrackBoundElement(proxy: hydroObject, elem: Element) {
  const elements = bindMap.get(proxy);
  if (!elements) return;

  const index = elements.indexOf(elem);
  if (index !== -1) elements.splice(index, 1);
  if (elements.length === 0) bindMap.delete(proxy);
}

function purgeTrackedEventListenersInSubtree(root: Element) {
  purgeTrackedEventListeners(root);
  for (const node of root.querySelectorAll("*")) {
    purgeTrackedEventListeners(node);
  }
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
      if (viewElements) viewElementsEventFunctions.set(funcName, variable);
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
          viewElements && viewElementsEventFunctions.set(funcName, value);
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
  if (!viewElements) {
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
  const before = htmlArray[index];
  const after = htmlArray[index + 1];
  if (/<\/?$/.test(before)) return false;
  return !/<[^>]*\s$/.test(before) || !/^\s*>/.test(after);
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
function markCachedHTMLWired(node: Node) {
  Reflect.set(node, prewiredSymbol, true);
}
function isViewPrewired(node: Node) {
  return !!Reflect.get(node, prewiredSymbol);
}
function buildHTMLParts(root: DocumentFragment) {
  const parts: htmlPart[] = [];
  walkHTMLParts(root, [], parts);
  return parts;
}
function walkHTMLParts(node: Node, path: number[], parts: htmlPart[]) {
  for (let index = 0; index < node.childNodes.length; index++) {
    const child = node.childNodes[index];
    if (isTextNode(child)) {
      const value = child.nodeValue ?? "";
      if (value.includes("__hydro")) {
        parts.push({
          kind: "text",
          path: [...path, index],
          markers: findMarkerIndexes(value),
          template: value,
        });
      }
    } else if (child.nodeType === window.Node.ELEMENT_NODE) {
      const elem = child as Element;
      const childPath = [...path, index];
      for (const attr of elem.getAttributeNames()) {
        const value = elem.getAttribute(attr) ?? "";
        if (value.includes("__hydro")) {
          parts.push({
            kind: "attribute",
            path: childPath,
            attr,
            markers: findMarkerIndexes(value),
            template: value,
          });
        }
      }
      walkHTMLParts(elem, childPath, parts);
    }
  }
}
function findMarkerIndexes(value: string) {
  const indexes: number[] = [];
  const marker = /__hydro(\d+)__/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(value))) indexes.push(Number(match[1]));
  return indexes;
}
function replaceCompiledMarkers(
  template: string,
  markers: number[],
  variables: unknown[],
  values: Array<string | undefined>,
) {
  let result = template;
  for (const index of markers) {
    values[index] ??= String(variables[index]);
    result = result.split(`__hydro${index}__`).join(values[index]!);
  }
  return result;
}
function applyCompiledParts(
  root: DocumentFragment,
  parts: htmlPart[],
  variables: unknown[],
) {
  const values = new Array<string | undefined>(variables.length);
  for (const part of parts) {
    let node: Node = root;
    for (const index of part.path) node = node.childNodes[index];

    const value = replaceCompiledMarkers(
      part.template,
      part.markers,
      variables,
      values,
    );
    if (part.kind === "text") {
      (node as Text).nodeValue = value;
      if (part.markers.some((index) => isReactiveValue(variables[index]))) {
        setReactivitySingle(node as Text);
      }
      continue;
    }

    const elem = node as Element;
    if (part.markers.length === 1 && part.attr.startsWith("on")) {
      const variable = variables[part.markers[0]];
      if (
        !isReactiveValue(variable) &&
        (isFunction(variable) || isEventObject(variable))
      ) {
        elem.removeAttribute(part.attr);
        addEventListener(elem, part.attr.replace(onEventRegex, ""), variable);
        continue;
      }
    }
    if (part.markers.some((index) => isReactiveValue(variables[index]))) {
      setReactivitySingle(elem, part.attr, value);
    } else {
      setAttribute(elem, part.attr, value);
    }
  }
}
function fillDOM(
  elem: ReturnType<typeof html>,
  insertNodes: Node[],
  eventFunctions: eventFunctions,
) {
  const root = document.createNodeIterator(
    elem,
    window.NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(element: Element) {
        return element.localName.endsWith(Placeholder.dummy)
          ? window.NodeFilter.FILTER_ACCEPT
          : window.NodeFilter.FILTER_REJECT;
      },
    },
  );
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
  if (key === "bind") {
    if (!isReactiveValue(value)) return false;

    const keys = Reflect.get(value, keysSymbol.description!) as PropertyKey[];
    const [resolvedValue, resolvedObj] = resolveObject(keys);
    const proxy =
      isObject(resolvedValue) && isProxy(resolvedValue)
        ? resolvedValue
        : resolvedObj;
    trackBoundElement(proxy, elem);
    return true;
  }

  if (key === Placeholder.twoWay || key in elem || boolAttrSet.has(key)) {
    return false;
  }

  const keys = Reflect.get(
    value as object,
    keysSymbol.description!,
  ) as PropertyKey[];
  const [resolvedValue, resolvedObj] = resolveObject(keys);
  if (
    resolvedValue == null ||
    isNode(resolvedValue) ||
    isFunction(resolvedValue) ||
    isEventObject(resolvedValue) ||
    isObject(resolvedValue)
  ) {
    return false;
  }

  const applied = setAttribute(elem, key, resolvedValue);
  setTraces(
    0,
    applied ? String(resolvedValue).length : 0,
    elem,
    String(keys[keys.length - 1]),
    resolvedObj,
    key,
  );
  return true;
}
function wireViewHChild(elem: Element | DocumentFragment, child: unknown) {
  const keys = Reflect.get(
    child as object,
    keysSymbol.description!,
  ) as PropertyKey[];
  const [resolvedValue, resolvedObj] = resolveObject(keys);
  if (isNode(resolvedValue)) return false;

  const textContent = isObject(resolvedValue)
    ? window.JSON.stringify(resolvedValue)
    : (resolvedValue ?? "");
  const textNode = document.createTextNode(String(textContent));
  elem.appendChild(textNode);
  setTraces(
    0,
    String(textContent).length,
    textNode,
    String(keys[keys.length - 1]),
    resolvedObj,
  );
  return true;
}
function h(
  name: string | ((...args: any[]) => ReturnType<typeof h>) | FragmentCase,
  props: Record<keyof any, any> | null,
  ...children: Array<any>
): ReturnType<typeof html> {
  if (isFunction(name)) return name({ ...props, children });

  const elem =
    typeof name === Placeholder.string
      ? document.createElement(
          name as string,
          props?.hasOwnProperty("is") ? { is: props["is"] } : undefined,
        )
      : document.createDocumentFragment();
  let viewPrewired = viewElements;
  let needsScan = false;
  for (const i in props) {
    if (viewElements && (i === "bind" || isReactiveValue(props[i]))) {
      if (wireViewHProp(elem as Element, i, props[i])) continue;
      viewPrewired = false;
    } else if (
      !viewElements &&
      !needsScan &&
      (i === "bind" ||
        i === Placeholder.twoWay ||
        containsReactiveValue(props[i]))
    ) {
      needsScan = true;
    }
    i in elem && !boolAttrSet.has(i)
      ? //@ts-ignore
        (elem[i] = props[i])
      : setAttribute(elem as HTMLElement, i, props[i]);
  }

  if (isDocumentFragment(elem)) {
    children = (name as FragmentCase).children;
  }
  const flatChildren = children.some((i) => Array.isArray(i))
    ? children.map(getChildren).flat()
    : children;
  for (const child of flatChildren) {
    let childIsNode = false;
    if (viewElements) {
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
  if (!viewElements) {
    if (needsScan) setReactivity(elem);
    Reflect.set(elem, prewiredSymbol, true);
  } else if (viewPrewired) {
    Reflect.set(elem, prewiredSymbol, true);
  }
  return elem;
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
  if (isTextNode(DOM)) {
    setReactivitySingle(DOM);
    return;
  }

  const elems = document.createNodeIterator(
    DOM,
    window.NodeFilter.SHOW_ELEMENT,
  );
  let elem;
  while ((elem = elems.nextNode() as Element)) {
    for (const key of elem.getAttributeNames()) {
      // Set functions
      const val = elem.getAttribute(key)!;
      if (eventFunctions && key.startsWith("on")) {
        const eventName = key.replace(onEventRegex, "");
        if (!(eventFunctions instanceof Map)) {
          eventFunctions = new Map(Object.entries(eventFunctions));
        }
        const event = eventFunctions?.get(val);
        if (!event) {
          setReactivitySingle(elem, key, val);
          continue;
        }
        elem.removeAttribute(key);
        addEventListener(elem, eventName, event);
      } else {
        setReactivitySingle(elem, key, val);
      }
    }

    let childNode = elem.firstChild;
    while (childNode) {
      if (
        isTextNode(childNode) &&
        (childNode.nodeValue?.includes("{{") ||
          (isServerSideCached &&
            childNode.nodeValue?.includes(Placeholder.reactiveKey)))
      ) {
        setReactivitySingle(childNode);
      }
      childNode = childNode.nextSibling;
    }
  }
}
function setReactivitySingle(node: Text): void; // TS function overload
function setReactivitySingle(node: Element, key: string, val: string): void; // TS function overload
function setReactivitySingle(
  node: Element | Text,
  key?: string,
  val?: string,
): void {
  let attr_OR_text: string, match: RegExpMatchArray | null;

  if (!key) {
    attr_OR_text = node.nodeValue!; // nodeValue is (always) defined on Text Nodes
  } else {
    attr_OR_text = val!;
    if (attr_OR_text === "") {
      // e.g. checked attribute or two-way attribute
      attr_OR_text = key;

      if (
        attr_OR_text.startsWith("{{") ||
        (isServerSideCached && attr_OR_text.startsWith(Placeholder.reactiveKey))
      ) {
        (node as Element).removeAttribute(attr_OR_text);
      }
    }
  }

  const hasCurlyBraces = attr_OR_text.includes("{{");
  const hasReactiveKey =
    isServerSideCached && attr_OR_text.includes(Placeholder.reactiveKey);
  if (!hasCurlyBraces && !hasReactiveKey) {
    return;
  }

  while ((match = attr_OR_text.match(reactivityRegex))) {
    // attr_OR_text will be altered in every iteration

    const [hydroMatch, hydroCurlyPath, hydroPath] = match;
    const properties = (hydroCurlyPath ?? hydroPath)
      .trim()
      .replace(newLineRegex, "")
      .split(propChainRegex)
      .filter(Boolean);
    const [resolvedValue, resolvedObj] = resolveObject(properties);
    let lastProp = properties[properties.length - 1];
    const start = match.index!;
    let end: number = start + String(resolvedValue).length;

    if (isNode(resolvedValue)) {
      node.nodeValue = attr_OR_text.replace(hydroMatch, "");
      node.after(resolvedValue);
      setTraces(
        start,
        end,
        resolvedValue as Element | Text,
        lastProp,
        resolvedObj,
        key,
      );
      return;
    }

    // Set Text or set Attribute
    if (isTextNode(node)) {
      const textContent = isObject(resolvedValue)
        ? window.JSON.stringify(resolvedValue)
        : (resolvedValue ?? "");

      attr_OR_text = attr_OR_text.replace(hydroMatch, textContent);
      if (attr_OR_text != null) {
        node.nodeValue = attr_OR_text;
      }
    } else {
      if (key === "bind") {
        attr_OR_text = attr_OR_text.replace(hydroMatch, "");
        node.removeAttribute(key);

        const proxy =
          isObject(resolvedValue) && isProxy(resolvedValue)
            ? resolvedValue
            : resolvedObj;
        trackBoundElement(proxy, node);
        continue;
      } else if (key === Placeholder.twoWay) {
        if (node instanceof window.HTMLSelectElement) {
          node.value = resolvedValue;
          changeAttrVal(Placeholder.change, node, resolvedObj, lastProp);
        } else if (
          node instanceof window.HTMLInputElement &&
          node.type === Placeholder.radio
        ) {
          node.checked = node.value === resolvedValue;
          changeAttrVal(Placeholder.change, node, resolvedObj, lastProp);
        } else if (
          node instanceof window.HTMLInputElement &&
          node.type === Placeholder.checkbox
        ) {
          node.checked = resolvedValue;
          changeAttrVal(Placeholder.change, node, resolvedObj, lastProp, true);
        } else if (
          node instanceof window.HTMLTextAreaElement ||
          node instanceof window.HTMLInputElement
        ) {
          node.value = resolvedValue;
          changeAttrVal("input", node, resolvedObj, lastProp);
        }

        attr_OR_text = attr_OR_text.replace(hydroMatch, "");
        node.toggleAttribute(Placeholder.twoWay);
      } else if (isFunction(resolvedValue) || isEventObject(resolvedValue)) {
        attr_OR_text = attr_OR_text.replace(hydroMatch, "");
        node.removeAttribute(key!);
        addEventListener(node, key!.replace(onEventRegex, ""), resolvedValue);
      } else if (isObject(resolvedValue)) {
        // Case: setting attrs on Element - <p ${props}>

        for (const [subKey, subVal] of Object.entries(resolvedValue)) {
          attr_OR_text = attr_OR_text.replace(hydroMatch, "");
          if (isFunction(subVal) || isEventObject(subVal)) {
            addEventListener(node, subKey.replace(onEventRegex, ""), subVal);
          } else {
            lastProp = subKey;
            if (setAttribute(node, subKey, subVal)) {
              end = start + String(subVal).length;
            } else {
              end = start;
            }
          }

          setTraces(
            start,
            end,
            node,
            lastProp,
            resolvedValue as hydroObject,
            subKey,
          );
        }

        continue; // As we set all Mappings via subKeys
      } else {
        attr_OR_text = attr_OR_text.replace(hydroMatch, resolvedValue);

        if (
          !setAttribute(
            node,
            key!,
            attr_OR_text === String(resolvedValue)
              ? resolvedValue
              : attr_OR_text,
          )
        ) {
          attr_OR_text = attr_OR_text.replace(resolvedValue, "");
        }
      }
    }

    setTraces(start, end, node, lastProp, resolvedObj, key);
  }
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
  // Set WeakMaps, that will be used to track a change for a Node but also to check if a Node has any other changes.
  const change: nodeChanges[number] = [start, end, key, resolvedObj, hydroKey];
  const changeArr = [change];

  if (allNodeChanges.has(node)) {
    allNodeChanges.get(node)!.push(change);
  } else {
    allNodeChanges.set(node, [change]); // Use own version. Otherwise changes, will lead to incorrect changes in the DOM.
  }

  if (reactivityMap.has(resolvedObj)) {
    const keyToNodeMap = reactivityMap.get(resolvedObj)!;
    const nodeToChangeMap = keyToNodeMap.get(hydroKey);

    if (nodeToChangeMap) {
      if (nodeToChangeMap.has(node)) {
        (nodeToChangeMap.get(node)! as nodeChanges).push(change);
      } else {
        nodeToChangeMap.set(changeArr, node);
        nodeToChangeMap.set(node, changeArr);
      }
    } else {
      keyToNodeMap.set(
        hydroKey,
        new Map<Element | Text | nodeChanges, Element | Text | nodeChanges>([
          [changeArr, node],
          [node, changeArr],
        ]),
      );
    }
  } else {
    reactivityMap.set(
      resolvedObj,
      new Map([
        [
          hydroKey,
          new Map<Element | Text | nodeChanges, Element | Text | nodeChanges>([
            [changeArr, node],
            [node, changeArr],
          ]),
        ],
      ]),
    );
  }
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

  if (elemEventFunctions.has(elem)) {
    elemEventFunctions.get(elem)!.forEach((handlers) => {
      handlers.forEach((handler) => elemFunctions.push(handler));
    });
  }
  if (elemEventFunctions.has(where as Element)) {
    elemEventFunctions.get(where as Element)!.forEach((handlers) => {
      handlers.forEach((handler) => whereFunctions.push(handler));
    });
  }

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
function pushLifecycleFunctions(
  functions: Function[],
  lifecycleMap: typeof onRenderMap | typeof onCleanupMap,
  node: ReturnType<typeof html>,
) {
  const handlers = lifecycleMap.get(node);
  if (!handlers) return;

  if (Array.isArray(handlers)) {
    functions.push(...handlers);
  } else {
    functions.push(handlers);
  }
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

function executeLifecycle(
  node: ReturnType<typeof html>,
  lifecyleMap: typeof onRenderMap | typeof onCleanupMap,
) {
  if (lifecyleMap.has(node)) {
    const handlers = lifecyleMap.get(node)!;
    const execute = () => {
      if (Array.isArray(handlers)) {
        handlers.forEach((handler) => handler());
      } else {
        handlers();
      }
    };

    if (globalSchedule) {
      schedule(execute);
    } else {
      execute();
    }

    lifecyleMap.delete(node as Element);
  }
}
function runLifecyle(
  node: ReturnType<typeof html>,
  lifecyleMap: typeof onRenderMap | typeof onCleanupMap,
) {
  if (
    (lifecyleMap === onRenderMap && !calledOnRender) ||
    (lifecyleMap === onCleanupMap && !calledOnCleanup)
  )
    return;

  executeLifecycle(node, lifecyleMap);

  const elements = document.createNodeIterator(
    node as Node,
    window.NodeFilter.SHOW_ELEMENT,
  );

  let subElem;
  while ((subElem = elements.nextNode())) {
    executeLifecycle(subElem as Element, lifecyleMap);

    let childNode = subElem.firstChild;
    while (childNode) {
      if (isTextNode(childNode)) {
        executeLifecycle(childNode as Text, lifecyleMap);
      }
      childNode = childNode.nextSibling;
    }
  }
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

    if (tag2Elements.has(wElem.localName)) {
      tag2Elements.get(wElem.localName)!.push(wElem);
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

function purgeReactivity(node: Text | Element | DocumentFragment) {
  if (isDocumentFragment(node)) return;

  if (!isTextNode(node)) {
    purgeTrackedEventListeners(node);
    const proxies = boundElemProxies.get(node);
    if (proxies) {
      if (Array.isArray(proxies)) {
        for (const proxy of proxies) untrackBoundElement(proxy, node);
      } else {
        untrackBoundElement(proxies, node);
      }
      boundElemProxies.delete(node);
    }
  }

  const changes = allNodeChanges.get(node);
  if (!changes) return;

  for (const change of changes) {
    const proxy = change[3];
    const hydroKey = change[4];
    const keyToNodeMap = reactivityMap.get(proxy);
    if (!keyToNodeMap) continue;

    const nodeToChangeMap = keyToNodeMap.get(hydroKey);
    if (nodeToChangeMap?.has(node)) {
      const pairedChanges = nodeToChangeMap.get(node)!;
      nodeToChangeMap.delete(node);
      nodeToChangeMap.delete(pairedChanges);
      if (nodeToChangeMap.size === 0) keyToNodeMap.delete(hydroKey);
    }
    if (keyToNodeMap.size === 0) reactivityMap.delete(proxy);
  }
  allNodeChanges.delete(node);
}

function purgeSubtree(root: Text | Element | DocumentFragment) {
  if (isTextNode(root)) {
    purgeReactivity(root);
    return;
  }

  purgeReactivity(root);
  const elements = document.createNodeIterator(
    root,
    window.NodeFilter.SHOW_ELEMENT,
  );
  let elem;
  while ((elem = elements.nextNode())) {
    purgeReactivity(elem as Element);
    let child = elem.firstChild;
    while (child) {
      if (isTextNode(child)) purgeReactivity(child);
      child = child.nextSibling;
    }
  }

  if (isDocumentFragment(root)) {
    let child = root.firstChild;
    while (child) {
      if (isTextNode(child)) purgeReactivity(child);
      child = child.nextSibling;
    }
  }
}

function purgeDetached(node: ReturnType<typeof html>) {
  if (ignoreIsConnected) return;

  if (isDocumentFragment(node)) {
    const children = fragmentToElements.get(node);
    if (children) {
      for (const child of children) {
        if (!child.isConnected) {
          purgeSubtree(child as Text | Element | DocumentFragment);
        }
      }
    }
  } else if (!node.isConnected) {
    purgeSubtree(node);
  }
}

/* c8 ignore next 13 */
async function schedule(fn: Function, ...args: any): Promise<void> {
  if ("scheduler" in window) {
    // @ts-ignore
    window.scheduler.postTask(() => fn(...args), { priority: "user-blocking" });
  } else {
    // @ts-ignore
    window.requestIdleCallback(() => fn(...args));
  }
}

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
  return new Proxy(initial, {
    get(target, subKey, _receiver) {
      if (subKey === reactiveSymbol.description) return true;
      if (subKey === keysSymbol.description) {
        return keys;
      }

      if (subKey === Symbol.toPrimitive) {
        return () =>
          isServerSideCached
            ? `${Placeholder.reactiveKey}${keys.join(".")}`
            : `{{${keys.join(".")}}}`;
      }

      return chainKeys(target, [...keys, subKey]) as hydroObject &
        ((setter: any) => void);
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
    if (hydroToReactive.has(previousValue)) {
      hydroToReactive.delete(previousValue);
    }
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
  const checkCondition = (cond: any) =>
    (
      !Reflect.has(condition, reactiveSymbol) && isFunction(condition)
        ? condition(cond)
        : isPromise(cond)
          ? false
          : cond
    )
      ? isFunction(trueVal)
        ? trueVal()
        : trueVal
      : isFunction(falseVal)
        ? falseVal()
        : falseVal;

  const ternaryValue = reactive(checkCondition(getValue(reactiveHydro)));

  const stopObserving = observe(reactiveHydro, (newVal: any) => {
    newVal === null
      ? unset(ternaryValue)
      : ternaryValue(checkCondition(newVal));
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
    if (!trackMap.has(proxy)) continue;

    for (const key of trackMap.get(proxy)!) {
      proxy.observe(key, reRun);

      if (unobserveMap.has(reRun)) {
        unobserveMap.get(reRun)!.push({ proxy, key });
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

let calledOnRender = false;
function addLifecycle(
  lifecycleMap: typeof onRenderMap | typeof onCleanupMap,
  elem: ReturnType<typeof html>,
  fn: Function,
) {
  const current = lifecycleMap.get(elem);
  if (!current) {
    lifecycleMap.set(elem, fn);
  } else if (Array.isArray(current)) {
    current.push(fn);
  } else {
    lifecycleMap.set(elem, [current, fn]);
  }
}
function onRender(
  fn: Function,
  elem: ReturnType<typeof html>,
  ...args: Array<any>
) {
  calledOnRender = true;
  addLifecycle(onRenderMap, elem, args.length ? fn.bind(fn, ...args) : fn);
}
let calledOnCleanup = false;
function onCleanup(
  fn: Function,
  elem: ReturnType<typeof html>,
  ...args: Array<any>
) {
  calledOnCleanup = true;
  addLifecycle(onCleanupMap, elem, args.length ? fn.bind(fn, ...args) : fn);
}

// Core of the library
const sharedHandlers = Symbol("handlers");
function observeMethod(this: hydroObject, key: PropertyKey, handler: Function) {
  const map = Reflect.get(this, sharedHandlers) as Map<
    PropertyKey,
    Set<Function>
  >;
  if (map.has(key)) {
    map.get(key)!.add(handler);
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
  return Reflect.get(this, sharedHandlers) as Map<PropertyKey, Set<Function>>;
}
function unobserveMethod(
  this: hydroObject,
  key: PropertyKey,
  handler: Function,
) {
  const map = Reflect.get(this, sharedHandlers) as Map<
    PropertyKey,
    Set<Function>
  >;
  if (key) {
    if (!map.has(key)) return;

    if (handler == null) {
      map.delete(key);
    } else {
      const handlersForKey = map.get(key);
      if (handlersForKey?.has(handler)) {
        handlersForKey.delete(handler);
        if (handlersForKey.size === 0) map.delete(key);
      }
    }
  } else {
    map.clear();
  }
}
function generateProxy(obj?: Record<PropertyKey, unknown>): hydroObject {
  let boundFunctions: WeakMap<Function, Function> | undefined;

  const proxy = new Proxy(obj ?? {}, {
    // If receiver is a getter, then it is the object on which the search first started for the property|key -> Proxy
    set(target, key, val, receiver) {
      if (trackDeps) {
        trackProxies.add(receiver);
        if (trackMap.has(receiver)) {
          trackMap.get(receiver)!.add(key);
        } else {
          trackMap.set(receiver, new Set([key]));
        }
      }

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
        const observer = Reflect.get(target, sharedHandlers, receiver);
        if (observer.has(key)) {
          let set = observer.get(key);
          for (const handler of set) {
            handler(null, oldVal);
          }
          set.clear();
          receiver.unobserve(key);
        }

        // If oldVal is a Proxy - clean it
        if (isObject(oldVal) && isProxy(oldVal)) {
          oldVal.unobserve();
          reactivityMap.delete(oldVal);
          if (bindMap.has(oldVal)) {
            const elements = bindMap.get(oldVal)!;
            bindMap.delete(oldVal);
            elements.forEach(removeElement);
          }
        } else {
          if (bindMap.has(receiver)) {
            const elements = bindMap.get(receiver)!;
            bindMap.delete(receiver);
            elements.forEach(removeElement);
          }
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
        for (const [subKey, subVal] of Object.entries(val)) {
          if (isObject(subVal) && !isProxy(subVal)) {
            Reflect.set(val, subKey, generateProxy(subVal));
          }
        }
      } else {
        if (
          !reuseElements &&
          Array.isArray(receiver) &&
          receiver.includes(oldVal) &&
          receiver.includes(val) &&
          /* c8 ignore start */
          bindMap.has(val)
        ) {
          const [elem] = bindMap.get(val)!;
          if (lastSwapElem !== elem) {
            const [oldElem] = bindMap.get(oldVal)!;
            lastSwapElem = oldElem;

            const prevElem = elem.previousSibling!;
            const prevOldElem = oldElem.previousSibling!;

            // Move it in the array too without triggering the proxy set
            const index = receiver.findIndex((i) => i === val);
            receiver.splice(Number(key), 1, val);
            receiver.splice(index, 1, oldVal);

            prevElem.after(oldElem);
            prevOldElem.after(elem);
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
      if (reactivityMap.has(oldVal)) {
        checkReactivityMap(oldVal, key, newVal, oldVal);
      } else if (reactivityMap.has(receiver)) {
        checkReactivityMap(receiver, key, newVal, oldVal);
      }

      // current val (before setting) is a proxy - take over its keyToNodeMap
      if (isObject(val) && isProxy(val)) {
        if (reactivityMap.has(oldVal)) {
          // Store old reactivityMap if it is a swap operation
          if (reuseElements) tmpSwap.set(oldVal, reactivityMap.get(oldVal)!);

          if (tmpSwap.has(val)) {
            reactivityMap.set(oldVal, tmpSwap.get(val)!);
            tmpSwap.delete(val);
          } else {
            reactivityMap.set(oldVal, reactivityMap.get(val)!);
          }
        }
      }

      // Inform the Observers
      if (returnSet) {
        Reflect.get(target, sharedHandlers, receiver)
          .get(key)
          ?.forEach((handler: Function) => handler(newVal, oldVal));
      }

      // If oldVal is a Proxy - clean it
      !reuseElements && oldVal && cleanProxy(oldVal);

      return returnSet;
    },

    // fix proxy bugs, e.g Map
    get(target, prop, receiver) {
      if (trackDeps) {
        trackProxies.add(receiver);
        if (trackMap.has(receiver)) {
          trackMap.get(receiver)!.add(prop);
        } else {
          trackMap.set(receiver, new Set([prop]));
        }
      }
      const value = Reflect.get(target, prop, receiver);
      if (!isFunction(value)) {
        return value;
      }

      const cachedFunction = boundFunctions?.get(value);
      if (cachedFunction) return cachedFunction;

      const boundFunction = value.bind(target);
      (boundFunctions ??= new WeakMap()).set(value, boundFunction);
      return boundFunction;
    },
  } as ProxyHandler<hydroObject>);

  Reflect.defineProperty(proxy, Placeholder.isProxy, {
    value: true,
  });
  Reflect.defineProperty(proxy, Placeholder.asyncUpdate, {
    value: globalSchedule,
    writable: true,
  });
  Reflect.defineProperty(proxy, sharedHandlers, {
    value: new Map<PropertyKey, Set<Function>>(),
  });
  Reflect.defineProperty(proxy, Placeholder.observe, {
    value: observeMethod,
    configurable: true,
  });
  Reflect.defineProperty(proxy, Placeholder.getObservers, {
    value: getObserversMethod,
    configurable: true,
  });
  Reflect.defineProperty(proxy, Placeholder.unobserve, {
    value: unobserveMethod,
    configurable: true,
  });

  return proxy as hydroObject;
}

function cleanProxy(proxy: any) {
  if (isObject(proxy) && isProxy(proxy)) {
    proxy.unobserve();
    reactivityMap.delete(proxy);
    /* c8 ignore next 5 */
    if (bindMap.has(proxy)) {
      const elements = bindMap.get(proxy)!;
      bindMap.delete(proxy);
      elements.forEach(removeElement);
    }
  }
}

function checkReactivityMap(obj: any, key: PropertyKey, val: any, oldVal: any) {
  const keyToNodeMap = reactivityMap.get(obj)!;
  const nodeToChangeMap = keyToNodeMap.get(String(key));

  if (nodeToChangeMap) {
    /* c8 ignore next 5 */
    if (Reflect.get(obj, Placeholder.asyncUpdate)) {
      schedule(updateDOM, nodeToChangeMap, val, oldVal);
    } else {
      updateDOM(nodeToChangeMap, val, oldVal);
    }
  }

  if (isObject(val)) {
    const entries = Object.entries(val);
    for (const [subKey, subVal] of entries) {
      const subOldVal =
        (isObject(oldVal) && Reflect.get(oldVal, subKey)) || oldVal;
      const nodeToChangeMap = keyToNodeMap.get(subKey);
      if (nodeToChangeMap) {
        /* c8 ignore next 5 */
        if (Reflect.get(obj, Placeholder.asyncUpdate)) {
          schedule(updateDOM, nodeToChangeMap, subVal, subOldVal);
        } else {
          updateDOM(nodeToChangeMap, subVal, subOldVal);
        }
      }
    }
  }
}

function updateDOM(nodeToChangeMap: nodeToChangeMap, val: any, oldVal: any) {
  nodeToChangeMap.forEach((entry) => {
    // Circular reference in order to keep Memory low
    if (isNode(entry as Text)) {
      /* c8 ignore next 5 */
      if (!ignoreIsConnected && !(entry as Node).isConnected) {
        const tmpChange = nodeToChangeMap.get(entry)!;
        nodeToChangeMap.delete(entry);
        nodeToChangeMap.delete(tmpChange);
        if (allNodeChanges.has(entry as Element | Text)) {
          allNodeChanges.delete(entry as Element | Text);
        }
      }
      return; // Continue in forEach
    }

    // For each change of the node update either attribute or textContent
    for (const change of entry as nodeChanges) {
      const node = nodeToChangeMap.get(entry) as Element | Text;
      const [start, end, key] = change;
      let useStartEnd = false;

      if (isNode(val) && (!isServerSideCached || val !== node)) {
        replaceElement(val as Element, node);
        if (isServerSideCached || val !== node) {
          nodeToChangeMap.delete(node);
          nodeToChangeMap.delete(entry);
          if (!isDocumentFragment(val)) {
            nodeToChangeMap.set(val as Element, entry);
            nodeToChangeMap.set(entry, val as Element);
          }
        }
      } else if (isTextNode(node)) {
        useStartEnd = true;
        let text = node.nodeValue!;

        node.nodeValue =
          text.substring(0, start) + String(val) + text.substring(end);
      } else {
        if (key === Placeholder.twoWay) {
          if (
            node instanceof window.HTMLInputElement &&
            node.type === Placeholder.radio
          ) {
            node.checked = Array.isArray(val)
              ? val.includes(node.name)
              : String(val) === node.value;
          } else if (
            node instanceof window.HTMLInputElement &&
            node.type === Placeholder.checkbox
          ) {
            node.checked = val;
          } else if (
            node instanceof window.HTMLTextAreaElement ||
            node instanceof window.HTMLSelectElement ||
            node instanceof window.HTMLInputElement
          ) {
            (node as HTMLInputElement).value = String(val);
          }
        } else if (isFunction(val) || isEventObject(val)) {
          const eventName = key!.replace(onEventRegex, "");
          const handlerToRemove = isFunction(oldVal) ? oldVal : oldVal.event;
          removeTrackedEventListener(node, eventName, handlerToRemove);
          addEventListener(node, eventName, val);
        } else if (isObject(val)) {
          const entries = Object.entries(val);
          for (const [subKey, subVal] of entries) {
            if (isFunction(subVal) || isEventObject(subVal)) {
              const eventName = subKey.replace(onEventRegex, "");
              const previousHandler = oldVal?.[subKey];
              const handlerToRemove = isFunction(previousHandler)
                ? previousHandler
                : previousHandler.event;
              removeTrackedEventListener(node, eventName, handlerToRemove);
              addEventListener(node, eventName, subVal);
            } else {
              setAttribute(node, subKey, subVal);
            }
          }
        } else {
          useStartEnd = true;
          let attr = node.getAttribute(key!);
          if (attr) {
            attr = attr.substring(0, start) + String(val) + attr.substring(end);
            setAttribute(node, key!, attr === String(val) ? val : attr);
          } else {
            setAttribute(node, key!, val);
          }
        }
      }

      if (useStartEnd) {
        // Update end
        change[1] = start + String(val).length;

        // Because we updated the end, we also have to update the start and end for every other reactive change in the node, for the same key
        if (allNodeChanges.has(node)) {
          let passedNode: boolean = false;
          for (const nodeChange of allNodeChanges.get(node)!) {
            if (nodeChange === change) {
              passedNode = true;
              continue;
            }

            if (passedNode && (isTextNode(node) || key === nodeChange[2])) {
              const difference = String(oldVal).length - String(val).length;
              nodeChange[0] -= difference;
              nodeChange[1] -= difference;
            }
          }
        }
      }
    }
  });
}

const pendingCleanupRows: Array<Array<ChildNode>> = [];
let pendingCleanupCount = 0;
let cleanupFlushScheduled = false;
const PENDING_CLEANUP_LIMIT = 2000;

function resetViewRows(rootElem: Element) {
  const rows = Array.from(rootElem.childNodes);
  rootElem.textContent = "";
  if (rows.length === 0) return;

  pendingCleanupRows.push(rows);
  pendingCleanupCount += rows.length;
  if (pendingCleanupCount >= PENDING_CLEANUP_LIMIT) {
    flushCleanupQueue();
  } else if (!cleanupFlushScheduled) {
    cleanupFlushScheduled = true;
    schedule(flushCleanupQueue);
  }
}

function flushCleanupQueue() {
  cleanupFlushScheduled = false;
  const batches = pendingCleanupRows.splice(0, pendingCleanupRows.length);
  pendingCleanupCount = 0;
  for (const rows of batches) cleanupDetachedRows(rows);
}

function cleanupDetachedRows(rows: Array<ChildNode>) {
  const hasCleanup = calledOnCleanup;
  for (const row of rows) cleanupDetachedNode(row, hasCleanup);
}

function cleanupDetachedNode(node: ChildNode, hasCleanup: boolean) {
  if (isTextNode(node)) {
    if (hasCleanup) executeLifecycle(node, onCleanupMap);
    purgeReactivity(node);
    return;
  }

  if (hasCleanup) executeLifecycle(node as Element, onCleanupMap);
  purgeReactivity(node as Element);
  let child = node.firstChild;
  while (child) {
    cleanupDetachedNode(child, hasCleanup);
    child = child.nextSibling;
  }
}

function view(
  root: string,
  data: reactiveObject<Array<any>>,
  renderFunction: (value: any, index: number) => Node,
) {
  viewElements = true;
  const rootElem = $(root)!;
  const elements = getValue(data).map(renderFunction);
  const initialRowsAreWired =
    viewElementsEventFunctions.size === 0 && elements.every(isViewPrewired);
  rootElem.append(...elements);
  for (const elem of elements) runLifecyle(elem as Element, onRenderMap);
  if (rootElem.hasChildNodes() && !initialRowsAreWired) {
    setReactivity(rootElem, viewElementsEventFunctions);
    viewElementsEventFunctions.clear();
  }
  onCleanup(unset, rootElem, data);

  viewElements = false;
  const stopViewObserver = observe(
    data,
    (newData: typeof data, oldData: typeof data) => {
      /* c8 ignore start */
      viewElements = true;
      let newRowsAreWired = false;

      // Reset or re-use
      if (
        !newData?.length ||
        (!reuseElements && newData?.length === oldData?.length)
      ) {
        resetViewRows(rootElem);
        if (newData === null) {
          viewElements = false;
          return;
        }
      } else if (reuseElements) {
        for (let i = 0; i < oldData?.length && newData?.length; i++) {
          oldData[i].id = newData[i].id;
          oldData[i].label = newData[i].label;
          newData[i] = oldData[i];
        }
      }

      // Add to existing
      if (
        oldData?.length &&
        newData?.length > oldData?.length &&
        newData[0] === oldData[0]
      ) {
        const length = oldData.length;
        const slicedData = newData.slice(length);
        const newElements = slicedData.map((item, i) =>
          renderFunction(item, i + length),
        );
        const appendedRowsAreWired =
          viewElementsEventFunctions.size === 0 &&
          newElements.every(isViewPrewired);
        newRowsAreWired = appendedRowsAreWired;
        rootElem.append(...newElements);
        for (const elem of newElements)
          runLifecyle(elem as Element, onRenderMap);
      }

      // Add new
      else if (oldData?.length === 0 || (!reuseElements && newData?.length)) {
        if (!reuseElements && oldData?.length && rootElem.hasChildNodes()) {
          resetViewRows(rootElem);
        }

        const elements = newData.map(renderFunction);
        const replacementRowsAreWired =
          viewElementsEventFunctions.size === 0 &&
          elements.every(isViewPrewired);
        newRowsAreWired = replacementRowsAreWired;
        rootElem.append(...elements);
        for (const elem of elements) runLifecyle(elem as Element, onRenderMap);
      }
      if (rootElem.hasChildNodes() && !newRowsAreWired) {
        setReactivity(rootElem, viewElementsEventFunctions);
        viewElementsEventFunctions.clear();
      }
      viewElements = false;
      /* c8 ignore end */
    },
  )!;
  onCleanup(stopViewObserver, rootElem);
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
