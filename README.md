# hydro-js

> A lightweight (~1.7K <em>compressed</em>) reactive UI library via template literal tags.<br>

## Installation

```javascript
$ npm install hydro.js
import { render, html } from 'hydro-js';
```

Akternatively you can use a CDN

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

There are multiple things this library can do. The first thing is generating HTML from strings. This is mostly done by the `Range Web API`. There are already ways to do that, like `Element.insertAdjacentHTML()`, but this has some drawbacks, as it does not create some Table Elements, like `<colgroup>`, `<tbody>`, `<tfoot>`, `<thead>` and `<tr>`. Furthermore, the html function deals with inline events, objects, {{ Mustache }} etc. Using this function will feel like writing JSX without a build step.

The render function is used for mounting and unmounting Elements to the DOM and for executing lifecycle hooks. Optionally, it can diff both HTML Trees and reuse Elements (optionally too).

The functions calls for `render` and <em>DOM Updates</em> are queued and worked on during a browser's idle periods.

In order to make the DOM reactive, `ES6 Proxy` objects are being used to map data against an array of DOM Elements. Whenever the <em>setter</em> is being called, the Proxy will check the mapping and update the DOM granularly.

Almost all intern maps are using WeakMaps with DOM Elements or Proxy object as keys and memory is cleared efficiently.

## Documentation

### html

args: `string`<br>
returns: `DocumentFragment | Element | Text`

Takes a string and transforms it to HTML. Used for internal bookkeeping too.

### render

args:

- new Element (`DocumentFragment | Element | Text`)
- old Element (`Element | string`)
- ? shouldschedule: boolean (default: true)

returns: `function` that unmounts the new Element

Accepts the return value of `html` and replaces it with the old Element. If old Element is a string, it will resolve it with `querySelector`.

### setGlobalSchedule

args: `boolean`<br>

Will enable/disable the queue for `render` and <em>DOM Updates</em>. Defaults to `true`.

### setReuseElements

args: `boolean`<br>

Will enable/disable the reuse of Elements in the diffing Phase of `render`. Defaults to `true`.

### setInsertDiffing

args: `boolean`<br>

If enabled, it will insert the new Element to the DOM before diffing. This will asssure that reused Elements will not lose their state (e.g. `<video>` in <em>Chrome</em>. Defaults to `false`.

### onRender

args:

- `function`
- elem (`DocumentFragment | Element | Text`)
- ...args for passed `function`

Calls the passed in `function` with `...args`, after the Element is being inserted by `render`;

### onCleanup

args:

- `function`
- elem (`DocumentFragment | Element | Text`)
- ...args for passed `function`

Calls the passed in `function` with `...args`, after the Element is being diffed out by `render` or removed by `unmount`;

### reactive

args: value: `any`<br>
returns: unique Proxy object

Returns a Proxy object that can be used in `html`. The Proxy is a layer over a function that can set the value. If the argument is a function, then the argument of the passed in function will be provided as the current value for the Proxy.
Interally, the hydro Proxy is used and this reactive Proxy hides it's complexity.

### observe

args:

- `ReturnType<typeof reactive>`<br>
- `function`

Calls the function whenenver the value of reactive changes. This is only one layer deep but chaining properties returns a Proxy too.

### getValue

args: `ReturnType<typeof reactive>`<br>
Returns the value inside the the Proxy. getValue is needed because chaining properties returns a Proxy.

### ternary

args:

- condition: `function | ReturnType<typeof reactive>`
- trueVal: `any`
- falseVal: `any`
- ? proxy: `ReturnType<typeof reactive>`

returns: `ReturnType<typeof reactive>`

In order to track a ternary, that is being used in a template literal, this function has to be used. The proxy parameter is optional if the first parameter is a Proxy. Otherwise, a function is being executed, whenever the Proxy value changes, which will update the DOM to either the trueVal or the falseVal
(it will also execute truVal/falseVal, if it is a function).

### unset

args: ReturnType<typeof reactive>

Deletes the Proxy object. This is important to keep memory low.

### hydro

The actual Proxy in the library. This cannot be used with `getValue`, `observe`, `ternary` or `unset` but it offers the same functionality in a different manner.

### emit

args:

- event: `string`
- data: `any`
- who: `EventTarget`
- options: `object` (default: `{ bubbles: true }`)

Emits an event from the EventTarget <em>who</em>. This event bubbles by default.

### internals

An object with internal data / functions for testing or deeper dives for developers. This only includes a `compare` function for DOM Elements by at the moment.

## Roadmap

• Add GitHub Actions for Publishing
• Snowpack Starter Project with Prerendering<br>
• Add Broadcast channel or alike to sync updates over multiple tabs<br>
• Experiment with Code in Worker<br>
• Experiment if the above code can be replaced by wasm<br>
• Refactor some code parts, once WeakRef is supported in Safari
