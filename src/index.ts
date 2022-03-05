import { createStore as createSolidStore, produce, unwrap } from "solid-js/store";
import { Accessor, batch, createContext, createMemo, useContext, createComponent } from "solid-js";

export interface Action<T = any> {
    type: T,
}

export interface AnyAction extends Action {
    // Allows any extra properties to be defined in an action.
    [extraProps: string]: any
}

export type Thunk<A extends Action, S> = (dispatch: Dispatch<A, S>, state: DeepReadonly<S>) => void;

// actions, thunks and promises
export type DispatchableAction<A extends Action, S> =
    | A
    | Thunk<A, S>
    | Array<DispatchableAction<A, S>>
    | Promise<DispatchableAction<A, S>>;

export type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> }

export interface Dispatch<A extends Action, S> {
    <T extends A>(action: DispatchableAction<T, S>): void;
}

export interface Mutator<S, A extends Action = AnyAction> {
    (state: undefined, action: A): S;
    (state: S, action: A): void | undefined;

    // if created with mutatorWithDefault, this may be set.
    default?(): S;
}

export interface Store<S = any, A extends Action = AnyAction> {
    state: DeepReadonly<S>;
    dispatch: Dispatch<A, S>;
    replaceMutator(new_mutator: Mutator<S, A>): void;
    replaceEffect(new_effect: Effect<S, A> | null | undefined): void;
}

export interface Effect<S, A extends Action> {
    (state: DeepReadonly<S>, action: A, dispatch: Dispatch<A, S>): void;
}

export function combineEffects<S, A extends Action>(...effects: Array<Effect<S, A>>) {
    return function(state: DeepReadonly<S>, action: A, dispatch: Dispatch<A, S>) {
        for(let effect of effects) {
            effect(state, action, dispatch);
        }
    } as Effect<S, A>;
}

declare const $CombinedState: unique symbol;
interface EmptyObject { readonly [$CombinedState]?: undefined }
export type CombinedState<S> = EmptyObject & S

export type InitialState<S> = Required<S> extends EmptyObject
    ? S extends CombinedState<infer S1> ? { [K in keyof S1]?: S1[K] extends object ? InitialState<S1[K]> : S1[K] } : S
    : { [K in keyof S]: S[K] extends string | number | boolean | symbol ? S[K] : InitialState<S[K]> };

const INIT: Action = { type: '@@INIT' };
export function createStore<S = any, A extends Action = AnyAction>(
    mutator: Mutator<S, A>,
    initial: InitialState<S>,
    effect?: Effect<S, A> | null,
) {
    let [state, setState] = createSolidStore<S>(initial as S, { name: 'MutantStore' }),
        mutate = (action: A) => setState(produce(s => mutator(s as any, action))),
        run: (action: A) => void;

    function replaceEffect(effect: Effect<S, A> | null | undefined) {
        run = effect ? (action: A) => { mutate(action); effect(unwrap(state), action, dispatch) } : mutate;
    }

    function dispatch(action: DispatchableAction<A, S>) {
        // batch is very cheap to nest, so wrap any nested dispatches to defer UI updates
        if(action) batch(() => {
            if(typeof action === 'object' && !!(action as A).type) {
                run(action as A);
            } else if(Array.isArray(action)) {
                // arrays
                action.forEach(dispatch);
            } else if(typeof (action as Promise<DispatchableAction<A, S>>).then === 'function') {
                // promises
                (action as Promise<DispatchableAction<A, S>>).then(dispatch);
            } else if(typeof action === 'function') {
                // thunks
                action(dispatch, state);
            }
        });
    };

    replaceEffect(effect);
    dispatch(INIT as A);

    return {
        state,
        dispatch,
        replaceEffect,
        replaceMutator(new_mutator: Mutator<S, A>) {
            mutator = new_mutator;
            dispatch(INIT as A); // rerun init to refresh changed mutators
        },
    } as Store<S, A>;
}

export type MutatorMap<S = any, A extends Action = AnyAction> = {
    [K in keyof S]: Mutator<S[K], A>
};

export type StateFromMutatorMapObject<M> = M extends MutatorMap
    ? { [P in keyof M]: M[P] extends Mutator<infer S, any> ? S : never }
    : never

export type MutatorFromMutatorMap<M> =
    M extends { [P in keyof M]: infer R } ? (R extends Mutator<any, any> ? R : never) : never

export type ActionFromMutator<M> = M extends Mutator<any, infer A> ? A : never;

export type ActionFromMutatorsMap<M> = M extends MutatorMap
    ? ActionFromMutator<MutatorFromMutatorMap<M>>
    : never

/**
 * Combines mutators from an object key-mutator map via nesting.
 *
 * @param mutators MutatorMap<S, A>
 * @returns Mutator<S, A>
 */
export function combineMutators<M extends MutatorMap>(mutators: M) {
    let keys = Object.keys(mutators);

    return mutatorWithDefault(() => ({}), function(state, action) {
        for(let key of keys) {
            let res = mutators[key](state[key], action);
            if(!!res) { state[key] = res; }
        }
    }) as Mutator<CombinedState<StateFromMutatorMapObject<M>>, ActionFromMutatorsMap<M>>;
}

/**
 * Same as `combineMutators`, but will attempt to filter actions by key prefix to `type`
 *
 * @param mutators  MutatorMap<S, A>
 * @returns Mutator<S, A>
 */
export function combineMutatorsFiltered<M extends MutatorMap>(mutators: M) {
    let keys = Object.keys(mutators);

    return mutatorWithDefault(() => ({}), function(state, action) {
        let can_filter = typeof action.type === 'string';
        for(let key of keys) {
            if(can_filter && !(action.type as string).startsWith(key)) continue;
            let res = mutators[key](state[key], action);
            if(!!res) { state[key] = res; }
        }
    }) as Mutator<CombinedState<StateFromMutatorMapObject<M>>, ActionFromMutatorsMap<M>>;
}

/**
 * Takes a simple half-mutator and allows to to derive a default value automatically.
 *
 * @param default_state () => S
 * @param mutator (state: S, action: A) => void
 * @returns Mutator<S, A>
 */
export function mutatorWithDefault<S = any, A extends Action = AnyAction>(
    default_state: () => S,
    mutator: (state: S, action: A) => void
) {
    function mutate(state: S | undefined, action: A) {
        let has_state = state ? 1 : (state = default_state(), 0);
        mutator(state, action);
        if(!has_state) return state;
        else return;
    }

    mutate.default = default_state;

    return mutate as Mutator<S, A>;
}

export interface MutantContextValue<S = any, A extends Action = AnyAction> {
    store: Store<S, A>;
}

export const MutantContext = /*#__PURE__*/ createContext<MutantContextValue>(null as any);

export interface ProviderProps<S = any, A extends Action = AnyAction> {
    store: Store<S, A>,
    children: any,
}

export function Provider<S = RootStateOrAny, A extends Action = AnyAction>(props: ProviderProps<S, A>) {
    return createComponent(MutantContext.Provider, {
        get value() { return { store: props.store }; },
        get children() { return props.children; }
    });
}

export interface DefaultRootState { };
export type AnyIfEmpty<T extends object> = keyof T extends never ? any : T;
export type RootStateOrAny = AnyIfEmpty<DefaultRootState>;

export function useMutantContext<S = RootStateOrAny, A extends Action = AnyAction>() {
    const contextValue = useContext(MutantContext);

    if(process.env.NODE_ENV !== 'production' && !contextValue) {
        throw new Error('could not find mutant context value; please ensure the component is wrapped in a <Provider>');
    }

    return contextValue as MutantContextValue<S, A>;
}

export function useStore<S = RootStateOrAny, A extends Action = AnyAction>() {
    return useMutantContext().store as Store<S, A>;
}

export function useDispatch<S = RootStateOrAny, A extends Action = AnyAction>() {
    return useStore<S, A>().dispatch;
}

export function useSelector<T, S = RootStateOrAny, A extends Action = AnyAction>(selector: (state: DeepReadonly<S>) => T): Accessor<T> {
    const state = useStore<S, A>().state;
    return createMemo(() => selector(state));
}