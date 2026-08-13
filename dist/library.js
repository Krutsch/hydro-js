import { createOwnership, } from "./ownership.js";
import { createBinding } from "./binding.js";
import { createUpdateEngine, } from "./updates.js";
import { createView, createViewState } from "./view.js";
// Safari Polyfills
window.requestIdleCallback =
    /* c8 ignore next 4 */
    window.requestIdleCallback ||
        ((cb, _, start = window.performance.now()) => window.setTimeout(cb, 0, {
            didTimeout: false,
            timeRemaining: () => Math.max(0, 5 - (window.performance.now() - start)),
        }));
// Safari Polyfills END
// Hoisted out of the hot paths: every `window.X` is a global object lookup.
const NodeConstructor = window.Node;
const SHOW_ELEMENT = window.NodeFilter.SHOW_ELEMENT;
const range = document.createRange();
range.selectNodeContents(range.createContextualFragment(`<${"template" /* Placeholder.template */}>`).lastChild);
const defaultParser = range.createContextualFragment.bind(range);
let ownership;
let allNodeChanges;
let elemEventFunctions;
let reactivityMap;
let bindMap;
let boundElemProxies;
let tmpSwap;
let onRenderMap;
let onCleanupMap;
let binding;
let updateEngine;
const fragmentToElements = new WeakMap(); // Used to retreive Elements from DocumentFragment after it has been rendered â€“ for diffing
const hydroToReactive = new WeakMap(); // Used for internal mapping from hydroKeys to the the Proxy created by the reactive function
const ternaryDisposers = new WeakMap();
const reactiveSymbol = Symbol("reactive");
const keysSymbol = Symbol("keys");
const htmlCache = new WeakMap();
const htmlPartsCache = new WeakMap();
const htmlTemplateCacheable = new WeakMap();
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
    const registry = globalThis;
    const previousVersion = registry[instanceKey];
    if (previousVersion === undefined) {
        registry[instanceKey] = VERSION;
    }
    else {
        console.warn(`[hydro-js] Duplicate instances (${previousVersion}, ${VERSION}); ` +
            `separate reactivity state. Deduplicate with \`npm ls hydro-js\`, ` +
            `aligned ranges, or an "overrides" entry.`);
    }
}
/* c8 ignore stop */
let globalSchedule = true; // Decides whether to schedule rendering and updating (async)
let reuseElements = true; // Reuses Elements when rendering
let insertBeforeDiffing = false; // Makes sense in Chrome only
let shouldSetReactivity = true;
let ignoreIsConnected = false;
/* c8 ignore start */
const reactivityRegex = new RegExp(isServerSideCached
    ? `\\{\\{([^]*?)\\}\\}|${"hydro-reactive-" /* Placeholder.reactiveKey */}([a-zA-Z0-9_.-]+)`
    : `\\{\\{([^]*?)\\}\\}`);
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
let lastSwapElem = null;
let internReset = false;
let reactiveKeyCounter = 0;
const primitiveTypes = new Set([
    "number",
    "string",
    "symbol",
    "boolean",
    "bigint",
]);
function isObject(obj) {
    return obj != null && typeof obj === "object";
}
function isFunction(func) {
    return typeof func === "function" /* Placeholder.function */;
}
function isTextNode(node) {
    return node.splitText !== undefined;
}
function isNode(node) {
    return isObject(node) && node instanceof NodeConstructor;
}
function isDocumentFragment(node) {
    return node.nodeType === 11;
}
function isEventObject(obj) {
    return (isObject(obj) && "event" /* Placeholder.event */ in obj && "options" /* Placeholder.options */ in obj);
}
function isProxy(hydroObject) {
    const wasTracking = trackDeps;
    if (wasTracking)
        trackDeps = false;
    const result = Reflect.get(hydroObject, "isProxy" /* Placeholder.isProxy */);
    if (wasTracking)
        trackDeps = true;
    return result;
}
function isPromise(obj) {
    return isObject(obj) && typeof obj.then === "function";
}
function isServerSide() {
    return (window.navigator.userAgent.includes("Node.js") ||
        window.navigator.userAgent.includes("Deno") ||
        window.navigator.userAgent.includes("Bun") ||
        window.navigator.userAgent.includes("HappyDOM") ||
        window.navigator.userAgent.includes("jsdom"));
}
function randomText() {
    const randomChars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 6; i++) {
        result += randomChars.charAt(Math.floor(Math.random() * randomChars.length));
    }
    return result;
    // return Math.random().toString(32).slice(2);
}
function setGlobalSchedule(willSchedule) {
    globalSchedule = willSchedule;
    setHydroRecursive(hydro);
}
function setReuseElements(willReuse) {
    reuseElements = willReuse;
}
function setInsertDiffing(willInsert) {
    insertBeforeDiffing = willInsert;
}
function setShouldSetReactivity(willSet) {
    shouldSetReactivity = willSet;
}
function setIgnoreIsConnected(ignore) {
    ignoreIsConnected = ignore;
}
function setHydroRecursive(obj) {
    Reflect.set(obj, "asyncUpdate" /* Placeholder.asyncUpdate */, globalSchedule);
    for (const value of Object.values(obj)) {
        if (isObject(value) && isProxy(value)) {
            setHydroRecursive(value);
        }
    }
}
function setAttribute(node, key, val) {
    const isBoolAttr = boolAttrSet.has(key);
    if (isBoolAttr && !val) {
        node.removeAttribute(key);
        return false;
    }
    node.setAttribute(key, isFunction(val) && Reflect.has(val, reactiveSymbol)
        ? val
        : isBoolAttr
            ? ""
            : val);
    return true;
}
function addEventListener(node, eventName, obj) {
    ownership.addEventListener(node, eventName, obj);
}
function removeTrackedEventListener(node, eventName, handler) {
    ownership.removeTrackedEventListener(node, eventName, handler);
}
function purgeTrackedEventListeners(node) {
    ownership.purgeTrackedEventListeners(node);
}
function trackBoundElement(proxy, elem) {
    ownership.trackBoundElement(proxy, elem);
}
function untrackBoundElement(proxy, elem) {
    ownership.untrackBoundElement(proxy, elem);
}
function html(htmlArray, ...variables) {
    const cachedDOM = createCachedHTML(htmlArray, variables);
    if (cachedDOM)
        return cachedDOM;
    const eventFunctions = new Map(); // Temporarily store a mapping for string -> function, because eventListener have to be registered after the Element's creation
    const insertNodes = []; // Nodes, that will be added after the parsing
    const template = `<${"template" /* Placeholder.template */} id="lbInsertNodes"></${"template" /* Placeholder.template */}>`;
    const resolvedVariables = new Array(variables.length);
    for (let i = 0; i < variables.length; i++) {
        const variable = variables[i];
        if (isNode(variable)) {
            insertNodes.push(variable);
            resolvedVariables[i] = template;
        }
        else if (primitiveTypes.has(typeof variable) ||
            Reflect.has(variable, reactiveSymbol)) {
            resolvedVariables[i] = String(variable);
        }
        else if (isFunction(variable) || isEventObject(variable)) {
            const funcName = randomText();
            eventFunctions.set(funcName, variable);
            if (viewState.rendering)
                viewState.eventFunctions.set(funcName, variable);
            resolvedVariables[i] = funcName;
        }
        else if (Array.isArray(variable)) {
            for (let index = 0; index < variable.length; index++) {
                const item = variable[index];
                if (isNode(item)) {
                    insertNodes.push(item);
                    variable[index] = template;
                }
            }
            resolvedVariables[i] = variable.join("");
        }
        else if (isObject(variable)) {
            let result = "";
            for (const [key, value] of Object.entries(variable)) {
                if (isFunction(value) || isEventObject(value)) {
                    const funcName = randomText();
                    eventFunctions.set(funcName, value);
                    viewState.rendering && viewState.eventFunctions.set(funcName, value);
                    result += `${key}="${funcName}"`;
                }
                else {
                    result += `${key}="${value}"`;
                }
            }
            resolvedVariables[i] = result;
        }
    }
    // Find elements <html|head|body>, as they cannot be created by the parser. Replace them by fake Custom Elements and replace them afterwards.
    let DOMString = String.raw(htmlArray, ...resolvedVariables).trim();
    DOMString = DOMString.replace(HTML_FIND_INVALID, `<$1$2${"-dummy" /* Placeholder.dummy */}$3`);
    const DOM = parser(DOMString);
    // Delay Element iteration and manipulation after the elements have been added to the DOM.
    if (!viewState.rendering) {
        fillDOM(DOM, insertNodes, eventFunctions);
    }
    // Return DocumentFragment
    if (DOM.childNodes.length > 1)
        return DOM;
    // Return empty Text Node
    if (!DOM.firstChild)
        return document.createTextNode("");
    // Return Element | Text
    return DOM.firstChild;
}
function parser(DOMString) {
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
function parseTableFragment(parentName, DOMString) {
    const parent = document.createElement(parentName);
    parent.innerHTML = DOMString;
    const fragment = document.createDocumentFragment();
    fragment.append(...parent.childNodes);
    return fragment;
}
function isReactiveValue(value) {
    return ((isObject(value) || isFunction(value)) && Reflect.has(value, reactiveSymbol));
}
function containsReactiveMarker(value) {
    return (value.includes("{{") ||
        /* c8 ignore next */
        (isServerSideCached && value.includes("hydro-reactive-" /* Placeholder.reactiveKey */)));
}
function containsReactiveValue(value) {
    if (Array.isArray(value))
        return value.some(containsReactiveValue);
    if (isReactiveValue(value))
        return true;
    if (typeof value === "string" /* Placeholder.string */)
        return containsReactiveMarker(value);
    if (isObject(value) && !isNode(value)) {
        return Object.values(value).some(containsReactiveValue);
    }
    return false;
}
function containsParsedHTML(value) {
    return value.includes("<") || containsReactiveMarker(value);
}
function canCacheHTMLPosition(htmlArray, index) {
    const before = htmlArray.slice(0, index + 1).join("");
    if (/<\/?$/.test(before))
        return false;
    return !/<[^>]*\s$/.test(before);
}
function isTemplateCacheable(htmlArray) {
    const cached = htmlTemplateCacheable.get(htmlArray);
    if (cached !== undefined)
        return cached;
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
function canCacheHTMLVariables(htmlArray, variables) {
    if (!isTemplateCacheable(htmlArray))
        return false;
    for (const variable of variables) {
        if (isNode(variable) || Array.isArray(variable))
            return false;
        if (isReactiveValue(variable))
            continue;
        if (containsReactiveValue(variable))
            return false;
        if (typeof variable === "string" /* Placeholder.string */ &&
            containsParsedHTML(variable)) {
            return false;
        }
        if (primitiveTypes.has(typeof variable) ||
            isFunction(variable) ||
            isEventObject(variable)) {
            continue;
        }
        return false;
    }
    return true;
}
function createCachedHTML(htmlArray, variables) {
    if (!shouldSetReactivity || !canCacheHTMLVariables(htmlArray, variables)) {
        return undefined;
    }
    let cachedDOM = htmlCache.get(htmlArray);
    let parts = htmlPartsCache.get(htmlArray);
    if (!cachedDOM) {
        const markers = variables.map((_, index) => `__hydro${index}__`);
        const DOMString = String.raw(htmlArray, ...markers).trim();
        if (HTML_FIND_INVALID.test(DOMString))
            return undefined;
        cachedDOM = parser(DOMString);
        htmlCache.set(htmlArray, cachedDOM);
        parts = buildHTMLParts(cachedDOM);
        htmlPartsCache.set(htmlArray, parts);
    }
    const DOM = cachedDOM.cloneNode(true);
    applyCompiledParts(DOM, parts, variables);
    if (DOM.childNodes.length > 1) {
        markCachedHTMLWired(DOM);
        return DOM;
    }
    if (!DOM.firstChild)
        return document.createTextNode("");
    markCachedHTMLWired(DOM.firstChild);
    return DOM.firstChild;
}
function markCachedHTMLWired(node) {
    node[prewiredSymbol] = true;
}
function isViewPrewired(node) {
    return node[prewiredSymbol] === true;
}
function buildHTMLParts(root) {
    return binding.buildHTMLParts(root);
}
function applyCompiledParts(root, parts, variables) {
    binding.applyCompiledParts(root, parts, variables);
}
// Fast path for a slot that is exactly one reactive value. Returns false when
// the value needs the generic (string parsing) path in setReactivitySingle.
function wireReactiveValue(node, variable, key) {
    return binding.wireReactiveValue(node, variable, key);
}
function fillDOM(elem, insertNodes, eventFunctions) {
    const root = document.createNodeIterator(elem, SHOW_ELEMENT, {
        acceptNode(element) {
            return element.localName.endsWith("-dummy" /* Placeholder.dummy */)
                ? window.NodeFilter.FILTER_ACCEPT
                : window.NodeFilter.FILTER_REJECT;
        },
    });
    const nodes = [];
    let currentNode;
    while ((currentNode = root.nextNode())) {
        nodes.push(currentNode);
    }
    for (const node of nodes) {
        const tag = node.localName.replace("-dummy" /* Placeholder.dummy */, "");
        const replacement = document.createElement(tag);
        /* c8 ignore next 3 */
        for (const key of node.getAttributeNames()) {
            replacement.setAttribute(key, node.getAttribute(key));
        }
        replacement.append(...node.childNodes);
        node.replaceWith(replacement);
    }
    // Insert HTML Elements, which were stored in insertNodes
    if (!isTextNode(elem)) {
        for (const template of elem.querySelectorAll("template[id^=lbInsertNodes]"))
            template.replaceWith(insertNodes.shift());
    }
    if (shouldSetReactivity)
        setReactivity(elem, eventFunctions);
}
function wireViewHProp(elem, key, value) {
    return binding.wireViewHProp(elem, key, value);
}
function wireViewHChild(elem, child) {
    return binding.wireViewHChild(elem, child);
}
function h(name, props, ...children) {
    if (isFunction(name))
        return name({ ...props, children });
    const isFragment = typeof name !== "string" /* Placeholder.string */;
    const elem = isFragment
        ? document.createDocumentFragment()
        : document.createElement(name, props?.["is"] !== undefined ? { is: props["is"] } : undefined);
    let viewPrewired = viewState.rendering;
    let needsScan = false;
    for (const i in props) {
        const value = props[i];
        if (viewState.rendering && (i === "bind" || isReactiveValue(value))) {
            if (wireViewHProp(elem, i, value))
                continue;
            viewPrewired = false;
        }
        else if (!viewState.rendering &&
            !needsScan &&
            (i === "bind" || i === "two-way" /* Placeholder.twoWay */ || containsReactiveValue(value))) {
            needsScan = true;
        }
        isElementProperty(elem, i, isFragment) && !boolAttrSet.has(i)
            ? //@ts-ignore
                (elem[i] = value)
            : setAttribute(elem, i, value);
    }
    if (isFragment) {
        children = name.children;
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
                if (!isViewPrewired(child))
                    viewPrewired = false;
            }
            else if (isReactiveValue(child)) {
                if (wireViewHChild(elem, child))
                    continue;
                viewPrewired = false;
            }
        }
        else if (!needsScan) {
            childIsNode = isNode(child);
            needsScan = childIsNode
                ? !isViewPrewired(child)
                : containsReactiveValue(child);
        }
        childIsNode ? elem.appendChild(child) : elem.append(child);
    }
    if (!viewState.rendering) {
        if (needsScan)
            setReactivity(elem);
        markCachedHTMLWired(elem);
    }
    else if (viewPrewired) {
        markCachedHTMLWired(elem);
    }
    return elem;
}
// `prop in element` walks the whole prototype chain across the JS/DOM
// boundary. The answer only depends on the element interface, so cache it per
// constructor - a not yet defined custom element never shares an entry with
// the upgraded one, and customized built-ins keep their own entry.
const elementProperties = new WeakMap();
function isElementProperty(elem, prop, isFragment) {
    if (isFragment)
        return prop in elem;
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
function getChildren(child) {
    return isObject(child) && !isNode(child)
        ? Object.values(child)
        : child;
}
/* c8 ignore end */
function setReactivity(DOM, eventFunctions) {
    binding.setReactivity(DOM, eventFunctions);
}
function setReactivitySingle(node, key, val) {
    binding.setReactivitySingle(node, key, val);
}
// Same behavior as v-model in https://v3.vuejs.org/guide/forms.html#basic-usage
function changeAttrVal(eventName, node, resolvedObj, lastProp, isChecked = false) {
    node.addEventListener(eventName, changeHandler);
    onCleanup(() => node.removeEventListener(eventName, changeHandler), node);
    function changeHandler({ target }) {
        Reflect.set(resolvedObj, lastProp, isChecked
            ? target.checked
            : target.value);
    }
}
function setTraces(start, end, node, hydroKey, resolvedObj, key) {
    ownership.recordTrace(start, end, node, hydroKey, resolvedObj, key);
}
// Helper function to return a value and hydro obj from a chain of properties
function resolveObject(propertyArray) {
    let value, prev;
    value = prev = hydro;
    for (const prop of propertyArray) {
        prev = value;
        value = Reflect.get(prev, prop);
    }
    return [value, prev];
}
function compareEvents(elem, where, onlyTextChildren) {
    const elemFunctions = [];
    const whereFunctions = [];
    if (isTextNode(elem)) {
        pushLifecycleFunctions(elemFunctions, onRenderMap, elem);
        pushLifecycleFunctions(elemFunctions, onCleanupMap, elem);
        pushLifecycleFunctions(whereFunctions, onRenderMap, where);
        pushLifecycleFunctions(whereFunctions, onCleanupMap, where);
        return (elemFunctions.length === whereFunctions.length &&
            String(elemFunctions) === String(whereFunctions));
    }
    pushTrackedHandlers(elemFunctions, elem);
    pushTrackedHandlers(whereFunctions, where);
    pushLifecycleFunctions(elemFunctions, onRenderMap, elem);
    pushLifecycleFunctions(elemFunctions, onCleanupMap, elem);
    pushLifecycleFunctions(whereFunctions, onRenderMap, where);
    pushLifecycleFunctions(whereFunctions, onCleanupMap, where);
    if (elemFunctions.length !== whereFunctions.length)
        return false;
    if (String(elemFunctions) !== String(whereFunctions))
        return false;
    for (let i = 0; i < elem.childNodes.length; i++) {
        const elemChild = elem.childNodes[i];
        const whereChild = where.childNodes[i];
        if (onlyTextChildren) {
            if (isTextNode(elemChild)) {
                if (!compareEvents(elemChild, whereChild, onlyTextChildren)) {
                    return false;
                }
            }
        }
        else if (!compareEvents(elemChild, whereChild)) {
            return false;
        }
    }
    return true;
}
function pushTrackedHandlers(functions, elem) {
    ownership.pushTrackedHandlers(functions, elem);
}
function pushLifecycleFunctions(functions, lifecycleMap, node) {
    ownership.pushLifecycleFunctions(functions, lifecycleMap === onRenderMap ? "render" : "cleanup", node);
}
function compare(elem, where, onlyTextChildren) {
    if (isDocumentFragment(elem) || isDocumentFragment(where))
        return false;
    return (elem.isEqualNode(where) && compareEvents(elem, where, onlyTextChildren));
}
function render(elem, where = "", shouldSchedule = globalSchedule) {
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
    let elemChildren = [];
    if (isDocumentFragment(elem)) {
        elemChildren = Array.from(elem.childNodes);
        fragmentToElements.set(elem, elemChildren); // For diffing later
    }
    if (!where) {
        document.body.append(elem);
    }
    else {
        if (typeof where === "string" /* Placeholder.string */) {
            const resolveStringToElement = $(where);
            if (resolveStringToElement) {
                where = resolveStringToElement;
            }
            else {
                return noop;
            }
        }
        if (!reuseElements) {
            const previous = where;
            replaceElement(elem, previous);
            purgeDetached(previous);
        }
        else {
            if (isTextNode(elem)) {
                const previous = where;
                replaceElement(elem, previous);
                purgeDetached(previous);
            }
            else if (!compare(elem, where)) {
                treeDiff(elem, where);
            }
        }
    }
    runLifecyle(elem, onRenderMap);
    for (const subElem of elemChildren) {
        runLifecyle(subElem, onRenderMap);
    }
    return unmount(isDocumentFragment(elem) ? elemChildren : elem);
}
function noop() { }
function runLifecyle(node, lifecyleMap) {
    ownership.runLifecycle(node, lifecyleMap === onRenderMap ? "render" : "cleanup");
}
function filterTag2Elements(tag2Elements, root) {
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
function treeDiff(elem, where) {
    const elemElements = [...elem.querySelectorAll("*")];
    if (!isDocumentFragment(elem))
        elemElements.unshift(elem);
    let whereElements = [];
    if (!isTextNode(where)) {
        whereElements = [...where.querySelectorAll("*")];
        if (!isDocumentFragment(where))
            whereElements.unshift(where);
    }
    let template;
    if (insertBeforeDiffing) {
        template = document.createElement(isServerSideCached ? "div" : "template");
        /* c8 ignore next 3 */
        if (where === document.documentElement) {
            where.append(template);
        }
        else {
            if (isDocumentFragment(where)) {
                fragmentToElements.get(where)[0].before(template);
            }
            else {
                where.before(template);
            }
        }
        template.append(elem);
    }
    // Create Mapping for easier diffing, eg: "div" -> [...Element]
    const tag2Elements = new Map();
    for (const wElem of whereElements) {
        /* c8 ignore next 2 */
        if (insertBeforeDiffing && wElem === template)
            return;
        const sameTag = tag2Elements.get(wElem.localName);
        if (sameTag) {
            sameTag.push(wElem);
        }
        else {
            tag2Elements.set(wElem.localName, [wElem]);
        }
    }
    // Re-use any where Element if possible, then remove elem Element
    for (const subElem of elemElements) {
        const sameElements = tag2Elements.get(subElem.localName);
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
            ? Array.from(template.childNodes)
            : [elem];
        if (isDocumentFragment(where)) {
            const oldElems = fragmentToElements.get(where);
            for (const e of newElems)
                oldElems[0].before(e);
            for (const e of oldElems)
                e.remove();
        }
        else {
            if (where instanceof window.HTMLHtmlElement) {
                replaceElement(elem, where);
            }
            else {
                where.replaceWith(...newElems);
            }
        }
        template.remove();
        runLifecyle(where, onCleanupMap);
    }
    else {
        replaceElement(elem, where);
    }
    if (!ignoreIsConnected) {
        for (const subElem of elemElements) {
            if (!subElem.isConnected)
                purgeSubtree(subElem);
        }
        for (const subElem of whereElements) {
            if (!subElem.isConnected)
                purgeSubtree(subElem);
        }
    }
    tag2Elements.clear();
}
function replaceElement(elem, where) {
    if (isDocumentFragment(where)) {
        const fragmentChildren = fragmentToElements.get(where);
        if (isDocumentFragment(elem)) {
            const fragmentElements = Array.from(elem.childNodes);
            for (let index = 0; index < fragmentChildren.length; index++) {
                const fragWhere = fragmentChildren[index];
                if (index < fragmentElements.length) {
                    render(fragmentElements[index], fragWhere);
                }
                else {
                    fragWhere.remove();
                }
            }
        }
        else {
            for (let index = 0; index < fragmentChildren.length; index++) {
                const fragWhere = fragmentChildren[index];
                if (index === 0) {
                    render(elem, fragWhere);
                }
                else {
                    fragWhere.remove();
                }
            }
        }
        /* c8 ignore start */
    }
    else if (isServerSideCached) {
        if (elem instanceof window.HTMLHtmlElement &&
            where instanceof window.HTMLHtmlElement) {
            for (const key of elem.getAttributeNames()) {
                setAttribute(where, key, elem.getAttribute(key));
            }
            where.replaceChildren(...elem.childNodes);
        }
        else {
            where.replaceWith(elem);
        }
        /* c8 ignore end */
    }
    else {
        where.replaceWith(elem);
    }
    runLifecyle(where, onCleanupMap);
}
function unmount(elem) {
    if (Array.isArray(elem)) {
        return () => elem.forEach(removeElement);
    }
    else {
        return () => removeElement(elem);
    }
}
function removeElement(elem) {
    if (!ignoreIsConnected && elem.isConnected) {
        elem.remove();
        runLifecyle(elem, onCleanupMap);
        purgeSubtree(elem);
    }
}
function purgeSubtree(root) {
    ownership.purgeSubtree(root);
}
function purgeDetached(node) {
    ownership.purgeDetached(node);
}
/* c8 ignore next 13 */
const hasScheduler = "scheduler" in window;
const schedulerOptions = { priority: "user-blocking" };
function schedule(fn, ...args) {
    if (hasScheduler) {
        // @ts-ignore
        window.scheduler.postTask(() => fn(...args), schedulerOptions);
    }
    else {
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
        reactiveKey: "hydro-reactive-" /* Placeholder.reactiveKey */,
        twoWay: "two-way" /* Placeholder.twoWay */,
        change: "change" /* Placeholder.change */,
        radio: "radio" /* Placeholder.radio */,
        checkbox: "checkbox" /* Placeholder.checkbox */,
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
    getReactivePath: (value) => Reflect.get(value, keysSymbol.description),
    isProxy,
    setAttribute,
    addEventListener,
    trackBoundElement,
    setTraces,
    changeAttrVal,
});
const updateAdapter = {
    isConnected: (node) => node.isConnected,
    isText: isTextNode,
    isNode,
    isFunction,
    isEventObject,
    isObject: (value) => isObject(value),
    replace: (node, value) => {
        replaceElement(value, node);
        return isDocumentFragment(value) ? null : value;
    },
    applyText: (node, start, end, value) => {
        const text = node;
        const current = text.nodeValue;
        text.nodeValue =
            current.substring(0, start) + value + current.substring(end);
    },
    applyControl: (node, _key, value) => {
        const elem = node;
        if (elem instanceof window.HTMLInputElement &&
            elem.type === "radio" /* Placeholder.radio */) {
            elem.checked = Array.isArray(value)
                ? value.includes(elem.name)
                : String(value) === elem.value;
        }
        else if (elem instanceof window.HTMLInputElement &&
            elem.type === "checkbox" /* Placeholder.checkbox */) {
            elem.checked = Boolean(value);
        }
        else if (elem instanceof window.HTMLTextAreaElement ||
            elem instanceof window.HTMLSelectElement ||
            elem instanceof window.HTMLInputElement) {
            elem.value = String(value);
        }
    },
    applyEvent: (node, key, value, oldValue) => {
        const elem = node;
        const previous = oldValue;
        const oldHandler = isFunction(previous) ? previous : previous.event;
        removeTrackedEventListener(elem, key, oldHandler);
        addEventListener(elem, key, value);
    },
    applyObject: (node, value, oldValue) => {
        const elem = node;
        const previous = oldValue;
        for (const [subKey, subValue] of Object.entries(value)) {
            if (isFunction(subValue) || isEventObject(subValue)) {
                const previousHandler = previous?.[subKey];
                const oldHandler = isFunction(previousHandler)
                    ? previousHandler
                    : previousHandler?.event;
                const eventName = subKey.replace(onEventRegex, "");
                if (oldHandler)
                    removeTrackedEventListener(elem, eventName, oldHandler);
                addEventListener(elem, eventName, subValue);
            }
            else {
                setAttribute(elem, subKey, subValue);
            }
        }
    },
    applyAttribute: (node, key, start, end, value) => {
        const elem = node;
        let attr = elem.getAttribute(key);
        const valueString = String(value);
        if (attr) {
            attr = attr.substring(0, start) + valueString + attr.substring(end);
            setAttribute(elem, key, attr === valueString ? value : attr);
        }
        else {
            setAttribute(elem, key, value);
        }
    },
};
updateEngine = createUpdateEngine({
    adapter: updateAdapter,
    allNodeChanges,
    reactivityMap,
    schedule,
    isAsync: (obj) => Reflect.get(obj, "asyncUpdate" /* Placeholder.asyncUpdate */),
    isServerSideCached,
    shouldIgnoreIsConnected: () => ignoreIsConnected,
    onEvent: (key) => key.replace(onEventRegex, ""),
    twoWayKey: "two-way" /* Placeholder.twoWay */,
});
function reactive(initial) {
    let key;
    do
        key = `hydror${reactiveKeyCounter++}`;
    while (Reflect.has(hydro, key));
    Reflect.set(hydro, key, initial);
    Reflect.set(setter, reactiveSymbol, true);
    const chainKeysProxy = chainKeys(setter, [key]);
    if (isObject(initial)) {
        hydroToReactive.set(Reflect.get(hydro, key), chainKeysProxy);
    }
    return chainKeysProxy;
    function setter(val) {
        const keys = // @ts-ignore
         (this && Reflect.has(this, reactiveSymbol) ? this : chainKeysProxy)[keysSymbol.description];
        const [resolvedValue, resolvedObj] = resolveObject(keys);
        const lastProp = keys[keys.length - 1];
        if (isFunction(val)) {
            const returnVal = val(resolvedValue);
            const sameObject = resolvedValue === returnVal;
            if (sameObject)
                return;
            Reflect.set(resolvedObj, lastProp, returnVal ?? resolvedValue);
        }
        else {
            Reflect.set(resolvedObj, lastProp, val);
        }
    }
}
function chainKeys(initial, keys) {
    // One-slot memo per chain node: a row builder touches the same path
    // (e.g. data[index]) several times, so re-allocating a Proxy plus a copied
    // key array on every property read is pure garbage.
    let cachedKey;
    let cachedProxy;
    let toPrimitive;
    return new Proxy(initial, {
        get(target, subKey, _receiver) {
            if (subKey === reactiveSymbol.description)
                return true;
            if (subKey === keysSymbol.description) {
                return keys;
            }
            if (subKey === Symbol.toPrimitive) {
                return (toPrimitive ??= () => isServerSideCached
                    ? `${"hydro-reactive-" /* Placeholder.reactiveKey */}${keys.join(".")}`
                    : `{{${keys.join(".")}}}`);
            }
            if (subKey === cachedKey)
                return cachedProxy;
            const chained = chainKeys(target, [...keys, subKey]);
            cachedKey = subKey;
            cachedProxy = chained;
            return chained;
        },
    });
}
function getReactiveKeys(reactiveHydro) {
    const keys = reactiveHydro[keysSymbol.description];
    const lastProp = keys[keys.length - 1];
    return [lastProp, keys.length === 1];
}
function unset(reactiveHydro) {
    const ternaryDisposer = ternaryDisposers.get(reactiveHydro);
    if (ternaryDisposer) {
        if (ternaryDisposer.done)
            return;
        ternaryDisposer.stop();
        ternaryDisposer.done = true;
    }
    const [lastProp, oneKey] = getReactiveKeys(reactiveHydro);
    if (oneKey) {
        const previousValue = Reflect.get(hydro, lastProp);
        Reflect.set(hydro, lastProp, null);
        hydroToReactive.delete(previousValue);
    }
    else {
        const [_, resolvedObj] = resolveObject(reactiveHydro[keysSymbol.description]);
        Reflect.set(resolvedObj, lastProp, null);
    }
}
function setAsyncUpdate(reactiveHydro, asyncUpdate) {
    const [_, oneKey] = getReactiveKeys(reactiveHydro);
    if (oneKey) {
        hydro.asyncUpdate = asyncUpdate;
    }
    else {
        const [_, resolvedObj] = resolveObject(reactiveHydro[keysSymbol.description]);
        resolvedObj.asyncUpdate = asyncUpdate;
    }
}
function observe(reactiveHydro, fn) {
    if (reactiveHydro === undefined)
        return reactiveHydro;
    const [lastProp, oneKey] = getReactiveKeys(reactiveHydro);
    if (oneKey) {
        return hydro.observe(lastProp, fn);
    }
    else {
        const [_, resolvedObj] = resolveObject(reactiveHydro[keysSymbol.description]);
        return resolvedObj.observe(lastProp, fn);
    }
}
function unobserve(reactiveHydro) {
    const [lastProp, oneKey] = getReactiveKeys(reactiveHydro);
    if (oneKey) {
        hydro.unobserve(lastProp);
    }
    else {
        const [_, resolvedObj] = resolveObject(reactiveHydro[keysSymbol.description]);
        resolvedObj.unobserve(lastProp);
    }
}
function ternary(condition, trueVal, falseVal, reactiveHydro = condition) {
    // Resolve the shape of the inputs once instead of on every notification: a
    // list where every row observes the same signal calls this per row per change.
    const conditionIsFunction = !Reflect.has(condition, reactiveSymbol) && isFunction(condition);
    const trueValIsFunction = isFunction(trueVal);
    const falseValIsFunction = isFunction(falseVal);
    const checkCondition = (cond) => (conditionIsFunction
        ? condition(cond)
        : isPromise(cond)
            ? false
            : cond)
        ? trueValIsFunction
            ? trueVal()
            : trueVal
        : falseValIsFunction
            ? falseVal()
            : falseVal;
    const ternaryValue = reactive(checkCondition(getValue(reactiveHydro)));
    const stopObserving = observe(reactiveHydro, (newVal) => {
        if (newVal === null) {
            unset(ternaryValue);
            return;
        }
        const nextValue = checkCondition(newVal);
        // Setting the identical value is a no-op inside the Proxy anyway - skip the
        // setter round trip for every row whose derived value did not change.
        if (nextValue === getValue(ternaryValue))
            return;
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
function emit(eventName, data, who, options = { bubbles: true }) {
    who.dispatchEvent(new window.CustomEvent(eventName, { ...options, detail: data }));
}
let trackDeps = false;
const trackProxies = new Set();
function trackDependency(receiver, key) {
    trackProxies.add(receiver);
    const keys = trackMap.get(receiver);
    if (keys) {
        keys.add(key);
    }
    else {
        trackMap.set(receiver, new Set([key]));
    }
}
const trackMap = new WeakMap();
const unobserveMap = new WeakMap();
function watchEffect(fn) {
    trackDeps = true;
    const res = fn();
    if (isPromise(res)) {
        res.then(() => {
            trackDeps = false;
        });
    }
    else {
        trackDeps = false;
    }
    const reRun = (newVal) => {
        if (newVal !== null)
            fn();
    };
    for (const proxy of trackProxies) {
        const trackedKeys = trackMap.get(proxy);
        if (!trackedKeys)
            continue;
        for (const key of trackedKeys) {
            proxy.observe(key, reRun);
            const entries = unobserveMap.get(reRun);
            if (entries) {
                entries.push({ proxy, key });
            }
            else {
                unobserveMap.set(reRun, [{ proxy, key }]);
            }
        }
        trackMap.delete(proxy);
    }
    trackProxies.clear();
    return () => {
        const entries = unobserveMap.get(reRun);
        if (!entries)
            return;
        entries.forEach((entry) => entry.proxy.unobserve(entry.key, reRun));
        unobserveMap.delete(reRun);
    };
}
function getValue(reactiveHydro) {
    if (reactiveHydro === undefined)
        return reactiveHydro;
    const [resolvedValue] = resolveObject(Reflect.get(reactiveHydro, keysSymbol.description));
    return resolvedValue;
}
function addLifecycle(lifecycleMap, elem, fn) {
    ownership.addLifecycle(lifecycleMap === onRenderMap ? "render" : "cleanup", elem, fn);
}
function onRender(fn, elem, ...args) {
    addLifecycle(onRenderMap, elem, args.length ? fn.bind(fn, ...args) : fn);
}
function onCleanup(fn, elem, ...args) {
    addLifecycle(onCleanupMap, elem, args.length ? fn.bind(fn, ...args) : fn);
}
// Core of the library
const sharedHandlers = Symbol("handlers");
// The handler Map is created lazily: most Proxies (e.g. every row object of a
// list) are never observed, so allocating a Map per Proxy is wasted memory.
function getHandlers(obj) {
    return Reflect.get(obj, sharedHandlers);
}
function ensureHandlers(obj) {
    let map = Reflect.get(obj, sharedHandlers);
    if (!map) {
        map = new Map();
        Reflect.defineProperty(obj, sharedHandlers, { value: map });
    }
    return map;
}
function observeMethod(key, handler) {
    const map = ensureHandlers(this);
    const handlersForKey = map.get(key);
    if (handlersForKey) {
        handlersForKey.add(handler);
    }
    else {
        map.set(key, new Set([handler]));
    }
    return () => {
        const handlersForKey = map.get(key);
        if (!handlersForKey)
            return;
        handlersForKey.delete(handler);
        if (handlersForKey.size === 0)
            map.delete(key);
    };
}
function getObserversMethod() {
    return ensureHandlers(this);
}
function unobserveMethod(key, handler) {
    const map = getHandlers(this);
    if (!map)
        return;
    if (key) {
        const handlersForKey = map.get(key);
        if (!handlersForKey)
            return;
        if (handler == null) {
            map.delete(key);
        }
        else if (handlersForKey.has(handler)) {
            handlersForKey.delete(handler);
            if (handlersForKey.size === 0)
                map.delete(key);
        }
    }
    else {
        map.clear();
    }
}
// Reused descriptor map: defining the internal properties on the raw target
// before wrapping it saves the defineProperty trap round trips and the five
// descriptor objects each created reactive object used to allocate.
const proxyDescriptors = {
    ["isProxy" /* Placeholder.isProxy */]: { value: true },
    ["asyncUpdate" /* Placeholder.asyncUpdate */]: { value: true, writable: true },
    ["observe" /* Placeholder.observe */]: { value: observeMethod, configurable: true },
    ["getObservers" /* Placeholder.getObservers */]: { value: getObserversMethod, configurable: true },
    ["unobserve" /* Placeholder.unobserve */]: { value: unobserveMethod, configurable: true },
};
function generateProxy(obj) {
    const target = obj ?? {};
    proxyDescriptors["asyncUpdate" /* Placeholder.asyncUpdate */].value = globalSchedule;
    Object.defineProperties(target, proxyDescriptors);
    return new Proxy(target, proxyHandler);
}
// One shared handler object for every Proxy: a per-call object literal with two
// closures would allocate three objects per reactive object (10k rows = 30k).
const proxyBoundFunctions = new WeakMap();
function bindToTarget(target, value) {
    let boundFunctions = proxyBoundFunctions.get(target);
    const cachedFunction = boundFunctions?.get(value);
    if (cachedFunction)
        return cachedFunction;
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
        if (trackDeps)
            trackDependency(receiver, key);
        let returnSet = true;
        let oldVal = Reflect.get(target, key, receiver);
        if (oldVal === val)
            return returnSet;
        // Reset Path - mostly GC
        if (val === null) {
            // Remove entry from reactitivyMap underlying Map
            if (reactivityMap.has(receiver)) {
                const key2NodeMap = reactivityMap.get(receiver);
                key2NodeMap.delete(String(key));
                if (key2NodeMap.size === 0) {
                    reactivityMap.delete(receiver);
                }
            }
            // Inform the Observers about null change and unobserve
            const observer = Reflect.get(target, sharedHandlers, receiver);
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
        }
        else if (isNode(val)) {
            returnSet = Reflect.set(target, key, val, receiver);
        }
        else if (isObject(val) && !isProxy(val)) {
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
        }
        else {
            // A swap: the incoming value already sits somewhere else in the same
            // array. One indexOf answers both "is it a member" and "where" -
            // includes + includes + findIndex walked the array three times. Array
            // methods are bound to the raw target by the get trap, so this does not
            // re-enter the Proxy per element.
            const swapIndex = !reuseElements &&
                Array.isArray(receiver) &&
                bindMap.has(val) &&
                bindMap.has(oldVal)
                ? receiver.indexOf(val)
                : -1;
            if (swapIndex !== -1) {
                /* c8 ignore start */
                const [elem] = bindMap.get(val);
                if (lastSwapElem !== elem) {
                    const [oldElem] = bindMap.get(oldVal);
                    lastSwapElem = oldElem;
                    const prevElem = elem.previousSibling;
                    const prevOldElem = oldElem.previousSibling;
                    // Move it in the array too without triggering the proxy set
                    receiver.splice(Number(key), 1, val);
                    receiver.splice(swapIndex, 1, oldVal);
                    prevElem.after(oldElem);
                    prevOldElem.after(elem);
                    lastSwapElem = null;
                }
                return true;
            }
            else {
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
        }
        else if (reactivityMap.has(receiver)) {
            checkReactivityMap(receiver, key, newVal, oldVal);
        }
        // current val (before setting) is a proxy - take over its keyToNodeMap
        if (oldValReactivity && isObject(val) && isProxy(val)) {
            // Store old reactivityMap if it is a swap operation
            if (reuseElements)
                tmpSwap.set(oldVal, oldValReactivity);
            const swapped = tmpSwap.get(val);
            if (swapped) {
                reactivityMap.set(oldVal, swapped);
                tmpSwap.delete(val);
            }
            else {
                reactivityMap.set(oldVal, reactivityMap.get(val));
            }
        }
        // Inform the Observers
        if (returnSet) {
            const handlers = getHandlers(target)?.get(key);
            if (handlers) {
                for (const handler of handlers)
                    handler(newVal, oldVal);
            }
        }
        // If oldVal is a Proxy - clean it
        !reuseElements && oldVal && cleanProxy(oldVal);
        return returnSet;
    },
    // fix proxy bugs, e.g Map
    get(target, prop, receiver) {
        if (trackDeps)
            trackDependency(receiver, prop);
        const value = Reflect.get(target, prop, receiver);
        if (!isFunction(value)) {
            return value;
        }
        return bindToTarget(target, value);
    },
};
function cleanProxy(proxy) {
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
function checkReactivityMap(obj, key, val, oldVal) {
    updateEngine.checkReactivityMap(obj, key, val, oldVal);
}
function resetViewRows(rootElem) {
    ownership.resetViewRows(rootElem);
}
const viewImplementation = createView({
    state: viewState,
    select: (root) => $(root),
    getValue: (data) => getValue(data),
    observe: (data, handler) => observe(data, handler),
    unset: (data) => unset(data),
    onCleanup,
    runLifecycle: (node) => runLifecyle(node, onRenderMap),
    setReactivity: (root, eventFunctions) => setReactivity(root, eventFunctions),
    isPrewired: isViewPrewired,
    resetRows: resetViewRows,
    reuseElements: () => reuseElements,
});
function view(root, data, renderFunction) {
    viewImplementation(root, data, renderFunction);
}
const hydro = generateProxy();
const $ = document.querySelector.bind(document);
const $$ = document.querySelectorAll.bind(document);
const internals = {
    compare,
    allNodeChanges,
    hydroToReactive,
    boolAttrList: Array.from(boolAttrSet),
};
export { render, html, h, hydro, setGlobalSchedule, setReuseElements, setInsertDiffing, setShouldSetReactivity, setIgnoreIsConnected, reactive, unset, setAsyncUpdate, unobserve, observe, ternary, emit, watchEffect, internals, getValue, onRender, onCleanup, setReactivity, $, $$, view, isServerSide, };
