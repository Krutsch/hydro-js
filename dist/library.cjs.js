// Safari Polyfills
window.requestIdleCallback =
    /* c8 ignore next 4 */
    window.requestIdleCallback ||
        ((cb, _, start = performance.now()) => window.setTimeout(cb, 0, {
            didTimeout: false,
            timeRemaining: () => Math.max(0, 5 - (performance.now() - start)),
        }));
// Safari Polyfills END
// Parser to create HTML elements from strings
const parser = ((range = document.createRange()) => {
    range.selectNodeContents(range.createContextualFragment("<template>").lastChild);
    return range.createContextualFragment.bind(range);
})();
const allNodeChanges = new WeakMap(); // Maps a Node against a change. This is necessary for nodes that have multiple changes for one text / attribute.
const elemEventFunctions = new WeakMap(); // Stores event functions in order to compare Elements against each other.
const reactivityMap = new WeakMap(); // Maps Proxy Objects
const tmpSwap = new WeakMap(); // Take over keyToNodeMap if new value is a hydro Proxy. Save old reactivityMap entry here, in case for a swap operation.
const bindMap = new WeakMap(); // Bind an Element to Data. If the Data is being unset, the DOM Element disappears too.
const onRenderMap = new WeakMap(); // Lifecycle Hook that is being called after rendering
const onCleanupMap = new WeakMap(); // Lifecycle Hook that is being called when unmount function is being called
const _boundFunctions = Symbol("boundFunctions"); // Cache for bound functions in Proxy, so that we create the bound version of each function only once
const toSchedule = []; // functions that will be executed async and during a browser's idle period
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
function isObject(obj) {
    return obj != null && typeof obj === "object";
}
function isFunction(func) {
    return typeof func === "function" /* function */;
}
function isTextNode(node) {
    return node.splitText !== undefined;
}
function isNode(node) {
    return node instanceof Node;
}
function isDocumentFragment(node) {
    // getElementById exists in svg too. I did not find a better way to identify a DocumentFragment
    return node.nodeName !== "svg" && "getElementById" in node;
}
function isEventObject(obj) {
    return (isObject(obj) && "event" /* event */ in obj && "options" /* options */ in obj);
}
function isProxy(hydroObject) {
    return Reflect.get(hydroObject, "isProxy" /* isProxy */);
}
function isPromise(obj) {
    return isObject(obj) && typeof obj.then === "function";
}
function setGlobalSchedule(willSchedule) {
    globalSchedule = willSchedule;
    setHydroRecursive(hydro, willSchedule);
}
function setReuseElements(willReuse) {
    reuseElements = willReuse;
}
function setInsertDiffing(willInsert) {
    insertBeforeDiffing = willInsert;
}
function setHydroRecursive(obj, willSchedule) {
    Reflect.set(obj, "asyncUpdate" /* asyncUpdate */, willSchedule);
    Object.values(obj).forEach((value) => {
        if (isObject(value) && isProxy(value)) {
            setHydroRecursive(value, willSchedule);
        }
    });
}
function randomText() {
    return Math.random().toString(32).slice(2);
}
function setAttribute(node, key, val) {
    if (boolAttrList.includes(key) && !val) {
        node.removeAttribute(key);
        return false;
    }
    node.setAttribute(key, val);
    return true;
}
function addEventListener(node, eventName, obj) {
    node.addEventListener(eventName, isFunction(obj) ? obj : obj.event, isFunction(obj) ? {} : obj.options);
}
// This does not create <html>, <body> or <head> Elements.
// That is fine because the render function only renders within a body without a where parameter
function html(htmlArray, // The Input String, which is splitted by the template variables
...variables) {
    const eventFunctions = {}; // Temporarily store a mapping for string -> function, because eventListener have to be registered after the Element's creation
    let finalHTMLString = variables.length ? "" : htmlArray.join("").trim(); // The HTML string to parse
    let insertNodes = []; // Array of Nodes, that have to be added after the parsing
    variables.forEach((variable, index) => {
        const template = `<${"template" /* template */} id="lbInsertNodes${index}"></${"template" /* template */}>`;
        let html = htmlArray[index];
        // Remove empty text nodes on start
        if (index === 0)
            html = html.trimStart();
        if (isNode(variable)) {
            insertNodes.push(variable);
            finalHTMLString += html + template;
        }
        else if (["number", "string" /* string */, "symbol", "boolean", "bigint"].includes(typeof variable) ||
            Reflect.get(variable, "reactive" /* reactive */)) {
            finalHTMLString += html + String(variable);
        }
        else if (isFunction(variable) || isEventObject(variable)) {
            finalHTMLString += html.replace(eventListenerRegex, (_, eventType) => {
                const funcName = randomText();
                Reflect.set(eventFunctions, funcName, variable);
                return `${funcName}="${eventType}"`;
            });
        }
        else if (Array.isArray(variable)) {
            // Replace Nodes with template String
            variable.forEach((item, index) => {
                if (isNode(item)) {
                    insertNodes.push(item);
                    variable[index] = template;
                }
            });
            finalHTMLString += html + variable.join("");
        }
        else if (isObject(variable)) {
            Object.entries(variable).forEach(([key, value], index) => {
                if (index === 0) {
                    finalHTMLString += html;
                }
                if (isFunction(value) || isEventObject(value)) {
                    finalHTMLString += `${key}=`.replace(eventListenerRegex, (_, eventType) => {
                        const funcName = randomText();
                        Reflect.set(eventFunctions, funcName, value);
                        return `${funcName}="${eventType}"`;
                    });
                }
                else {
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
    DOM.querySelectorAll("template[id^=lbInsertNodes]").forEach((template) => replaceElement(insertNodes.shift(), template, false));
    setReactivity(DOM, eventFunctions);
    // Set reactive Behavior if only a Text Node is present
    if (DOM.childElementCount === 0 && DOM.firstChild) {
        setReactivitySingle(DOM.firstChild);
        // Return Text Node
        return DOM.firstChild;
    }
    // Return DocumentFragment
    if (DOM.childNodes.length > 1)
        return DOM;
    // Return Text Node
    if (!DOM.firstChild)
        return document.createTextNode("");
    // Return Element
    return DOM.firstChild;
}
function setReactivity(DOM, eventFunctions) {
    // Set events and reactive behaviour(checks for {{ key }} where key is on hydro)
    const root = document.createNodeIterator(DOM, window.NodeFilter.SHOW_ELEMENT);
    let elem;
    //@ts-ignore
    while ((elem = root.nextNode())) {
        // Check Attributes
        elem.getAttributeNames().forEach((key) => {
            // Set functions
            if (eventFunctions && key in eventFunctions) {
                const event = eventFunctions[key];
                const eventName = elem.getAttribute(key);
                elem.removeAttribute(key);
                if (isEventObject(event)) {
                    elem.addEventListener(eventName, event.event, event.options);
                    if (elemEventFunctions.has(elem)) {
                        elemEventFunctions.get(elem).push(event.event);
                    }
                    else {
                        elemEventFunctions.set(elem, [event.event]);
                    }
                }
                else {
                    elem.addEventListener(eventName, event);
                    if (elemEventFunctions.has(elem)) {
                        elemEventFunctions.get(elem).push(event);
                    }
                    else {
                        elemEventFunctions.set(elem, [event]);
                    }
                }
            }
            else {
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
function setReactivitySingle(node, key) {
    let attr_OR_text, match;
    if (isTextNode(node)) {
        attr_OR_text = node.nodeValue; // nodeValue is (always) defined on Text Nodes
    }
    else {
        attr_OR_text = node.getAttribute(key);
        if (attr_OR_text === "") {
            // e.g. checked attribute or two-way attribute
            attr_OR_text = key;
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
            const textContent = isObject(resolvedValue)
                ? JSON.stringify(resolvedValue)
                : resolvedValue ?? "";
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
                continue;
            }
            else if (key === "two-way" /* twoWay */) {
                // Same behavior as v-model in https://v3.vuejs.org/guide/forms.html#basic-usage
                const changeAttrVal = (eventName) => {
                    node.addEventListener(eventName, ({ target }) => {
                        Reflect.set(resolvedObj, lastProp, target.value);
                    });
                };
                if (node instanceof HTMLTextAreaElement ||
                    (node instanceof HTMLInputElement && node.type === "text" /* text */)) {
                    node.value = resolvedValue;
                    changeAttrVal("input");
                }
                else if (node instanceof HTMLSelectElement) {
                    node.value = resolvedValue;
                    changeAttrVal("change" /* change */);
                }
                else if (node instanceof HTMLInputElement &&
                    node.type === "radio" /* radio */) {
                    node.checked = node.value === resolvedValue;
                    changeAttrVal("change" /* change */);
                }
                else if (node instanceof HTMLInputElement &&
                    node.type === "checkbox" /* checkbox */) {
                    node.checked = resolvedValue.includes(node.name);
                    node.addEventListener("change" /* change */, ({ target }) => {
                        if (!target.checked) {
                            resolvedValue.splice(resolvedValue.indexOf(node.name), 1);
                        }
                        else if (!resolvedValue.includes(node.name)) {
                            resolvedValue.push(node.name);
                        }
                    });
                }
                attr_OR_text = attr_OR_text.replace(hydroMatch, "");
                node.setAttribute("two-way" /* twoWay */, "");
            }
            else if (isFunction(resolvedValue) || isEventObject(resolvedValue)) {
                attr_OR_text = attr_OR_text.replace(hydroMatch, "");
                node.removeAttribute(key);
                addEventListener(node, key.replace(onEventRegex, ""), resolvedValue);
            }
            else if (isObject(resolvedValue)) {
                // Case: setting attrs on Element - <p ${props}>
                Object.entries(resolvedValue).forEach(([subKey, subVal]) => {
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
                });
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
function setTraces(start, end, node, hydroKey, resolvedObj, key) {
    // Set WeakMaps, that will be used to track a change for a Node but also to check if a Node has any other changes.
    const change = [start, end, key];
    if (allNodeChanges.has(node)) {
        allNodeChanges.get(node).push(change);
    }
    else {
        allNodeChanges.set(node, [change]);
    }
    if (reactivityMap.has(resolvedObj)) {
        const keyToNodeMap = reactivityMap.get(resolvedObj);
        if (keyToNodeMap.has(hydroKey)) {
            const nodeToChangeMap = keyToNodeMap.get(hydroKey);
            if (nodeToChangeMap.has(node)) {
                nodeToChangeMap.get(node).push(change);
            }
            else {
                const changeArr = [change];
                nodeToChangeMap.set(changeArr, node);
                nodeToChangeMap.set(node, changeArr);
            }
        }
        else {
            const changeArr = [change];
            keyToNodeMap.set(hydroKey, 
            //@ts-ignore // ts-bug
            new Map([
                [changeArr, node],
                [node, changeArr],
            ]));
        }
    }
    else {
        const changeArr = [change];
        reactivityMap.set(resolvedObj, new Map([
            [
                hydroKey,
                //@ts-ignore // ts-bug
                new Map([
                    [changeArr, node],
                    [node, changeArr],
                ]),
            ],
        ]));
    }
}
// Helper function to return a Hydro Obj with a aalue from a chain of properties on hydro
function resolveObject(propertyArray) {
    let value, prev;
    value = prev = hydro;
    propertyArray.forEach((prop) => {
        prev = value;
        value = Reflect.get(prev, prop);
    });
    return [value, prev];
}
function compareEvents(elem, where, onlyTextChildren) {
    const elemFunctions = [];
    const whereFunctions = [];
    if (isTextNode(elem)) {
        if (onRenderMap.has(elem)) {
            elemFunctions.push(onRenderMap.get(elem));
        }
        if (onCleanupMap.has(elem)) {
            elemFunctions.push(onCleanupMap.get(elem));
        }
        if (onRenderMap.has(where)) {
            whereFunctions.push(onRenderMap.get(where));
        }
        if (onCleanupMap.has(where)) {
            whereFunctions.push(onCleanupMap.get(where));
        }
        if (elemFunctions.length !== whereFunctions.length)
            return false;
        if (String(elemFunctions) !== String(whereFunctions))
            return false;
        return true;
    }
    if (elemEventFunctions.has(elem)) {
        elemFunctions.push(...elemEventFunctions.get(elem));
    }
    if (elemEventFunctions.has(where)) {
        whereFunctions.push(...elemEventFunctions.get(where));
    }
    if (onRenderMap.has(elem)) {
        elemFunctions.push(onRenderMap.get(elem));
    }
    if (onCleanupMap.has(elem)) {
        elemFunctions.push(onCleanupMap.get(elem));
    }
    if (onRenderMap.has(where)) {
        whereFunctions.push(onRenderMap.get(where));
    }
    if (onCleanupMap.has(where)) {
        whereFunctions.push(onCleanupMap.get(where));
    }
    if (elemFunctions.length !== whereFunctions.length)
        return false;
    if (String(elemFunctions) !== String(whereFunctions))
        return false;
    for (let i = 0; i < elem.childNodes.length; i++) {
        if (onlyTextChildren) {
            if (isTextNode(elem.childNodes[i])) {
                if (!compareEvents(elem.childNodes[i], where.childNodes[i], onlyTextChildren)) {
                    return false;
                }
            }
        }
        else {
            if (!compareEvents(elem.childNodes[i], where.childNodes[i])) {
                return false;
            }
        }
    }
    return true;
}
function compare(elem, where, onlyTextChildren) {
    return (elem.isEqualNode(where) && compareEvents(elem, where, onlyTextChildren));
}
function render(elem, where = "", shouldSchedule = globalSchedule) {
    if (shouldSchedule) {
        toSchedule.push([render, elem, where, false]);
        if (!isScheduling)
            window.requestIdleCallback(schedule);
        return unmount(elem);
    }
    // Get elem value if elem is reactiveObject
    if (Reflect.get(elem, "reactive" /* reactive */)) {
        elem = getValue(elem);
    }
    // Store Elements of DocumentFragment for later unmount
    let elemChildren;
    if (isDocumentFragment(elem)) {
        elemChildren = Array.from(elem.childNodes);
    }
    if (!where) {
        document.body.append(elem);
    }
    else {
        if (typeof where === "string" /* string */) {
            const resolveStringToElement = document.querySelector(where);
            if (resolveStringToElement) {
                where = resolveStringToElement;
            }
            else {
                return () => { };
            }
        }
        if (!reuseElements) {
            replaceElement(elem, where);
        }
        else {
            if (isTextNode(elem)) {
                replaceElement(elem, where);
            }
            else if (isDocumentFragment(elem) || !compare(elem, where)) {
                treeDiff(elem, where);
            }
        }
    }
    runLifecyle(elem, onRenderMap);
    elemChildren?.forEach((subElem) => {
        runLifecyle(subElem, onRenderMap);
    });
    return unmount(isDocumentFragment(elem) ? elemChildren : elem);
}
function executeLifecycle(node, lifecyleMap) {
    if (lifecyleMap.has(node)) {
        const fn = lifecyleMap.get(node);
        /* c8 ignore next 3 */
        if (globalSchedule) {
            window.requestIdleCallback(fn);
        }
        else {
            fn();
        }
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
function treeDiff(elem, where) {
    const elemElements = document.createNodeIterator(elem, window.NodeFilter.SHOW_ELEMENT);
    const whereElements = document.createNodeIterator(where, window.NodeFilter.SHOW_ELEMENT);
    let template;
    if (insertBeforeDiffing) {
        template = document.createElement("template" /* template */);
        where.before(template);
        template.append(elem);
    }
    // Create Mapping for easier diffing, eg: "div" -> [...Element]
    let wElem;
    const tag2Elements = new Map();
    //@ts-ignore
    while ((wElem = whereElements.nextNode())) {
        if (tag2Elements.has(wElem.localName)) {
            tag2Elements.get(wElem.localName).push(wElem);
        }
        else {
            tag2Elements.set(wElem.localName, [wElem]);
        }
    }
    // Re-use any where Element if possible, then remove elem Element
    let subElem;
    //@ts-ignore
    while ((subElem = elemElements.nextNode())) {
        const sameElements = tag2Elements.get(subElem.localName);
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
        where.before(...(isDocumentFragment(elem) ? Array.from(template.childNodes) : [elem]));
        where.remove();
        template.remove();
        runLifecyle(where, onCleanupMap);
    }
    else {
        replaceElement(elem, where);
    }
    tag2Elements.clear();
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
    if (elem.isConnected) {
        elem.remove();
        runLifecyle(elem, onCleanupMap);
    }
}
function replaceElement(elem, where, withLifecycle = true) {
    where.before(elem);
    where.remove();
    if (withLifecycle)
        runLifecyle(where, onCleanupMap);
}
function schedule(deadline) {
    isScheduling = true;
    while (deadline.timeRemaining() > 0 && toSchedule.length > 0) {
        const [fn, ...args] = toSchedule.shift();
        fn(...args);
    }
    /* c8 ignore next 3 */
    if (toSchedule.length > 0) {
        window.requestIdleCallback(schedule);
    }
    isScheduling = false;
}
function reactive(initial) {
    let key;
    do
        key = randomText();
    while (Reflect.has(hydro, key));
    Reflect.set(hydro, key, initial);
    Reflect.set(setter, "reactive" /* reactive */, true);
    const chainKeysProxy = chainKeys(setter, [key]);
    return chainKeysProxy;
    function setter(val) {
        // @ts-ignore
        const keys = (this || chainKeysProxy)["__keys__" /* keys */];
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
    return new Proxy(initial, {
        get(target, subKey, _receiver) {
            if (subKey === "reactive" /* reactive */)
                return true;
            if (subKey === "__keys__" /* keys */) {
                return keys;
            }
            if (subKey === Symbol.toPrimitive) {
                return () => `{{${keys.join(".")}}}`;
            }
            return chainKeys(target, [...keys, subKey]);
        },
    });
}
function getReactiveKeys(reactiveHydro) {
    const keys = reactiveHydro["__keys__" /* keys */];
    const lastProp = keys[keys.length - 1];
    return [lastProp, keys.length === 1];
}
function unset(reactiveHydro) {
    const [lastProp, oneKey] = getReactiveKeys(reactiveHydro);
    if (oneKey) {
        Reflect.set(hydro, lastProp, null);
    }
    else {
        const [_, resolvedObj] = resolveObject(reactiveHydro["__keys__" /* keys */]);
        Reflect.set(resolvedObj, lastProp, null);
    }
}
function setAsyncUpdate(reactiveHydro, asyncUpdate) {
    const [_, oneKey] = getReactiveKeys(reactiveHydro);
    if (oneKey) {
        hydro.asyncUpdate = asyncUpdate;
    }
    else {
        const [_, resolvedObj] = resolveObject(reactiveHydro["__keys__" /* keys */]);
        resolvedObj.asyncUpdate = asyncUpdate;
    }
}
function observe(reactiveHydro, fn) {
    const [lastProp, oneKey] = getReactiveKeys(reactiveHydro);
    if (oneKey) {
        hydro.observe(lastProp, fn);
    }
    else {
        const [_, resolvedObj] = resolveObject(reactiveHydro["__keys__" /* keys */]);
        resolvedObj.observe(lastProp, fn);
    }
}
function unobserve(reactiveHydro) {
    const [lastProp, oneKey] = getReactiveKeys(reactiveHydro);
    if (oneKey) {
        hydro.unobserve(lastProp);
    }
    else {
        const [_, resolvedObj] = resolveObject(reactiveHydro["__keys__" /* keys */]);
        resolvedObj.unobserve(lastProp);
    }
}
function ternary(condition, trueVal, falseVal, reactiveHydro = condition) {
    const checkCondition = (cond) => (!Reflect.get(condition, "reactive" /* reactive */) && isFunction(condition)
        ? condition(cond)
        : isPromise(cond)
            ? false
            : cond)
        ? isFunction(trueVal)
            ? trueVal()
            : trueVal
        : isFunction(falseVal)
            ? falseVal()
            : falseVal;
    const ternaryValue = reactive(checkCondition(getValue(reactiveHydro)));
    observe(reactiveHydro, (newVal) => {
        newVal === null
            ? unset(ternaryValue)
            : ternaryValue(checkCondition(newVal));
    });
    return ternaryValue;
}
function emit(eventName, data, who, options = { bubbles: true }) {
    who.dispatchEvent(new CustomEvent(eventName, { ...options, detail: data }));
}
function getValue(reactiveHydro) {
    // @ts-ignore
    const [resolvedValue] = resolveObject(reactiveHydro["__keys__" /* keys */]);
    return resolvedValue;
}
let calledOnRender = false;
function onRender(fn, elem, ...args) {
    calledOnRender = true;
    onRenderMap.set(elem, args.length ? fn.bind(fn, ...args) : fn);
}
let calledOnCleanup = false;
function onCleanup(fn, elem, ...args) {
    calledOnCleanup = true;
    onCleanupMap.set(elem, args.length ? fn.bind(fn, ...args) : fn);
}
// Core of the library
function generateProxy(obj = {}) {
    const handlers = Symbol("handlers"); // For observer pattern
    const boundFunctions = new WeakMap();
    const proxy = new Proxy(obj, {
        // If receiver is a getter, then it is the object on which the search first started for the property|key -> Proxy
        set(target, key, val, receiver) {
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
                const observer = Reflect.get(target, handlers, receiver);
                if (observer.has(key)) {
                    let set = observer.get(key);
                    set.forEach((handler) => handler(null, oldVal));
                    set.clear();
                    receiver.unobserve(key);
                }
                // If oldVal is a Proxy - clean it
                if (isObject(oldVal) && isProxy(oldVal)) {
                    reactivityMap.delete(oldVal);
                    if (bindMap.has(oldVal)) {
                        bindMap.get(oldVal).forEach(removeElement);
                        bindMap.delete(oldVal);
                    }
                    cleanProxy(oldVal);
                }
                else {
                    if (bindMap.has(receiver)) {
                        bindMap.get(receiver).forEach(removeElement);
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
            }
            else if (isNode(val)) {
                returnSet = Reflect.set(target, key, val, receiver);
            }
            else if (isObject(val) && !isProxy(val)) {
                returnSet = Reflect.set(target, key, generateProxy(val), receiver);
                // Recursively set properties to Proxys too
                Object.entries(val).forEach(([subKey, subVal]) => {
                    if (isObject(subVal) && !isProxy(subVal)) {
                        Reflect.set(val, subKey, generateProxy(subVal));
                    }
                });
            }
            else {
                returnSet = Reflect.set(target, key, val, receiver);
            }
            // Check if DOM needs to be updated
            // oldVal can be Proxy value too
            if (reactivityMap.has(oldVal)) {
                checkReactivityMap(oldVal, key, val, oldVal);
            }
            else if (reactivityMap.has(receiver)) {
                checkReactivityMap(receiver, key, val, oldVal);
            }
            // current val (before setting) is a proxy - take over its keyToNodeMap
            if (isObject(val) && isProxy(val)) {
                if (reactivityMap.has(oldVal)) {
                    // Store old reactivityMap if it is a swap operation
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
                Reflect.get(target, handlers, receiver)
                    .get(key)
                    ?.forEach((handler) => handler(Reflect.get(hydro, key), oldVal));
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
    });
    Reflect.defineProperty(proxy, "isProxy" /* isProxy */, {
        value: true,
    });
    Reflect.defineProperty(proxy, "asyncUpdate" /* asyncUpdate */, {
        value: globalSchedule,
        writable: true,
    });
    Reflect.defineProperty(proxy, handlers, {
        //TODO: should be WeakValue in future
        value: new Map(),
    });
    Reflect.defineProperty(proxy, "observe" /* observe */, {
        value: (key, handler) => {
            const map = Reflect.get(proxy, handlers);
            if (map.has(key)) {
                map.get(key).add(handler);
            }
            else {
                map.set(key, new Set([handler]));
            }
        },
        configurable: true,
    });
    Reflect.defineProperty(proxy, "getObservers" /* getObservers */, {
        value: () => Reflect.get(proxy, handlers),
        configurable: true,
    });
    Reflect.defineProperty(proxy, "unobserve" /* unobserve */, {
        value: (key) => {
            const map = Reflect.get(proxy, handlers);
            if (key) {
                if (map.has(key))
                    map.delete(key);
            }
            else {
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
    return proxy;
}
function cleanProxy(oldProxy, currentProxy) {
    // Unobserve
    const observer = oldProxy.getObservers();
    observer.forEach((set) => set.clear());
    oldProxy.unobserve();
    // Set containing Proxys to null too
    let filterEmpty = [];
    Object.entries(oldProxy).forEach(([subKey, subVal]) => {
        if (isObject(subVal) && isProxy(subVal)) {
            filterEmpty.push(subKey);
            if (!currentProxy ||
                !Reflect.has(currentProxy, subKey) ||
                subVal !== Reflect.get(currentProxy, subKey))
                Reflect.set(oldProxy, subKey, null);
        }
    });
    // Remove empty slot from array
    if (Array.isArray(oldProxy)) {
        filterEmpty.reverse().forEach((idx) => filterEmpty.splice(idx, 1));
    }
}
function checkReactivityMap(obj, key, val, oldVal) {
    const keyToNodeMap = reactivityMap.get(obj);
    if (keyToNodeMap.has(String(key))) {
        /* c8 ignore next 5 */
        if (Reflect.get(obj, "asyncUpdate" /* asyncUpdate */)) {
            toSchedule.push([updateDOM, keyToNodeMap, String(key), val, oldVal]);
            if (!isScheduling)
                window.requestIdleCallback(schedule);
        }
        else {
            updateDOM(keyToNodeMap, String(key), val, oldVal);
        }
    }
    if (isObject(val)) {
        Object.entries(val).forEach(([subKey, subVal]) => {
            const subOldVal = (isObject(oldVal) && Reflect.get(oldVal, subKey)) || oldVal;
            if (keyToNodeMap.has(subKey)) {
                /* c8 ignore next 5 */
                if (Reflect.get(obj, "asyncUpdate" /* asyncUpdate */)) {
                    toSchedule.push([updateDOM, keyToNodeMap, subKey, subVal, subOldVal]);
                    if (!isScheduling)
                        window.requestIdleCallback(schedule);
                }
                else {
                    updateDOM(keyToNodeMap, subKey, subVal, subOldVal);
                }
            }
        });
    }
}
function updateDOM(keyToNodeMap, key, val, oldVal) {
    const nodeToChangeMap = keyToNodeMap.get(key);
    nodeToChangeMap.forEach((entry) => {
        // Circular reference in order to keep Memory low
        if (isNode(entry)) {
            /* c8 ignore next 5 */
            if (!entry.isConnected) {
                const tmpChange = nodeToChangeMap.get(entry);
                nodeToChangeMap.delete(entry);
                nodeToChangeMap.delete(tmpChange);
            }
            return; // Continue in forEach
        }
        // For each change of the node update either attribute or textContent
        entry.forEach((change) => {
            const node = nodeToChangeMap.get(entry);
            const [start, end, key] = change;
            let useStartEnd = false;
            if (isNode(val)) {
                replaceElement(val, node);
            }
            else if (isTextNode(node)) {
                useStartEnd = true;
                let text = node.nodeValue;
                node.nodeValue =
                    text.substring(0, start) + String(val) + text.substring(end);
            }
            else {
                if (key === "two-way" /* twoWay */) {
                    if (node instanceof HTMLTextAreaElement ||
                        node instanceof HTMLSelectElement ||
                        (node instanceof HTMLInputElement && node.type === "text" /* text */)) {
                        node.value = String(val);
                    }
                    else if (node instanceof HTMLInputElement &&
                        (node.type === "checkbox" /* checkbox */ ||
                            node.type === "radio" /* radio */)) {
                        node.checked = Array.isArray(val)
                            ? val.includes(node.name)
                            : String(val) === node.value;
                    }
                }
                else if (isFunction(val) || isEventObject(val)) {
                    const eventName = key.replace(onEventRegex, "");
                    node.removeEventListener(eventName, isFunction(val) ? val : val.event);
                    addEventListener(node, eventName, val);
                }
                else if (isObject(val)) {
                    Object.entries(val).forEach(([subKey, subVal]) => {
                        if (isFunction(subVal) || isEventObject(subVal)) {
                            const eventName = subKey.replace(onEventRegex, "");
                            node.removeEventListener(eventName, isFunction(subVal) ? subVal : subVal.event);
                            addEventListener(node, eventName, subVal);
                        }
                        else {
                            setAttribute(node, subKey, subVal);
                        }
                    });
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
                let passedNode;
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
let wasHidden = false;
document.addEventListener("visibilitychange", () => {
    /* c8 ignore next 19 */
    // The schedule logic does not work well when the document is in the background. Ideally all the changes have to be rendered at once, if the User comes back
    // This could block the UI however, and it makes sense to only render the last updates < 50ms
    if (wasHidden === true && document.hidden === false) {
        const start = performance.now();
        // 1 frame if 24fps, 18 frames if 360fps
        const lastFrames = toSchedule.splice(toSchedule.length - 18, 18);
        while (lastFrames.length > 0 && performance.now() < start + 50) {
            const [fn, ...args] = lastFrames.shift();
            fn(...args);
        }
        // Render the latest update, just in case
        if (lastFrames.length > 0) {
            const [fn, ...args] = lastFrames.pop();
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
module.exports = { render, html, hydro, setGlobalSchedule, setReuseElements, setInsertDiffing, reactive, unset, setAsyncUpdate, unobserve, observe, ternary, emit, internals, getValue, onRender, onCleanup, setReactivity, $, $$, };