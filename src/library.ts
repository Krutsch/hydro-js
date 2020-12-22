declare const window: any;
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
interface RequestIdleCallbackDeadline {
  readonly didTimeout: boolean;
  timeRemaining: () => number;
}

interface hydroObject extends Record<keyof any, any> {
  isProxy: boolean;
  asyncUpdate: boolean;
  observe: (key: keyof any, fn: Function) => any;
  getObservers: () => Map<string, Set<Function>>;
  unobserve: (key?: keyof any) => undefined;
}
type nodeChange = Array<[number, number, string | undefined]>;

// Change to IterableWeakMap once supported
// Circular reference
type nodeToChangeMap = Map<
  Element | Text | nodeChange,
  Element | Text | nodeChange
>;
// TODO: Change to WeakValue
interface keyToNodeMap extends Map<string, nodeToChangeMap> {}
interface EventObject {
  event: EventListener;
  options: AddEventListenerOptions;
}
type reactiveObject<T> = T & hydroObject & ((setter: any) => void);
type eventFunctions = Record<string, EventListener | EventObject>;

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
  reactive = "reactive",
  observe = "observe",
  getObservers = "getObservers",
  unobserve = "unobserve",
  keys = "__keys__",
  twoWay = "two-way",
  change = "change",
  radio = "radio",
  checkbox = "checkbox",
}

// Safari Polyfills
window.requestIdleCallback =
  /* c8 ignore next 4 */
  window.requestIdleCallback ||
  ((cb: Function, _: any, start = performance.now()) =>
    window.setTimeout(cb, 0, {
      didTimeout: false,
      timeRemaining: () => Math.max(0, 5 - (performance.now() - start)),
    }));
// Safari Polyfills END

// Parser to create HTML elements from strings
const parser = ((range = document.createRange()) => {
  range.selectNodeContents(
    range.createContextualFragment("<template>").lastChild!
  );
  return range.createContextualFragment.bind(range);
})();
const allNodeChanges = new WeakMap<Text | Element, nodeChange>(); // Maps a Node against a change. This is necessary for nodes that have multiple changes for one text / attribute.
const elemEventFunctions = new WeakMap<Element, Array<EventListener>>(); // Stores event functions in order to compare Elements against each other.
const reactivityMap = new WeakMap<hydroObject, keyToNodeMap>(); // Maps Proxy Objects
const tmpSwap = new WeakMap<hydroObject, keyToNodeMap>(); // Take over keyToNodeMap if new value is a hydro Proxy. Save old reactivityMap entry here, in case for a swap operation.
const bindMap = new WeakMap<hydroObject, Array<Element>>(); // Bind an Element to Data. If the Data is being unset, the DOM Element disappears too.
const onRenderMap = new WeakMap<ReturnType<typeof html>, Function>(); // Lifecycle Hook that is being called after rendering
const onCleanupMap = new WeakMap<ReturnType<typeof html>, Function>(); // Lifecycle Hook that is being called when unmount function is being called
const _boundFunctions = Symbol("boundFunctions"); // Cache for bound functions in Proxy, so that we create the bound version of each function only once

const toSchedule: Array<[Function, ...any[]]> = []; // functions that will be executed async and during a browser's idle period
let globalSchedule = true; // Decides whether to schedule rendering and updating (async)
let reuseElements = true; // Reuses Elements when rendering
let insertBeforeDiffing = false;
let isScheduling = false; // Helper - checks if code is already in requestIdleCallback

const reactivityRegex = /\{\{((\s|.)*?)\}\}/;
const eventListenerRegex = /on(\w+)=/;
const newLineRegex = /\n/g;
const propChainRegex = /[\.\[\]]/;
const onEventRegex = /^on/;

// https://html.spec.whatwg.org/#attributes-3
// if value for bool attr is falsy, then remove attr
const boolAttrList = [
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
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
];

function isObject(obj: object | unknown): obj is Record<string, any> {
  return obj != null && typeof obj === "object";
}
function isFunction(func: Function | unknown): func is Function {
  return typeof func === Placeholder.function;
}
function isTextNode(node: Node): node is Text {
  return (node as Text).splitText !== undefined;
}
function isNode(node: Node): node is Node {
  return node instanceof Node;
}
function isDocumentFragment(node: Node): node is DocumentFragment {
  // getElementById exists in svg too. I did not find a better way to identify a DocumentFragment
  return node.nodeName !== "svg" && "getElementById" in node;
}
function isEventObject(obj: object | unknown): obj is EventObject {
  return (
    isObject(obj) && Placeholder.event in obj && Placeholder.options in obj
  );
}
function isProxy(hydroObject: any): hydroObject is hydroObject {
  return Reflect.get(hydroObject, Placeholder.isProxy);
}
function isPromise(obj: any): obj is Promise<any> {
  return isObject(obj) && typeof obj.then === "function";
}

function setGlobalSchedule(willSchedule: boolean): void {
  globalSchedule = willSchedule;
  setHydroRecursive(hydro, willSchedule);
}
function setReuseElements(willReuse: boolean): void {
  reuseElements = willReuse;
}
function setInsertDiffing(willInsert: boolean): void {
  insertBeforeDiffing = willInsert;
}
function setHydroRecursive(obj: hydroObject, willSchedule: boolean) {
  Reflect.set(obj, Placeholder.asyncUpdate, willSchedule);

  Object.values(obj).forEach((value) => {
    if (isObject(value) && isProxy(value)) {
      setHydroRecursive(value, willSchedule);
    }
  });
}

function randomText() {
  return Math.random().toString(32).slice(2);
}
function setAttribute(node: Element, key: string, val: any): boolean {
  if (boolAttrList.includes(key) && !val) {
    node.removeAttribute(key);
    return false;
  }

  node.setAttribute(key, val);
  return true;
}
function addEventListener(
  node: Element,
  eventName: string,
  obj: EventObject | EventListener
) {
  node.addEventListener(
    eventName,
    isFunction(obj) ? obj : obj.event,
    isFunction(obj) ? {} : obj.options
  );
}
// This does not create <html>, <body> or <head> Elements.
// That is fine because the render function only renders within a body without a where parameter
function html(
  htmlArray: TemplateStringsArray, // The Input String, which is splitted by the template variables
  ...variables: Array<any>
): Element | DocumentFragment | Text {
  const eventFunctions: eventFunctions = {}; // Temporarily store a mapping for string -> function, because eventListener have to be registered after the Element's creation
  let finalHTMLString = variables.length ? "" : htmlArray.join("").trim(); // The HTML string to parse
  let insertNodes: Node[] = []; // Array of Nodes, that have to be added after the parsing

  variables.forEach((variable, index) => {
    const template = `<${Placeholder.template} id="lbInsertNodes${index}"></${Placeholder.template}>`;
    let html = htmlArray[index];

    // Remove empty text nodes on start
    if (index === 0) html = html.trimStart();

    if (isNode(variable)) {
      insertNodes.push(variable);
      finalHTMLString += html + template;
    } else if (
      ["number", Placeholder.string, "symbol", "boolean", "bigint"].includes(
        typeof variable
      ) ||
      Reflect.get(variable, Placeholder.reactive)
    ) {
      finalHTMLString += html + String(variable);
    } else if (isFunction(variable) || isEventObject(variable)) {
      finalHTMLString += html.replace(eventListenerRegex, (_, eventType) => {
        const funcName = randomText();
        Reflect.set(eventFunctions, funcName, variable);

        return `${funcName}="${eventType}"`;
      });
    } else if (Array.isArray(variable)) {
      // Replace Nodes with template String
      variable.forEach((item, index) => {
        if (isNode(item)) {
          insertNodes.push(item);
          variable[index] = template;
        }
      });

      finalHTMLString += html + variable.join("");
    } else if (isObject(variable)) {
      Object.entries(variable).forEach(([key, value], index) => {
        if (index === 0) {
          finalHTMLString += html;
        }

        if (isFunction(value) || isEventObject(value)) {
          finalHTMLString += `${key}=`.replace(
            eventListenerRegex,
            (_, eventType) => {
              const funcName = randomText();
              Reflect.set(eventFunctions, funcName, value);

              return `${funcName}="${eventType}"`;
            }
          );
        } else {
          finalHTMLString += `${key}="${value}"`;
        }
      });
    }

    // Last iteration: trim end
    if (index === variables.length - 1) {
      // the length of htmlArray is always 1 bigger than the length of variables
      finalHTMLString += htmlArray[index + 1].trimEnd();
    }
  });

  const DOM = parser(finalHTMLString);

  // Insert HTML Elements, which were stored in insertNodes
  DOM.querySelectorAll("template[id^=lbInsertNodes]").forEach((template) =>
    replaceElement(insertNodes.shift()!, template, false)
  );

  setReactivity(DOM, eventFunctions);

  // Set reactive Behavior if only a Text Node is present
  if (DOM.childElementCount === 0 && DOM.firstChild) {
    setReactivitySingle(DOM.firstChild as Text);
    // Return Text Node
    return DOM.firstChild as Text;
  }

  // Return DocumentFragment
  if (DOM.childNodes.length > 1) return DOM;

  // Return Text Node
  if (!DOM.firstChild) return document.createTextNode("");

  // Return Element
  return DOM.firstChild as Element;
}
function setReactivity(DOM: Node, eventFunctions?: eventFunctions) {
  // Set events and reactive behaviour(checks for {{ key }} where key is on hydro)
  const root = document.createNodeIterator(DOM, window.NodeFilter.SHOW_ELEMENT);
  let elem: Element;
  //@ts-ignore
  while ((elem = root.nextNode())) {
    // Check Attributes
    elem.getAttributeNames().forEach((key) => {
      // Set functions
      if (eventFunctions && key in eventFunctions) {
        const event = eventFunctions[key];
        const eventName = elem.getAttribute(key)!;
        elem.removeAttribute(key);

        if (isEventObject(event)) {
          elem.addEventListener(eventName, event.event, event.options);
          if (elemEventFunctions.has(elem)) {
            elemEventFunctions.get(elem)!.push(event.event);
          } else {
            elemEventFunctions.set(elem, [event.event]);
          }
        } else {
          elem.addEventListener(eventName, event);
          if (elemEventFunctions.has(elem)) {
            elemEventFunctions.get(elem)!.push(event as EventListener);
          } else {
            elemEventFunctions.set(elem, [event as EventListener]);
          }
        }
      } else {
        setReactivitySingle(elem, key);
      }
    });

    // Check Text Nodes
    // This is somehow faster than createNodeIterator and createTreeWalker
    // https://esbench.com/bench/5e9c421c12464000a01e4359
    let childNode = elem.firstChild;
    while (childNode) {
      if (isTextNode(childNode)) {
        setReactivitySingle(childNode);
      }
      childNode = childNode.nextSibling;
    }
  }
}
function setReactivitySingle(node: Text): void; // TS function overload
function setReactivitySingle(node: Element, key: string): void; // TS function overload
function setReactivitySingle(node: Element | Text, key?: string): void {
  let attr_OR_text: string, match: RegExpMatchArray | null;

  if (isTextNode(node)) {
    attr_OR_text = node.nodeValue!; // nodeValue is (always) defined on Text Nodes
  } else {
    attr_OR_text = (node as Element).getAttribute(key!)!;
    if (attr_OR_text! === "") {
      // e.g. checked attribute or two-way attribute
      attr_OR_text = key!;

      if (attr_OR_text.startsWith("{{")) {
        node.removeAttribute(attr_OR_text);
      }
    }
  }

  while ((match = attr_OR_text.match(reactivityRegex))) {
    // attr_OR_text will be altered in every iteration

    const [hydroMatch, hydroPath] = match;
    const properties = hydroPath
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
        key
      );
      return;
    }

    // Set Text or set Attribute
    if (isTextNode(node)) {
      const textContent = isObject(resolvedValue)
        ? JSON.stringify(resolvedValue)
        : resolvedValue ?? "";

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
        if (bindMap.has(proxy)) {
          bindMap.get(proxy)!.push(node);
        } else {
          bindMap.set(proxy, [node]);
        }
        continue;
      } else if (key === Placeholder.twoWay) {
        // Same behavior as v-model in https://v3.vuejs.org/guide/forms.html#basic-usage
        const changeAttrVal = (eventName: string) => {
          node.addEventListener(eventName, ({ target }) => {
            Reflect.set(
              resolvedObj,
              lastProp,
              (target as HTMLInputElement).value
            );
          });
        };

        if (
          node instanceof HTMLTextAreaElement ||
          (node instanceof HTMLInputElement && node.type === Placeholder.text)
        ) {
          node.value = resolvedValue;
          changeAttrVal("input");
        } else if (node instanceof HTMLSelectElement) {
          node.value = resolvedValue;
          changeAttrVal(Placeholder.change);
        } else if (
          node instanceof HTMLInputElement &&
          node.type === Placeholder.radio
        ) {
          node.checked = node.value === resolvedValue;
          changeAttrVal(Placeholder.change);
        } else if (
          node instanceof HTMLInputElement &&
          node.type === Placeholder.checkbox
        ) {
          node.checked = resolvedValue.includes(node.name);
          node.addEventListener(Placeholder.change, ({ target }) => {
            if (!(target as HTMLInputElement).checked) {
              resolvedValue.splice(resolvedValue.indexOf(node.name), 1);
            } else if (!resolvedValue.includes(node.name)) {
              resolvedValue.push(node.name);
            }
          });
        }

        attr_OR_text = attr_OR_text.replace(hydroMatch, "");
        node.setAttribute(Placeholder.twoWay, "");
      } else if (isFunction(resolvedValue) || isEventObject(resolvedValue)) {
        attr_OR_text = attr_OR_text.replace(hydroMatch, "");
        node.removeAttribute(key!);
        addEventListener(node, key!.replace(onEventRegex, ""), resolvedValue);
      } else if (isObject(resolvedValue)) {
        // Case: setting attrs on Element - <p ${props}>

        Object.entries(resolvedValue).forEach(([subKey, subVal]) => {
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
            subKey
          );
        });

        continue; // As we set all Mappings via subKeys
      } else {
        attr_OR_text = attr_OR_text.replace(hydroMatch, resolvedValue);

        if (
          !setAttribute(
            node,
            key!,
            attr_OR_text === String(resolvedValue)
              ? resolvedValue
              : attr_OR_text
          )
        ) {
          attr_OR_text = attr_OR_text.replace(resolvedValue, "");
        }
      }
    }

    setTraces(start, end, node, lastProp, resolvedObj, key);
  }
}
function setTraces(
  start: number,
  end: number,
  node: Text | Element,
  hydroKey: string,
  resolvedObj: hydroObject,
  key?: string
): void {
  // Set WeakMaps, that will be used to track a change for a Node but also to check if a Node has any other changes.
  const change = [start, end, key] as nodeChange[number];

  if (allNodeChanges.has(node)) {
    allNodeChanges.get(node)!.push(change);
  } else {
    allNodeChanges.set(node, [change]);
  }

  if (reactivityMap.has(resolvedObj)) {
    const keyToNodeMap = reactivityMap.get(resolvedObj)!;
    if (keyToNodeMap.has(hydroKey)) {
      const nodeToChangeMap = keyToNodeMap.get(hydroKey)!;
      if (nodeToChangeMap.has(node)) {
        (nodeToChangeMap.get(node)! as nodeChange).push(change);
      } else {
        const changeArr = [change];
        nodeToChangeMap.set(changeArr, node);
        nodeToChangeMap.set(node, changeArr);
      }
    } else {
      const changeArr = [change];
      keyToNodeMap.set(
        hydroKey,
        //@ts-ignore // ts-bug
        new Map([
          [changeArr, node],
          [node, changeArr],
        ])
      );
    }
  } else {
    const changeArr = [change];
    reactivityMap.set(
      resolvedObj,

      new Map([
        [
          hydroKey,
          //@ts-ignore // ts-bug
          new Map([
            [changeArr, node],
            [node, changeArr],
          ]),
        ],
      ])
    );
  }
}
// Helper function to return a Hydro Obj with a aalue from a chain of properties on hydro
function resolveObject(propertyArray: Array<keyof any>): [any, hydroObject] {
  let value: any, prev: hydroObject;
  value = prev = hydro;

  propertyArray.forEach((prop) => {
    prev = value;
    value = Reflect.get(prev, prop);
  });

  return [value, prev];
}

function compareEvents(
  elem: Element | Text,
  where: Element | Text,
  onlyTextChildren?: boolean
): boolean {
  const elemFunctions = [];
  const whereFunctions = [];

  if (isTextNode(elem)) {
    if (onRenderMap.has(elem)) {
      elemFunctions.push(onRenderMap.get(elem)!);
    }
    if (onCleanupMap.has(elem)) {
      elemFunctions.push(onCleanupMap.get(elem)!);
    }
    if (onRenderMap.has(where)) {
      whereFunctions.push(onRenderMap.get(where)!);
    }
    if (onCleanupMap.has(where)) {
      whereFunctions.push(onCleanupMap.get(where)!);
    }

    if (elemFunctions.length !== whereFunctions.length) return false;
    if (String(elemFunctions) !== String(whereFunctions)) return false;

    return true;
  }

  if (elemEventFunctions.has(elem)) {
    elemFunctions.push(...elemEventFunctions.get(elem)!);
  }
  if (elemEventFunctions.has(where as Element)) {
    whereFunctions.push(...elemEventFunctions.get(where as Element)!);
  }

  if (onRenderMap.has(elem)) {
    elemFunctions.push(onRenderMap.get(elem)!);
  }
  if (onCleanupMap.has(elem)) {
    elemFunctions.push(onCleanupMap.get(elem)!);
  }
  if (onRenderMap.has(where)) {
    whereFunctions.push(onRenderMap.get(where)!);
  }
  if (onCleanupMap.has(where)) {
    whereFunctions.push(onCleanupMap.get(where)!);
  }

  if (elemFunctions.length !== whereFunctions.length) return false;
  if (String(elemFunctions) !== String(whereFunctions)) return false;

  for (let i = 0; i < elem.childNodes.length; i++) {
    if (onlyTextChildren) {
      if (isTextNode(elem.childNodes[i])) {
        if (
          !compareEvents(
            elem.childNodes[i] as Text,
            where.childNodes[i] as Text,
            onlyTextChildren
          )
        ) {
          return false;
        }
      }
    } else {
      if (
        !compareEvents(
          elem.childNodes[i] as Element | Text,
          where.childNodes[i] as Element | Text
        )
      ) {
        return false;
      }
    }
  }

  return true;
}

function compare(
  elem: Element,
  where: Element,
  onlyTextChildren?: boolean
): boolean {
  return (
    elem.isEqualNode(where) && compareEvents(elem, where, onlyTextChildren)
  );
}

function render(
  elem: ReturnType<typeof html> | reactiveObject<any>,
  where: ReturnType<typeof html> | string = "",
  shouldSchedule = globalSchedule
): ChildNode["remove"] {
  if (shouldSchedule) {
    toSchedule.push([render, elem, where, false]);
    if (!isScheduling) window.requestIdleCallback(schedule);
    return unmount(elem);
  }

  // Get elem value if elem is reactiveObject
  if (Reflect.get(elem, Placeholder.reactive)) {
    elem = getValue(elem);
  }

  // Store Elements of DocumentFragment for later unmount
  let elemChildren: Array<ChildNode>;
  if (isDocumentFragment(elem)) {
    elemChildren = Array.from(elem.childNodes);
  }

  if (!where) {
    document.body.append(elem);
  } else {
    if (typeof where === Placeholder.string) {
      const resolveStringToElement = document.querySelector(where as string);
      if (resolveStringToElement) {
        where = resolveStringToElement;
      } else {
        return () => {};
      }
    }

    if (!reuseElements) {
      replaceElement(elem, where as Element);
    } else {
      if (isTextNode(elem)) {
        replaceElement(elem, where as Element);
      } else if (isDocumentFragment(elem) || !compare(elem, where as Element)) {
        treeDiff(elem, where as Element);
      }
    }
  }

  runLifecyle(elem, onRenderMap);
  elemChildren!?.forEach((subElem) => {
    runLifecyle(subElem as Element | Text, onRenderMap);
  });

  return unmount(isDocumentFragment(elem) ? elemChildren! : elem);
}

function executeLifecycle(
  node: ReturnType<typeof html>,
  lifecyleMap: typeof onRenderMap | typeof onCleanupMap
) {
  if (lifecyleMap.has(node)) {
    const fn = lifecyleMap.get(node)!;

    /* c8 ignore next 3 */
    if (globalSchedule) {
      window.requestIdleCallback(fn);
    } else {
      fn();
    }

    lifecyleMap.delete(node as Element);
  }
}
function runLifecyle(
  node: ReturnType<typeof html>,
  lifecyleMap: typeof onRenderMap | typeof onCleanupMap
) {
  if (
    (lifecyleMap === onRenderMap && !calledOnRender) ||
    (lifecyleMap === onCleanupMap && !calledOnCleanup)
  )
    return;

  executeLifecycle(node, lifecyleMap);

  const elements = document.createNodeIterator(
    node as Node,
    window.NodeFilter.SHOW_ELEMENT
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
  root: Element
) {
  for (const [localName, list] of tag2Elements.entries()) {
    for (let i = 0; i < list.length; i++) {
      const elem = list[i];

      if (root.contains(elem) || root.isSameNode(elem)) {
        list.splice(i, 1);
        i--;
      }
      if (list.length === 0) {
        tag2Elements.delete(localName);
      }
    }
  }
}
function treeDiff(elem: Element | DocumentFragment, where: Element) {
  const elemElements = document.createNodeIterator(
    elem,
    window.NodeFilter.SHOW_ELEMENT
  );
  const whereElements = document.createNodeIterator(
    where,
    window.NodeFilter.SHOW_ELEMENT
  );

  let template: HTMLTemplateElement;
  if (insertBeforeDiffing) {
    template = document.createElement(Placeholder.template);
    where.before(template);
    template.append(elem);
  }

  // Create Mapping for easier diffing, eg: "div" -> [...Element]
  let wElem: Element;
  const tag2Elements = new Map<string, Array<Element>>();
  //@ts-ignore
  while ((wElem = whereElements.nextNode())) {
    if (tag2Elements.has(wElem.localName)) {
      tag2Elements.get(wElem.localName)!.push(wElem);
    } else {
      tag2Elements.set(wElem.localName, [wElem]);
    }
  }

  // Re-use any where Element if possible, then remove elem Element
  let subElem: Element;
  //@ts-ignore
  while ((subElem = elemElements.nextNode())) {
    const sameElements = tag2Elements!.get(subElem.localName);

    if (sameElements) {
      for (let index = 0; index < sameElements.length; index++) {
        const whereElem = sameElements[index];

        if (compare(subElem, whereElem, true)) {
          replaceElement(whereElem, subElem);
          filterTag2Elements(tag2Elements, whereElem);
          break;
        }
      }
    }
  }

  if (insertBeforeDiffing) {
    where.before(
      ...(isDocumentFragment(elem) ? Array.from(template!.childNodes) : [elem])
    );
    where.remove();
    template!.remove();
    runLifecyle(where, onCleanupMap);
  } else {
    replaceElement(elem, where);
  }
  tag2Elements.clear();
}

function unmount<T = ReturnType<typeof html> | Array<ChildNode>>(elem: T) {
  if (Array.isArray(elem)) {
    return () => elem.forEach(removeElement);
  } else {
    return () => removeElement((elem as unknown) as Text | Element);
  }
}

function removeElement(elem: Text | Element) {
  if (elem.isConnected) {
    elem.remove();
    runLifecyle(elem, onCleanupMap);
  }
}

function replaceElement(
  elem: Node,
  where: Element,
  withLifecycle: boolean = true
) {
  where.before(elem);
  where.remove();

  if (withLifecycle) runLifecyle(where, onCleanupMap);
}

function schedule(deadline: RequestIdleCallbackDeadline): void {
  isScheduling = true;

  while (deadline.timeRemaining() > 0 && toSchedule.length > 0) {
    const [fn, ...args] = toSchedule.shift()!;
    fn(...args);
  }

  /* c8 ignore next 3 */
  if (toSchedule.length > 0) {
    window.requestIdleCallback(schedule);
  }

  isScheduling = false;
}

function reactive<T>(initial: T): reactiveObject<T> {
  let key: string;

  do key = randomText();
  while (Reflect.has(hydro, key));

  Reflect.set(hydro, key, initial);
  Reflect.set(setter, Placeholder.reactive, true);

  const chainKeysProxy = chainKeys(setter, [key]);
  return chainKeysProxy;

  function setter<U>(val: U) {
    // @ts-ignore
    const keys = (this || chainKeysProxy)[Placeholder.keys];
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
function chainKeys(initial: Function | any, keys: Array<keyof any>): any {
  return new Proxy(initial, {
    get(target, subKey, _receiver) {
      if (subKey === Placeholder.reactive) return true;
      if (subKey === Placeholder.keys) {
        return keys;
      }

      if (subKey === Symbol.toPrimitive) {
        return () => `{{${keys.join(".")}}}`;
      }

      return chainKeys(target, [...keys, subKey]) as hydroObject &
        ((setter: any) => void);
    },
  });
}
function getReactiveKeys(reactiveHydro: reactiveObject<any>) {
  const keys = reactiveHydro[Placeholder.keys];
  const lastProp = keys[keys.length - 1];
  return [lastProp, keys.length === 1];
}
function unset(reactiveHydro: reactiveObject<any>): void {
  const [lastProp, oneKey] = getReactiveKeys(reactiveHydro);

  if (oneKey) {
    Reflect.set(hydro, lastProp, null);
  } else {
    const [_, resolvedObj] = resolveObject(reactiveHydro[Placeholder.keys]);
    Reflect.set(resolvedObj, lastProp, null);
  }
}
function setAsyncUpdate(
  reactiveHydro: reactiveObject<any>,
  asyncUpdate: boolean
) {
  const [_, oneKey] = getReactiveKeys(reactiveHydro);

  if (oneKey) {
    hydro.asyncUpdate = asyncUpdate;
  } else {
    const [_, resolvedObj] = resolveObject(reactiveHydro[Placeholder.keys]);
    resolvedObj.asyncUpdate = asyncUpdate;
  }
}
function observe(reactiveHydro: reactiveObject<any>, fn: Function) {
  const [lastProp, oneKey] = getReactiveKeys(reactiveHydro);

  if (oneKey) {
    hydro.observe(lastProp, fn);
  } else {
    const [_, resolvedObj] = resolveObject(reactiveHydro[Placeholder.keys]);
    resolvedObj.observe(lastProp, fn);
  }
}
function unobserve(reactiveHydro: reactiveObject<any>) {
  const [lastProp, oneKey] = getReactiveKeys(reactiveHydro);

  if (oneKey) {
    hydro.unobserve(lastProp);
  } else {
    const [_, resolvedObj] = resolveObject(reactiveHydro[Placeholder.keys]);
    resolvedObj.unobserve(lastProp);
  }
}
function ternary(
  condition: Function | reactiveObject<any>,
  trueVal: any,
  falseVal: any,
  reactiveHydro: reactiveObject<any> = condition
) {
  const checkCondition = (cond: any) =>
    (
      !Reflect.get(condition, Placeholder.reactive) && isFunction(condition)
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

  observe(reactiveHydro, (newVal: any) => {
    newVal === null
      ? unset(ternaryValue)
      : ternaryValue(checkCondition(newVal));
  });

  return ternaryValue;
}
function emit(
  eventName: string,
  data: any,
  who: EventTarget,
  options: object = { bubbles: true }
) {
  who.dispatchEvent(new CustomEvent(eventName, { ...options, detail: data }));
}
function getValue<T>(reactiveHydro: T): T {
  // @ts-ignore
  const [resolvedValue] = resolveObject(reactiveHydro[Placeholder.keys]);
  return resolvedValue;
}

let calledOnRender = false;
function onRender(
  fn: Function,
  elem: ReturnType<typeof html>,
  ...args: Array<any>
) {
  calledOnRender = true;
  onRenderMap.set(elem, args.length ? fn.bind(fn, ...args) : fn);
}
let calledOnCleanup = false;
function onCleanup(
  fn: Function,
  elem: ReturnType<typeof html>,
  ...args: Array<any>
) {
  calledOnCleanup = true;
  onCleanupMap.set(elem, args.length ? fn.bind(fn, ...args) : fn);
}

// Core of the library
function generateProxy(obj = {}): hydroObject {
  const handlers = Symbol("handlers"); // For observer pattern
  const boundFunctions = new WeakMap<Function, Function>();

  const proxy = new Proxy(obj, {
    // If receiver is a getter, then it is the object on which the search first started for the property|key -> Proxy
    set(target, key, val, receiver) {
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
        const observer = Reflect.get(target, handlers, receiver);
        if (observer.has(key)) {
          let set = observer.get(key);
          set.forEach((handler: Function) => handler(null, oldVal));
          set.clear();
          receiver.unobserve(key);
        }

        // If oldVal is a Proxy - clean it
        if (isObject(oldVal) && isProxy(oldVal)) {
          reactivityMap.delete(oldVal);
          if (bindMap.has(oldVal)) {
            bindMap.get(oldVal)!.forEach(removeElement);
            bindMap.delete(oldVal);
          }
          cleanProxy(oldVal);
        } else {
          if (bindMap.has(receiver)) {
            bindMap.get(receiver)!.forEach(removeElement);
            bindMap.delete(receiver);
          }
        }

        returnSet = Reflect.deleteProperty(receiver, key);
        return returnSet;
      }

      // Set the value
      if (isPromise(val)) {
        const promise = val;
        promise
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
        Object.entries(val).forEach(([subKey, subVal]) => {
          if (isObject(subVal) && !isProxy(subVal)) {
            Reflect.set(val, subKey, generateProxy(subVal));
          }
        });
      } else {
        returnSet = Reflect.set(target, key, val, receiver);
      }

      // Check if DOM needs to be updated
      // oldVal can be Proxy value too
      if (reactivityMap.has(oldVal)) {
        checkReactivityMap(oldVal, key, val, oldVal);
      } else if (reactivityMap.has(receiver)) {
        checkReactivityMap(receiver, key, val, oldVal);
      }

      // current val (before setting) is a proxy - take over its keyToNodeMap
      if (isObject(val) && isProxy(val)) {
        if (reactivityMap.has(oldVal)) {
          // Store old reactivityMap if it is a swap operation
          tmpSwap.set(oldVal, reactivityMap.get(oldVal)!);

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
        Reflect.get(target, handlers, receiver)
          .get(key)
          ?.forEach((handler: Function) =>
            handler(Reflect.get(hydro, key), oldVal)
          );
      }

      // Setting oldVal to null does not work because the prop has already been updated.
      // Hence, the reset Path will not be triggered. GC it here instead.
      if (isObject(oldVal) && isProxy(oldVal)) {
        cleanProxy(oldVal, Reflect.get(target, key, receiver));
      }

      return returnSet;
    },

    // fix proxy bugs, e.g Map
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (!isFunction(value)) {
        return value;
      }

      if (!boundFunctions.has(value)) {
        boundFunctions.set(value, value.bind(target));
      }
      return boundFunctions.get(value);
    },
  } as ProxyHandler<hydroObject>);

  Reflect.defineProperty(proxy, Placeholder.isProxy, {
    value: true,
  });
  Reflect.defineProperty(proxy, Placeholder.asyncUpdate, {
    value: globalSchedule,
    writable: true,
  });
  Reflect.defineProperty(proxy, handlers, {
    //TODO: should be WeakValue in future
    value: new Map(),
  });
  Reflect.defineProperty(proxy, Placeholder.observe, {
    value: (key: keyof any, handler: Function) => {
      const map = Reflect.get(proxy, handlers);

      if (map.has(key)) {
        map.get(key).add(handler);
      } else {
        map.set(key, new Set([handler]));
      }
    },
    configurable: true,
  });
  Reflect.defineProperty(proxy, Placeholder.getObservers, {
    value: () => Reflect.get(proxy, handlers),
    configurable: true,
  });
  Reflect.defineProperty(proxy, Placeholder.unobserve, {
    value: (key: keyof any) => {
      const map = Reflect.get(proxy, handlers);

      if (key) {
        if (map.has(key)) map.delete(key);
      } else {
        map.clear();
      }
    },
    configurable: true,
  });
  window.queueMicrotask(() => {
    if (proxy === hydro)
      Reflect.defineProperty(proxy, _boundFunctions, {
        value: boundFunctions,
      });
  });

  return proxy as hydroObject;
}
function cleanProxy(oldProxy: hydroObject, currentProxy?: hydroObject) {
  // Unobserve
  const observer = oldProxy.getObservers();
  observer.forEach((set) => set.clear());
  oldProxy.unobserve();

  // Set containing Proxys to null too
  let filterEmpty: Array<number> = [];
  Object.entries(oldProxy).forEach(([subKey, subVal]) => {
    if (isObject(subVal) && isProxy(subVal)) {
      filterEmpty.push((subKey as unknown) as number);
      if (
        !currentProxy ||
        !Reflect.has(currentProxy, subKey) ||
        subVal !== Reflect.get(currentProxy, subKey)
      )
        Reflect.set(oldProxy, subKey, null);
    }
  });

  // Remove empty slot from array
  if (Array.isArray(oldProxy)) {
    filterEmpty.reverse().forEach((idx) => filterEmpty.splice(idx, 1));
  }
}
function checkReactivityMap(obj: any, key: keyof any, val: any, oldVal: any) {
  const keyToNodeMap = reactivityMap.get(obj)!;

  if (keyToNodeMap.has(String(key))) {
    /* c8 ignore next 5 */
    if (Reflect.get(obj, Placeholder.asyncUpdate)) {
      toSchedule.push([updateDOM, keyToNodeMap, String(key), val, oldVal]);
      if (!isScheduling) window.requestIdleCallback(schedule);
    } else {
      updateDOM(keyToNodeMap, String(key), val, oldVal);
    }
  }

  if (isObject(val)) {
    Object.entries(val).forEach(([subKey, subVal]) => {
      const subOldVal =
        (isObject(oldVal) && Reflect.get(oldVal, subKey)) || oldVal;

      if (keyToNodeMap.has(subKey)) {
        /* c8 ignore next 5 */
        if (Reflect.get(obj, Placeholder.asyncUpdate)) {
          toSchedule.push([updateDOM, keyToNodeMap, subKey, subVal, subOldVal]);
          if (!isScheduling) window.requestIdleCallback(schedule);
        } else {
          updateDOM(keyToNodeMap, subKey, subVal, subOldVal);
        }
      }
    });
  }
}

function updateDOM(
  keyToNodeMap: keyToNodeMap,
  key: string,
  val: any,
  oldVal: any
) {
  const nodeToChangeMap = keyToNodeMap.get(key) as nodeToChangeMap;

  nodeToChangeMap.forEach((entry) => {
    // Circular reference in order to keep Memory low
    if (isNode(entry as Text)) {
      /* c8 ignore next 5 */
      if (!(entry as Node).isConnected) {
        const tmpChange = nodeToChangeMap.get(entry)!;
        nodeToChangeMap.delete(entry);
        nodeToChangeMap.delete(tmpChange);
      }
      return; // Continue in forEach
    }

    // For each change of the node update either attribute or textContent
    (entry as nodeChange).forEach((change) => {
      const node = nodeToChangeMap.get(entry) as Element | Text;
      const [start, end, key] = change;
      let useStartEnd = false;

      if (isNode(val)) {
        replaceElement(val, node as Element);
      } else if (isTextNode(node)) {
        useStartEnd = true;
        let text = node.nodeValue!;

        node.nodeValue =
          text.substring(0, start) + String(val) + text.substring(end);
      } else {
        if (key === Placeholder.twoWay) {
          if (
            node instanceof HTMLTextAreaElement ||
            node instanceof HTMLSelectElement ||
            (node instanceof HTMLInputElement && node.type === Placeholder.text)
          ) {
            (node as HTMLInputElement).value = String(val);
          } else if (
            node instanceof HTMLInputElement &&
            (node.type === Placeholder.checkbox ||
              node.type === Placeholder.radio)
          ) {
            node.checked = Array.isArray(val)
              ? val.includes(node.name)
              : String(val) === node.value;
          }
        } else if (isFunction(val) || isEventObject(val)) {
          const eventName = key!.replace(onEventRegex, "");
          node.removeEventListener(
            eventName,
            isFunction(val) ? val : val.event
          );
          addEventListener(node, eventName, val);
        } else if (isObject(val)) {
          Object.entries(val).forEach(([subKey, subVal]) => {
            if (isFunction(subVal) || isEventObject(subVal)) {
              const eventName = subKey.replace(onEventRegex, "");
              node.removeEventListener(
                eventName,
                isFunction(subVal) ? subVal : subVal.event
              );
              addEventListener(node, eventName, subVal);
            } else {
              setAttribute(node, subKey, subVal);
            }
          });
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
        let passedNode: boolean;
        allNodeChanges.get(node)?.forEach((nodeChange) => {
          if (nodeChange === change) {
            passedNode = true;
            return;
          }

          if (passedNode && (isTextNode(node) || key === nodeChange[2])) {
            const difference = String(oldVal).length - String(val).length;
            nodeChange[0] -= difference;
            nodeChange[1] -= difference;
          }
        });
      }
    });
  });
}

const hydro = generateProxy();
const $ = document.querySelector.bind(document);
const $$ = document.querySelectorAll.bind(document);

let wasHidden: boolean = false;
document.addEventListener("visibilitychange", () => {
  /* c8 ignore next 19 */
  // The schedule logic does not work well when the document is in the background. Ideally all the changes have to be rendered at once, if the User comes back
  // This could block the UI however, and it makes sense to only render the last updates < 50ms
  if (wasHidden === true && document.hidden === false) {
    const start = performance.now();
    // 1 frame if 24fps, 18 frames if 360fps
    const lastFrames = toSchedule.splice(toSchedule.length - 18, 18);
    while (lastFrames.length > 0 && performance.now() < start + 50) {
      const [fn, ...args] = lastFrames.shift()!;
      fn(...args);
    }
    // Render the latest update, just in case
    if (lastFrames.length > 0) {
      const [fn, ...args] = lastFrames.pop()!;
      fn(...args);
    }
    // Empty toSchedule
    toSchedule.splice(0, toSchedule.length);
  }
  wasHidden = document.hidden;
});

const internals = {
  compare,
};
export {
  render,
  html,
  hydro,
  setGlobalSchedule,
  setReuseElements,
  setInsertDiffing,
  reactive,
  unset,
  setAsyncUpdate,
  unobserve,
  observe,
  ternary,
  emit,
  internals,
  getValue,
  onRender,
  onCleanup,
  setReactivity,
  $,
  $$,
};
