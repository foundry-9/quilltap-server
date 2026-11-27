/**
 * seekFrames: a step tried once a frame until it answers true or the frames run out.
 */

import { seekFrames } from '@/components/theme-editor/seek-frames'

describe('seekFrames', () => {
  let queue: FrameRequestCallback[]
  beforeEach(() => {
    queue = []
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      queue.push(cb)
      return queue.length
    })
  })
  afterEach(() => jest.restoreAllMocks())

  const runFrames = () => {
    let ran = 0
    while (queue.length > 0) {
      queue.shift()!(0)
      ran++
    }
    return ran
  }

  it('starts on the next frame, not at once', () => {
    const step = jest.fn(() => true)
    seekFrames(step, 5)
    expect(step).not.toHaveBeenCalled()
    runFrames()
    expect(step).toHaveBeenCalledTimes(1)
  })

  it('stops as soon as the step answers true', () => {
    let calls = 0
    const step = jest.fn(() => ++calls === 3)
    seekFrames(step, 10)
    runFrames()
    expect(step).toHaveBeenCalledTimes(3)
  })

  it('gives up after maxFrames tries', () => {
    const step = jest.fn(() => false)
    seekFrames(step, 4)
    expect(runFrames()).toBe(4)
    expect(step).toHaveBeenCalledTimes(4)
  })
})
