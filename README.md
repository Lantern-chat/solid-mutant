solid-mutant
============

Mutated data-store for SolidJS, inspired by React-Redux.

## Synopsis

**Redux** relies on immutability and referential equality to allow applications to detect changes. Reducers must not modify state, but return new state with changes. Without a library such as Immer, this is awkward and prone to errors.

**Mutant** instead allows mutations directly, by automatically wrapping all mutators in an Immer-like proxy provided by SolidJS through the `produce` method.

## Actions

Like Redux, Mutant supports dispatching actions that are just simple objects that the mutators then process.

However, Mutant provides built-in support for thunks, promises and arrays of actions. It will attempt to batch together multiple actions within those to avoid thrashing the UI.

## Mutators

As Mutant allows direct mutation of state, the processing of actions can be much simpler.

```js
function mutator(state, action) {
    // handle uninitialized state, see note below for an easier way
    if(!state) {
        state = { value: 0 };
        mutator(state, action);
        return state;
    }

    switch(action.type) {
        case 'increment': {
            state.value++;
            break;
        }
        case 'decrement': {
            state.value--;
            break;
        }
    }
}

let store = createStore(mutator, { value: 0 });

store.dispatch({type: 'increment'});

console.log(store.state.value); // 1
```

However, without an initial state value, mutators are responsible for creating fresh objects and populating them, and **only** if there is no initial state.

To make this easier, the `mutatorWithDefault` method is provided:

```js
const mutator = mutatorWithDefault(
    () => ({value: 0}), // not this is a closure, so a new object is generated
    (state, action) => {
        switch(action.type) {
            case 'increment': {
                state.value++;
                break;
            }
            case 'decrement': {
                state.value--;
                break;
            }
        }
    }
);
```

## Combining Mutators

Furthermore, mutators can be combined to create a larger state via `combineMutators`:
```js
import { user_mutator, cart_mutator } from "./mutators";

const root_mutator = combineMutators({
    user: user_mutator,
    cart: cart_mutator,
});

const store = createStore(root_mutator, {}); // state will be filled in with defaults

console.log(store.state.cart); // ...
```

## Effects and side-effects

After Dispatching an action, it's often desired to be able to perform side-effects. Side-effects are best to be avoided in mutators themselves.

To provide this, `createStore` takes a third argument that is simply a function to perform untracked side-effects.

```js
function some_effect(state, action, dispatch) {
    if(action.type == 'increment') {
        // do whatever, send HTTP requests, command websockets, etc.
        console.log("Incremented!");
    }
}

const store = createStore(mutator, {value: 0}, some_effect);
```

### Patching mutators and effects

The Store value provides methods `replaceMutator` and `replaceEffect` to hot-patch those during runtime, allowing you to defer loading in your main application logic until logged in, for example.

### Usage in SolidJS

Mutant is built directly on SolidJS primitives such as Solid's own `createStore`, and as such all values within the store are nested signals.

Mutant provides a few functions to insert the Store into your component tree, and access it later.

The `Provider` component is a thin wrapper for a context provider, such that:

```jsx
import { createStore, Provider } from "solid-mutant";

const store = createStore(...);

function App() {
    return (
        <Provider store={store}>
            <AppInner/>
        </Provider>
    );
}
```

Then deeper in:
```jsx
function SomeComponent() {
    let store = useStore(), dispatch = useDispatch();

    return (
        <button type="button" onClick={() => dispatch({type: 'increment'})}>
            {store.state.value}
        </button>
    )
}
```

#### Selectors

Or if you're familiar with react-redux's selectors:
```jsx
let value = useSelector(state => state.value);

<div>{value()}</div>
```
Note that this uses an accessor callback like a regular signal.

#### Structured Selectors

Furthermore, structured selectors can be used as such:
```jsx
let stuff = useStructuredSelector({
    a: state => state.some.thing,
    b: state => do_work(state.other.thing),
});

<div>{stuff.a} and {stuff.b}</div>
```

Unlike the regular selector, "structured" selectors use `Object.defineProperty` to make accessing property values easier.

The downside of this is that it uses a custom getter that ties into the state.

To use the result of this structured selector as a regular object, splat it like:
```js
import { createStore as createSolidStore }
let [local, setLocal] = createSolidStore({ ...stuff });
```

A `createStructuredSelector` method exists as well for re-usable structured selectors.

More docs will be added later.