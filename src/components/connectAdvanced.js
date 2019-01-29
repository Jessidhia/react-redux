import hoistStatics from 'hoist-non-react-statics'
import invariant from 'invariant'
import warning from '../utils/warning'
import React, { Component, PureComponent } from 'react'
import { isValidElementType, isMemo, isContextConsumer } from 'react-is'

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
    context: Context = ReactReduxContext,

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

  // We use this to infer whether static contextType is supported
  // without doing an actual feature test. They were both introduced
  // in the same release.
  const is16_6 = React.memo !== undefined

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

    const { pure } = connectOptions

    let memo = x => x

    if (pure) {
      // Using memo instead of PureComponent looks redundant,
      // but we make use of memo's ability to only look at `props`
      // to detect when props changed
      memo = React.memo || compatMemo.bind(undefined, forwardRef)
    }

    const MemoWrappedComponent = isMemo(WrappedComponent)
      ? WrappedComponent
      : memo(WrappedComponent)

    const selectorFactoryOptions = {
      ...connectOptions,
      getDisplayName,
      methodName,
      renderCountProp,
      shouldHandleStateChanges,
      storeKey,
      displayName,
      wrappedComponentName,
      WrappedComponent: WrappedComponent
    }
    // if (process.env.NODE_ENV !== 'production') {
    //   Object.freeze(selectorFactoryOptions)
    // }

    function makeDerivedPropsSelector() {
      let lastProps
      let lastState
      let lastDerivedProps
      let lastStore
      let sourceSelector

      return pure
        ? function selectDerivedProps(state, props, store) {
            if (lastProps === props && lastState === state) {
              return lastDerivedProps
            }

            if (store !== lastStore) {
              lastStore = store
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
        : function selectDerivedProps(state, props, store) {
            if (store !== lastStore) {
              lastStore = store
              sourceSelector = selectorFactory(
                store.dispatch,
                selectorFactoryOptions
              )
            }

            return sourceSelector(state, props)
          }
    }

    function getContextToUse({ context }) {
      return context &&
        context.Consumer &&
        isContextConsumer(<context.Consumer />)
        ? context // the context from the props
        : Context // the context given to connectAdvanced
    }

    function getOwnProps(props, ContextToUse) {
      if (forwardRef || props.$$contextValue) {
        return props.wrapperProps
      }
      return props
      if (
        is16_6 &&
        !forwardRef &&
        (ContextToUse || getContextToUse(props)) === Context
      ) {
        return props
      }
      return props.wrapperProps
    }

    function getForwardRefProp(props) {
      if (forwardRef) {
        return props.forwardedRef
      }
      return undefined
    }

    const emptyObject = {}

    class Connect extends (pure ? PureComponent : Component) {
      constructor(rawProps, context) {
        super(rawProps)

        const ContextToUse = getContextToUse(rawProps)
        const props = getOwnProps(rawProps, ContextToUse)

        invariant(
          !props[storeKey],
          'Passing redux store in props has been removed and does not do anything. ' +
            customStoreWarningMessage
        )

        // it is possible to fall from the fast path to the slow path,
        // but not possible to upgrade from the slow path to the fast path
        const fastPath =
          rawProps.$$contextValue || (ContextToUse === Context && is16_6)

        if (fastPath) {
          // this.context can never be undefined, so we need to store
          // whether to access it or not in another variable
          const useContext = ContextToUse === Context && is16_6
          const contextValue = useContext ? context : rawProps.$$contextValue
          invariant(
            contextValue,
            `Could not find "store" in the context of ` +
              `"${displayName}". Either wrap the root component in a <Provider>, ` +
              `or pass a custom React context provider to <Provider> and the corresponding ` +
              `React context consumer to ${displayName} in connect options.`
          )

          const selectDerivedProps = makeDerivedPropsSelector()
          this.state = {
            fastPath,
            useContext,
            contextValue,
            // we need to store the context here so we can
            // downgrade to the slow path if the context in the props changes
            ContextToUse,
            // need this in state so getDerivedStateFromProps can see it
            selectDerivedProps,
            memoizedProps: undefined // to be filled by getDerivedState
          }
          this.subscription = undefined

          this.handleSubscription = shouldHandleStateChanges
            ? storeState => {
                this.setState((state, props) => {
                  const memoizedProps = state.selectDerivedProps(
                    storeState,
                    getOwnProps(props),
                    contextValue.store
                  )
                  return !pure || state.memoizedProps !== memoizedProps
                    ? {
                        memoizedProps
                      }
                    : null
                })
              }
            : undefined
        } else {
          this.state = {
            fastPath
          }

          if (process.env.NODE_ENV !== 'production') {
            // we may need it for a development warning
            this.state.ContextToUse = ContextToUse
          }
        }

        // we could downgrade from fast to slow path so this needs to always be bound
        this.indirectExtractContextValue = this.indirectExtractContextValue.bind(
          this
        )
      }

      static getDerivedStateFromProps(props, prevState) {
        // it's not possible to upgrade to the fast path...... but check if
        // the context was dynamically modified anyway if we are in a development build
        if (process.env.NODE_ENV === 'production' && !prevState.fastPath) {
          return null
        }

        // we should be able to get rid of these "fastPath" shenanigans entirely......
        // by removing the "context" prop and bumping peerdep to 16.6.
        // first, we need to check if we can still stay in the fast path, or
        // if we have to downgrade.
        if (prevState.fastPath) {
          const ContextToUse = getContextToUse(props)

          if (ContextToUse !== prevState.ContextToUse) {
            warning(
              'Dynamically modifying the "context" prop of a connect()ed component ' +
                'may cause the connected component to be completely unmounted and re-mounted'
            )

            return {
              fastPath: false,
              ContextToUse,
              // reset object states to release memory
              contextValue: undefined,
              memoizedProps: undefined,
              selectDerivedProps: undefined
            }
          }
        }

        // the same check that's done at the top but this time for not-production
        if (process.env.NODE_ENV !== 'production' && !prevState.fastPath) {
          return null
        }

        const { $$contextValue } = props
        const { contextValue, selectDerivedProps } = prevState
        if ($$contextValue !== undefined) {
          if ($$contextValue !== contextValue) {
            // return an update that will cascade; we'll read the new value on the next pass
            // changing the contextValue is really expensive but should be really rare
            return { contextValue: $$contextValue }
          }

          const memoizedProps = selectDerivedProps(
            $$contextValue.getState(),
            getOwnProps(props),
            $$contextValue.store
          )
          if (memoizedProps !== prevState.memoizedProps) {
            return { memoizedProps }
          }
          return null
        }
        // We don't have access to this.context,
        // but if we got this far, the context should hopefully
        // have not changed. We'll need a check in componentDidUpdate
        // to cascade back into this if this.context did change.

        const memoizedProps = selectDerivedProps(
          contextValue.getState(),
          getOwnProps(props),
          contextValue.store
        )
        if (memoizedProps !== prevState.memoizedProps) {
          return { memoizedProps }
        }

        return null
      }

      componentDidMount() {
        if (this.state.fastPath) {
          // we only read context from this.context specifically for copying to this.state
          const contextValue = this.state.useContext
            ? this.context
            : this.props.$$contextValue
          if (contextValue !== this.state.contextValue) {
            // this will cascade and the subscription should happen in componentDidUpdate
            this.setState({ contextValue })
          } else if (this.handleSubscription !== undefined) {
            this.subscription = this.state.contextValue.subscribe(
              this.handleSubscription
            )
          }
        }
      }

      componentDidUpdate(_prevProps, prevState) {
        if (prevState.fastPath !== this.state.fastPath) {
          // uh-oh, we just downgraded... unsubscribe from store updates
          if (this.subscription !== undefined) {
            this.subscription()
            this.subscription = undefined
            this.handleSubscription = undefined
          }
        }

        if (this.state.fastPath) {
          const contextValue = this.state.useContext
            ? this.context
            : this.props.$$contextValue

          // we don't need to check this in componentDidMount as we already do in the constructor
          // if the contextValue for some reason disappears in componentDidMount it'll cascade here
          invariant(
            contextValue,
            `Could not find "store" in the context of ` +
              `"${displayName}". Either wrap the root component in a <Provider>, ` +
              `or pass a custom React context provider to <Provider> and the corresponding ` +
              `React context consumer to ${displayName} in connect options.`
          )

          if (contextValue !== this.state.contextValue) {
            this.setState({ contextValue })
          } else if (
            this.handleSubscription !== undefined &&
            this.state.contextValue !== prevState.contextValue
          ) {
            if (this.subscription !== undefined) {
              this.subscription()
            }
            this.subscription = this.state.contextValue.subscribe(
              this.handleSubscription
            )
          }
        }
      }

      componentWillUnmount() {
        if (this.subscription !== undefined) {
          this.subscription()
        }
      }

      indirectExtractContextValue(value) {
        return this.extractContextValue(value)
      }

      extractContextValue(contextValue) {
        invariant(
          contextValue,
          `Could not find "store" in the context of ` +
            `"${displayName}". Either wrap the root component in a <Provider>, ` +
            `or pass a custom React context provider to <Provider> and the corresponding ` +
            `React context consumer to ${displayName} in connect options.`
        )

        let forwardedRef,
          wrapperProps = this.props
        if (forwardRef) {
          wrapperProps = this.props.wrapperProps
          forwardedRef = this.props.forwardedRef
        }

        return (
          <Connect
            context={this.state.ContextToUse}
            wrapperProps={wrapperProps}
            forwardedRef={forwardedRef}
            $$contextValue={contextValue}
          />
        )
      }

      renderContextRead() {
        const ContextToUse = this.state.ContextToUse

        return (
          <ContextToUse.Consumer>
            {this.indirectExtractContextValue}
          </ContextToUse.Consumer>
        )
      }

      render() {
        if (!this.state.fastPath) {
          return this.renderContextRead()
        }

        const { memoizedProps } = this.state
        const forwardedRef = getForwardRefProp(this.props)

        return <MemoWrappedComponent {...memoizedProps} ref={forwardedRef} />
      }
    }

    Connect.contextType = Context

    const MemoConnect = memo(Connect)
    MemoConnect.WrappedComponent = WrappedComponent
    MemoConnect.displayName = displayName

    if (forwardRef) {
      const forwarded = memo(
        React.forwardRef(function forwardConnectRef(props, ref) {
          return <MemoConnect wrapperProps={props} forwardedRef={ref} />
        })
      )

      forwarded.displayName = displayName
      forwarded.WrappedComponent = WrappedComponent

      return hoistStatics(forwarded, WrappedComponent)
    }

    return hoistStatics(MemoConnect, WrappedComponent)
  }
}

function compatMemo(forwardRef, memoComponent) {
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
