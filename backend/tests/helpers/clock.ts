/** Stops the wall clock at [iso], so tests can say exactly what time it is. Undo with `jest.useRealTimers()`. */
export function setClock(iso: string): void {
  jest.useFakeTimers({
    now: new Date(iso),
    // only Date is faked, so supertest, MongoDB and the Google fakes keep running on real time
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout',
    ],
  });
}

/** Moves the stopped wall clock forward by [milliseconds]. */
export function advanceClock(milliseconds: number): void {
  jest.setSystemTime(Date.now() + milliseconds);
}
