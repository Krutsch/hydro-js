// Members referenced more than once live as plain top-level consts instead of
// Placeholder entries: `const enum` is fully erased by tsc (every reference is
// replaced by its literal string at each call site), so a multi-use value here
// would repeat itself verbatim at every call site instead of collapsing to a
// single minifier-renameable binding.
const STRING_TYPE = "string";
const IS_PROXY = "isProxy";
const ASYNC_UPDATE = "asyncUpdate";
const TEMPLATE_TAG = "template";
const TWO_WAY = "two-way";
const CHANGE_EVENT = "change";
const RADIO_TYPE = "radio";
const CHECKBOX_TYPE = "checkbox";
const DUMMY_SUFFIX = "-dummy";
const REACTIVE_KEY_PREFIX = "hydro-reactive-";
// Safari Polyfills
window.requestIdleCallback =
    /* c8 ignore next 4 */
    window.requestIdleCallback ||
        ((cb, _, start = window.performance.now()) => window.setTimeout(cb, 0, {
            didTimeout: false,
            timeRemaining: () => Math.max(0, 5 - (window.performance.now() - start)),
        }));
// Safari Polyfills END
const range = document.createRange();
range.selectNodeContents(range.createContextualFragment(`<${TEMPLATE_TAG}>`).lastChild);
const defaultParser = range.createContextualFragment.bind(range);
const allNodeChanges = new WeakMap(); // Maps a Node against an array of changes. An array is necessary because a node can have multiple variables for one text / attribute.
const elemEventFunctions = new WeakMap(); // Stores event functions in order to compare Elements against each other.
const reactivityMap = new WeakMap(); // Maps Proxy Objects to another Map(proxy-key, node).
const bindMap = new WeakMap(); // Bind an Element to data. If the data is being unset, the DOM Element disappears too.
const boundElemProxies = new WeakMap(); // Reverse of bindMap: which Proxies an Element is bound to, so it can be removed from bindMap when the Element is purged.
const tmpSwap = new WeakMap(); // Take over keyToNodeMap if the new value is a hydro Proxy. Save old reactivityMap entry here, in case for a swap operation.
const onRenderMap = new WeakMap(); // Lifecycle Hook that is being called after rendering
const onCleanupMap = new WeakMap(); // Lifecycle Hook that is being called when unmount function is being called
const fragmentToElements = new WeakMap(); // Used to retreive Elements from DocumentFragment after it has been rendered – for diffing
const hydroToReactive = new WeakMap(); // Used for internal mapping from hydroKeys to the the Proxy created by the reactive function
// ternary() subscribes an observer onto its (often long-lived/shared) condition
// Proxy and only returns the derived value, not the observe() stop-fn. Without
// this, unset(ternaryValue) has no way to ever remove that subscription, so it
// (and everything its closure captures, e.g. a row Proxy) is retained for the
// lifetime of the condition - typically the whole app. Keyed by the derived
// ternaryValue so unset() can look its disposer up and tear it down.
// `poolKey` (when set) additionally tells unset() this slot came from
// ternarySlotPool and should be released back to the pool instead of going
// through the generic delete-the-hydro-property path - see ternarySlotPool.
// `done` guards against unset() running twice for the same ternaryValue: it
// can legitimately be invoked from two different places for the same row -
// once directly, if the shared condition itself becomes null (ternary()'s
// own observer callback), and once via a (possibly deferred, see
// resetViewRows) onCleanup(unset, tr, className) dispatch. Once torn down,
// later calls must no-op rather than fall through to the generic path, which
// would delete a pooled slot's property and undo the whole point of pooling.
const ternaryDisposers = new WeakMap();
// ternary() runs once per list row, and its derived value is thrown away
// almost as often (unset() fires on every row teardown). reactive()'s normal
// path mints an ever-incrementing, never-reused key and unset() deletes it -
// `delete` on a fast-mode (hidden-class-backed) object is a well-known V8
// trigger for permanently downgrading that object to dictionary-mode (slow,
// hash-map-backed) properties, and objects generally never transition back.
// hydro is one single object for the whole app lifetime, so the very FIRST
// ternary-driven delete anywhere can permanently slow down every future
// property get/set on hydro - i.e. every reactive access in the whole app,
// not just clears. Reuse a small bounded pool of slot names instead: once a
// name has been used, the property stays declared forever and is only ever
// value-overwritten (no shape churn, no delete).
const ternarySlotPool = [];
let ternarySlotCounter = 0;
const _boundFunctions = Symbol("boundFunctions"); // Cache for bound functions in Proxy, so that we create the bound version of each function only once
const reactiveSymbol = Symbol("reactive");
const keysSymbol = Symbol("keys");
const keysSymbolKey = keysSymbol.description;
const htmlCache = new WeakMap();
// Precompiled marker positions for a cached template, so that applying values on
// each call is a handful of direct node touches instead of a full-subtree scan.
const htmlPartsCache = new WeakMap();
// Memoized "is this template site structurally cacheable" decision (depends only
// on the static strings, not the per-call variables).
const htmlTemplateCacheable = new WeakMap();
const viewElementsEventFunctions = new Map();
const hWiredSymbol = Symbol("hWired");
const isServerSideCached = isServerSide();
let globalSchedule = true; // Decides whether to schedule rendering and updating (async)
let reuseElements = true; // Reuses Elements when rendering
let insertBeforeDiffing = false; // Makes sense in Chrome only
let shouldSetReactivity = true;
let viewElements = false;
let ignoreIsConnected = false;
const reactivityRegex = new RegExp(isServerSideCached
    ? `\\{\\{([^]*?)\\}\\}|${REACTIVE_KEY_PREFIX}([a-zA-Z0-9_.-]+)`
    : `\\{\\{([^]*?)\\}\\}`);
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
const boolAttrSet = new Set("allowfullscreen alpha async autofocus autoplay checked controls draggable default defer disabled formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected shadowrootclonable shadowrootcustomelementregistry shadowrootdelegatesfocus shadowrootserializable spellcheck".split(" "));
let lastSwapElem = null;
let internReset = false;
let reactiveKeyCounter = 0;
const primitiveTypes = new Set("number string symbol boolean bigint".split(" "));
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
    return node instanceof window.Node;
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
    const result = Reflect.get(hydroObject, IS_PROXY);
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
    Reflect.set(obj, ASYNC_UPDATE, globalSchedule);
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
    const isFn = isFunction(obj);
    const handler = isFn ? obj : obj.event;
    node.addEventListener(eventName, handler, isFn ? {} : obj.options);
    if (elemEventFunctions.has(node)) {
        const map = elemEventFunctions.get(node);
        if (map.has(eventName)) {
            map.get(eventName).add(handler);
        }
        else {
            map.set(eventName, new Set([handler]));
        }
    }
    else {
        elemEventFunctions.set(node, new Map([[eventName, new Set([handler])]]));
    }
}
function removeTrackedEventListener(node, eventName, handler) {
    node.removeEventListener(eventName, handler);
    node.removeEventListener(eventName, handler, true);
    const map = elemEventFunctions.get(node);
    if (!map)
        return;
    const handlers = map.get(eventName);
    if (!handlers)
        return;
    handlers.delete(handler);
    if (handlers.size === 0) {
        map.delete(eventName);
    }
    if (map.size === 0) {
        elemEventFunctions.delete(node);
    }
}
// Native removeEventListener calls are kept here deliberately (tempting as it
// is to drop them for GC purposes alone): unmount()/removeElement() must
// guarantee a removed node stops responding to events even if something
// external still holds a strong reference to it and calls dispatchEvent()
// directly - dispatchEvent doesn't care whether the target is connected or
// reachable via GC roots elsewhere. See test.html "cleans up all event
// listeners on unmount, not just the first".
function purgeTrackedEventListeners(node) {
    const map = elemEventFunctions.get(node);
    if (!map)
        return;
    map.forEach((handlers, eventName) => {
        handlers.forEach((handler) => {
            node.removeEventListener(eventName, handler);
            node.removeEventListener(eventName, handler, true);
        });
    });
    elemEventFunctions.delete(node);
}
function html(htmlArray, ...variables) {
    const cachedDOM = createCachedHTML(htmlArray, variables);
    if (cachedDOM)
        return cachedDOM;
    const eventFunctions = new Map(); // Temporarily store a mapping for string -> function, because eventListener have to be registered after the Element's creation
    const insertNodes = []; // Nodes, that will be added after the parsing
    const template = `<${TEMPLATE_TAG} id="lbInsertNodes"></${TEMPLATE_TAG}>`;
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
    DOMString = DOMString.replace(HTML_FIND_INVALID, `<$1$2${DUMMY_SUFFIX}$3`);
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
function createCachedHTML(htmlArray, variables) {
    if (!shouldSetReactivity || !canCacheHTMLVariables(htmlArray, variables)) {
        return;
    }
    let parts = htmlPartsCache.get(htmlArray);
    let cached = htmlCache.get(htmlArray);
    if (!cached) {
        const markers = variables.map((_, i) => `__hydro${i}__`);
        let DOMString = String.raw(htmlArray, ...markers).trim();
        if (HTML_FIND_INVALID.test(DOMString)) {
            HTML_FIND_INVALID.lastIndex = 0;
            return;
        }
        HTML_FIND_INVALID.lastIndex = 0;
        cached = parser(DOMString);
        htmlCache.set(htmlArray, cached);
        parts = buildHTMLParts(cached);
        htmlPartsCache.set(htmlArray, parts);
    }
    const DOM = cached.cloneNode(true);
    // `values` are stringified lazily (see markerValue) so event handlers never pay
    // the cost of String(fn).
    const values = new Array(variables.length);
    applyCompiledParts(DOM, parts, variables, values);
    if (DOM.childNodes.length > 1)
        return DOM;
    if (!DOM.firstChild)
        return document.createTextNode("");
    return DOM.firstChild;
}
function markerValue(index, variables, values) {
    const cached = values[index];
    return cached !== undefined
        ? cached
        : (values[index] = String(variables[index]));
}
function replaceCompiledMarkers(template, markers, variables, values) {
    let out = template;
    for (let i = 0; i < markers.length; i++) {
        const index = markers[i];
        out = out
            .split(`__hydro${index}__`)
            .join(markerValue(index, variables, values));
    }
    return out;
}
function buildHTMLParts(root) {
    const parts = [];
    walkHTMLParts(root, [], parts);
    return parts;
}
function walkHTMLParts(node, path, parts) {
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (isTextNode(child)) {
            const value = child.nodeValue;
            if (value.includes("__hydro")) {
                parts.push({
                    kind: 0,
                    path: [...path, i],
                    markers: findMarkerIndexes(value),
                    template: value,
                });
            }
        }
        else if (child.nodeType === 1) {
            const elem = child;
            const childPath = [...path, i];
            for (const attr of elem.getAttributeNames()) {
                const value = elem.getAttribute(attr);
                if (value.includes("__hydro")) {
                    parts.push({
                        kind: 1,
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
function findMarkerIndexes(value) {
    const result = [];
    const regex = /__hydro(\d+)__/g;
    let match;
    while ((match = regex.exec(value)))
        result.push(Number(match[1]));
    return result;
}
function applyCompiledParts(root, parts, variables, values) {
    for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        let node = root;
        const path = part.path;
        for (let i = 0; i < path.length; i++)
            node = node.childNodes[path[i]];
        if (part.kind === 0) {
            const value = replaceCompiledMarkers(part.template, part.markers, variables, values);
            node.nodeValue = value;
            // A reactive marker stringifies to "{{key.chain}}" (see chainKeys'
            // Symbol.toPrimitive), so resolve + register it the same way the
            // uncached path does, but targeted at this one known node instead of a
            // NodeIterator scan over the whole subtree.
            if (part.markers.some((m) => isReactiveValue(variables[m]))) {
                setReactivitySingle(node);
            }
        }
        else {
            const elem = node;
            const attr = part.attr;
            if (part.markers.length === 1 && attr.startsWith("on")) {
                const variable = variables[part.markers[0]];
                // A reactive value can itself be a chainKeys Proxy wrapping a
                // (callable) setter, so it passes isFunction() too — exclude it here
                // and let it fall through to setReactivitySingle below, which
                // resolves the chain first and only then checks isFunction/isEventObject
                // on the *resolved* value.
                if (!isReactiveValue(variable) &&
                    (isFunction(variable) || isEventObject(variable))) {
                    elem.removeAttribute(attr);
                    addEventListener(elem, attr.replace(onEventRegex, ""), variable);
                    continue;
                }
            }
            const value = replaceCompiledMarkers(part.template, part.markers, variables, values);
            if (part.markers.some((m) => isReactiveValue(variables[m]))) {
                setReactivitySingle(elem, attr, value);
            }
            else {
                setAttribute(elem, attr, value);
            }
        }
    }
}
function canCacheHTMLVariables(htmlArray, variables) {
    if (!isTemplateCacheable(htmlArray))
        return false;
    for (let i = 0; i < variables.length; i++) {
        const variable = variables[i];
        if (isNode(variable) || Array.isArray(variable))
            return false;
        // A reactive value used directly (not nested in an object/array) is still
        // cacheable: applyCompiledParts resolves + registers it via
        // setReactivitySingle instead of leaving a dangling {{placeholder}}, so the
        // template's static structure can still be reused/cloned. Nested reactive
        // values (inside an object/array variable) fall through to
        // containsReactiveValue and still bail, since that shape isn't compiled.
        if (isReactiveValue(variable))
            continue;
        if (containsReactiveValue(variable))
            return false;
        if (typeof variable === STRING_TYPE && containsParsedHTML(variable)) {
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
// Structural cacheability depends only on the static template strings, so memoize
// it per template site instead of recomputing (Array.from + regex) every call.
function isTemplateCacheable(htmlArray) {
    const cached = htmlTemplateCacheable.get(htmlArray);
    if (cached !== undefined)
        return cached;
    let ok = true;
    for (let i = 0; i < htmlArray.length; i++) {
        if (containsReactiveMarker(htmlArray[i])) {
            ok = false;
            break;
        }
    }
    if (ok) {
        for (let i = 0; i < htmlArray.length - 1; i++) {
            if (!canCacheHTMLPosition(htmlArray, i)) {
                ok = false;
                break;
            }
        }
    }
    htmlTemplateCacheable.set(htmlArray, ok);
    return ok;
}
function canCacheHTMLPosition(htmlArray, index) {
    const before = htmlArray[index];
    const after = htmlArray[index + 1];
    if (/<\/?$/.test(before))
        return false;
    if (/<[^>]*\s$/.test(before) && /^\s*>/.test(after))
        return false;
    return true;
}
function containsReactiveMarker(value) {
    return (value.includes("{{") ||
        (isServerSideCached && value.includes(REACTIVE_KEY_PREFIX)));
}
function containsParsedHTML(value) {
    return value.includes("<") || containsReactiveMarker(value);
}
function fillDOM(elem, insertNodes, eventFunctions) {
    const root = document.createNodeIterator(elem, window.NodeFilter.SHOW_ELEMENT, {
        acceptNode(element) {
            return element.localName.endsWith(DUMMY_SUFFIX)
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
        const tag = node.localName.replace(DUMMY_SUFFIX, "");
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
function isReactiveValue(v) {
    return (isObject(v) || isFunction(v)) && Reflect.has(v, reactiveSymbol);
}
function isHWired(node) {
    // @ts-ignore
    return !!node[hWiredSymbol];
}
function markHWired(node) {
    // @ts-ignore
    node[hWiredSymbol] = true;
}
// Direct-wire a whole-value reactive prop (or `bind`) at element-creation time,
// so the `h`/JSX path never emits a `{{placeholder}}` that setReactivity has to
// re-parse (regex + resolve + a second setAttribute + a full NodeIterator pass).
// Only the unambiguous scalar/bind cases are handled; anything exotic (two-way,
// bool attrs, node/object/function results) returns false and takes the old path.
function hWireProp(elem, key, value) {
    if (key === "bind") {
        if (!isReactiveValue(value))
            return false;
        const keys = value[keysSymbolKey];
        const [resolvedValue, resolvedObj] = resolveObject(keys);
        const proxy = isObject(resolvedValue) && isProxy(resolvedValue)
            ? resolvedValue
            : resolvedObj;
        if (bindMap.has(proxy))
            bindMap.get(proxy).push(elem);
        else
            bindMap.set(proxy, [elem]);
        if (boundElemProxies.has(elem))
            boundElemProxies.get(elem).add(proxy);
        else
            boundElemProxies.set(elem, new Set([proxy]));
        return true;
    }
    if (!isReactiveValue(value))
        return false;
    if (key === TWO_WAY || key in elem || boolAttrSet.has(key)) {
        return false;
    }
    const keys = value[keysSymbolKey];
    const [resolvedValue, resolvedObj] = resolveObject(keys);
    if (isNode(resolvedValue) ||
        isFunction(resolvedValue) ||
        isEventObject(resolvedValue) ||
        isObject(resolvedValue)) {
        return false; // exotic result -> let the placeholder path handle it
    }
    if (resolvedValue == null)
        return false;
    const lastProp = keys[keys.length - 1];
    const applied = setAttribute(elem, key, resolvedValue ?? "");
    setTraces(0, applied ? String(resolvedValue ?? "").length : 0, elem, lastProp, resolvedObj, key);
    return true;
}
// Direct-wire a single reactive text child (the common `{data[i].label}` case).
function hWireChild(elem, child) {
    if (!isReactiveValue(child))
        return false;
    const keys = child[keysSymbolKey];
    const [resolvedValue, resolvedObj] = resolveObject(keys);
    if (isNode(resolvedValue))
        return false; // reactive node child -> placeholder path
    const lastProp = keys[keys.length - 1];
    const textContent = stringifyIfObject(resolvedValue);
    const textNode = document.createTextNode(String(textContent));
    elem.appendChild(textNode);
    setTraces(0, String(textContent).length, textNode, lastProp, resolvedObj);
    return true;
}
// Shared by hWireChild/setReactivitySingle: reactive text stringifies objects
// as JSON, everything else falls back to "" for null/undefined.
function stringifyIfObject(value) {
    return isObject(value) ? window.JSON.stringify(value) : (value ?? "");
}
function h(name, props, ...children) {
    if (isFunction(name))
        return name({ ...props, children });
    const elem = typeof name === STRING_TYPE
        ? document.createElement(name, props?.hasOwnProperty("is") ? { is: props["is"] } : undefined)
        : document.createDocumentFragment();
    const isFrag = isDocumentFragment(elem);
    let needsScan = false;
    for (const i in props) {
        const value = props[i];
        if (!isFrag && hWireProp(elem, i, value))
            continue;
        if (!needsScan &&
            (i === "bind" || i === TWO_WAY || containsReactiveValue(value))) {
            needsScan = true;
        }
        i in elem && !boolAttrSet.has(i)
            ? //@ts-ignore
                (elem[i] = value)
            : setAttribute(elem, i, value);
    }
    if (isFrag) {
        children = name.children;
    }
    const flatChildren = children.some((i) => Array.isArray(i))
        ? children.map(getChildren).flat()
        : children;
    for (const child of flatChildren) {
        if (hWireChild(elem, child))
            continue;
        if (!needsScan) {
            if (isNode(child)) {
                needsScan = !isHWired(child);
            }
            else if (containsReactiveValue(child)) {
                needsScan = true;
            }
        }
        elem.append(child);
    }
    if (needsScan) {
        if (viewElements) {
            return elem;
        }
        setReactivity(elem);
    }
    markHWired(elem);
    return elem;
}
function getChildren(child) {
    return isObject(child) && !isNode(child)
        ? Object.values(child)
        : child;
}
function containsReactiveValue(value) {
    if (isReactiveValue(value))
        return true;
    if (typeof value === STRING_TYPE)
        return containsReactiveMarker(value);
    if (Array.isArray(value))
        return value.some(containsReactiveValue);
    if (isObject(value) && !isNode(value)) {
        return Object.values(value).some(containsReactiveValue);
    }
    return false;
}
/* c8 ignore end */
function setReactivity(DOM, eventFunctions) {
    if (isTextNode(DOM)) {
        setReactivitySingle(DOM);
        return;
    }
    const elems = document.createNodeIterator(DOM, window.NodeFilter.SHOW_ELEMENT);
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
                containsReactiveMarker(childNode.nodeValue ?? "")) {
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
                (isServerSideCached && attr_OR_text.startsWith(REACTIVE_KEY_PREFIX))) {
                node.removeAttribute(attr_OR_text);
            }
        }
    }
    if (!containsReactiveMarker(attr_OR_text)) {
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
            node.nodeValue = attr_OR_text.replace(hydroMatch, "");
            node.after(resolvedValue);
            setTraces(start, end, resolvedValue, lastProp, resolvedObj, key);
            return;
        }
        // Set Text or set Attribute
        if (isTextNode(node)) {
            const textContent = stringifyIfObject(resolvedValue);
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
                if (bindMap.has(proxy)) {
                    bindMap.get(proxy).push(node);
                }
                else {
                    bindMap.set(proxy, [node]);
                }
                if (boundElemProxies.has(node)) {
                    boundElemProxies.get(node).add(proxy);
                }
                else {
                    boundElemProxies.set(node, new Set([proxy]));
                }
                continue;
            }
            else if (key === TWO_WAY) {
                if (node instanceof window.HTMLSelectElement) {
                    node.value = resolvedValue;
                    changeAttrVal(CHANGE_EVENT, node, resolvedObj, lastProp);
                }
                else if (node instanceof window.HTMLInputElement &&
                    node.type === RADIO_TYPE) {
                    node.checked = node.value === resolvedValue;
                    changeAttrVal(CHANGE_EVENT, node, resolvedObj, lastProp);
                }
                else if (node instanceof window.HTMLInputElement &&
                    node.type === CHECKBOX_TYPE) {
                    node.checked = resolvedValue;
                    changeAttrVal(CHANGE_EVENT, node, resolvedObj, lastProp, true);
                }
                else if (node instanceof window.HTMLTextAreaElement ||
                    node instanceof window.HTMLInputElement) {
                    node.value = resolvedValue;
                    changeAttrVal("input", node, resolvedObj, lastProp);
                }
                attr_OR_text = attr_OR_text.replace(hydroMatch, "");
                node.toggleAttribute(TWO_WAY);
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
// Shared by setTraces' two "first change for this key" branches: a Map that
// resolves both directions (change-array -> node, node -> change-array).
function pairMap(a, b) {
    //@ts-ignore
    return new Map([
        [a, b],
        [b, a],
    ]);
}
function setTraces(start, end, node, hydroKey, resolvedObj, key) {
    // Set WeakMaps, that will be used to track a change for a Node but also to check if a Node has any other changes.
    const change = [start, end, key, resolvedObj, hydroKey];
    const changeArr = [change];
    if (allNodeChanges.has(node)) {
        allNodeChanges.get(node).push(change);
    }
    else {
        allNodeChanges.set(node, [change]); // Use own version. Otherwise changes, will lead to incorrect changes in the DOM.
    }
    if (reactivityMap.has(resolvedObj)) {
        const keyToNodeMap = reactivityMap.get(resolvedObj);
        const nodeToChangeMap = keyToNodeMap.get(hydroKey);
        if (nodeToChangeMap) {
            if (nodeToChangeMap.has(node)) {
                nodeToChangeMap.get(node).push(change);
            }
            else {
                nodeToChangeMap.set(changeArr, node);
                nodeToChangeMap.set(node, changeArr);
            }
        }
        else {
            keyToNodeMap.set(hydroKey, pairMap(changeArr, node));
        }
    }
    else {
        reactivityMap.set(resolvedObj, new Map([[hydroKey, pairMap(changeArr, node)]]));
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
    if (elemEventFunctions.has(elem)) {
        elemEventFunctions.get(elem).forEach((handlers) => {
            handlers.forEach((handler) => elemFunctions.push(handler));
        });
    }
    if (elemEventFunctions.has(where)) {
        elemEventFunctions.get(where).forEach((handlers) => {
            handlers.forEach((handler) => whereFunctions.push(handler));
        });
    }
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
function pushLifecycleFunctions(functions, lifecyleMap, node) {
    const fns = lifecyleMap.get(node);
    if (!fns)
        return;
    if (Array.isArray(fns))
        functions.push(...fns);
    else
        functions.push(fns);
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
        if (typeof where === STRING_TYPE) {
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
            purgeDetached(previous); // old tree is fully discarded when not reusing
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
    if (lifecyleMap.has(node)) {
        const fns = lifecyleMap.get(node);
        const execute = () => {
            if (Array.isArray(fns))
                fns.forEach((fn) => fn());
            else
                fns();
        };
        if (globalSchedule)
            schedule(execute);
        else
            execute();
        lifecyleMap.delete(node);
    }
}
function runLifecyle(node, lifecyleMap) {
    if ((lifecyleMap === onRenderMap && !calledOnRender) ||
        (lifecyleMap === onCleanupMap && !calledOnCleanup))
        return;
    executeLifecycle(node, lifecyleMap);
    const elements = document.createNodeIterator(node, window.NodeFilter.SHOW_ELEMENT);
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
        if (tag2Elements.has(wElem.localName)) {
            tag2Elements.get(wElem.localName).push(wElem);
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
    // Release reactivity bookkeeping for any candidate Node that ended up detached
    // (discarded new Elements + non-reused old Elements). Reused Elements remain
    // connected and are skipped. Disabled when isConnected is untrustworthy.
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
// Remove every trace of a single Node from the reactivity bookkeeping so that,
// once it leaves the DOM, nothing in the library keeps it alive. reactivityMap
// is keyed by long-lived Proxies (hydro never dies), so without this a removed
// Node would be retained forever via its nodeToChangeMap entry.
function purgeReactivity(node) {
    if (!isTextNode(node))
        purgeTrackedEventListeners(node);
    // Drop bind references (bindMap holds Elements strongly).
    const proxies = boundElemProxies.get(node);
    if (proxies) {
        for (const proxy of proxies) {
            const arr = bindMap.get(proxy);
            if (arr) {
                const idx = arr.indexOf(node);
                if (idx !== -1)
                    arr.splice(idx, 1);
                if (arr.length === 0)
                    bindMap.delete(proxy);
            }
        }
        boundElemProxies.delete(node);
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
        const nodeToChangeMap = keyToNodeMap.get(hydroKey);
        if (nodeToChangeMap && nodeToChangeMap.has(node)) {
            const arr = nodeToChangeMap.get(node);
            nodeToChangeMap.delete(node);
            nodeToChangeMap.delete(arr);
            if (nodeToChangeMap.size === 0)
                keyToNodeMap.delete(hydroKey);
        }
        if (keyToNodeMap.size === 0)
            reactivityMap.delete(proxy);
    }
    allNodeChanges.delete(node);
}
// Purge a Node and its whole subtree (elements + their Text children), mirroring
// the traversal used by runLifecyle / setReactivity.
function purgeSubtree(root) {
    if (isTextNode(root)) {
        purgeReactivity(root);
        return;
    }
    purgeReactivity(root); // no-op for DocumentFragment
    const elements = document.createNodeIterator(root, window.NodeFilter.SHOW_ELEMENT);
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
    // Text nodes that are direct children of a DocumentFragment have no element
    // parent visited above, so handle them explicitly.
    if (isDocumentFragment(root)) {
        let child = root.firstChild;
        while (child) {
            if (isTextNode(child))
                purgeReactivity(child);
            child = child.nextSibling;
        }
    }
}
// Purge a node / fragment only if it ended up detached from the document after a
// diff or replace. Reused nodes stay connected and keep their reactivity.
function purgeDetached(node) {
    if (ignoreIsConnected)
        return;
    if (isDocumentFragment(node)) {
        const kids = fragmentToElements.get(node);
        if (kids) {
            for (const kid of kids) {
                if (!kid.isConnected)
                    purgeSubtree(kid);
            }
        }
    }
    else if (!node.isConnected) {
        purgeSubtree(node);
    }
}
/* c8 ignore next 13 */
async function schedule(fn, ...args) {
    if ("scheduler" in window) {
        // @ts-ignore
        window.scheduler.postTask(() => fn(...args), { priority: "user-blocking" });
    }
    else {
        // @ts-ignore
        window.requestIdleCallback(() => fn(...args));
    }
}
// Shared tail of reactive()'s slot creation: given an already-chosen unique
// key, install `initial` on hydro and wrap it in a chainKeys proxy. Split out
// so ternary()'s pooled slots (see ternarySlotPool below) can reuse the exact
// same setter/hydroToReactive logic while only differing in how the key is
// chosen and whether the property is enumerable.
function installReactiveSlot(key, initial, enumerable) {
    if (enumerable) {
        // reactive()'s original behavior, unchanged: always go through the set
        // trap so object/array initial values get recursively wrapped into
        // reactive proxies.
        Reflect.set(hydro, key, initial);
    }
    else if (Reflect.has(hydro, key)) {
        // ternary()'s pooled slot, reused - value-only overwrite, no shape churn.
        Reflect.set(hydro, key, initial);
    }
    else {
        // ternary()'s pooled slot, minted for the first time - bypasses the set
        // trap. Only reached for primitive initial values (see ternary()), so
        // there is nothing that needs recursive proxy-wrapping here; this also
        // makes the slot non-enumerable, so it stays as invisible to
        // JSON.stringify(hydro)/Object.keys(hydro)/for-in as an absent property.
        Reflect.defineProperty(hydro, key, {
            value: initial,
            writable: true,
            enumerable: false,
            configurable: true,
        });
    }
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
function reactive(initial) {
    let key;
    // Monotonic counter instead of randomText() in a collision loop: reactive() is
    // hot (one per row via ternary in list rendering). Keep the key all-lowercase –
    // reactive keys can land in attribute *names* (`<p ${obj}>` -> `{{key}}`) which
    // the HTML parser lowercases, so an uppercase char would break resolution. The
    // guard still advances on the rare collision with a user-set hydro property.
    do
        key = `hydror${reactiveKeyCounter++}`;
    while (Reflect.has(hydro, key));
    return installReactiveSlot(key, initial, true);
}
function chainKeys(initial, keys) {
    return new Proxy(initial, {
        get(target, subKey, _receiver) {
            if (subKey === reactiveSymbol.description)
                return true;
            if (subKey === keysSymbol.description) {
                return keys;
            }
            if (subKey === Symbol.toPrimitive) {
                return () => isServerSideCached
                    ? `${REACTIVE_KEY_PREFIX}${keys.join(".")}`
                    : `{{${keys.join(".")}}}`;
            }
            return chainKeys(target, [...keys, subKey]);
        },
    });
}
function getReactiveKeys(reactiveHydro) {
    const keys = reactiveHydro[keysSymbol.description];
    const lastProp = keys[keys.length - 1];
    return [lastProp, keys.length === 1];
}
function unset(reactiveHydro) {
    const ternaryTeardown = ternaryDisposers.get(reactiveHydro);
    if (ternaryTeardown) {
        if (ternaryTeardown.done)
            return; // already fully torn down, see comment above
        ternaryTeardown.stop();
        ternaryTeardown.done = true;
        if (ternaryTeardown.poolKey !== undefined) {
            // Pooled slot: the reactivityMap/bindMap entries tied to whatever node
            // this was bound to are already handled by purgeReactivity (called on
            // that node directly by resetViewRows/purgeSubtree), and this slot was
            // never enumerable/object-valued, so there is nothing else to release -
            // just return the name for reuse. Skips the delete-the-hydro-property
            // path entirely (see ternarySlotPool for why that matters).
            ternarySlotPool.push(ternaryTeardown.poolKey);
            return;
        }
    }
    const [lastProp, oneKey] = getReactiveKeys(reactiveHydro);
    if (oneKey) {
        Reflect.set(hydro, lastProp, null);
        if (hydroToReactive.has(hydro[lastProp])) {
            hydroToReactive.delete(hydro[lastProp]);
        }
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
    const isReactiveCondition = Reflect.has(condition, reactiveSymbol);
    const isTrueFn = isFunction(trueVal);
    const isFalseFn = isFunction(falseVal);
    const checkCondition = (cond) => (!isReactiveCondition && isFunction(condition)
        ? condition(cond)
        : isPromise(cond)
            ? false
            : cond)
        ? isTrueFn
            ? trueVal()
            : trueVal
        : isFalseFn
            ? falseVal()
            : falseVal;
    const initial = checkCondition(getValue(reactiveHydro));
    // Primitive results (the realistic case - a className string etc.) use the
    // bounded, never-deleted slot pool (see ternarySlotPool). Object-valued
    // results fall back to plain reactive(): installReactiveSlot's pooled path
    // installs via defineProperty (bypassing the set trap, so it wouldn't get
    // recursively proxied the way reactive()'s normal Reflect.set path does),
    // and object results are rare/unrealistic for ternary() anyway.
    const usePool = primitiveTypes.has(typeof initial);
    const poolKey = usePool
        ? (ternarySlotPool.pop() ?? `hydrot${ternarySlotCounter++}`)
        : undefined;
    const ternaryValue = usePool
        ? installReactiveSlot(poolKey, initial, false)
        : reactive(initial);
    // Store the disposer so unset(ternaryValue) (the documented per-instance
    // cleanup call, e.g. onCleanup(unset, tr, className)) can also stop this
    // subscription on the (possibly shared/long-lived) condition - see
    // ternaryDisposers above.
    const stopObserving = observe(reactiveHydro, (newVal) => {
        newVal === null
            ? unset(ternaryValue)
            : ternaryValue(checkCondition(newVal));
    });
    if (stopObserving) {
        ternaryDisposers.set(ternaryValue, { stop: stopObserving, poolKey });
    }
    return ternaryValue;
}
function emit(eventName, data, who, options = { bubbles: true }) {
    who.dispatchEvent(new window.CustomEvent(eventName, { ...options, detail: data }));
}
let trackDeps = false;
const trackProxies = new Set();
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
        if (!trackMap.has(proxy))
            continue;
        for (const key of trackMap.get(proxy)) {
            proxy.observe(key, reRun);
            if (unobserveMap.has(reRun)) {
                unobserveMap.get(reRun).push({ proxy, key });
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
function addLifecycle(lifecyleMap, elem, fn) {
    const current = lifecyleMap.get(elem);
    if (!current) {
        lifecyleMap.set(elem, fn);
    }
    else if (Array.isArray(current)) {
        current.push(fn);
    }
    else {
        lifecyleMap.set(elem, [current, fn]);
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
// Core of the library
// A single shared symbol keys every proxy's observer Map, so the observe/
// getObservers/unobserve methods can be defined once and reused across every
// proxy instead of allocating three closures (plus a fresh Symbol) per proxy.
// This matters when many proxies are created at once (e.g. one per list row).
const sharedHandlers = Symbol("handlers");
function observeMethod(key, handler) {
    const map = Reflect.get(this, sharedHandlers);
    if (map.has(key)) {
        map.get(key).add(handler);
    }
    else {
        map.set(key, new Set([handler]));
    }
    return () => {
        const handlersForKey = map.get(key);
        if (!handlersForKey)
            return;
        handlersForKey.delete(handler);
        if (handlersForKey.size === 0) {
            map.delete(key);
        }
    };
}
function getObserversMethod() {
    return Reflect.get(this, sharedHandlers);
}
function unobserveMethod(key, handler) {
    const map = Reflect.get(this, sharedHandlers);
    if (key) {
        if (map.has(key)) {
            if (handler == null) {
                map.delete(key);
            }
            else {
                const set = map.get(key);
                if (set?.has(handler)) {
                    set.delete(handler);
                }
            }
        }
        /* c8 ignore next 3 */
    }
    else {
        map.clear();
    }
}
function generateProxy(obj) {
    const boundFunctions = new WeakMap();
    const proxy = new Proxy(obj ?? {}, {
        // If receiver is a getter, then it is the object on which the search first started for the property|key -> Proxy
        set(target, key, val, receiver) {
            if (trackDeps) {
                trackProxies.add(receiver);
                if (trackMap.has(receiver)) {
                    trackMap.get(receiver).add(key);
                }
                else {
                    trackMap.set(receiver, new Set([key]));
                }
            }
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
                        // Snapshot + delete before removing, because removeElement now
                        // purges the Element out of bindMap too (mutation during forEach).
                        const elems = bindMap.get(oldVal);
                        bindMap.delete(oldVal);
                        elems.forEach(removeElement);
                    }
                }
                else {
                    if (bindMap.has(receiver)) {
                        const elems = bindMap.get(receiver);
                        bindMap.delete(receiver);
                        elems.forEach(removeElement);
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
            }
            else if (isNode(val)) {
                returnSet = Reflect.set(target, key, val, receiver);
            }
            else if (isObject(val) && !isProxy(val)) {
                returnSet = Reflect.set(target, key, generateProxy(val), receiver);
                // Recursively set properties to Proxys too
                for (const [subKey, subVal] of Object.entries(val)) {
                    if (isObject(subVal) && !isProxy(subVal)) {
                        Reflect.set(val, subKey, generateProxy(subVal));
                    }
                }
            }
            else {
                if (!reuseElements &&
                    Array.isArray(receiver) &&
                    receiver.includes(oldVal) &&
                    receiver.includes(val) &&
                    /* c8 ignore start */
                    bindMap.has(val)) {
                    const [elem] = bindMap.get(val);
                    if (lastSwapElem !== elem) {
                        const [oldElem] = bindMap.get(oldVal);
                        lastSwapElem = oldElem;
                        const prevElem = elem.previousSibling;
                        const prevOldElem = oldElem.previousSibling;
                        // Move it in the array too without triggering the proxy set
                        const index = receiver.findIndex((i) => i === val);
                        receiver.splice(Number(key), 1, val);
                        receiver.splice(index, 1, oldVal);
                        prevElem.after(oldElem);
                        prevOldElem.after(elem);
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
            if (reactivityMap.has(oldVal)) {
                checkReactivityMap(oldVal, key, newVal, oldVal);
            }
            else if (reactivityMap.has(receiver)) {
                checkReactivityMap(receiver, key, newVal, oldVal);
            }
            // current val (before setting) is a proxy - take over its keyToNodeMap
            if (isObject(val) && isProxy(val)) {
                if (reactivityMap.has(oldVal)) {
                    // Store old reactivityMap if it is a swap operation
                    if (reuseElements)
                        tmpSwap.set(oldVal, reactivityMap.get(oldVal));
                    if (tmpSwap.has(val)) {
                        reactivityMap.set(oldVal, tmpSwap.get(val));
                        tmpSwap.delete(val);
                    }
                    else {
                        reactivityMap.set(oldVal, reactivityMap.get(val));
                    }
                }
            }
            // Inform the Observers
            if (returnSet) {
                Reflect.get(target, sharedHandlers, receiver)
                    .get(key)
                    ?.forEach((handler) => handler(newVal, oldVal));
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
                    trackMap.get(receiver).add(prop);
                }
                else {
                    trackMap.set(receiver, new Set([prop]));
                }
            }
            const value = Reflect.get(target, prop, receiver);
            if (!isFunction(value)) {
                return value;
            }
            if (!boundFunctions.has(value)) {
                boundFunctions.set(value, value.bind(target));
            }
            return boundFunctions.get(value);
        },
    });
    Reflect.defineProperty(proxy, IS_PROXY, {
        value: true,
    });
    Reflect.defineProperty(proxy, ASYNC_UPDATE, {
        value: globalSchedule,
        writable: true,
    });
    Reflect.defineProperty(proxy, sharedHandlers, {
        value: new Map(),
    });
    Reflect.defineProperty(proxy, "observe" /* Placeholder.observe */, {
        value: observeMethod,
        configurable: true,
    });
    Reflect.defineProperty(proxy, "getObservers" /* Placeholder.getObservers */, {
        value: getObserversMethod,
        configurable: true,
    });
    Reflect.defineProperty(proxy, "unobserve" /* Placeholder.unobserve */, {
        value: unobserveMethod,
        configurable: true,
    });
    if (!obj)
        Reflect.defineProperty(proxy, _boundFunctions, {
            value: boundFunctions,
        });
    return proxy;
}
function cleanProxy(proxy) {
    if (isObject(proxy) && isProxy(proxy)) {
        proxy.unobserve();
        reactivityMap.delete(proxy);
        /* c8 ignore next 5 */
        if (bindMap.has(proxy)) {
            const elems = bindMap.get(proxy);
            bindMap.delete(proxy);
            elems.forEach(removeElement);
        }
    }
}
function checkReactivityMap(obj, key, val, oldVal) {
    const keyToNodeMap = reactivityMap.get(obj);
    const nodeToChangeMap = keyToNodeMap.get(String(key));
    if (nodeToChangeMap) {
        /* c8 ignore next 5 */
        if (Reflect.get(obj, ASYNC_UPDATE)) {
            schedule(updateDOM, nodeToChangeMap, val, oldVal);
        }
        else {
            updateDOM(nodeToChangeMap, val, oldVal);
        }
    }
    if (isObject(val)) {
        const entries = Object.entries(val);
        for (const [subKey, subVal] of entries) {
            const subOldVal = (isObject(oldVal) && Reflect.get(oldVal, subKey)) || oldVal;
            const nodeToChangeMap = keyToNodeMap.get(subKey);
            if (nodeToChangeMap) {
                /* c8 ignore next 5 */
                if (Reflect.get(obj, ASYNC_UPDATE)) {
                    schedule(updateDOM, nodeToChangeMap, subVal, subOldVal);
                }
                else {
                    updateDOM(nodeToChangeMap, subVal, subOldVal);
                }
            }
        }
    }
}
function updateDOM(nodeToChangeMap, val, oldVal) {
    nodeToChangeMap.forEach((entry) => {
        // Circular reference in order to keep Memory low
        if (isNode(entry)) {
            /* c8 ignore next 5 */
            if (!ignoreIsConnected && !entry.isConnected) {
                const tmpChange = nodeToChangeMap.get(entry);
                nodeToChangeMap.delete(entry);
                nodeToChangeMap.delete(tmpChange);
                if (allNodeChanges.has(entry)) {
                    allNodeChanges.delete(entry);
                }
            }
            return; // Continue in forEach
        }
        // For each change of the node update either attribute or textContent
        for (const change of entry) {
            const node = nodeToChangeMap.get(entry);
            const [start, end, key] = change;
            let useStartEnd = false;
            if (isNode(val) && (!isServerSideCached || val !== node)) {
                replaceElement(val, node);
                if (isServerSideCached || val !== node) {
                    nodeToChangeMap.delete(node);
                    nodeToChangeMap.delete(entry);
                    if (!isDocumentFragment(val)) {
                        nodeToChangeMap.set(val, entry);
                        nodeToChangeMap.set(entry, val);
                    }
                }
            }
            else if (isTextNode(node)) {
                useStartEnd = true;
                let text = node.nodeValue;
                node.nodeValue =
                    text.substring(0, start) + String(val) + text.substring(end);
            }
            else {
                if (key === TWO_WAY) {
                    if (node instanceof window.HTMLInputElement &&
                        node.type === RADIO_TYPE) {
                        node.checked = Array.isArray(val)
                            ? val.includes(node.name)
                            : String(val) === node.value;
                    }
                    else if (node instanceof window.HTMLInputElement &&
                        node.type === CHECKBOX_TYPE) {
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
                    if (attr) {
                        attr = attr.substring(0, start) + String(val) + attr.substring(end);
                        setAttribute(node, key, attr === String(val) ? val : attr);
                    }
                    else {
                        setAttribute(node, key, val);
                    }
                }
            }
            if (useStartEnd) {
                // Update end
                change[1] = start + String(val).length;
                // Because we updated the end, we also have to update the start and end for every other reactive change in the node, for the same key
                if (allNodeChanges.has(node)) {
                    let passedNode = false;
                    for (const nodeChange of allNodeChanges.get(node)) {
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
// Mount freshly rendered view rows. The reactive wiring happens in a SINGLE
// setReactivity pass. For the common case (each row is one Node) it runs over a
// detached fragment holding only the new rows – one NodeIterator, and no
// re-scanning of already-mounted rows – then the fragment is attached. This is
// what keeps "append rows to large table" cheap: the previous per-row
// setReactivity spun up one NodeIterator per row (very costly in Chrome).
// view()'s "Reset or re-use" / same-length-replace paths wipe rootElem via
// textContent = "" instead of going through render()/removeElement() (that's
// what keeps them cheap - no per-row diffing). But that means the rows being
// discarded never get runLifecyle(onCleanupMap) (e.g. onCleanup(unset, tr, ...))
// nor purgeSubtree (allNodeChanges/reactivityMap/bindMap/elemEventFunctions),
// so anything a row's cleanup would have torn down - notably a ternary()
// subscription on a shared condition, which pins the row's Proxy (and hence
// its bound Element, via bindMap) forever - leaks for the lifetime of the app.
//
// The visual clear stays exactly as cheap as plain textContent = "" always
// was - snapshotting the (soon-to-be-former) children into a plain array is
// just reading a live NodeList once, then the same single native
// textContent = "" wipe as before. The actual cleanup walk (onCleanup +
// purgeReactivity per row) is real, unavoidable work, but nothing downstream
// needs it to have already happened by the time this function returns - the
// rows are already detached and invisible either way - so it's queued and
// only actually walked via schedule() instead of running inline on the
// synchronous "clear" path. updateDOM's existing isConnected check already
// makes a stale, not-yet-purged binding harmless if something reacts in the
// meantime; unset()'s `done` guard (see ternaryDisposers) makes a ternary
// row's teardown safe to run twice (once here, once if its shared condition
// happens to go through a null transition first, e.g. selected(null) in the
// js-framework-benchmark app) without double-releasing a pooled slot.
//
// schedule() only ever actually runs once the host yields (idle callback /
// postTask) - callers that never yield between operations (e.g. a tight
// synchronous loop with no `await`, like a microbenchmark harness driving
// hundreds of trials back to back) would otherwise let the queue grow
// without bound until something finally yields, if ever. pendingCleanupRows
// / PENDING_CLEANUP_LIMIT is a hard backstop: past that many queued rows,
// flush synchronously right now instead of waiting for an idle moment,
// bounding worst-case backlog to one flush's worth regardless of whether the
// host ever yields.
const pendingCleanupRows = [];
let pendingCleanupCount = 0;
let cleanupFlushScheduled = false;
const PENDING_CLEANUP_LIMIT = 2000;
function resetViewRows(rootElem) {
    const rows = Array.from(rootElem.childNodes);
    rootElem.textContent = "";
    if (!rows.length)
        return;
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
    for (const row of rows) {
        if (isTextNode(row)) {
            if (hasCleanup)
                executeLifecycle(row, onCleanupMap);
            purgeReactivity(row);
            continue;
        }
        // document.createNodeIterator yields its own root first (same assumption
        // setReactivity/runLifecyle already make), so `row` itself is covered.
        const elements = document.createNodeIterator(row, window.NodeFilter.SHOW_ELEMENT);
        let elem;
        while ((elem = elements.nextNode())) {
            if (hasCleanup)
                executeLifecycle(elem, onCleanupMap);
            purgeReactivity(elem);
            let child = elem.firstChild;
            while (child) {
                if (isTextNode(child)) {
                    if (hasCleanup)
                        executeLifecycle(child, onCleanupMap);
                    purgeReactivity(child);
                }
                child = child.nextSibling;
            }
        }
    }
}
function addViewRows(rootElem, elements) {
    const hasFragmentItems = elements.some(isDocumentFragment);
    const fragment = document.createDocumentFragment();
    for (const elem of elements)
        fragment.appendChild(elem);
    if (!hasFragmentItems) {
        if (viewElementsEventFunctions.size !== 0 ||
            !elements.every((elem) => isHWired(elem))) {
            setReactivity(fragment, viewElementsEventFunctions);
            viewElementsEventFunctions.clear();
        }
        rootElem.appendChild(fragment);
        for (const elem of elements)
            runLifecyle(elem, onRenderMap);
    }
    else {
        // A row rendered to a DocumentFragment loses its identity once attached, so
        // fall back to attaching first and wiring the whole root in one pass.
        rootElem.appendChild(fragment);
        for (const elem of elements)
            runLifecyle(elem, onRenderMap);
        if (rootElem.hasChildNodes()) {
            setReactivity(rootElem, viewElementsEventFunctions);
            viewElementsEventFunctions.clear();
        }
    }
}
function view(root, data, renderFunction) {
    viewElements = true;
    const rootElem = $(root);
    const elements = getValue(data).map(renderFunction);
    addViewRows(rootElem, elements);
    viewElements = false;
    const stopViewObserver = observe(data, (newData, oldData) => {
        /* c8 ignore start */
        viewElements = true;
        // Reset or re-use
        if (!newData?.length ||
            (!reuseElements && newData?.length === oldData?.length)) {
            resetViewRows(rootElem);
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
            addViewRows(rootElem, newElements);
        }
        // Add new
        else if (oldData?.length === 0 || (!reuseElements && newData?.length)) {
            if (!reuseElements && oldData?.length && rootElem.hasChildNodes()) {
                resetViewRows(rootElem);
            }
            const elements = newData.map(renderFunction);
            addViewRows(rootElem, elements);
        }
        viewElements = false;
        /* c8 ignore end */
    });
    onCleanup(stopViewObserver, rootElem);
    onCleanup(unset, rootElem, data);
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
