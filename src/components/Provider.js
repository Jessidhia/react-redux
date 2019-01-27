import React, { Component } from 'react'
import PropTypes from 'prop-types'
import { ReactReduxContext } from './Context'

// TODO: how do we make this work with other renderers?
import ReactDOM from 'react-dom'
const { unstable_batchedUpdates } = ReactDOM

class Provider extends Component {
  constructor(props) {
    super(props)

    const { store } = props

    this.state = {
      subscribe: this.childSubscribe.bind(this),
      store
    }
    this.subscriptions = new Set()
    this.previousState = store.getState()
  }

  componentDidMount() {
    this._isMounted = true
    this.subscribe()
  }

  componentWillUnmount() {
    if (this.unsubscribe) this.unsubscribe()
    this.subscriptions.clear()

    this._isMounted = false
  }

  componentDidUpdate(prevProps) {
    if (this.props.store !== prevProps.store) {
      if (this.unsubscribe) this.unsubscribe()

      this.subscribe()
    }
  }

  subscribe() {
    const { store } = this.props
    const { subscriptions } = this

    const flushUpdates = () => {
      const state = store.getState()
      if (state === this.previousState) {
        return
      }
      this.previousState = state
      unstable_batchedUpdates(() => {
        subscriptions.forEach(cb => {
          cb(state)
        })
      })
    }

    this.unsubscribe = store.subscribe(() => {
      if (this._isMounted) {
        flushUpdates()
      }
    })

    // handle the case where there were updates before we subscribed
    flushUpdates()
  }

  childSubscribe(cb) {
    const { subscriptions } = this
    subscriptions.add(cb)
    // cb(this.previousState)
    return () => subscriptions.delete(cb)
  }

  render() {
    const Context = this.props.context || ReactReduxContext

    return (
      <Context.Provider value={this.state}>
        {this.props.children}
      </Context.Provider>
    )
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
