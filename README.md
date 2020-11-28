<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="104" height="20" role="img" aria-label="coverage: 100%"><title>coverage: 100%</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="104" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="61" height="20" fill="#555"/><rect x="61" width="43" height="20" fill="#4c1"/><rect width="104" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110"><text aria-hidden="true" x="315" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="510">coverage</text><text x="315" y="140" transform="scale(.1)" fill="#fff" textLength="510">coverage</text><text aria-hidden="true" x="815" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="330">100%</text><text x="815" y="140" transform="scale(.1)" fill="#fff" textLength="330">100%</text></g></svg>

# hydro-js

> A lightweight (~3.7K <em>compressed</em>) reactive UI library via template literal tags.<br> Support in all modern Browsers.

## Installation

To bootstrap a new app:

```properties
$ npx create-hydro-app@latest <project>
```

or integrate in an existing app:

```properties
$ npm install hydro-js
import { render, html } from 'hydro-js';
```

Alternatively you can use a CDN:

```html
<script type="module">
  import { render, html } from "https://unpkg.com/hydro-js";
</script>
```

## Examples

- [Simple Counter](https://codesandbox.io/s/hydro-js-counter-mwpf4?file=/index.js)
- [Two Way Data Binding](https://codesandbox.io/s/hydro-js-two-way-data-binding-observe-extpq?file=/index.js)
- [Destructure Attributes](https://codesandbox.io/s/hydro-js-destructure-attributes-zhcx7?file=/index.js)
- [Ternary](https://codesandbox.io/s/hydro-js-ternary-c01h2?file=/index.js)
- [Promise Handling](https://codesandbox.io/s/hydro-js-promise-handling-eo90f?file=/index.js)
- [Nested Reactivity](https://codesandbox.io/s/hydro-js-nested-reactivity-myjpt?file=/index.js)
- [Nested Reactivity 2](https://codesandbox.io/s/hydro-js-nested-reactivity-6xy42?file=/index.js)

## Concept

There are multiple things this library can do. The first thing is generating HTML from strings. This is mostly done by the `Range Web API`. There are already ways to do that, like `Element.insertAdjacentHTML()`, but this has some drawbacks, as it does not create Table Elements, like `<colgroup>`, `<tbody>`, `<tfoot>`, `<thead>` and `<tr>`. Furthermore, the html function deals with inline events, objects, Handlebars / {{ Mustache }} etc. Using this function will feel like writing JSX without a build step.

The render function is used for mounting and unmounting Elements to/from the DOM and for executing lifecycle hooks. Optionally, it can diff both HTML Trees and reuse Elements (optionally too). This is not using a virtual DOM.

The functions calls for `render` and <em>DOM Updates</em> are queued and worked on during a browser's idle periods.

In order to make the DOM reactive, `ES6 Proxy` objects are being used to map data against an array of DOM Elements. Whenever the <em>setter</em> is being called, the Proxy will check the mapping and update the DOM granularly. No re-renders are needed!

Almost all intern maps are using `WeakMap` with DOM Elements or Proxy objects as keys and thus memory is cleared efficiently.

## Documentation

### html

args: `string`<br>
returns: `DocumentFragment | Element | Text`

Takes a string and transforms it to HTML. Used for internal bookkeeping too.

### render

args:

- new Element (`ReturnType<typeof html> | reactive Proxy`)
- old Element (`ReturnType<typeof html> | string`)
- ? shouldSchedule: `boolean` (default: true)

returns: `function` that unmounts the new Element

Accepts the return value of `html` and replaces it with <em>old Element</em>. If it is a string, it will be resolved with `querySelector`.

### setGlobalSchedule

args: `boolean`<br>

Will enable/disable the schedule logic for `render` and <em>DOM Updates</em>. Intern value defaults to `true`.

### setReuseElements

args: `boolean`<br>

Will enable/disable the reuse of Elements in the diffing phase of `render`. Intern value defaults to `true`.

### setInsertDiffing

args: `boolean`<br>

If enabled, it will insert the new DOM Tree to the DOM before diffing. This will asssure that reused Elements will not lose their state (e.g. `<video>` in <em>Chrome</em>. Intern value defaults to `false`.

### onRender

args:

- `function`
- elem (`ReturnType<typeof html>`)
- ...args for passed `function`

Calls the passed in `function` with `...args`, after the Element is being inserted by `render`;

### onCleanup

args:

- `function`
- elem (`ReturnType<typeof html>`)
- ...args for passed `function`

Calls the passed in `function` with `...args`, after the Element is being diffed out by `render` or removed by `unmount`;

### reactive

args: value: `any`<br>
returns: unique `Proxy`

Returns a Proxy object that can be used within `html`. The Proxy is a wrapping a function that can set the value. If the setter is called with a function then the argument of the passed in function will be provided as the current value for the Proxy.
The actual value will be set on the hydro Proxy, but this Proxy will hide the complexity.
<br><em> Special behaviour for promises: the library will await promises and will set its value to the unwrapped value. If the Promise rejects, the value will be unset.</em>

### observe

args:

- `ReturnType<typeof reactive>`<br>
- `function`

Calls the function whenenver the value of reactive changes. This is only one layer deep but chaining properties on reactive Proxys will return a Proxy too. Observing a prop of an object will look like: `observe(person.name, ...)`

### unobserve

args:

- `ReturnType<typeof reactive>`

Removes all observer from the reactive Proxy. This will not unobserve observer on properties.

### getValue

args: `ReturnType<typeof reactive>`<br>
returns: currently set value

Returns the value inside the the Proxy. getValue is needed because reactive Proxy does not have access to the value.

### asyncUpdate

args:

- `ReturnType<typeof reactive>`<br>
- `boolean`

Sets the schedule behavior for DOM Updates that are bound to this Proxy.

### unset

args: ReturnType<typeof reactive>

Deletes the Proxy object and removes Observer. This is important for keeping memory low.

### ternary

args:

- condition: `function | ReturnType<typeof reactive>`
- trueVal: `any`
- falseVal: `any`
- ? proxy: `ReturnType<typeof reactive>`

returns: `ReturnType<typeof reactive>`

In order to track a ternary in a template literal, this function has to be used. The proxy parameter is optional if the first parameter is a reactive Proxy. Otherwise, a function is being executed, whenever the Proxy value changes, which will update the DOM to either the trueVal or the falseVal.

### hydro

The actual Proxy in the library. This cannot be used with `getValue`, `observe`, `ternary` or `unset` but it offers the same functionality in a different manner.

properties:<br>

- isProxy: `boolean` (default: true)<br>
- asyncUpdate: `boolean`, (default: true, derived from globalSchedule)<br>
- observe: `function`, args: `string` as key<br>
- unobserve: `function`, args: `string | undefined`, unobserve key or all<br>
- getObservers: `function`, returns: map with all observer

### emit

args:

- event: `string`
- data: `any`
- who: `EventTarget`
- options: `object` (default: `{ bubbles: true }`)

Emits an event from the EventTarget <em>who</em>. This event bubbles by default.

### \$

Shortcut for `querySelector`.

### \$\$

Shortcut for `querySelectorAll`.

### internals

An object with internal data / functions for testing or deeper dives for developers. This only includes a `compare` function for DOM Elements at the moment.

## Roadmap

• Add GitHub Actions for Publishing<br>
• Experiment with Code in Worker<br>
• Experiment if the above code can be replaced by wasm<br>
• Add Broadcast channel or alike to sync updates over multiple tabs<br>
• Refactor some code parts, once WeakRef is supported in Safari<br>
