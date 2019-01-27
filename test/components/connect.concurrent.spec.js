/*eslint-disable react/prop-types*/

jest.resetModules()
jest.useFakeTimers()

// Temporarily remove addEventListener to force the 'scheduler'
// that will be required by 'react-dom' to use the setTimeout implementation
//
// This is based on the 'scheduler' that 16.6.3 uses; newer schedulers
// check for window.MessageChannel instead which doesn't even exist in jsdom.
const addEventListener = window.addEventListener
window.addEventListener = undefined

// babel-plugin-jest-hoist doesn't hoist resetModules or useFakeTimers,
// so we need to import everything using require. We also need to do
// a version check before actually requiring other things.
//
// NOTE: requiring react-dom **will crash** on versions before 16.6
// when addEventListener is not defined. Coincidentally, 16.6 was
// the version that renamed AsyncMode to ConcurrentMode so
// we only require react-dom and react-test-library if it exists.

const React = require('react')
const { Component } = React

function stringBuilder(prev = '', action) {
  return action.type === 'APPEND' ? prev + action.body : prev
}

describe('React', () => {
  describe('connect', () => {
    const ConcurrentMode = React.ConcurrentMode || React.unstable_ConcurrentMode

    ;(ConcurrentMode ? describe : describe.skip)('ConcurrentMode', () => {
      const { createStore } = require('redux')
      const { Provider: ProviderMock, connect } = require('../../src')
      const rtl = require('react-testing-library')
      const ReactDOM = require('react-dom')
      const { unstable_interactiveUpdates, flushSync } = ReactDOM
      require('jest-dom/extend-expect')

      // rtl.render needs this to be put back, but scheduler should already
      // have loaded its setTimeout-based version that we can control with fake timers
      window.addEventListener = addEventListener

      it("The Provider's view of the store is consistent", () => {
        // i.e.: competing updates should never end up reverting themselves

        const store = createStore(stringBuilder)

        const updated = jest.fn()
        const Container = connect(state => ({ string: state }))(
          class Container extends Component {
            componentDidUpdate() {
              updated(this.props.string)
            }
            render() {
              return this.props.string
            }
          }
        )

        // NOTE: jest itself has a race condition if we mock this here
        // for some reason, we will see errors from other tests.
        // Skip the console.error spying
        // const spy = jest.spyOn(console, 'error').mockImplementation(() => {})

        const tester = rtl.render(
          <ConcurrentMode>
            <ProviderMock store={store}>
              <Container />
            </ProviderMock>
          </ConcurrentMode>
        )

        jest.runAllTimers()

        // expect(spy).toHaveBeenCalledTimes(0)
        // spy.mockRestore()

        // NOTE: this is abusing implementation details of react-reconciler itself.
        // see https://gist.github.com/Jessidhia/49d0915b7e722dc5b49ab9779b5906e8

        // https://github.com/facebook/react/blob/e19c9e10/packages/react-reconciler/src/ReactFiberRoot.js#L32
        const fiberRoot = tester.container._reactRootContainer._internalRoot

        // when there's nothing left for React to do, there won't be any scheduled roots
        expect(fiberRoot.nextScheduledRoot).toBe(null)

        function flushRoot() {
          // while (fiberRoot.nextScheduledRoot !== null) {
          jest.runAllTimers()
          // }
        }

        store.dispatch({ type: 'APPEND', body: 'a' })

        // there is something to do, but it's async and we didn't run the timers,
        // so React couldn't do anything
        expect(fiberRoot.nextScheduledRoot).not.toBe(null)
        expect(updated).toHaveBeenCalledTimes(0)
        expect(tester.container.textContent).toBe('')
        flushRoot()
        expect(fiberRoot.nextScheduledRoot).toBe(null)
        expect(updated).toHaveBeenCalledTimes(1)
        expect(tester.container.textContent).toBe('a')

        store.dispatch({ type: 'APPEND', body: 'b' })
        expect(updated).toHaveBeenCalledTimes(1)
        flushSync(() => {
          store.dispatch({ type: 'APPEND', body: 'c' })
        })
        expect(updated).toHaveBeenCalledTimes(2)
        flushRoot()
        expect(updated).toHaveBeenCalledTimes(2)
        expect(tester.container.textContent).toBe('abc')

        store.dispatch({ type: 'APPEND', body: 'd' })
        unstable_interactiveUpdates(() => {
          expect(store.getState()).toBe('abcd')
          store.dispatch({ type: 'APPEND', body: 'e' })
        })
        // everything we've run so far is synchronous,
        // it's just React that hasn't caught up yet
        expect(store.getState()).toBe('abcde')
        // there should be 3 pending async updates at this point,
        // but we didn't run any timers so nothing should have changed yet
        expect(fiberRoot.nextScheduledRoot).not.toBe(null)
        expect(updated).toHaveBeenCalledTimes(2)
        expect(tester.container.textContent).toBe('abc')

        unstable_interactiveUpdates(() => {
          store.dispatch({ type: 'APPEND', body: 'f' })
        })
        // this interactiveUpdates should cause the
        // previously scheduled interactiveUpdates
        // to run before invoking the callback,
        // but there should still be the new
        // interactiveUpdates pending.
        expect(fiberRoot.nextScheduledRoot).not.toBe(null)
        expect(updated).toHaveBeenCalledTimes(3)
        expect(store.getState()).toBe('abcdef')
        expect(tester.container.textContent).toBe('abcde')

        // add a few more pending updates
        store.dispatch({ type: 'APPEND', body: 'g' })
        store.dispatch({ type: 'APPEND', body: 'h' })
        store.dispatch({ type: 'APPEND', body: 'i' })

        flushSync(() => {
          store.dispatch({ type: 'APPEND', body: 'j' })
        })
        // flushSync still keeps all pending tasks, it just ignores the queue
        expect(fiberRoot.nextScheduledRoot).not.toBe(null)
        // all of the dispatches themselves were sync so
        // the flushSync above will have pushed the latest state,
        // despite there still being pending updates
        expect(updated).toHaveBeenCalledTimes(4)
        expect(tester.container.textContent).toBe('abcdefghij')

        flushRoot()

        // the pending updates will just repeat the latest state
        expect(fiberRoot.nextScheduledRoot).toBe(null)
        expect(updated).toHaveBeenCalledTimes(4)
        expect(tester.container.textContent).toBe('abcdefghij')

        // let's try just interactive updates now.

        unstable_interactiveUpdates(() => {
          store.dispatch({ type: 'APPEND', body: 'k' })
        })
        expect(fiberRoot.nextScheduledRoot).not.toBe(null)
        expect(updated).toHaveBeenCalledTimes(4)
        unstable_interactiveUpdates(() => {
          // unstable_interactiveUpdates should have
          // flushed the previous update before invoking the callback
          expect(fiberRoot.nextScheduledRoot).toBe(null)
          expect(updated).toHaveBeenCalledTimes(5)
          expect(tester.container.textContent).toBe('abcdefghijk')
          store.dispatch({ type: 'APPEND', body: 'l' })
        })

        flushRoot()
        expect(fiberRoot.nextScheduledRoot).toBe(null)
        expect(updated).toHaveBeenCalledTimes(6)
        expect(tester.container.textContent).toBe('abcdefghijkl')
      })
    })
  })
})
