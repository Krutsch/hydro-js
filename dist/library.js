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
const allNodeChanges = new WeakMap(); // Maps a Node against an array of changes. An array is necessary because a node can have multiple variables for one text / attribute.
const elemEventFunctions = new WeakMap(); // Stores event functions in order to compare Elements against each other.
const reactivityMap = new WeakMap(); // Maps Proxy Objects to another Map(proxy-key, node).
const bindMap = new WeakMap(); // Bind an Element to data. If the data is being unset, the DOM Element disappears too.
const boundElemProxies = new WeakMap(); // Reverse of bindMap: which Proxies an Element is bound to.
const tmpSwap = new WeakMap(); // Take over keyToNodeMap if the new value is a hydro Proxy. Save old reactivityMap entry here, in case for a swap operation.
const onRenderMap = new WeakMap(); // Lifecycle Hook that is being called after rendering
const onCleanupMap = new WeakMap(); // Lifecycle Hook that is being called when unmount function is being called
const treeChangeHandlers = new WeakMap();
const attributeChangeHandlers = new WeakMap();
const fragmentToElements = new WeakMap(); // Used to retreive Elements from DocumentFragment after it has been rendered â€“ for diffing
const hydroToReactive = new WeakMap(); // Used for internal mapping from hydroKeys to the the Proxy created by the reactive function
const ternaryDisposers = new WeakMap();
const reactiveSymbol = Symbol("reactive");
const keysSymbol = Symbol("keys");
const htmlCache = new WeakMap();
const htmlPartsCache = new WeakMap();
const htmlTemplateCacheable = new WeakMap();
const prewiredSymbol = Symbol("prewired");
const viewElementsEventFunctions = new Map();
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
let viewElements = false;
let ignoreIsConnected = false;
/* c8 ignore start */
const reactivityRegex = new RegExp(isServerSideCached
    ? `\\{\\{([^]*?)\\}\\}|${"hydro-reactive-" /* Placeholder.reactiveKey */}([a-zA-Z0-9_.-]+):`
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
    // Nullish means "no value" - stringifying it would write the literal
    // "null"/"undefined" as the attribute content.
    if (val == null || (isBoolAttr && !val)) {
        node.removeAttribute(key);
        notifyAttributeChange(node, key);
        return false;
    }
    node.setAttribute(key, isFunction(val) && Reflect.has(val, reactiveSymbol)
        ? val
        : isBoolAttr
            ? ""
            : val);
    notifyAttributeChange(node, key);
    return true;
}
function addEventListener(node, eventName, obj) {
    const isFn = isFunction(obj);
    const handler = isFn ? obj : obj.event;
    node.addEventListener(eventName, handler, isFn ? {} : obj.options);
    const events = elemEventFunctions.get(node);
    if (events) {
        const handlers = events.get(eventName);
        if (handlers === undefined) {
            events.set(eventName, handler);
        }
        else if (handlers instanceof Set) {
            handlers.add(handler);
        }
        else if (handlers !== handler) {
            events.set(eventName, new Set([handlers, handler]));
        }
    }
    else {
        elemEventFunctions.set(node, new Map([[eventName, handler]]));
    }
}
function removeTrackedEventListener(node, eventName, handler) {
    node.removeEventListener(eventName, handler);
    node.removeEventListener(eventName, handler, true);
    const map = elemEventFunctions.get(node);
    if (!map)
        return;
    const handlers = map.get(eventName);
    if (handlers === undefined)
        return;
    if (handlers instanceof Set) {
        handlers.delete(handler);
        if (handlers.size === 0)
            map.delete(eventName);
    }
    else if (handlers === handler) {
        map.delete(eventName);
    }
    if (map.size === 0) {
        elemEventFunctions.delete(node);
    }
}
function purgeTrackedEventListeners(node) {
    const events = elemEventFunctions.get(node);
    if (!events)
        return;
    events.forEach((handlers, eventName) => {
        if (handlers instanceof Set) {
            handlers.forEach((handler) => {
                node.removeEventListener(eventName, handler);
                node.removeEventListener(eventName, handler, true);
            });
        }
        else {
            node.removeEventListener(eventName, handlers);
            node.removeEventListener(eventName, handlers, true);
        }
    });
    elemEventFunctions.delete(node);
}
function trackBoundElement(proxy, elem) {
    const boundElements = bindMap.get(proxy);
    if (boundElements) {
        boundElements.push(elem);
    }
    else {
        bindMap.set(proxy, [elem]);
    }
    const current = boundElemProxies.get(elem);
    if (!current) {
        boundElemProxies.set(elem, proxy);
    }
    else if (Array.isArray(current)) {
        if (!current.includes(proxy))
            current.push(proxy);
    }
    else if (current !== proxy) {
        boundElemProxies.set(elem, [current, proxy]);
    }
}
function untrackBoundElement(proxy, elem) {
    const elements = bindMap.get(proxy);
    if (!elements)
        return;
    const index = elements.indexOf(elem);
    if (index !== -1)
        elements.splice(index, 1);
    if (elements.length === 0)
        bindMap.delete(proxy);
}
function purgeTrackedEventListenersInSubtree(root) {
    /* c8 ignore start */
    purgeTrackedEventListeners(root);
    for (const node of root.querySelectorAll("*")) {
        purgeTrackedEventListeners(node);
    }
    /* c8 ignore end */
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
            if (viewElements)
                viewElementsEventFunctions.set(funcName, variable);
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
                    viewElements && viewElementsEventFunctions.set(funcName, value);
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
    if (!viewElements) {
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
    const parts = [];
    walkHTMLParts(root, [], parts);
    return parts;
}
function walkHTMLParts(node, path, parts) {
    for (let index = 0; index < node.childNodes.length; index++) {
        const child = node.childNodes[index];
        if (isTextNode(child)) {
            const value = child.nodeValue ?? "";
            if (value.includes("__hydro")) {
                const markers = findMarkerIndexes(value);
                parts.push({
                    kind: "text",
                    path: [...path, index],
                    markers,
                    template: value,
                    whole: isWholeMarker(value, markers),
                });
            }
        }
        else if (child.nodeType === NodeConstructor.ELEMENT_NODE) {
            const elem = child;
            const childPath = [...path, index];
            for (const attr of elem.getAttributeNames()) {
                const value = elem.getAttribute(attr) ?? "";
                if (value.includes("__hydro")) {
                    const markers = findMarkerIndexes(value);
                    parts.push({
                        kind: "attribute",
                        path: childPath,
                        attr,
                        markers,
                        template: value,
                        whole: isWholeMarker(value, markers),
                    });
                }
            }
            walkHTMLParts(elem, childPath, parts);
        }
    }
}
function isWholeMarker(value, markers) {
    return markers.length === 1 && value === `__hydro${markers[0]}__`;
}
function findMarkerIndexes(value) {
    const indexes = [];
    const marker = /__hydro(\d+)__/g;
    let match;
    while ((match = marker.exec(value)))
        indexes.push(Number(match[1]));
    return indexes;
}
function replaceCompiledMarkers(template, markers, variables, values) {
    let result = template;
    for (const index of markers) {
        const marker = `__hydro${index}__`;
        const value = (values[index] ??= String(variables[index]));
        // Single occurrence is the norm - splice it instead of split/join, which
        // allocates an intermediate array per marker per render.
        const at = result.indexOf(marker);
        if (at === -1)
            continue;
        if (result.indexOf(marker, at + marker.length) === -1) {
            result =
                at === 0 && marker.length === result.length
                    ? value
                    : result.slice(0, at) + value + result.slice(at + marker.length);
        }
        else {
            result = result.split(marker).join(value);
        }
    }
    return result;
}
function hasReactiveMarkerValue(markers, variables) {
    for (let index = 0; index < markers.length; index++) {
        if (isReactiveValue(variables[markers[index]]))
            return true;
    }
    return false;
}
function resolveCompiledPath(root, path) {
    let node = root;
    for (let level = 0; level < path.length; level++) {
        // firstChild/nextSibling beats childNodes[i]: no live NodeList round trip
        // per step, and template paths are short.
        let child = node.firstChild;
        for (let index = path[level]; index > 0; index--)
            child = child.nextSibling;
        node = child;
    }
    return node;
}
function applyCompiledParts(root, parts, variables) {
    const values = new Array(variables.length);
    for (const part of parts) {
        const node = resolveCompiledPath(root, part.path);
        const markers = part.markers;
        // Whole slot is exactly one reactive variable (`${value}` / `x="${value}"`),
        // which is the common case: wire it straight from the key chain instead of
        // stringifying it and parsing the {{...}} marker back out of the DOM.
        if (part.whole &&
            isReactiveValue(variables[markers[0]]) &&
            wireReactiveValue(node, variables[markers[0]], part.kind === "attribute" ? part.attr : undefined)) {
            continue;
        }
        const value = replaceCompiledMarkers(part.template, markers, variables, values);
        if (part.kind === "text") {
            node.nodeValue = value;
            if (hasReactiveMarkerValue(markers, variables)) {
                setReactivitySingle(node);
            }
            continue;
        }
        const elem = node;
        if (markers.length === 1 && part.attr.startsWith("on")) {
            const variable = variables[markers[0]];
            if (!isReactiveValue(variable) &&
                (isFunction(variable) || isEventObject(variable))) {
                elem.removeAttribute(part.attr);
                addEventListener(elem, part.attr.replace(onEventRegex, ""), variable);
                continue;
            }
        }
        if (hasReactiveMarkerValue(markers, variables)) {
            setReactivitySingle(elem, part.attr, value);
        }
        else {
            setAttribute(elem, part.attr, value);
        }
    }
}
// Fast path for a slot that is exactly one reactive value. Returns false when
// the value needs the generic (string parsing) path in setReactivitySingle.
function wireReactiveValue(node, variable, key) {
    const keys = Reflect.get(variable, keysSymbol.description);
    const [resolvedValue, resolvedObj] = resolveObject(keys);
    if (isNode(resolvedValue))
        return false;
    // A reactive value may itself hold further {{...}} markers, which only the
    // generic path resolves recursively.
    if (typeof resolvedValue === "string" /* Placeholder.string */ &&
        containsReactiveMarker(resolvedValue)) {
        return false;
    }
    const lastProp = String(keys[keys.length - 1]);
    if (key === undefined) {
        const textContent = isObject(resolvedValue)
            ? window.JSON.stringify(resolvedValue)
            : (resolvedValue ?? "");
        const text = String(textContent);
        node.nodeValue = text;
        setTraces(0, String(resolvedValue).length, node, lastProp, resolvedObj);
        return true;
    }
    const elem = node;
    if (key === "bind") {
        elem.removeAttribute(key);
        trackBoundElement(isObject(resolvedValue) && isProxy(resolvedValue)
            ? resolvedValue
            : resolvedObj, elem);
        return true;
    }
    if (key === "two-way" /* Placeholder.twoWay */ ||
        resolvedValue == null ||
        isObject(resolvedValue) ||
        isFunction(resolvedValue) ||
        isEventObject(resolvedValue)) {
        return false;
    }
    setAttribute(elem, key, resolvedValue);
    setTraces(0, String(resolvedValue).length, elem, lastProp, resolvedObj, key);
    return true;
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
    if (key === "bind") {
        if (!isReactiveValue(value))
            return false;
        const keys = Reflect.get(value, keysSymbol.description);
        const [resolvedValue, resolvedObj] = resolveObject(keys);
        const proxy = isObject(resolvedValue) && isProxy(resolvedValue)
            ? resolvedValue
            : resolvedObj;
        trackBoundElement(proxy, elem);
        return true;
    }
    if (key === "two-way" /* Placeholder.twoWay */ || key in elem || boolAttrSet.has(key)) {
        return false;
    }
    const keys = Reflect.get(value, keysSymbol.description);
    const [resolvedValue, resolvedObj] = resolveObject(keys);
    if (resolvedValue == null ||
        isNode(resolvedValue) ||
        isFunction(resolvedValue) ||
        isEventObject(resolvedValue) ||
        isObject(resolvedValue)) {
        return false;
    }
    const applied = setAttribute(elem, key, resolvedValue);
    setTraces(0, applied ? String(resolvedValue).length : 0, elem, String(keys[keys.length - 1]), resolvedObj, key);
    return true;
}
function wireViewHChild(elem, child) {
    const keys = Reflect.get(child, keysSymbol.description);
    const [resolvedValue, resolvedObj] = resolveObject(keys);
    if (isNode(resolvedValue))
        return false;
    const textContent = isObject(resolvedValue)
        ? window.JSON.stringify(resolvedValue)
        : (resolvedValue ?? "");
    const textNode = document.createTextNode(String(textContent));
    elem.appendChild(textNode);
    setTraces(0, String(textContent).length, textNode, String(keys[keys.length - 1]), resolvedObj);
    return true;
}
function h(name, props, ...children) {
    if (isFunction(name))
        return name({ ...props, children });
    const isFragment = typeof name !== "string" /* Placeholder.string */;
    const elem = isFragment
        ? document.createDocumentFragment()
        : document.createElement(name, props?.["is"] !== undefined ? { is: props["is"] } : undefined);
    let viewPrewired = viewElements;
    let needsScan = false;
    for (const i in props) {
        const value = props[i];
        if (viewElements && (i === "bind" || isReactiveValue(value))) {
            if (wireViewHProp(elem, i, value))
                continue;
            viewPrewired = false;
        }
        else if (!viewElements &&
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
        if (viewElements) {
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
    if (!viewElements) {
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
    if (isTextNode(DOM)) {
        setReactivitySingle(DOM);
        return;
    }
    const elems = document.createNodeIterator(DOM, SHOW_ELEMENT);
    let elem;
    while ((elem = elems.nextNode())) {
        for (const key of elem.getAttributeNames()) {
            // Set functions
            const val = elem.getAttribute(key);
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
            }
            else {
                setReactivitySingle(elem, key, val);
            }
        }
        let childNode = elem.firstChild;
        while (childNode) {
            if (isTextNode(childNode) &&
                (childNode.nodeValue?.includes("{{") ||
                    (isServerSideCached &&
                        childNode.nodeValue?.includes("hydro-reactive-" /* Placeholder.reactiveKey */)))) {
                setReactivitySingle(childNode);
            }
            childNode = childNode.nextSibling;
        }
    }
}
function setReactivitySingle(node, key, val) {
    let attr_OR_text, match;
    if (!key) {
        attr_OR_text = node.nodeValue; // nodeValue is (always) defined on Text Nodes
    }
    else {
        attr_OR_text = val;
        if (attr_OR_text === "") {
            // e.g. checked attribute or two-way attribute
            attr_OR_text = key;
            if (attr_OR_text.startsWith("{{") ||
                (isServerSideCached && attr_OR_text.startsWith("hydro-reactive-" /* Placeholder.reactiveKey */))) {
                node.removeAttribute(attr_OR_text);
            }
        }
    }
    const hasCurlyBraces = attr_OR_text.includes("{{");
    const hasReactiveKey = isServerSideCached && attr_OR_text.includes("hydro-reactive-" /* Placeholder.reactiveKey */);
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
        const start = match.index;
        let end = start + String(resolvedValue).length;
        if (isNode(resolvedValue)) {
            const parent = node.parentNode;
            node.nodeValue = attr_OR_text.replace(hydroMatch, "");
            node.after(resolvedValue);
            if (parent)
                notifyTreeChange(parent);
            setTraces(start, end, resolvedValue, lastProp, resolvedObj, key);
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
        }
        else {
            if (key === "bind") {
                attr_OR_text = attr_OR_text.replace(hydroMatch, "");
                node.removeAttribute(key);
                const proxy = isObject(resolvedValue) && isProxy(resolvedValue)
                    ? resolvedValue
                    : resolvedObj;
                trackBoundElement(proxy, node);
                continue;
            }
            else if (key === "two-way" /* Placeholder.twoWay */) {
                if (node instanceof window.HTMLSelectElement) {
                    node.value = resolvedValue;
                    changeAttrVal("change" /* Placeholder.change */, node, resolvedObj, lastProp);
                }
                else if (node instanceof window.HTMLInputElement &&
                    node.type === "radio" /* Placeholder.radio */) {
                    node.checked = node.value === resolvedValue;
                    changeAttrVal("change" /* Placeholder.change */, node, resolvedObj, lastProp);
                }
                else if (node instanceof window.HTMLInputElement &&
                    node.type === "checkbox" /* Placeholder.checkbox */) {
                    node.checked = resolvedValue;
                    changeAttrVal("change" /* Placeholder.change */, node, resolvedObj, lastProp, true);
                }
                else if (node instanceof window.HTMLTextAreaElement ||
                    node instanceof window.HTMLInputElement) {
                    node.value = resolvedValue;
                    changeAttrVal("input", node, resolvedObj, lastProp);
                }
                attr_OR_text = attr_OR_text.replace(hydroMatch, "");
                node.toggleAttribute("two-way" /* Placeholder.twoWay */);
            }
            else if (isFunction(resolvedValue) || isEventObject(resolvedValue)) {
                attr_OR_text = attr_OR_text.replace(hydroMatch, "");
                node.removeAttribute(key);
                addEventListener(node, key.replace(onEventRegex, ""), resolvedValue);
            }
            else if (isObject(resolvedValue)) {
                // Case: setting attrs on Element - <p ${props}>
                for (const [subKey, subVal] of Object.entries(resolvedValue)) {
                    attr_OR_text = attr_OR_text.replace(hydroMatch, "");
                    if (isFunction(subVal) || isEventObject(subVal)) {
                        addEventListener(node, subKey.replace(onEventRegex, ""), subVal);
                    }
                    else {
                        lastProp = subKey;
                        if (setAttribute(node, subKey, subVal)) {
                            end = start + String(subVal).length;
                        }
                        else {
                            end = start;
                        }
                    }
                    setTraces(start, end, node, lastProp, resolvedValue, subKey);
                }
                continue; // As we set all Mappings via subKeys
            }
            else {
                attr_OR_text = attr_OR_text.replace(hydroMatch, resolvedValue);
                if (!setAttribute(node, key, attr_OR_text === String(resolvedValue)
                    ? resolvedValue
                    : attr_OR_text)) {
                    attr_OR_text = attr_OR_text.replace(resolvedValue, "");
                }
            }
        }
        setTraces(start, end, node, lastProp, resolvedObj, key);
    }
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
    // Set WeakMaps, that will be used to track a change for a Node but also to check if a Node has any other changes.
    const change = [start, end, key, resolvedObj, hydroKey];
    const changesForNode = allNodeChanges.get(node);
    if (changesForNode) {
        changesForNode.push(change);
    }
    else {
        allNodeChanges.set(node, [change]); // Use own version. Otherwise changes, will lead to incorrect changes in the DOM.
    }
    const keyToNodeMap = reactivityMap.get(resolvedObj);
    if (keyToNodeMap) {
        const entry = keyToNodeMap.get(hydroKey);
        if (entry === undefined) {
            keyToNodeMap.set(hydroKey, { node, changes: [change] });
        }
        else if (entry instanceof Map) {
            const keyChanges = entry.get(node);
            if (keyChanges) {
                keyChanges.push(change);
            }
            else {
                entry.set(node, [change]);
            }
        }
        else if (entry.node === node) {
            entry.changes.push(change);
        }
        else {
            keyToNodeMap.set(hydroKey, new Map([
                [entry.node, entry.changes],
                [node, [change]],
            ]));
        }
    }
    else {
        reactivityMap.set(resolvedObj, new Map([[hydroKey, { node, changes: [change] }]]));
    }
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
    const events = elemEventFunctions.get(elem);
    if (!events)
        return;
    events.forEach((handlers) => {
        if (handlers instanceof Set) {
            handlers.forEach((handler) => functions.push(handler));
        }
        else {
            functions.push(handlers);
        }
    });
}
function pushLifecycleFunctions(functions, lifecycleMap, node) {
    const handlers = lifecycleMap.get(node);
    if (!handlers)
        return;
    if (Array.isArray(handlers)) {
        functions.push(...handlers);
    }
    else {
        functions.push(handlers);
    }
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
        notifyTreeChange(document.body);
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
function executeLifecycle(node, lifecyleMap) {
    const handlers = lifecyleMap.get(node);
    if (handlers) {
        const execute = () => {
            if (Array.isArray(handlers)) {
                handlers.forEach((handler) => handler());
            }
            else {
                handlers();
            }
        };
        if (globalSchedule) {
            schedule(execute);
        }
        else {
            execute();
        }
        lifecyleMap.delete(node);
    }
}
function runLifecyle(node, lifecyleMap) {
    if ((lifecyleMap === onRenderMap && !calledOnRender) ||
        (lifecyleMap === onCleanupMap && !calledOnCleanup))
        return;
    executeLifecycle(node, lifecyleMap);
    const elements = document.createNodeIterator(node, SHOW_ELEMENT);
    let subElem;
    while ((subElem = elements.nextNode())) {
        executeLifecycle(subElem, lifecyleMap);
        let childNode = subElem.firstChild;
        while (childNode) {
            if (isTextNode(childNode)) {
                executeLifecycle(childNode, lifecyleMap);
            }
            childNode = childNode.nextSibling;
        }
    }
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
            const parent = oldElems[0]?.parentNode;
            for (const e of newElems)
                oldElems[0].before(e);
            for (const e of oldElems)
                e.remove();
            if (parent)
                notifyTreeChange(parent);
        }
        else {
            if (where instanceof window.HTMLHtmlElement) {
                replaceElement(elem, where);
            }
            else {
                const parent = where.parentNode;
                where.replaceWith(...newElems);
                if (parent)
                    notifyTreeChange(parent);
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
    const changedParents = new Set();
    if (isDocumentFragment(where)) {
        const fragmentChildren = fragmentToElements.get(where);
        if (isDocumentFragment(elem)) {
            const fragmentElements = Array.from(elem.childNodes);
            for (let index = 0; index < fragmentChildren.length; index++) {
                const fragWhere = fragmentChildren[index];
                if (fragWhere.parentNode)
                    changedParents.add(fragWhere.parentNode);
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
                if (fragWhere.parentNode)
                    changedParents.add(fragWhere.parentNode);
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
            changedParents.add(where);
        }
        else {
            if (where.parentNode)
                changedParents.add(where.parentNode);
            where.replaceWith(elem);
        }
        /* c8 ignore end */
    }
    else {
        if (where.parentNode)
            changedParents.add(where.parentNode);
        where.replaceWith(elem);
    }
    for (const parent of changedParents)
        notifyTreeChange(parent);
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
        const parent = elem.parentNode;
        elem.remove();
        if (parent)
            notifyTreeChange(parent);
        runLifecyle(elem, onCleanupMap);
        purgeSubtree(elem);
    }
}
function purgeReactivity(node) {
    if (isDocumentFragment(node))
        return;
    if (!isTextNode(node)) {
        purgeTrackedEventListeners(node);
        const proxies = boundElemProxies.get(node);
        if (proxies) {
            if (Array.isArray(proxies)) {
                for (const proxy of proxies)
                    untrackBoundElement(proxy, node);
            }
            else {
                untrackBoundElement(proxies, node);
            }
            boundElemProxies.delete(node);
        }
    }
    const changes = allNodeChanges.get(node);
    if (!changes)
        return;
    for (const change of changes) {
        const proxy = change[3];
        const hydroKey = change[4];
        const keyToNodeMap = reactivityMap.get(proxy);
        if (!keyToNodeMap)
            continue;
        const entry = keyToNodeMap.get(hydroKey);
        if (entry instanceof Map) {
            if (entry.delete(node) && entry.size === 0) {
                keyToNodeMap.delete(hydroKey);
            }
        }
        else if (entry !== undefined && entry.node === node) {
            keyToNodeMap.delete(hydroKey);
        }
        if (keyToNodeMap.size === 0)
            reactivityMap.delete(proxy);
    }
    allNodeChanges.delete(node);
}
function purgeSubtree(root) {
    if (isTextNode(root)) {
        purgeReactivity(root);
        return;
    }
    purgeReactivity(root);
    const elements = document.createNodeIterator(root, SHOW_ELEMENT);
    let elem;
    while ((elem = elements.nextNode())) {
        purgeReactivity(elem);
        let child = elem.firstChild;
        while (child) {
            if (isTextNode(child))
                purgeReactivity(child);
            child = child.nextSibling;
        }
    }
    if (isDocumentFragment(root)) {
        let child = root.firstChild;
        while (child) {
            if (isTextNode(child))
                purgeReactivity(child);
            child = child.nextSibling;
        }
    }
}
function purgeDetached(node) {
    if (ignoreIsConnected)
        return;
    if (isDocumentFragment(node)) {
        const children = fragmentToElements.get(node);
        if (children) {
            for (const child of children) {
                if (!child.isConnected) {
                    purgeSubtree(child);
                }
            }
        }
    }
    else if (!node.isConnected) {
        purgeSubtree(node);
    }
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
                    ? `${"hydro-reactive-" /* Placeholder.reactiveKey */}${keys.join(".")}:`
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
let calledOnRender = false;
function addLifecycle(lifecycleMap, elem, fn) {
    const current = lifecycleMap.get(elem);
    if (!current) {
        lifecycleMap.set(elem, fn);
    }
    else if (Array.isArray(current)) {
        current.push(fn);
    }
    else {
        lifecycleMap.set(elem, [current, fn]);
    }
}
function onRender(fn, elem, ...args) {
    calledOnRender = true;
    addLifecycle(onRenderMap, elem, args.length ? fn.bind(fn, ...args) : fn);
}
let calledOnCleanup = false;
function onCleanup(fn, elem, ...args) {
    calledOnCleanup = true;
    addLifecycle(onCleanupMap, elem, args.length ? fn.bind(fn, ...args) : fn);
}
function onTreeChange(fn, root) {
    const handlers = treeChangeHandlers.get(root);
    if (handlers) {
        handlers.add(fn);
    }
    else {
        treeChangeHandlers.set(root, new Set([fn]));
    }
    return () => {
        const current = treeChangeHandlers.get(root);
        if (!current)
            return;
        current.delete(fn);
        if (current.size === 0)
            treeChangeHandlers.delete(root);
    };
}
function onAttributeChange(fn, element) {
    const handlers = attributeChangeHandlers.get(element);
    if (handlers) {
        handlers.add(fn);
    }
    else {
        attributeChangeHandlers.set(element, new Set([fn]));
    }
    return () => {
        const current = attributeChangeHandlers.get(element);
        if (!current)
            return;
        current.delete(fn);
        if (current.size === 0)
            attributeChangeHandlers.delete(element);
    };
}
function notifyAttributeChange(element, name) {
    const handlers = attributeChangeHandlers.get(element);
    if (handlers) {
        for (const handler of handlers)
            handler(name);
    }
}
function notifyTreeChange(parent) {
    let current = parent;
    while (current) {
        const handlers = treeChangeHandlers.get(current);
        if (handlers) {
            for (const handler of handlers)
                handler(parent);
        }
        current = current.parentNode;
    }
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
        let oldVal = Reflect.get(receiver, key);
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
                    const changedParents = new Set();
                    if (prevElem.parentNode)
                        changedParents.add(prevElem.parentNode);
                    if (prevOldElem.parentNode)
                        changedParents.add(prevOldElem.parentNode);
                    prevElem.after(oldElem);
                    prevOldElem.after(elem);
                    for (const parent of changedParents)
                        notifyTreeChange(parent);
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
    const keyToNodeMap = reactivityMap.get(obj);
    const stringKey = String(key);
    const entry = keyToNodeMap.get(stringKey);
    if (entry) {
        /* c8 ignore next 5 */
        if (Reflect.get(obj, "asyncUpdate" /* Placeholder.asyncUpdate */)) {
            schedule(updateDOM, keyToNodeMap, stringKey, entry, val, oldVal);
        }
        else {
            updateDOM(keyToNodeMap, stringKey, entry, val, oldVal);
        }
    }
    if (isObject(val)) {
        const source = val;
        // Walk whichever side is smaller - a handful of tracked keys against a 10k
        // row array should not cost O(rows) string keys.
        if (Array.isArray(val) && keyToNodeMap.size < val.length) {
            for (const subKey of keyToNodeMap.keys()) {
                if (!Object.prototype.propertyIsEnumerable.call(val, subKey))
                    continue;
                updateSubKey(obj, keyToNodeMap, subKey, source[subKey], oldVal);
            }
        }
        else {
            const subKeys = Object.keys(source);
            for (let index = 0; index < subKeys.length; index++) {
                const subKey = subKeys[index];
                updateSubKey(obj, keyToNodeMap, subKey, source[subKey], oldVal);
            }
        }
    }
}
function updateSubKey(obj, keyToNodeMap, subKey, subVal, oldVal) {
    const entry = keyToNodeMap.get(subKey);
    if (!entry)
        return;
    const subOldVal = (isObject(oldVal) && Reflect.get(oldVal, subKey)) || oldVal;
    /* c8 ignore next 5 */
    if (Reflect.get(obj, "asyncUpdate" /* Placeholder.asyncUpdate */)) {
        schedule(updateDOM, keyToNodeMap, subKey, entry, subVal, subOldVal);
    }
    else {
        updateDOM(keyToNodeMap, subKey, entry, subVal, subOldVal);
    }
}
function updateDOM(keyToNodeMap, hydroKey, entry, val, oldVal) {
    const valIsNode = isNode(val);
    if (entry instanceof Map) {
        // Collect first: re-keying inside forEach would make the iteration visit
        // the replacement Node again.
        const rekeyed = [];
        entry.forEach((changes, node) => {
            const mapped = applyNodeChanges(node, changes, val, oldVal, valIsNode);
            if (mapped !== node)
                rekeyed.push([node, mapped, changes]);
        });
        for (const [node, mapped, changes] of rekeyed) {
            entry.delete(node);
            if (mapped)
                entry.set(mapped, changes);
        }
        if (entry.size === 0)
            keyToNodeMap.delete(hydroKey);
        return;
    }
    const mapped = applyNodeChanges(entry.node, entry.changes, val, oldVal, valIsNode);
    if (mapped === entry.node)
        return;
    if (mapped) {
        entry.node = mapped;
    }
    else {
        keyToNodeMap.delete(hydroKey);
    }
}
// Applies every tracked change of one Node. Returns the Node the changes belong
// to afterwards: the same Node, a replacement Node, or null when the mapping is
// gone (detached Node or replaced by a DocumentFragment).
function applyNodeChanges(node, changes, val, oldVal, valIsNode) {
    /* c8 ignore next 5 */
    if (!ignoreIsConnected && !node.isConnected) {
        allNodeChanges.delete(node);
        return null;
    }
    let mapped = node;
    let valString;
    // For each change of the node update either attribute or textContent
    for (const change of changes) {
        const [start, end, key] = change;
        let useStartEnd = false;
        node = (mapped ?? node);
        if (valIsNode && (!isServerSideCached || val !== node)) {
            replaceElement(val, node);
            if (isServerSideCached || val !== node) {
                mapped = isDocumentFragment(val) ? null : val;
            }
        }
        else if (isTextNode(node)) {
            useStartEnd = true;
            const text = node.nodeValue;
            valString ??= String(val);
            node.nodeValue =
                text.substring(0, start) + valString + text.substring(end);
        }
        else {
            if (key === "two-way" /* Placeholder.twoWay */) {
                if (node instanceof window.HTMLInputElement &&
                    node.type === "radio" /* Placeholder.radio */) {
                    node.checked = Array.isArray(val)
                        ? val.includes(node.name)
                        : String(val) === node.value;
                }
                else if (node instanceof window.HTMLInputElement &&
                    node.type === "checkbox" /* Placeholder.checkbox */) {
                    node.checked = val;
                }
                else if (node instanceof window.HTMLTextAreaElement ||
                    node instanceof window.HTMLSelectElement ||
                    node instanceof window.HTMLInputElement) {
                    node.value = String(val);
                }
            }
            else if (isFunction(val) || isEventObject(val)) {
                const eventName = key.replace(onEventRegex, "");
                const handlerToRemove = isFunction(oldVal) ? oldVal : oldVal.event;
                removeTrackedEventListener(node, eventName, handlerToRemove);
                addEventListener(node, eventName, val);
            }
            else if (isObject(val)) {
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
                    }
                    else {
                        setAttribute(node, subKey, subVal);
                    }
                }
            }
            else {
                useStartEnd = true;
                let attr = node.getAttribute(key);
                valString ??= String(val);
                if (attr) {
                    attr = attr.substring(0, start) + valString + attr.substring(end);
                    setAttribute(node, key, attr === valString ? val : attr);
                }
                else {
                    setAttribute(node, key, val);
                }
            }
        }
        if (useStartEnd) {
            // Update end
            valString ??= String(val);
            change[1] = start + valString.length;
            // Because we updated the end, we also have to update the start and end for every other reactive change in the node, for the same key
            const changesForNode = allNodeChanges.get(node);
            if (changesForNode) {
                let passedNode = false;
                const difference = String(oldVal).length - valString.length;
                for (const nodeChange of changesForNode) {
                    if (nodeChange === change) {
                        passedNode = true;
                        continue;
                    }
                    if (passedNode && (isTextNode(node) || key === nodeChange[2])) {
                        nodeChange[0] -= difference;
                        nodeChange[1] -= difference;
                    }
                }
            }
        }
    }
    return mapped;
}
const pendingCleanupRows = [];
let pendingCleanupCount = 0;
let cleanupFlushScheduled = false;
const PENDING_CLEANUP_LIMIT = 2000;
function resetViewRows(rootElem) {
    const rows = Array.from(rootElem.childNodes);
    rootElem.textContent = "";
    if (rows.length === 0)
        return;
    notifyTreeChange(rootElem);
    pendingCleanupRows.push(rows);
    pendingCleanupCount += rows.length;
    if (pendingCleanupCount >= PENDING_CLEANUP_LIMIT) {
        flushCleanupQueue();
    }
    else if (!cleanupFlushScheduled) {
        cleanupFlushScheduled = true;
        schedule(flushCleanupQueue);
    }
}
function flushCleanupQueue() {
    cleanupFlushScheduled = false;
    const batches = pendingCleanupRows.splice(0, pendingCleanupRows.length);
    pendingCleanupCount = 0;
    for (const rows of batches)
        cleanupDetachedRows(rows);
}
function cleanupDetachedRows(rows) {
    const hasCleanup = calledOnCleanup;
    for (const row of rows)
        cleanupDetachedNode(row, hasCleanup);
}
function cleanupDetachedNode(node, hasCleanup) {
    if (isTextNode(node)) {
        if (hasCleanup)
            executeLifecycle(node, onCleanupMap);
        purgeReactivity(node);
        return;
    }
    if (hasCleanup)
        executeLifecycle(node, onCleanupMap);
    purgeReactivity(node);
    let child = node.firstChild;
    while (child) {
        cleanupDetachedNode(child, hasCleanup);
        child = child.nextSibling;
    }
}
// One DOM insert without spreading 10k arguments onto the stack.
function appendAll(root, nodes) {
    const length = nodes.length;
    if (length === 0)
        return;
    if (length === 1) {
        root.appendChild(nodes[0]);
        notifyTreeChange(root);
        return;
    }
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < length; index++)
        fragment.appendChild(nodes[index]);
    root.appendChild(fragment);
    notifyTreeChange(root);
}
function view(root, data, renderFunction) {
    viewElements = true;
    const rootElem = $(root);
    const elements = getValue(data).map(renderFunction);
    const initialRowsAreWired = viewElementsEventFunctions.size === 0 && elements.every(isViewPrewired);
    appendAll(rootElem, elements);
    for (const elem of elements)
        runLifecyle(elem, onRenderMap);
    if (rootElem.hasChildNodes() && !initialRowsAreWired) {
        setReactivity(rootElem, viewElementsEventFunctions);
        viewElementsEventFunctions.clear();
    }
    onCleanup(unset, rootElem, data);
    viewElements = false;
    const stopViewObserver = observe(data, (newData, oldData) => {
        /* c8 ignore start */
        viewElements = true;
        let newRowsAreWired = false;
        // Reset or re-use
        if (!newData?.length ||
            (!reuseElements && newData?.length === oldData?.length)) {
            resetViewRows(rootElem);
            if (newData === null) {
                viewElements = false;
                return;
            }
        }
        else if (reuseElements) {
            for (let i = 0; i < oldData?.length && newData?.length; i++) {
                oldData[i].id = newData[i].id;
                oldData[i].label = newData[i].label;
                newData[i] = oldData[i];
            }
        }
        // Add to existing
        if (oldData?.length &&
            newData?.length > oldData?.length &&
            newData[0] === oldData[0]) {
            const length = oldData.length;
            const slicedData = newData.slice(length);
            const newElements = slicedData.map((item, i) => renderFunction(item, i + length));
            const appendedRowsAreWired = viewElementsEventFunctions.size === 0 &&
                newElements.every(isViewPrewired);
            newRowsAreWired = appendedRowsAreWired;
            appendAll(rootElem, newElements);
            for (const elem of newElements)
                runLifecyle(elem, onRenderMap);
        }
        // Add new
        else if (oldData?.length === 0 || (!reuseElements && newData?.length)) {
            if (!reuseElements && oldData?.length && rootElem.hasChildNodes()) {
                resetViewRows(rootElem);
            }
            const elements = newData.map(renderFunction);
            const replacementRowsAreWired = viewElementsEventFunctions.size === 0 &&
                elements.every(isViewPrewired);
            newRowsAreWired = replacementRowsAreWired;
            appendAll(rootElem, elements);
            for (const elem of elements)
                runLifecyle(elem, onRenderMap);
        }
        if (rootElem.hasChildNodes() && !newRowsAreWired) {
            setReactivity(rootElem, viewElementsEventFunctions);
            viewElementsEventFunctions.clear();
        }
        viewElements = false;
        /* c8 ignore end */
    });
    onCleanup(stopViewObserver, rootElem);
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
export { render, html, h, hydro, setGlobalSchedule, setReuseElements, setInsertDiffing, setShouldSetReactivity, setIgnoreIsConnected, reactive, unset, setAsyncUpdate, unobserve, observe, ternary, emit, watchEffect, internals, getValue, onRender, onCleanup, onAttributeChange, onTreeChange, setReactivity, $, $$, view, isServerSide, };
