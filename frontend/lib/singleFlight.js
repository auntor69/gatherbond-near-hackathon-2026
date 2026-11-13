// A synchronous guard for user-triggered async actions. React state updates are not
// immediate, so two clicks in the same task can both observe `busy === false`; the ref
// guard closes that window without changing the visible busy state.
export function createSingleFlight() {
  let active = false;

  function begin() {
    if (active) {
      return false;
    }
    active = true;
    return true;
  }

  function end() {
    active = false;
  }

  return { begin, end };
}
