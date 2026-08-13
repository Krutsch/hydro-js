# hydro-js Context

Language for hydro-js reactive HTML rendering and its managed DOM output.

## Language

**Reactive value**:
A value that can be read, changed, observed, and used to drive rendered output.
_Avoid_: State, signal

**Template**:
A description of HTML output containing static structure and positions for values, attributes, events, or nodes.
_Avoid_: Markup string, component

**View**:
A data-driven collection of rendered nodes under one root, updated as its collection changes.
_Avoid_: List component, collection service

**Rendered node**:
A DOM node managed by hydro-js after template or view rendering, including its updates, lifecycle, and cleanup obligations.
_Avoid_: DOM element, widget
