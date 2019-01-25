import hoistStatics from 'hoist-non-react-statics'
import invariant from 'invariant'
import React, { Component, PureComponent } from 'react'
import { isValidElementType, isContextConsumer } from 'react-is'

import { ReactReduxContext } from './Context'

const stringifyComponent = Comp => {
  try {
    return JSON.stringify(Comp)
  } catch (err) {
    return String(Comp)
  }
}

export default function connectAdvanced(
  /*
    selectorFactory is a func that is responsible for returning the selector function used to
    compute new props from state, props, and dispatch. For example:

      export default connectAdvanced((dispatch, options) => (state, props) => ({
        thing: state.things[props.thingId],
        saveThing: fields => dispatch(actionCreators.saveThing(props.thingId, fields)),
      }))(YourComponent)

    Access to dispatch is provided to the factory so selectorFactories can bind actionCreators
    outside of their selector as an optimization. Options passed to connectAdvanced are passed to
    the selectorFactory, along with displayName and WrappedComponent, as the second argument.

    Note that selectorFactory is responsible for all caching/memoization of inbound and outbound
    props. Do not use connectAdvanced directly without memoizing results between calls to your
    selector, otherwise the Connect component will re-render on every state or props change.
  */
  selectorFactory,
  // options object:
  {
    // the func used to compute this HOC's displayName from the wrapped component's displayName.
    // probably overridden by wrapper functions such as connect()
    getDisplayName = name => `ConnectAdvanced(${name})`,

    // shown in error messages
    // probably overridden by wrapper functions such as connect()
    methodName = 'connectAdvanced',

    // REMOVED: if defined, the name of the property passed to the wrapped element indicating the number of
    // calls to render. useful for watching in react devtools for unnecessary re-renders.
    renderCountProp = undefined,

    // determines whether this HOC subscribes to store changes
    shouldHandleStateChanges = true,

    // REMOVED: the key of props/context to get the store
    storeKey = 'store',

    // REMOVED: expose the wrapped component via refs
    withRef = false,

    // use React's forwardRef to expose a ref of the wrapped component
    forwardRef = false,

    // the context consumer to use
    context = ReactReduxContext,

    // additional options are passed through to the selectorFactory
    ...connectOptions
  } = {}
) {
  invariant(
    renderCountProp === undefined,
    `renderCountProp is removed. render counting is built into the latest React dev tools profiling extension`
  )

  invariant(
    !withRef,
    'withRef is removed. To access the wrapped instance, use a ref on the connected component'
  )

  const customStoreWarningMessage =
    'To use a custom Redux store for specific components,  create a custom React context with ' +
    "React.createContext(), and pass the context object to React Redux's Provider and specific components" +
    ' like:  <Provider context={MyContext}><ConnectedComponent context={MyContext} /></Provider>. ' +
    'You may also pass a {context : MyContext} option to connect'

  invariant(
    storeKey === 'store',
    'storeKey has been removed and does not do anything. ' +
      customStoreWarningMessage
  )

  const Context = context

  return function wrapWithConnect(WrappedComponent) {
    if (process.env.NODE_ENV !== 'production') {
      invariant(
        isValidElementType(WrappedComponent),
        `You must pass a component to the function returned by ` +
          `${methodName}. Instead received ${stringifyComponent(
            WrappedComponent
          )}`
      )
    }

    const wrappedComponentName =
      WrappedComponent.displayName || WrappedComponent.name || 'Component'

    const displayName = getDisplayName(wrappedComponentName)

    const selectorFactoryOptions = {
      ...connectOptions,
      getDisplayName,
      methodName,
      renderCountProp,
      shouldHandleStateChanges,
      storeKey,
      displayName,
      wrappedComponentName,
      WrappedComponent
    }

    const { pure } = connectOptions

    let OuterBaseComponent = Component
    let memo = x => x

    if (pure) {
      memo = React.memo || compatMemo
      OuterBaseComponent = PureComponent
    }

    function makeDerivedPropsSelector() {
      let lastProps
      let lastState
      let lastDerivedProps
      let lastStore
      let lastSelectorFactoryOptions
      let sourceSelector

      return function selectDerivedProps(
        state,
        props,
        store,
        selectorFactoryOptions
      ) {
        if (pure && lastProps === props && lastState === state) {
          return lastDerivedProps
        }

        if (
          store !== lastStore ||
          lastSelectorFactoryOptions !== selectorFactoryOptions
        ) {
          lastStore = store
          lastSelectorFactoryOptions = selectorFactoryOptions
          sourceSelector = selectorFactory(
            store.dispatch,
            selectorFactoryOptions
          )
        }

        lastProps = props
        lastState = state

        const nextProps = sourceSelector(state, props)

        lastDerivedProps = nextProps
        return lastDerivedProps
      }
    }

    function makeChildElementSelector() {
      let lastChildProps, lastForwardRef, lastChildElement, lastComponent

      return function selectChildElement(
        WrappedComponent,
        childProps,
        forwardRef
      ) {
        if (
          childProps !== lastChildProps ||
          forwardRef !== lastForwardRef ||
          lastComponent !== WrappedComponent
        ) {
          lastChildProps = childProps
          lastForwardRef = forwardRef
          lastComponent = WrappedComponent
          lastChildElement = (
            <WrappedComponent {...childProps} ref={forwardRef} />
          )
        }

        return lastChildElement
      }
    }

    // We need at least 2, and potentially 3 components (!) for <16.6 compatibility.
    // All because of the lack of React.memo and static contextType. Bumping peerDep
    // to 16.6 would let us put everything in a single component.
    //
    // The only reason for ConnectConsumer to exist is to emulate "static contextType".
    //
    // Not doing it like this breaks the
    // "should allow providing a factory function to mapDispatchToProps" test as the
    // only other way to deal with it is by triggering a cascading update, and a cascading
    // update on a lifecycle gets batched with other updates done in the same lifecycle,
    // breaking the test as it also uses an on mount update to trigger the test case.
    const Connect = memo(
      hoistStatics(
        class Connect extends OuterBaseComponent {
          constructor(props) {
            super(props)
            this.selectDerivedProps = makeDerivedPropsSelector()
            this.selectChildElement = makeChildElementSelector()
            this.indirectHandleSubscription = this.indirectHandleSubscription.bind(
              this
            )
            this.state = {
              storeState: props.contextValue.store.getState()
            }
            this.subscription = undefined
          }

          componentDidMount() {
            this.subscription = this.props.contextValue.subscribe(
              this.indirectHandleSubscription
            )
          }

          componentDidUpdate(prevProps) {
            if (this.props.contextValue !== prevProps.contextValue) {
              this.subscription()
              this.subscription = this.props.contextValue.subscribe(
                this.indirectHandleSubscription
              )
            }
          }

          componentWillUnmount() {
            this.subscription()
          }

          indirectHandleSubscription(storeState) {
            return this.handleSubscription(storeState)
          }

          handleSubscription(storeState) {
            this.setState(() => ({
              storeState
            }))
          }

          render() {
            let forwardedRef
            // eslint-ignore-next-line no-unused-vars
            let { contextValue, ...wrapperProps } = this.props
            contextValue // this is only read to remove it from the ...wrapperProps
            if (forwardRef) {
              forwardedRef = this.props.forwardedRef
              wrapperProps = this.props.wrapperProps
            }

            let derivedProps = this.selectDerivedProps(
              this.state.storeState,
              wrapperProps,
              this.props.contextValue.store,
              selectorFactoryOptions
            )

            return this.selectChildElement(
              WrappedComponent,
              derivedProps,
              forwardedRef
            )
          }
        },
        WrappedComponent
      )
    )

    class ConnectConsumer extends OuterBaseComponent {
      constructor(props) {
        super(props)
        invariant(
          forwardRef ? !props.wrapperProps[storeKey] : !props[storeKey],
          'Passing redux store in props has been removed and does not do anything. ' +
            customStoreWarningMessage
        )
        this.indirectRenderWrappedComponent = this.indirectRenderWrappedComponent.bind(
          this
        )
      }

      indirectRenderWrappedComponent(value) {
        // calling renderWrappedComponent on prototype from indirectRenderWrappedComponent bound to `this`
        return this.renderWrappedComponent(value)
      }

      renderWrappedComponent(value) {
        invariant(
          value,
          `Could not find "store" in the context of ` +
            `"${displayName}". Either wrap the root component in a <Provider>, ` +
            `or pass a custom React context provider to <Provider> and the corresponding ` +
            `React context consumer to ${displayName} in connect options.`
        )

        return <Connect {...this.props} contextValue={value} />
      }

      render() {
        const ContextToUse =
          this.props.context &&
          this.props.context.Consumer &&
          isContextConsumer(<this.props.context.Consumer />)
            ? this.props.context
            : Context

        return (
          <ContextToUse.Consumer>
            {this.indirectRenderWrappedComponent}
          </ContextToUse.Consumer>
        )
      }
    }

    ConnectConsumer.WrappedComponent = WrappedComponent
    ConnectConsumer.displayName = displayName

    if (forwardRef) {
      const forwarded = React.forwardRef(function forwardConnectRef(
        props,
        ref
      ) {
        return <ConnectConsumer wrapperProps={props} forwardedRef={ref} />
      })

      forwarded.displayName = displayName
      forwarded.WrappedComponent = WrappedComponent
      return hoistStatics(forwarded, WrappedComponent)
    }

    return hoistStatics(ConnectConsumer, WrappedComponent)
  }
}

function compatMemo(memoComponent) {
  const memoComponentName = memoComponent.displayName || memoComponent.name

  class CompatMemo extends PureComponent {
    render() {
      return React.createElement(memoComponent, this.props)
    }
  }
  CompatMemo.displayName = memoComponentName
    ? `CompatMemo(${memoComponentName})`
    : undefined
  return hoistStatics(CompatMemo, memoComponent)
}
