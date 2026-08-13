export function createRecordingUpdateAdapter(effects) {
    return {
        isConnected: (node) => node.isConnected,
        isText: (node) => node.nodeType === 3,
        isNode: (value) => value != null && typeof value === "object" && "nodeType" in value,
        isFunction: (value) => typeof value === "function",
        isEventObject: (value) => value != null && typeof value === "object" && "event" in value,
        isObject: (value) => value != null && typeof value === "object",
        replace: (node, value) => {
            effects.push({ kind: "replace", node, value });
            return value;
        },
        applyText: (node, start, end, value) => {
            effects.push({ kind: "text", node, start, end, value });
        },
        applyControl: (node, key, value) => {
            effects.push({ kind: "control", node, key, value });
        },
        applyEvent: (node, key, value, oldValue) => {
            effects.push({ kind: "event", node, key, value, oldValue });
        },
        applyObject: (node, value, oldValue) => {
            effects.push({ kind: "object", node, value, oldValue });
        },
        applyAttribute: (node, key, start, end, value) => {
            effects.push({ kind: "attribute", node, key, start, end, value });
        },
    };
}
export function createUpdateEngine(options) {
    const adapter = options.adapter;
    function checkReactivityMap(obj, key, value, oldValue) {
        const keyToNodeMap = options.reactivityMap.get(obj);
        const stringKey = String(key);
        const entry = keyToNodeMap.get(stringKey);
        if (entry) {
            if (options.isAsync(obj)) {
                options.schedule(updateDOM, keyToNodeMap, stringKey, entry, value, oldValue);
            }
            else {
                updateDOM(keyToNodeMap, stringKey, entry, value, oldValue);
            }
        }
        if (adapter.isObject(value)) {
            const source = value;
            if (Array.isArray(value) && keyToNodeMap.size < value.length) {
                for (const subKey of keyToNodeMap.keys()) {
                    if (!Object.prototype.propertyIsEnumerable.call(value, subKey)) {
                        continue;
                    }
                    updateSubKey(obj, keyToNodeMap, subKey, source[subKey], oldValue);
                }
            }
            else {
                const subKeys = Object.keys(source);
                for (let index = 0; index < subKeys.length; index++) {
                    const subKey = subKeys[index];
                    updateSubKey(obj, keyToNodeMap, subKey, source[subKey], oldValue);
                }
            }
        }
    }
    function updateSubKey(obj, keyToNodeMap, subKey, subValue, oldValue) {
        const entry = keyToNodeMap.get(subKey);
        if (!entry)
            return;
        const subOldValue = adapter.isObject(oldValue) && oldValue[subKey]
            ? oldValue[subKey]
            : oldValue;
        if (options.isAsync(obj)) {
            options.schedule(updateDOM, keyToNodeMap, subKey, entry, subValue, subOldValue);
        }
        else {
            updateDOM(keyToNodeMap, subKey, entry, subValue, subOldValue);
        }
    }
    function updateDOM(keyToNodeMap, hydroKey, entry, value, oldValue) {
        const valueIsNode = adapter.isNode(value);
        if (entry instanceof Map) {
            const rekeyed = [];
            entry.forEach((changes, node) => {
                const mapped = applyNodeChanges(node, changes, value, oldValue, valueIsNode);
                if (mapped !== node) {
                    rekeyed.push([node, mapped, changes]);
                }
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
        const mapped = applyNodeChanges(entry.node, entry.changes, value, oldValue, valueIsNode);
        if (mapped === entry.node)
            return;
        if (mapped)
            entry.node = mapped;
        else
            keyToNodeMap.delete(hydroKey);
    }
    function applyNodeChanges(originalNode, changes, value, oldValue, valueIsNode) {
        if (!options.shouldIgnoreIsConnected() &&
            !options.adapter.isConnected(originalNode)) {
            options.allNodeChanges.delete(originalNode);
            return null;
        }
        let mapped = originalNode;
        let valueString;
        for (const change of changes) {
            const [start, end, key] = change;
            let useStartEnd = false;
            const node = mapped ?? originalNode;
            if (valueIsNode && (!options.isServerSideCached || value !== node)) {
                mapped = adapter.replace(node, value);
            }
            else if (adapter.isText(node)) {
                useStartEnd = true;
                valueString ??= String(value);
                adapter.applyText(node, start, end, valueString);
            }
            else if (key === options.twoWayKey) {
                adapter.applyControl(node, key, value);
            }
            else if (adapter.isFunction(value) || adapter.isEventObject(value)) {
                adapter.applyEvent(node, options.onEvent(key), value, oldValue);
            }
            else if (adapter.isObject(value)) {
                adapter.applyObject(node, value, oldValue);
            }
            else {
                useStartEnd = true;
                valueString ??= String(value);
                adapter.applyAttribute(node, key, start, end, value);
            }
            if (useStartEnd) {
                valueString ??= String(value);
                change[1] = start + valueString.length;
                const changesForNode = options.allNodeChanges.get(node);
                if (changesForNode) {
                    let passedNode = false;
                    const difference = String(oldValue).length - valueString.length;
                    for (const nodeChange of changesForNode) {
                        if (nodeChange === change) {
                            passedNode = true;
                            continue;
                        }
                        if (passedNode && (adapter.isText(node) || key === nodeChange[2])) {
                            nodeChange[0] -= difference;
                            nodeChange[1] -= difference;
                        }
                    }
                }
            }
        }
        return mapped;
    }
    return { checkReactivityMap, updateDOM };
}
