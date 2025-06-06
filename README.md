<img align="right" alt="100% Coverage" src="coverage.svg">

# hydro-js

> A lightweight (below 5K <em>compressed</em>) reactive UI library via template literal tags.<br> Support in all modern Browsers and with Server-Side Rendering!

## Installation

To bootstrap a new app:

```properties
$ npm init hydro-app@latest <project> // or npx create-hydro-app@latest <project>
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

- [Simple Counter](https://stackblitz.com/edit/hydro-simple-counter)
- [Reactive CSS](https://stackblitz.com/edit/hydro-reactive-styles)
- [Two Way Data Binding](https://stackblitz.com/edit/hydro-two-way-data)
- [Show](https://stackblitz.com/edit/hydro-show-ternary)
- [Destructure Attributes](https://stackblitz.com/edit/hydro-destructure-attributes)
- [Ternary](https://stackblitz.com/edit/hydro-ternary)
- [Promise Handling](https://stackblitz.com/edit/hydro-promise)
- [Nested Reactivity](https://stackblitz.com/edit/hydro-nested-reactivity)
- [Nested Reactivity 2](https://stackblitz.com/edit/hydro-nested-reactivity-2)

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

#### Example

```js
html`<p>Text</p>`;
```

### render

args:

- new Element (`ReturnType<typeof html> | reactive Proxy`)
- old Element (`ReturnType<typeof html> | string`)
- shouldSchedule?: `boolean` (default: true)

returns: `function` that unmounts the new Element

Accepts the return value of `html` and replaces it with <em>old Element</em>. If it is a string, it will be resolved with `querySelector`. If there is no second parameter, the Element will be appended to the `body`.

#### Example

```js
render(html`<p>Text</p>`);
```

### setGlobalSchedule

args: `boolean`<br>

Will enable/disable the schedule logic for `render` and <em>DOM Updates</em>. Intern value defaults to `true`.

### setReuseElements

args: `boolean`<br>

Will enable/disable the reuse of Elements in the diffing phase of `render`. Intern value defaults to `true`.

### setInsertDiffing

args: `boolean`<br>

If enabled, it will insert the new DOM Tree to the DOM before diffing. This will asssure that reused Elements will not lose their state (e.g. `<video>` in <em>Chrome</em>. Intern value defaults to `false`.

### setReactivity

args: `Node`<br>

Inserts Proxy values in the template HTML. This is useful, when HTML already exists, i.e. in a HTML file and you want to set the hydro Proxy Objects for the handlebars. Also, this can set event listener and remove the inline listener. This is a good way to send HTML over the wire.

#### Example 1

```js
// <p id="value">{{value}}</p> in HTML
const template = $("#value");
hydro.value = "Hello World";
setReactivity(template);
```

#### Example 2 (with event)

```js
// <p id="value" onclick="placeholder">{{value}}</p> in HTML
const template = $("#value")!;
hydro.value = "Hello World";
setReactivity(template, { placeholder: () => console.log("clicked") }); // placeholder should be unique
```

### onRender

args:

- `function`
- elem (`ReturnType<typeof html>`)
- ...args for passed `function`

Calls the passed in `function` with `...args`, after the Element is being inserted by `render`;

#### Example

```js
const elem = html`<p>Hello World</p>`;
onRender(() => console.log("rendered elem"), elem);
render(elem);
```

### onCleanup

args:

- `function`
- elem (`ReturnType<typeof html>`)
- ...args for passed `function`

Calls the passed in `function` with `...args`, after the Element is being diffed out by `render` or removed by `unmount`;

#### Example

```js
const elem = html`<p>Hello World</p>`;
onCleanup(() => console.log("removed elem"), elem);
const unmount = render(elem);
unmount();
```

### reactive

args: value: `any`<br>
returns: unique `Proxy`

Returns a Proxy object that can be used within `html`. The Proxy is wrapping a function that can set the value. There are two ways to call the function (see `Nested Reactivity 2`. If the Proxy will be called with a function, then the argument of the passed in function will be provided as the current value for the Proxy, otherwise it will take the new argument as new value.
The actual value will be set on the hydro Proxy.
<br><em> Special behaviour for (prev) functions: the old value will be kept, if the returned value is undefined.</em>

#### Example

```js
const data = reactive({ value: 42 });
render(html`<p>${data.value} €</p>`);
data((prev) => (prev.value = 21)); // Change the value
```

### observe

args:

- `ReturnType<typeof reactive>`<br>
- `function`

Calls the function whenever the value of reactive Proxy changes. This is only one layer deep but chaining properties on reactive Proxys will return a Proxy too. Observing a prop of an object will look like:

```js
observe(person.name, ...)
```

#### Example

```js
const person = reactive({ name: "Steve" });
observe(person.name, (newValue) => console.log(`Name changed to ${newValue}`));
person.name.setter("Definitely not Steve"); // Change the value
```

### unobserve

args:

- `ReturnType<typeof reactive>`

Removes all observers from the reactive Proxy. This will not be called recursively for properties.

### watchEffect

args: `function`
returns: a stop `function`

This works similarly to Vue3 watchEffect:
To apply and automatically re-apply a side effect based on reactive state, we can use the watchEffect method. It runs a function immediately while reactively tracking its dependencies and re-runs it whenever the dependencies are changed.

#### Example

```js
const count = reactive(0);
watchEffect(() => console.log(getValue(count)));
// -> logs 0

count(1);
// -> logs 1
```

### getValue

args: `ReturnType<typeof reactive>`<br>
returns: currently set value

Returns the value inside the the Proxy. getValue is needed because a reactive Proxy does not have access to the value.

#### Example

```js
const person = reactive({ name: "Steve" });
console.log(getValue(person.name)); // Get curent name
```

### setAsyncUpdate

args:

- `ReturnType<typeof reactive>`<br>
- `boolean`

Sets the schedule behavior for DOM Updates that are connected to this Proxy. This will not be called recursively for properties.

### unset

args: ReturnType<typeof reactive>

Deletes the Proxy object and removes all observers (both recursively). This is important for keeping memory low. This happens by setting the value to `null`.

### ternary

args:

- condition: `function | ReturnType<typeof reactive>`
- trueVal: `any`
- falseVal: `any`
- proxy?: `ReturnType<typeof reactive>`

returns: `ReturnType<typeof reactive>`

In order to track a ternary in a template literal, this function has to be used. The proxy parameter (4th) is optional, if the first parameter is a reactive Proxy. Otherwise, the condition function is being executed, whenever the Proxy value changes, which will update the DOM to either the trueVal or the falseVal, depening on the return value. If trueVal is a function, then it will be executed. The same applies for falseVal.

#### Example

```js
const toggleValue = reactive(true);
render(html` <button>${ternary(toggleValue, "ON", "OFF")}</button> `);
setTimeout(() => toggleValue(false), 1e3); // Will re-validate the ternary after 1s
```

### hydro

The actual Proxy in the library. This cannot be used with `getValue`, `observe`, `ternary` or `unset` but it offers the same functionality in a different manner.
<br><em> Special behaviour for promises: the library will await promises and will set its value to the unwrapped value. If the Promise rejects, the value will be unset.</em>
<br><em> Special behaviour for null: null will delete all properties and observer for a value</em>

properties:<br>

- isProxy: `boolean` (default: true)<br>
- asyncUpdate: `boolean`, (default: true, derived from globalSchedule)<br>
- observe: `function`, args: `string` as key, fn: `function`<br>
- unobserve: `function`, args: `string | undefined` - unobserve key or all, , fn: `function`<br>
- getObservers: `function`, returns: map with all observers

#### Example

```js
hydro.fruit = "Banana";
render(html`<span>{{ fruit }}</span>`);
```

### view

Render the elements whenever the data changes. It will handle the operation for deletion, addition, swapping etc. This defaults to a non-keyed solution but it can be changed by calling `setReuseElements` with false.

args:

- root: `string` (CSS selector)<br>
- data: `ReturnType<typeof reactive>`<br>
- renderFunction: `function`, args: item: `any`, i: `number`<br>

#### Example

```js
const data = reactive([{ id: 4, label: "Red Onions" }])
view('.table', data, (item, i) => <tr>Reactive: {data[i].id}, Non-reactive: {item.id}</tr>)
```

### emit

args:

- event: `string`
- data: `any`
- who: `EventTarget`
- options: `object` (default: `{ bubbles: true }`)

Emits an event from the EventTarget <em>who</em>. This event bubbles by default.

#### Example 1

```js
render(
  html`<div onfav=${({ detail: cake }) => console.log(cake)}>
    <p onclick=${({ target }) => emit("fav", "Cheesecake", target)}>
      Click to emit your favorite cake 🍰
    </p>
  </div>`
);
```

#### Example 2

```js
// With event options
render(
  html`<div onfav=${({ detail: cake }) => console.log(cake)}>
    <p
      onclick=${{
        options: {
          once: true,
        },
        event: ({ target }) => emit("fav", "Strawberry Cake", target),
      }}
    >
      Click to emit your favorite cake 🍰
    </p>
  </div>`
);
```

### \$

Shortcut for `querySelector`.

### \$\$

Shortcut for `querySelectorAll`.

### internals

An object with internal data / functions for testing or deeper dives for developers. This only includes a `compare` function for DOM Elements at the moment.

### Attributes

- bind: binds a piece of data to an element. This is only useful, when an element should be removed from the DOM, when the data is being set to null.

#### Example

```js
const data = reactive({ name: "Pet" });
render(html`<p bind=${data}>${data.name}</p>`);
setTimeout(() => unset(data), 1000); // will remove the element
```

### SSR

For Integrations, please refer here: https://github.com/Krutsch/hydro-js-integrations



## Further

To enable HTML highlighting in your files, you could use [leet-html](https://marketplace.visualstudio.com/items?itemName=EldarGerfanov.leet-html) in VS Code.
