# Changelog

## 1.8.8 2025-05-29
- fix missing function

## 1.8.7 2025-05-29
- fix bug when rendering the html element in a html element

## 1.8.6 2025-05-22
- update bool attr list and testing elements

## 1.8.5 2025-05-21
- undo change as the error may be in the integration

## 1.8.4 2025-05-21
- fix document instance for jsdom

## 1.8.3 2025-05-16
- move integrations to own package

## 1.8.2 2025-05-12
-fix: move happy-dom and jsdom to deps
 
## 1.8.1 2025-05-12
- fix: build the files and fix types

## 1.8.0 2025-05-12
- ship hydro-js/server for better Vite SSR integration

## 1.7.1 2025-04-08
- fix reactive bug when using SSR with happy-dom

## 1.7.0 2025-04-07
- feat: make library happy-dom compatible

## 1.6.0 2025-04-04
- improve prev change
- remove code from previous change
- feat: make library jsdom compatible

## 1.5.24 2025-04-02
## 1.5.23 2025-04-02
- make use of window object in order to work on the server for upcoming SSR

## 1.5.22 2024-09-29
- export bool attrs

## 1.5.21 2024-09-25
- fix a TypeScript type

## 1.5.20 2024-09-19

- fix correct boolean setting for attr
- add new internal variables for a new project
- improve scheduling

## 1.5.19 2024-06-07

- add function to toggle whether connected should be considered (defaults to false). This can be useful with non-rendered elements in combination with a router

## 1.5.18 2024-02-21

- enable DocumentFragment in h function

## 1.5.17 2024-02-16

- little refactor of html function

## 1.5.16- 2024-02-16

- Fix bug where false variable matched incorrectly in the switch

## 1.5.15- 2024-02-14

- Fix bug where web components where not registered correctly in the h function

## 1.5.14- 2023-04-04

- feat: add inert boolean attribute

## 1.5.13- 2022-04-30

- Undo attribute set twice bugfix as the reactive value was called falsly

## 1.5.12- 2022-04-30

- Fix bug where attribute was set twice
- Fix bug where bool attribute was incorrectly set on JSX elements with reactive function

## 1.5.11- 2022-04-30

- Fix bug where old events where not correctly removed

## 1.5.10- 2022-01-27

- Fix intense memory bug, that lead to Bug too

## 1.5.9- 2022-01-23

- Minor perf upgrade
- Fix bug where setReactivity returned too early

## 1.5.8- 2022-01-19

- Minor perf upgrade
- Added code example

## 1.5.7- 2022-01-06

- Performance and Memory improvements

## 1.5.6- 2022-01-05

- Repair h function

## 1.5.5- 2022-01-02

- Improve TypeScript types of $ and $$

## 1.5.4- 2021-12-30

- Perf Tweak in view function

## 1.5.3- 2021-12-30

- Performance Improvements

## 1.5.2- 2021-12-23

- Fix bug where attributes where not copied from (html|head|body) element

## 1.5.1- 2021-12-23

- Fix bug where document-fragment was added to internal tracking list.

## 1.5.0- 2021-12-22

- Fix bug where two-way bindings did not work on other input element types (type file: can only be set by a user)

## 1.4.7- 2021-12-15

- Bug fix, where variable was undefined
- Rewrite using less inline functions
- Add two pseudo-boolean attributes: draggable and spellcheck

## 1.4.6- 2021-09-22

- Update deps

## 1.4.5- 2021-07-27

- Change checkbox two-way behavior: this will now take a boolean instead of an array associated with the name on the element.
- Fix ternary bug in combination with two-way logic

## 1.4.4- 2021-06-18

- Pass children in h function as prop

## 1.4.3- 2021-05-28

- Use another parser revert

## 1.4.2- 2021-05-27

- Use another parser
- Use cache for setReactivity
- Add minor tweaks

## 1.4.1- 2021-05-21

- Use better RegExp
- Little performance gain

## 1.4.0- 2021-05-06

- Refactor h function. Breaking Change: Does not really support SVG anymore. Use html function for this case.
- Performance improvements
- Add non-keyed solution and default to it

## 1.3.5- 2021-05-03

- Refactor Memory Cleanup
- Add functionality for keyed solutions

## 1.3.4- 2021-04-28

- Run build

## 1.3.3- 2021-04-28

- Add template function
- Revert using setTimeout for setReactivity

## 1.3.2- 2021-04-28

- Fix critical bug

## 1.3.1- 2021-04-28

- Update docs with bind
- Schedule reactivity better

## 1.3.0- 2021-04-14

- Fix props bug with h function
- Refactor scheduler

## 1.2.14- 2021-03-15

- Update deps
- Fix bug regarding scope issues

## 1.2.13- 2021-02-20

- Fix bug where a passed in function would not work in JSX

## 1.2.12- 2021-01-30

- Add experimental h function

## 1.2.11- 2021-01-28

- Fix bugs where diffing did not work well with document fragments

## 1.2.10- 2021-01-25

- Add new function `setShouldSetReactivity`

## 1.2.9- 2021-01-24

- Fix bug where html was not diffable

## 1.2.8- 2021-01-24

- Add support for `html`, `head` and `body` element. The html function can create every element now

## 1.2.7- 2021-01-17

- Add test and update README.md
- Refactor HTML function to use String.raw
- Add new function `watchEffect`

## 1.2.6- 2021-01-01

- Add examples for README.md
- Move test file to dist
- Fix newValue bug in 'observe'

## 1.2.5- 2020-12-22

- Add feat: display empty string instead of undefined for undefined reactive values
- Bump deps

## 1.2.4- 2020-12-17

- Export setReactivity

## 1.2.3- 2020-12-04

- Remove Web Worker goal - tried options:
  - `@ampproject/worker-dom` does not cover enough APIs to make it possible
  - `via.js` does not really make it possible to use the windows object
  - `DOM-Proxy` made it possible to run ~50% of the code but was not efficient enough to make it worthwhile
- Remove Broadcast Channel goal, because this is something that the App Developer has to take care of. Structured cloning will fail for the most important calls
- Add MIT License

## 1.2.2- 2020-11-29

- Improve performance

## 1.2.1- 2020-11-29

- Add deleted .cjs file
- Add CHANGELOG.md
- Refactor schedule logic

## 1.2.0 - 2020-11-24

- Add Code Coverage for 100%
- Improve types
- Fix bind bug
- Improve prformance when comparing elements
- Add functions asyncUpdate and unset for `reactive` Proxy (<em>this functionality already existed on hydro</em>)

## 1.1.1 - 2020-11-24

- Improve performance
- Add support for custom `bind` attribute, that will remove a DOM Element when the Proxy will be removed

## 1.1.0 - 2020-11-22

- Replace internal testing tool with @web/test-runner
- Fix tests

## 1.0.9 - 2020-11-22

- Add npx support to bootstrap starter project

## 1.0.8 - 2020-11-21

- Update README.md and code comments

## 1.0.7 - 2020-11-20

- Add GC Test
- Add support for boolean attributes
- Support export dual module
- Update README.md

## 1.0.6 - 2020-11-16

- Change window.$ to exported value

## 1.0.5 - 2020-11-16

- Update README.md and code comments
- Add test

## 1.0.4 - 2020-11-15

- Add better Support for Promises and DOM Nodes
- Update README.md

## 1.0.3 - 2020-11-15

- No relevant changes

## 1.0.2 - 2020-11-15

- Add Code examples
- Update README.md
- Fix test

## 1.0.1 - 2020-11-15

- Update README.md
