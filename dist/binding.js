export function createBinding(runtime) {
    function buildHTMLParts(root) {
        const parts = [];
        walkHTMLParts(root, [], parts);
        return parts;
    }
    function walkHTMLParts(node, path, parts) {
        for (let index = 0; index < node.childNodes.length; index++) {
            const child = node.childNodes[index];
            if (runtime.isTextNode(child)) {
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
            else if (child.nodeType === 1) {
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
    function applyCompiledParts(root, parts, variables) {
        const values = new Array(variables.length);
        for (const part of parts) {
            const node = resolveCompiledPath(root, part.path);
            const markers = part.markers;
            if (part.whole &&
                runtime.isReactiveValue(variables[markers[0]]) &&
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
                if (!runtime.isReactiveValue(variable) &&
                    (runtime.isFunction(variable) || runtime.isEventObject(variable))) {
                    elem.removeAttribute(part.attr);
                    runtime.addEventListener(elem, part.attr.replace(runtime.onEventRegex, ""), variable);
                    continue;
                }
            }
            if (hasReactiveMarkerValue(markers, variables)) {
                setReactivitySingle(elem, part.attr, value);
            }
            else {
                runtime.setAttribute(elem, part.attr, value);
            }
        }
    }
    function wireReactiveValue(node, variable, key) {
        const keys = runtime.getReactivePath(variable);
        const [resolvedValue, resolvedObj] = runtime.resolveObject(keys);
        if (runtime.isNode(resolvedValue))
            return false;
        if (typeof resolvedValue === "string" &&
            runtime.containsReactiveMarker(resolvedValue)) {
            return false;
        }
        const lastProp = String(keys[keys.length - 1]);
        if (key === undefined) {
            const textContent = runtime.isObject(resolvedValue)
                ? window.JSON.stringify(resolvedValue)
                : (resolvedValue ?? "");
            const text = String(textContent);
            node.nodeValue = text;
            runtime.setTraces(0, String(resolvedValue).length, node, lastProp, resolvedObj);
            return true;
        }
        const elem = node;
        if (key === runtime.placeholder.bind) {
            elem.removeAttribute(key);
            runtime.trackBoundElement(runtime.isObject(resolvedValue) && runtime.isProxy(resolvedValue)
                ? resolvedValue
                : resolvedObj, elem);
            return true;
        }
        if (key === runtime.placeholder.twoWay ||
            resolvedValue == null ||
            runtime.isObject(resolvedValue) ||
            runtime.isFunction(resolvedValue) ||
            runtime.isEventObject(resolvedValue)) {
            return false;
        }
        runtime.setAttribute(elem, key, resolvedValue);
        runtime.setTraces(0, String(resolvedValue).length, elem, lastProp, resolvedObj, key);
        return true;
    }
    function setReactivity(DOM, eventFunctions) {
        if (runtime.isTextNode(DOM)) {
            setReactivitySingle(DOM);
            return;
        }
        const elems = document.createNodeIterator(DOM, runtime.showElement);
        let elem;
        while ((elem = elems.nextNode())) {
            for (const key of elem.getAttributeNames()) {
                const val = elem.getAttribute(key);
                if (eventFunctions && key.startsWith("on")) {
                    const eventName = key.replace(runtime.onEventRegex, "");
                    if (!(eventFunctions instanceof Map)) {
                        eventFunctions = new Map(Object.entries(eventFunctions));
                    }
                    const event = eventFunctions.get(val);
                    if (!event) {
                        setReactivitySingle(elem, key, val);
                        continue;
                    }
                    elem.removeAttribute(key);
                    runtime.addEventListener(elem, eventName, event);
                }
                else {
                    setReactivitySingle(elem, key, val);
                }
            }
            let childNode = elem.firstChild;
            while (childNode) {
                if (runtime.isTextNode(childNode) &&
                    (childNode.nodeValue?.includes("{{") ||
                        (runtime.isServerSideCached &&
                            childNode.nodeValue?.includes(runtime.placeholder.reactiveKey)))) {
                    setReactivitySingle(childNode);
                }
                childNode = childNode.nextSibling;
            }
        }
    }
    function setReactivitySingle(node, key, val) {
        let attrOrText;
        let match;
        if (!key) {
            attrOrText = node.nodeValue;
        }
        else {
            attrOrText = val;
            if (attrOrText === "") {
                attrOrText = key;
                if (attrOrText.startsWith("{{") ||
                    (runtime.isServerSideCached &&
                        attrOrText.startsWith(runtime.placeholder.reactiveKey))) {
                    node.removeAttribute(attrOrText);
                }
            }
        }
        const hasCurlyBraces = attrOrText.includes("{{");
        const hasReactiveKey = runtime.isServerSideCached &&
            attrOrText.includes(runtime.placeholder.reactiveKey);
        if (!hasCurlyBraces && !hasReactiveKey)
            return;
        while ((match = attrOrText.match(runtime.reactivityRegex))) {
            const [hydroMatch, hydroCurlyPath, hydroPath] = match;
            const properties = (hydroCurlyPath ?? hydroPath)
                .trim()
                .replace(runtime.newLineRegex, "")
                .split(runtime.propChainRegex)
                .filter(Boolean);
            const [resolvedValue, resolvedObj] = runtime.resolveObject(properties);
            let lastProp = properties[properties.length - 1];
            const start = match.index;
            let end = start + String(resolvedValue).length;
            if (runtime.isNode(resolvedValue)) {
                node.nodeValue = attrOrText.replace(hydroMatch, "");
                node.after(resolvedValue);
                runtime.setTraces(start, end, resolvedValue, lastProp, resolvedObj, key);
                return;
            }
            if (runtime.isTextNode(node)) {
                const textContent = runtime.isObject(resolvedValue)
                    ? window.JSON.stringify(resolvedValue)
                    : (resolvedValue ?? "");
                attrOrText = attrOrText.replace(hydroMatch, textContent);
                node.nodeValue = attrOrText;
            }
            else if (key === runtime.placeholder.bind) {
                attrOrText = attrOrText.replace(hydroMatch, "");
                node.removeAttribute(key);
                const proxy = runtime.isObject(resolvedValue) && runtime.isProxy(resolvedValue)
                    ? resolvedValue
                    : resolvedObj;
                runtime.trackBoundElement(proxy, node);
                continue;
            }
            else if (key === runtime.placeholder.twoWay) {
                if (node instanceof window.HTMLSelectElement) {
                    node.value = resolvedValue;
                    runtime.changeAttrVal(runtime.placeholder.change, node, resolvedObj, lastProp);
                }
                else if (node instanceof window.HTMLInputElement &&
                    node.type === runtime.placeholder.radio) {
                    node.checked = node.value === resolvedValue;
                    runtime.changeAttrVal(runtime.placeholder.change, node, resolvedObj, lastProp);
                }
                else if (node instanceof window.HTMLInputElement &&
                    node.type === runtime.placeholder.checkbox) {
                    node.checked = resolvedValue;
                    runtime.changeAttrVal(runtime.placeholder.change, node, resolvedObj, lastProp, true);
                }
                else if (node instanceof window.HTMLTextAreaElement ||
                    node instanceof window.HTMLInputElement) {
                    node.value = resolvedValue;
                    runtime.changeAttrVal("input", node, resolvedObj, lastProp);
                }
                attrOrText = attrOrText.replace(hydroMatch, "");
                node.toggleAttribute(runtime.placeholder.twoWay);
            }
            else if (runtime.isFunction(resolvedValue) ||
                runtime.isEventObject(resolvedValue)) {
                attrOrText = attrOrText.replace(hydroMatch, "");
                node.removeAttribute(key);
                runtime.addEventListener(node, key.replace(runtime.onEventRegex, ""), resolvedValue);
            }
            else if (runtime.isObject(resolvedValue)) {
                for (const [subKey, subVal] of Object.entries(resolvedValue)) {
                    attrOrText = attrOrText.replace(hydroMatch, "");
                    if (runtime.isFunction(subVal) || runtime.isEventObject(subVal)) {
                        runtime.addEventListener(node, subKey.replace(runtime.onEventRegex, ""), subVal);
                    }
                    else {
                        lastProp = subKey;
                        if (runtime.setAttribute(node, subKey, subVal)) {
                            end = start + String(subVal).length;
                        }
                        else {
                            end = start;
                        }
                    }
                    runtime.setTraces(start, end, node, lastProp, resolvedValue, subKey);
                }
                continue;
            }
            else {
                attrOrText = attrOrText.replace(hydroMatch, resolvedValue);
                if (!runtime.setAttribute(node, key, attrOrText === String(resolvedValue) ? resolvedValue : attrOrText)) {
                    attrOrText = attrOrText.replace(resolvedValue, "");
                }
            }
            runtime.setTraces(start, end, node, lastProp, resolvedObj, key);
        }
    }
    function wireViewHProp(elem, key, value) {
        if (key === runtime.placeholder.bind) {
            if (!runtime.isReactiveValue(value))
                return false;
            const keys = runtime.getReactivePath(value);
            const [resolvedValue, resolvedObj] = runtime.resolveObject(keys);
            const proxy = runtime.isObject(resolvedValue) && runtime.isProxy(resolvedValue)
                ? resolvedValue
                : resolvedObj;
            runtime.trackBoundElement(proxy, elem);
            return true;
        }
        if (key === runtime.placeholder.twoWay ||
            key in elem ||
            runtime.isBooleanAttribute(key)) {
            return false;
        }
        const keys = runtime.getReactivePath(value);
        const [resolvedValue, resolvedObj] = runtime.resolveObject(keys);
        if (resolvedValue == null ||
            runtime.isNode(resolvedValue) ||
            runtime.isFunction(resolvedValue) ||
            runtime.isEventObject(resolvedValue) ||
            runtime.isObject(resolvedValue)) {
            return false;
        }
        const applied = runtime.setAttribute(elem, key, resolvedValue);
        runtime.setTraces(0, applied ? String(resolvedValue).length : 0, elem, String(keys[keys.length - 1]), resolvedObj, key);
        return true;
    }
    function wireViewHChild(elem, child) {
        const keys = runtime.getReactivePath(child);
        const [resolvedValue, resolvedObj] = runtime.resolveObject(keys);
        if (runtime.isNode(resolvedValue))
            return false;
        const textContent = runtime.isObject(resolvedValue)
            ? window.JSON.stringify(resolvedValue)
            : (resolvedValue ?? "");
        const textNode = document.createTextNode(String(textContent));
        elem.appendChild(textNode);
        runtime.setTraces(0, String(textContent).length, textNode, String(keys[keys.length - 1]), resolvedObj);
        return true;
    }
    return {
        buildHTMLParts,
        applyCompiledParts,
        setReactivity,
        setReactivitySingle,
        wireReactiveValue,
        wireViewHProp,
        wireViewHChild,
    };
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
            if (runtime.isReactiveValue(variables[markers[index]]))
                return true;
        }
        return false;
    }
    function resolveCompiledPath(root, path) {
        let node = root;
        for (let level = 0; level < path.length; level++) {
            let child = node.firstChild;
            for (let index = path[level]; index > 0; index--) {
                child = child.nextSibling;
            }
            node = child;
        }
        return node;
    }
}
