import React, { PureComponent } from 'react'
import PropTypes from 'prop-types'
import { ReactReduxContext } from './Context'

function makeMemoizedChildren() {
  let prevContextProvider, prevContext, prevChildrenProp, prevChildren
  return function memoizedChildren(props, state) {
    const { Provider: NextContextProvider } = props.context || ReactReduxContext
    const nextContext = state.context
    const nextChildrenProp = props.children
    if (
      NextContextProvider === prevContextProvider &&
      nextContext === prevContext &&
      nextChildrenProp === prevChildrenProp
    ) {
      console.warn('memoized return')
      return prevChildren
    }
    prevChildren = (
      <NextContextProvider value={nextContext}>
        {nextChildrenProp}
      </NextContextProvider>
    )
    return prevChildren
  }
}

class Provider extends PureComponent {
  constructor(props) {
    super(props)

    const { store } = props

    this.state = {
      context: {
        // subscribe / getState direct from the context should be tearing-safe
        subscribe: this.childSubscribe.bind(this),
        getState: this.childGetState.bind(this),
        // subscribe / getState from the store are... not
        store
      },
      storeState: store.getState()
    }
    this.subscriptions = new Set()
    this.memoizedChildren = makeMemoizedChildren()
    this.mounted = false
  }

  componentDidMount() {
    this.mounted = true
    // if the redux store updated before the mount,
    // this will cascade into componentDidUpdate
    this.subscribe()
  }

  componentWillUnmount() {
    this.mounted = false
    if (this.unsubscribe) this.unsubscribe()
    this.subscriptions.clear()
  }

  componentDidUpdate(prevProps, prevState) {
    if (this.props.store !== prevProps.store) {
      if (this.unsubscribe) this.unsubscribe()

      this.subscribe()
    }

    // Problem: this converts any async update into a sync one
    // commit phase updates are always sync unless we otherwise
    // defer them, but deferring them would case even more problems.
    // The other option is tearing.
    const { storeState } = this.state
    if (storeState !== prevState.storeState) {
      for (const cb of this.subscriptions) {
        cb(storeState)
      }
    }
  }

  subscribe() {
    const updateState = () => {
      // it's unclear why this gets called even though componentWillUnmount does unsubscribe
      if (!this.mounted) {
        return
      }
      this.setState((_state, props) => {
        return {
          storeState: props.store.getState()
        }
      })
    }

    this.unsubscribe = this.props.store.subscribe(updateState)

    // handle the case where there were updates before we subscribed
    updateState()
  }

  childGetState() {
    return this.state.storeState
  }

  childSubscribe(cb) {
    const { subscriptions } = this
    subscriptions.add(cb)
    return function() {
      subscriptions.delete(cb)
    }
  }

  render() {
    return this.memoizedChildren(this.props, this.state)
  }
}

Provider.propTypes = {
  store: PropTypes.shape({
    subscribe: PropTypes.func.isRequired,
    dispatch: PropTypes.func.isRequired,
    getState: PropTypes.func.isRequired
  }),
  context: PropTypes.object,
  children: PropTypes.any
}

export default Provider
