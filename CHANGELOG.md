# Changelog

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
